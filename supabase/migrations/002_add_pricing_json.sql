-- ============================================================
-- Luminus Bulk Automation — Migration 002
-- Adds pricing_json column to import_items for full pricing tables
-- Run this in Supabase SQL Editor if you already ran 001
-- ============================================================

ALTER TABLE public.import_items
ADD COLUMN IF NOT EXISTS pricing_json jsonb;
