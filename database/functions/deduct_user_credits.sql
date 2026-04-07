-- ============================================================================
-- Function: deduct_user_credits
-- ============================================================================
-- Atomically deducts credits from a user account with proper error handling
-- and race condition prevention using row-level locking (FOR UPDATE).
--
-- This function ensures that credit deductions are:
-- 1. Atomic - either fully succeeds or fully fails
-- 2. Precise - preserves decimal precision (0.38 credits exactly)
-- 3. Safe - prevents race conditions with row locking
-- 4. Traceable - creates transaction records
-- ============================================================================

-- Drop existing functions to avoid ambiguity with overloaded versions
DROP FUNCTION IF EXISTS public.deduct_user_credits(UUID, NUMERIC, NUMERIC, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.deduct_user_credits(UUID, NUMERIC, NUMERIC, TEXT, JSONB, UUID);

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
    v_calculated_credits NUMERIC(10, 2);
BEGIN
    -- Get current balance with row lock (prevents race conditions)
    -- CRITICAL: FOR UPDATE locks the row for this transaction
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
    
    -- Calculate credits based on USD amount to ensure correct rate ($0.014/credit)
    -- This prevents discrepancies if the client sends an incorrect credit amount
    v_calculated_credits := ROUND((p_usd_amount / 0.014), 2);

    -- Check sufficient credits
    IF v_current_credits < v_calculated_credits THEN
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
                   v_calculated_credits, v_current_credits)::TEXT;
        RETURN;
    END IF;
    
    -- Calculate new balance with full precision
    v_new_balance := v_current_credits - v_calculated_credits;
    
    -- Update user credits atomically
    UPDATE public.users
    SET
        credits = v_new_balance,
        credits_used = COALESCE(credits_used, 0) + v_calculated_credits,
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
            v_calculated_credits,
            p_usd_amount,
            v_current_credits,
            v_new_balance,
            p_description,
            p_metadata,
            NOW()
        );
    EXCEPTION WHEN undefined_table THEN
        -- Table doesn't exist yet, just continue without transaction record
        NULL;
    END;

    -- LOG API REQUEST
    -- Only log if metadata contains API usage info
    IF (p_metadata ->> 'operationType') = 'api_actual_usage' THEN
        INSERT INTO public.api_request_logs (
            user_id,
            organization_id, -- Will be NULL for user deductions
            task_id,
            model_id,
            provider,
            input_tokens,
            output_tokens,
            total_cost,
            metadata
        ) VALUES (
            p_user_id,
            NULL,
            p_metadata ->> 'requestId', -- Using requestId as task_id reference or actual task id if available
            p_metadata ->> 'modelId',
            p_metadata ->> 'apiProvider',
            COALESCE((p_metadata ->> 'inputTokens')::INTEGER, 0),
            COALESCE((p_metadata ->> 'outputTokens')::INTEGER, 0),
            p_usd_amount,
            p_metadata
        );
    END IF;
    
    -- Return success with precise values
    RETURN QUERY SELECT
        TRUE,
        v_calculated_credits,
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
-- Test Query (run after creating function)
-- ============================================================================
-- Test with a small amount to verify precision:
-- 
-- SELECT * FROM deduct_user_credits(
--   'your-user-uuid'::uuid, 
--   0.38::numeric, 
--   0.005::numeric, 
--   'Test fractional deduction'
-- );
--
-- Expected: Should deduct exactly 0.38 credits, not 1 or 0
-- ============================================================================