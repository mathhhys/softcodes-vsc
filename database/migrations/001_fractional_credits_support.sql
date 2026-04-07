-- ============================================================================
-- Migration: Add Fractional Credits Support
-- ============================================================================
-- This migration converts the credits column from INTEGER to NUMERIC(10, 2)
-- to support fractional credit deductions (e.g., 0.38 credits)
--
-- IMPORTANT: Backup your database before running this migration!
-- ============================================================================

BEGIN;

-- Step 1: Add new decimal column for credits
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS credits_decimal NUMERIC(10, 2) DEFAULT 0.00;

-- Step 2: Migrate existing integer credits to decimal (preserve all existing values)
UPDATE public.users 
SET credits_decimal = credits::numeric
WHERE credits_decimal IS NULL OR credits_decimal = 0;

-- Step 3: Drop old integer column
ALTER TABLE public.users 
DROP COLUMN IF EXISTS credits CASCADE;

-- Step 4: Rename decimal column to credits
ALTER TABLE public.users 
RENAME COLUMN credits_decimal TO credits;

-- Step 5: Set NOT NULL constraint and default value
ALTER TABLE public.users 
ALTER COLUMN credits SET NOT NULL,
ALTER COLUMN credits SET DEFAULT 0.00;

-- Step 6: Update credits_used to support decimals
ALTER TABLE public.users 
ALTER COLUMN credits_used TYPE NUMERIC(10, 2) USING COALESCE(credits_used, 0)::numeric;

ALTER TABLE public.users 
ALTER COLUMN credits_used SET DEFAULT 0.00;

-- Step 7: Recreate index on credits column
DROP INDEX IF EXISTS idx_users_credits;
CREATE INDEX idx_users_credits ON public.users(credits);

-- Step 8: Add comment explaining the column type
COMMENT ON COLUMN public.users.credits IS 'User credit balance with 2 decimal precision (e.g., 198.62)';
COMMENT ON COLUMN public.users.credits_used IS 'Total credits used by user with 2 decimal precision';

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
--   numeric_scale
-- FROM information_schema.columns 
-- WHERE table_name = 'users' 
--   AND column_name IN ('credits', 'credits_used');
--
-- Expected result:
--   credits      | numeric | 10 | 2
--   credits_used | numeric | 10 | 2
-- ============================================================================