-- ============================================================
-- Luminus Bulk Automation — Migration 003
-- Adds sign-detail fields and multi-image support for vendor-style quotes.
-- Run this in Supabase SQL Editor if you already ran migrations 001/002.
-- ============================================================

ALTER TABLE public.import_items
ADD COLUMN IF NOT EXISTS discounted_price numeric(10,2),
ADD COLUMN IF NOT EXISTS color text,
ADD COLUMN IF NOT EXISTS finish text,
ADD COLUMN IF NOT EXISTS illuminated text,
ADD COLUMN IF NOT EXISTS usage text,
ADD COLUMN IF NOT EXISTS ul_cert text,
ADD COLUMN IF NOT EXISTS permit text,
ADD COLUMN IF NOT EXISTS install text,
ADD COLUMN IF NOT EXISTS discount_code text,
ADD COLUMN IF NOT EXISTS original_image_paths jsonb;
