-- ============================================================================
-- Migration: Add org_id to credit_transactions for unified org/user tracking
-- ============================================================================
-- Adds nullable org_id column to track deductions from organization or user.
-- Supports existing data (org_id NULL for user-only txns).

ALTER TABLE public.credit_transactions
ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id);

-- Index for efficient org-based queries/realtime
CREATE INDEX IF NOT EXISTS idx_credit_transactions_org_id
ON public.credit_transactions(org_id);

-- Verify:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'credit_transactions' AND column_name = 'org_id';
-- Expected: uuid