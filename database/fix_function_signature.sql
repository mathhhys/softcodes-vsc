-- ============================================================================
-- Fix: Replace old deduct_user_credits with new decimal version
-- ============================================================================
-- The old function uses INTEGER credits and returns jsonb
-- The new function uses NUMERIC(10,2) credits and returns TABLE format
-- This script drops the old function and creates the correct new one
-- ============================================================================

-- Step 1: Drop the old function (integer-based, jsonb return)
DROP FUNCTION IF EXISTS public.deduct_user_credits(uuid, integer, numeric, text, jsonb);

-- Step 2: Create the new function with NUMERIC(10,2) parameters and TABLE return
CREATE OR REPLACE FUNCTION public.deduct_user_credits(
    p_user_id UUID,
    p_credits_to_deduct NUMERIC(10, 2),
    p_usd_amount NUMERIC(10, 4),
    p_description TEXT DEFAULT 'Credit deduction',
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(
    success BOOLEAN,
    credits_deducted NUMERIC(10, 2),
    balance_before NUMERIC(10, 2),
    balance_after NUMERIC(10, 2),
    usd_amount NUMERIC(10, 4),
    transaction_id UUID,
    user_id UUID,
    error TEXT,
    message TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_credits NUMERIC(10, 2);
    v_new_balance NUMERIC(10, 2);
    v_transaction_id UUID;
BEGIN
    -- Get current balance with row lock (prevents race conditions)
    SELECT credits INTO v_current_credits
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE; -- CRITICAL: locks the row for the transaction
    
    -- Check if user exists
    IF NOT FOUND THEN
        RETURN QUERY SELECT 
            FALSE, -- success
            0::NUMERIC(10, 2), -- credits_deducted
            0::NUMERIC(10, 2), -- balance_before
            0::NUMERIC(10, 2), -- balance_after
            p_usd_amount, -- usd_amount
            NULL::UUID, -- transaction_id
            p_user_id, -- user_id
            'user_not_found', -- error
            'User not found'::TEXT; -- message
        RETURN;
    END IF;
    
    -- Check sufficient credits
    IF v_current_credits < p_credits_to_deduct THEN
        RETURN QUERY SELECT 
            FALSE,
            0::NUMERIC(10, 2),
            v_current_credits,
            v_current_credits,
            p_usd_amount,
            NULL::UUID,
            p_user_id,
            'insufficient_credits',
            format('Insufficient credits. Required: %s, Available: %s', 
                   p_credits_to_deduct, v_current_credits)::TEXT;
        RETURN;
    END IF;
    
    -- Calculate new balance with full precision
    v_new_balance := v_current_credits - p_credits_to_deduct;
    
    -- Update user credits atomically
    UPDATE public.users
    SET 
        credits = v_new_balance,
        credits_used = COALESCE(credits_used, 0) + p_credits_to_deduct,
        total_spent_usd = COALESCE(total_spent_usd, 0) + p_usd_amount,
        last_credit_update = NOW()
    WHERE id = p_user_id;
    
    -- Create transaction record (if table exists)
    BEGIN
        v_transaction_id := gen_random_uuid();
        
        INSERT INTO public.credit_transactions (
            id,
            user_id,
            operation_type,
            credits_amount,
            usd_amount,
            balance_before,
            balance_after,
            description,
            metadata,
            created_at
        ) VALUES (
            v_transaction_id,
            p_user_id,
            'deduction',
            p_credits_to_deduct,
            p_usd_amount,
            v_current_credits,
            v_new_balance,
            p_description,
            p_metadata,
            NOW()
        );
    EXCEPTION WHEN undefined_table THEN
        -- Table doesn't exist yet, just continue
        NULL;
    END;
    
    -- Return success with precise values
    RETURN QUERY SELECT 
        TRUE,
        p_credits_to_deduct,
        v_current_credits,
        v_new_balance,
        p_usd_amount,
        v_transaction_id,
        p_user_id,
        NULL::TEXT,
        'Credit deduction successful'::TEXT;
END;
$$;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.deduct_user_credits TO service_role;

-- Add comment explaining the function
COMMENT ON FUNCTION public.deduct_user_credits IS 
'Atomically deducts credits from user account with row-level locking to prevent race conditions. Supports fractional credits with 2 decimal precision (e.g., 0.38 credits).';

-- ============================================================================
-- Verification Queries
-- ============================================================================

-- 1. Verify old function is gone
SELECT 'Old function should not exist' as status, count(*) as count
FROM pg_proc 
WHERE proname = 'deduct_user_credits' 
  AND proargtypes = '(uuid, integer, numeric, text, jsonb)'::oidvector;

-- Expected: count = 0

-- 2. Verify new function exists
SELECT 'New function created' as status, proname, pg_get_function_arguments('public.deduct_user_credits'::regproc)
FROM pg_proc 
WHERE proname = 'deduct_user_credits';

-- Expected: p_user_id uuid, p_credits_to_deduct numeric(10,2), p_usd_amount numeric(10,4), p_description text, p_metadata jsonb

-- 3. Test the new function (replace YOUR_USER_UUID with actual UUID)
-- SELECT * FROM deduct_user_credits(
--   'YOUR_USER_UUID'::uuid,
--   0.38::numeric(10,2),
--   0.005::numeric(10,4),
--   'Test fractional deduction',
--   '{}'::jsonb
-- );

-- 4. Check your current credits column type
SELECT column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns 
WHERE table_name = 'users' AND column_name = 'credits';

-- Expected: numeric | 10 | 2

-- ============================================================================
-- After running this, the function will support fractional credits!
-- The old integer version has been dropped and replaced with NUMERIC(10,2)
-- ============================================================================