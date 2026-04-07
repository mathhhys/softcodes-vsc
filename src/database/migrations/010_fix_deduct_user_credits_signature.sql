-- ============================================================================
-- Migration: Fix deduct_user_credits function signature conflict
-- ============================================================================
-- This migration resolves the 300 "Multiple Choices" error by:
-- 1. Dropping the old integer-based function with JSONB return and p_request_id
-- 2. Ensuring only the new NUMERIC(10,2)-based function with TABLE return exists
-- 3. Adding proper error handling and verification
-- 
-- Run this in Supabase SQL Editor after backing up your database
-- ============================================================================

-- Step 1: Identify and drop the old conflicting function signature
-- The old function uses: integer credits, JSONB return, includes p_request_id
DROP FUNCTION IF EXISTS public.deduct_user_credits(uuid, integer, numeric, text, jsonb, text);

-- Step 2: Drop any other potential conflicting signatures
-- This covers variations that might exist from previous deployments
DROP FUNCTION IF EXISTS public.deduct_user_credits(uuid, integer, numeric, text, jsonb);
DROP FUNCTION IF EXISTS public.deduct_user_credits(uuid, integer, numeric);

-- Step 3: Create/Recreate the correct modern function
-- Uses NUMERIC(10,2) for fractional credits, returns TABLE for structured results
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
    -- Validate inputs
    IF p_credits_to_deduct <= 0 THEN
        RETURN QUERY SELECT 
            FALSE, -- success
            0::NUMERIC(10, 2), -- credits_deducted
            0::NUMERIC(10, 2), -- balance_before
            0::NUMERIC(10, 2), -- balance_after
            p_usd_amount, -- usd_amount
            NULL::UUID, -- transaction_id
            p_user_id, -- user_id
            'invalid_amount'::TEXT, -- error
            'Credits to deduct must be positive'::TEXT; -- message
        RETURN;
    END IF;

    IF p_usd_amount <= 0 THEN
        RETURN QUERY SELECT 
            FALSE,
            0::NUMERIC(10, 2),
            0::NUMERIC(10, 2),
            0::NUMERIC(10, 2),
            p_usd_amount,
            NULL::UUID,
            p_user_id,
            'invalid_usd_amount'::TEXT,
            'USD amount must be positive'::TEXT;
        RETURN;
    END IF;

    -- Get current balance with row lock (prevents race conditions)
    SELECT credits INTO v_current_credits
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE;
    
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
            'user_not_found'::TEXT, -- error
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
            'insufficient_credits'::TEXT,
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
        -- Table doesn't exist yet, just continue without transaction record
        v_transaction_id := NULL;
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

-- Step 4: Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.deduct_user_credits TO service_role;
GRANT EXECUTE ON FUNCTION public.deduct_user_credits TO authenticated;

-- Step 5: Add function comment for documentation
COMMENT ON FUNCTION public.deduct_user_credits IS 
'Atomically deducts credits from user account with row-level locking to prevent race conditions. Supports fractional credits with 2 decimal precision (e.g., 0.38 credits). Returns TABLE structure for structured results.';

-- Step 6: Verification queries
-- Run these to confirm the fix worked:

-- Verify only one function signature exists
SELECT 
    proname AS function_name,
    pg_get_function_arguments(oid) AS arguments,
    pg_get_function_result(oid) AS return_type,
    prosrc AS definition_preview
FROM pg_proc 
WHERE proname = 'deduct_user_credits' 
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY proargtypes;

-- Test the function (replace with a real user ID and small test amount)
-- SELECT * FROM deduct_user_credits(
--   'your-test-user-uuid'::uuid, 
--   0.01::numeric,  -- Small test amount
--   0.0001::numeric, 
--   'Migration test deduction'
-- );

-- Expected result: Single row with success=true if user exists and has credits
-- If you see multiple rows or 300 error, the migration didn't fully resolve conflicts

-- ============================================================================
-- Migration Complete
-- After running this, update your TypeScript code to handle TABLE return:
-- const { data, error } = await supabase.rpc('deduct_user_credits', params);
-- if (data && data.length > 0) {
--   const result = data[0];  // First row contains the result
-- }
-- ============================================================================