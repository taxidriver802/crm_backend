-- Phase 21: company branding (preset mark + owner-managed look)
-- Idempotent. palette_id already exists; this adds mark_id for preset marks.
-- Custom uploaded logos stay on logo_storage_key.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS mark_id TEXT NOT NULL DEFAULT 'product';
