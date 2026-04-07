-- ============================================================================
-- Migration: Rename organizations.credits -> organizations.total_credits
-- ============================================================================
-- Production uses `public.organizations.total_credits` as the current available
-- organization balance. Older environments (and earlier repo migrations) used
-- `public.organizations.credits`.
--
-- This migration:
-- 1) Renames `credits` -> `total_credits` if `total_credits` does not exist
-- 2) Ensures `total_credits` exists with NOT NULL + default
-- 3) Renames/creates a supporting index
-- 4) Updates the column comment
-- ============================================================================

BEGIN;

-- 1) Conditionally rename the column (only if total_credits doesn't already exist)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organizations'
      AND column_name = 'credits'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organizations'
      AND column_name = 'total_credits'
  ) THEN
    ALTER TABLE public.organizations RENAME COLUMN credits TO total_credits;
  END IF;
END $$;

-- 2) Ensure total_credits exists for all environments (new + existing)
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS total_credits NUMERIC(10, 2) DEFAULT 0.00 NOT NULL;

-- 3) Rename old index if present (optional but keeps naming consistent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i'
      AND n.nspname = 'public'
      AND c.relname = 'idx_organizations_credits'
  ) THEN
    ALTER INDEX public.idx_organizations_credits RENAME TO idx_organizations_total_credits;
  END IF;
END $$;

-- Ensure the new index exists (idempotent)
CREATE INDEX IF NOT EXISTS idx_organizations_total_credits ON public.organizations(total_credits);

-- 4) Update comment (renaming keeps old comment, but we normalize text)
COMMENT ON COLUMN public.organizations.total_credits IS
'Organization credit balance with 2 decimal precision (e.g., 198.62)';

COMMIT;