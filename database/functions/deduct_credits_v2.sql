-- ============================================================================
-- Function: deduct_user_credits (Updated for Organization Support)
-- ============================================================================
-- Atomically deducts credits from a user OR organization account.
-- If p_org_id is provided, deducts from the organization.
-- Otherwise, deducts from the user.
-- ============================================================================

-- Drop the old function signature to prevent ambiguity
DROP FUNCTION IF EXISTS public.deduct_user_credits(UUID, NUMERIC, NUMERIC, TEXT, JSONB);

-- Create the new function with the additional p_org_id parameter
CREATE OR REPLACE FUNCTION public.deduct_user_credits(
    p_user_id UUID,
    p_credits_to_deduct NUMERIC(10, 2),
    p_usd_amount NUMERIC(10, 4),
    p_description TEXT DEFAULT 'Credit deduction',
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_org_id UUID DEFAULT NULL
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
    -- Calculate credits based on USD amount to ensure correct rate ($0.014/credit)
    v_calculated_credits := ROUND((p_usd_amount / 0.014), 2);

    IF p_org_id IS NOT NULL THEN
        -- ====================================================================
        -- ORGANIZATION DEDUCTION LOGIC
        -- ====================================================================
        
        -- Get current balance with row lock
        SELECT total_credits INTO v_current_credits
        FROM public.organizations
        WHERE id = p_org_id
        FOR UPDATE;
        
        -- Check if organization exists
        IF NOT FOUND THEN
            RETURN QUERY SELECT 
                FALSE, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, p_usd_amount, NULL::UUID, p_user_id,
                'organization_not_found'::TEXT, 'Organization not found'::TEXT;
            RETURN;
        END IF;
        
        -- Check sufficient credits
        IF v_current_credits < v_calculated_credits THEN
            RETURN QUERY SELECT
                FALSE, 0::NUMERIC, v_current_credits, v_current_credits, p_usd_amount, NULL::UUID, p_user_id,
                'insufficient_credits'::TEXT,
                format('Insufficient organization credits. Required: %s, Available: %s', v_calculated_credits, v_current_credits)::TEXT;
            RETURN;
        END IF;
        
        -- Calculate new balance
        v_new_balance := v_current_credits - v_calculated_credits;
        
        -- Update organization credits
        UPDATE public.organizations
        SET
            total_credits = v_new_balance,
            credits_used = COALESCE(credits_used, 0) + v_calculated_credits,
            total_spent_usd = COALESCE(total_spent_usd, 0) + p_usd_amount,
            last_credit_update = NOW()
        WHERE id = p_org_id;
        
    ELSE
        -- ====================================================================
        -- USER DEDUCTION LOGIC (Legacy)
        -- ====================================================================
        
        -- Get current balance with row lock
        SELECT credits INTO v_current_credits
        FROM public.users
        WHERE id = p_user_id
        FOR UPDATE;
        
        -- Check if user exists
        IF NOT FOUND THEN
            RETURN QUERY SELECT 
                FALSE, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, p_usd_amount, NULL::UUID, p_user_id,
                'user_not_found'::TEXT, 'User not found'::TEXT;
            RETURN;
        END IF;
        
        -- Check sufficient credits
        IF v_current_credits < v_calculated_credits THEN
            RETURN QUERY SELECT
                FALSE, 0::NUMERIC, v_current_credits, v_current_credits, p_usd_amount, NULL::UUID, p_user_id,
                'insufficient_credits'::TEXT,
                format('Insufficient user credits. Required: %s, Available: %s', v_calculated_credits, v_current_credits)::TEXT;
            RETURN;
        END IF;
        
        -- Calculate new balance
        v_new_balance := v_current_credits - v_calculated_credits;
        
        -- Update user credits
        UPDATE public.users
        SET
            credits = v_new_balance,
            credits_used = COALESCE(credits_used, 0) + v_calculated_credits,
            total_spent_usd = COALESCE(total_spent_usd, 0) + p_usd_amount,
            last_credit_update = NOW()
        WHERE id = p_user_id;
    END IF;
    
    -- ====================================================================
    -- TRANSACTION RECORDING (Common)
    -- ====================================================================
    
    -- Create transaction record
    BEGIN
        v_transaction_id := gen_random_uuid();
        
        -- Add organization_id to metadata if present
        IF p_org_id IS NOT NULL THEN
            p_metadata := p_metadata || jsonb_build_object('organization_id', p_org_id);
        END IF;
        
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
        -- Table doesn't exist yet, just continue
        NULL;
    END;

    -- LOG API REQUEST
    IF (p_metadata ->> 'operationType') = 'api_actual_usage' THEN
        DECLARE
            v_log_user_id UUID;
        BEGIN
            -- Try to extract user_id from metadata if available (passed from extension)
            BEGIN
                v_log_user_id := (p_metadata ->> 'userId')::UUID;
            EXCEPTION WHEN OTHERS THEN
                v_log_user_id := NULL;
            END;

            INSERT INTO public.api_request_logs (
                user_id,
                organization_id,
                task_id,
                model_id,
                provider,
                input_tokens,
                output_tokens,
                total_cost,
                metadata
            ) VALUES (
                COALESCE(v_log_user_id, CASE WHEN p_org_id IS NULL THEN p_user_id ELSE NULL END),
                p_org_id,
                p_metadata ->> 'requestId',
                p_metadata ->> 'modelId',
                p_metadata ->> 'apiProvider',
                COALESCE((p_metadata ->> 'inputTokens')::INTEGER, 0),
                COALESCE((p_metadata ->> 'outputTokens')::INTEGER, 0),
                p_usd_amount,
                p_metadata
            );
        END;
    END IF;
    
    -- Return success
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

-- Grant necessary permissions (specify arguments to be safe)
GRANT EXECUTE ON FUNCTION public.deduct_user_credits(UUID, NUMERIC, NUMERIC, TEXT, JSONB, UUID) TO service_role;

-- Add comment (specify arguments to be safe)
COMMENT ON FUNCTION public.deduct_user_credits(UUID, NUMERIC, NUMERIC, TEXT, JSONB, UUID) IS 
'Atomically deducts credits from user OR organization account. If p_org_id is provided, deducts from organization.';