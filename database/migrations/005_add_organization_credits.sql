-- ============================================================================
-- Migration: Add Credit Support to Organizations Table
-- ============================================================================
-- This migration adds credit-related columns to the organizations table
-- to support organization-level credit management
-- ============================================================================

BEGIN;

-- Add credit columns to organizations table
-- NOTE: Production uses `total_credits` as the current available organization balance.
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS total_credits NUMERIC(10, 2) DEFAULT 0.00 NOT NULL;

ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS credits_used NUMERIC(10, 2) DEFAULT 0.00;

ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS total_spent_usd NUMERIC(10, 4) DEFAULT 0.00;

ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS last_credit_update TIMESTAMPTZ;

ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'free';

-- Create index on total_credits column for performance
CREATE INDEX IF NOT EXISTS idx_organizations_total_credits ON public.organizations(total_credits);

-- Add comments explaining the columns
COMMENT ON COLUMN public.organizations.total_credits IS 'Organization credit balance with 2 decimal precision (e.g., 198.62)';
COMMENT ON COLUMN public.organizations.credits_used IS 'Total credits used by organization with 2 decimal precision';
COMMENT ON COLUMN public.organizations.total_spent_usd IS 'Total USD amount spent by organization';
COMMENT ON COLUMN public.organizations.last_credit_update IS 'Timestamp of last credit update';
COMMENT ON COLUMN public.organizations.plan_type IS 'Organization subscription plan type (free, pro, enterprise)';

COMMIT;

-- ============================================================================
-- Verification Query (run after migration)
-- ============================================================================
-- Run this to verify the migration was successful:
-- 
-- SELECT 
--   column_name, 
--   data_type, 
--   numeric_precision, 
--   numeric_scale,
--   column_default
-- FROM information_schema.columns 
-- WHERE table_name = 'organizations' 
--   AND column_name IN ('credits', 'credits_used', 'total_spent_usd', 'last_credit_update', 'plan_type');
-- ============================================================================