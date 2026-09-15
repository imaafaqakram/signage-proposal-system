-- ============================================================
-- Luminus — Saved Leads (Migration 004)
-- Persists every lead pulled from the CRM import script, with full version
-- history, so recalling or editing one never needs another CRM/AI round trip.
-- Run this in Supabase SQL Editor after migrations 001-003.
--
-- No RLS on these two tables, unlike import_batches/import_clients/import_items:
-- this app has no real per-user Supabase Auth (VITE_ADMIN_BYPASS_MODE is a single
-- shared password, not auth.users accounts), so an auth.uid()-based policy would
-- never match anything. Server-side code (server.js locally, api/leads.js on
-- Vercel) uses the service-role key, which bypasses RLS regardless.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.leads (
  id             bigserial PRIMARY KEY,
  crm_record_id  text UNIQUE,
  client_name    text NOT NULL,
  contact_email  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_versions (
  id              bigserial PRIMARY KEY,
  lead_id         bigint NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  version_number  int NOT NULL,
  data            jsonb NOT NULL,
  label           text,
  source          text NOT NULL DEFAULT 'manual',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lead_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_lead_versions_lead_id
  ON public.lead_versions (lead_id);

-- ============================================================
-- DONE. Verify by running:
--   SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
-- You should see leads and lead_versions alongside the existing import_* tables.
-- ============================================================
