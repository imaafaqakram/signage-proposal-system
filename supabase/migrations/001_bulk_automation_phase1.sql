-- ============================================================
-- Luminus Bulk Automation — Phase 1 Data Model
-- Run this entire script in the Supabase SQL Editor
-- (Project → SQL Editor → New Query → Paste → Run)
-- ============================================================


-- ============================================================
-- 1. ENUM TYPE: Status machine for the batch pipeline
-- ============================================================
-- Drop old type if re-running
DROP TYPE IF EXISTS import_status CASCADE;

CREATE TYPE import_status AS ENUM (
  'extracted',
  'validating',
  'needs_manual_check',
  'queued_for_processing',
  'processing_images',
  'ready_for_review',
  'approved',
  'rejected',
  'sent',
  'failed'
);


-- ============================================================
-- 2. TABLE: import_batches
--    One row per bulk upload session (up to 50 PDFs at once)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.import_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by       uuid REFERENCES auth.users ON DELETE SET NULL,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  discount_percent  numeric(5,2) NOT NULL DEFAULT 0,
  status            import_status NOT NULL DEFAULT 'extracted',
  total_clients     int NOT NULL DEFAULT 0,
  notes             text
);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

-- Authenticated users can see and manage their own batches
CREATE POLICY "Users manage their own batches"
  ON public.import_batches
  FOR ALL
  USING (auth.uid() = uploaded_by)
  WITH CHECK (auth.uid() = uploaded_by);


-- ============================================================
-- 3. TABLE: import_clients
--    One row per PDF file (= one client in a batch)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.import_clients (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         uuid NOT NULL REFERENCES public.import_batches ON DELETE CASCADE,
  client_name      text NOT NULL,
  client_email     text NOT NULL,
  status           import_status NOT NULL DEFAULT 'extracted',
  source_pdf_path  text,        -- Supabase Storage path to the raw uploaded PDF
  final_pdf_path   text,        -- Supabase Storage path to the assembled proposal PDF
  validation_flags jsonb,       -- e.g. { "email_invalid": true }
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.import_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage clients in their batches"
  ON public.import_clients
  FOR ALL
  USING (
    batch_id IN (
      SELECT id FROM public.import_batches WHERE uploaded_by = auth.uid()
    )
  );

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_import_clients_updated_at
  BEFORE UPDATE ON public.import_clients
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


-- ============================================================
-- 4. TABLE: import_items
--    One row per sign / page within a client's PDF
-- ============================================================
CREATE TABLE IF NOT EXISTS public.import_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               uuid NOT NULL REFERENCES public.import_clients ON DELETE CASCADE,
  page_number             int NOT NULL DEFAULT 1,

  -- Extracted fields
  sign_type               text,
  size                    text,
  original_price          numeric(10,2),
  discounted_price      numeric(10,2),    -- discounted/final price from the quote
  adjusted_price          numeric(10,2),    -- after batch discount applied
  pricing_json            jsonb,            -- full pricing table: [{size, dim, cost, discounted_cost}]

  -- Sign details
  color                   text,
  finish                  text,
  illuminated             text,
  usage                   text,
  ul_cert                 text,
  permit                  text,
  install                 text,
  discount_code           text,

  -- Image paths (Supabase Storage)
  original_image_path     text,             -- deprecated: first extracted image
  original_image_paths  jsonb,            -- all extracted images from the PDF
  regenerated_image_path  text,             -- AI-generated output

  -- AI generation tracking
  generation_model        text,             -- 'nano-banana-pro' | 'gpt-image-2'
  fallback_reason         text,             -- e.g. 'api_error', 'timeout', 'rate_limited'
  generation_cost_usd     numeric(8,6),     -- per-item cost for cost tracking

  -- Validation
  validation_flags        jsonb,            -- e.g. { "price_non_numeric": true }

  status                  import_status NOT NULL DEFAULT 'extracted',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.import_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage items in their clients"
  ON public.import_items
  FOR ALL
  USING (
    client_id IN (
      SELECT ic.id FROM public.import_clients ic
      JOIN public.import_batches ib ON ib.id = ic.batch_id
      WHERE ib.uploaded_by = auth.uid()
    )
  );

CREATE TRIGGER trg_import_items_updated_at
  BEFORE UPDATE ON public.import_items
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


-- ============================================================
-- 5. INDEXES — keep queries fast as batches grow
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_import_clients_batch_id
  ON public.import_clients (batch_id);

CREATE INDEX IF NOT EXISTS idx_import_clients_status
  ON public.import_clients (status);

CREATE INDEX IF NOT EXISTS idx_import_items_client_id
  ON public.import_items (client_id);

CREATE INDEX IF NOT EXISTS idx_import_items_status
  ON public.import_items (status);


-- ============================================================
-- 6. STORAGE BUCKETS
--    Run these lines too — they create the storage buckets
--    for raw PDFs and AI-generated images.
-- ============================================================

-- Bucket for raw uploaded PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('import-pdfs', 'import-pdfs', false)
ON CONFLICT (id) DO NOTHING;

-- Bucket for generated/processed images
INSERT INTO storage.buckets (id, name, public)
VALUES ('import-images', 'import-images', true)
ON CONFLICT (id) DO NOTHING;

-- Only authenticated users can upload to import-pdfs
CREATE POLICY "Auth users upload import PDFs"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'import-pdfs' AND auth.role() = 'authenticated');

CREATE POLICY "Auth users read import PDFs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'import-pdfs' AND auth.role() = 'authenticated');

-- import-images is public (links go in proposal emails)
CREATE POLICY "Public read import images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'import-images');

CREATE POLICY "Auth users upload import images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'import-images' AND auth.role() = 'authenticated');


-- ============================================================
-- DONE. Verify by running:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public';
-- You should see: import_batches, import_clients, import_items
-- ============================================================
