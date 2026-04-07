-- ============================================================================
-- Migration: Log API Requests during Credit Deduction
-- ============================================================================
-- Updates deduct_user_credits and deduct_org_credits to automatically log
-- API usage details to the api_request_logs table.
-- This ensures perfect synchronization between billing and usage analytics.
-- ============================================================================

BEGIN;

-- 1. Update deduct_user_credits
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
    
    -- Calculate credits based on USD amount ($0.014/credit)
    v_calculated_credits := ROUND((p_usd_amount / 0.014), 2);

    -- Check sufficient credits
    IF v_current_credits < v_calculated_credits THEN
        RETURN QUERY SELECT
            FALSE, 0::NUMERIC, v_current_credits, v_current_credits, p_usd_amount, NULL::UUID, p_user_id,
            'insufficient_credits'::TEXT,
            format('Insufficient credits. Required: %s, Available: %s', v_calculated_credits, v_current_credits)::TEXT;
        RETURN;
    END IF;
    
    -- Calculate new balance
    v_new_balance := v_current_credits - v_calculated_credits;
    
    -- Update user credits atomically
    UPDATE public.users
    SET
        credits = v_new_balance,
        credits_used = COALESCE(credits_used, 0) + v_calculated_credits,
        total_spent_usd = COALESCE(total_spent_usd, 0) + p_usd_amount,
        last_credit_update = NOW()
    WHERE id = p_user_id;
    
    -- Create transaction record
    v_transaction_id := gen_random_uuid();
    
    INSERT INTO public.credit_transactions (
        id, user_id, operation_type, credits_amount, usd_amount,
        balance_before, balance_after, description, metadata, created_at
    ) VALUES (
        v_transaction_id, p_user_id, 'deduction', v_calculated_credits, p_usd_amount,
        v_current_credits, v_new_balance, p_description, p_metadata, NOW()
    );

    -- LOG API REQUEST (New Logic)
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
    
    -- Return success
    RETURN QUERY SELECT
        TRUE, v_calculated_credits, v_current_credits, v_new_balance, p_usd_amount,
        v_transaction_id, p_user_id, NULL::TEXT, 'Credit deduction successful'::TEXT;
END;
$$;

-- 2. Update deduct_org_credits
CREATE OR REPLACE FUNCTION public.deduct_org_credits(
  p_org_id UUID,
  p_credits_to_deduct NUMERIC(10,2),
  p_usd_amount NUMERIC(10,4),
  p_description TEXT DEFAULT 'Org credit deduction',
  p_metadata JSONB DEFAULT '{}'
)
RETURNS TABLE (
  success BOOLEAN,
  credits_deducted NUMERIC(10,2),
  balance_before NUMERIC(10,2),
  balance_after NUMERIC(10,2),
  usd_amount NUMERIC(10,4),
  transaction_id UUID,
  org_id UUID,
  error TEXT,
  message TEXT
) AS $$
DECLARE
  v_balance_before NUMERIC(10,2);
  v_balance_after NUMERIC(10,2);
  v_tx_id UUID := gen_random_uuid();
  v_user_id UUID;
BEGIN
  -- Lock the organization row
  PERFORM 1 FROM public.organizations WHERE id = p_org_id FOR UPDATE NOWAIT;
  
  -- Get current balance
  SELECT total_credits INTO v_balance_before
  FROM public.organizations
  WHERE id = p_org_id;
  
  -- Check sufficient credits
  IF COALESCE(v_balance_before, 0) < p_credits_to_deduct THEN
    RETURN QUERY SELECT 
      false, NULL::NUMERIC, v_balance_before, NULL::NUMERIC, p_usd_amount, NULL::UUID, p_org_id,
      'insufficient_credits'::TEXT,
      format('Insufficient credits. Required: %s, Available: %s', p_credits_to_deduct, v_balance_before)::TEXT;
    RETURN;
  END IF;

  -- Deduct credits
  UPDATE public.organizations
  SET
    total_credits = total_credits - p_credits_to_deduct,
    credits_used = COALESCE(credits_used, 0) + p_credits_to_deduct,
    total_spent_usd = COALESCE(total_spent_usd, 0) + p_usd_amount,
    last_credit_update = NOW()
  WHERE id = p_org_id
  RETURNING total_credits INTO v_balance_after;

  -- Create transaction record
  INSERT INTO public.credit_transactions (
      id, org_id, operation_type, credits_amount, usd_amount,
      balance_before, balance_after, description, metadata, created_at
  ) VALUES (
      v_tx_id, p_org_id, 'deduction', p_credits_to_deduct, p_usd_amount,
      v_balance_before, v_balance_after, p_description, p_metadata, NOW()
  );

  -- LOG API REQUEST (New Logic)
  IF (p_metadata ->> 'operationType') = 'api_actual_usage' THEN
      -- Try to extract user_id from metadata if available (passed from extension)
      -- Note: The extension might need to be updated to pass userId in metadata for org deductions
      BEGIN
        v_user_id := (p_metadata ->> 'userId')::UUID;
      EXCEPTION WHEN OTHERS THEN
        v_user_id := NULL;
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
          v_user_id, -- Might be NULL if not passed
          p_org_id::TEXT,
          p_metadata ->> 'requestId',
          p_metadata ->> 'modelId',
          p_metadata ->> 'apiProvider',
          COALESCE((p_metadata ->> 'inputTokens')::INTEGER, 0),
          COALESCE((p_metadata ->> 'outputTokens')::INTEGER, 0),
          p_usd_amount,
          p_metadata
      );
  END IF;

  -- Return success
  RETURN QUERY SELECT 
    true, p_credits_to_deduct, v_balance_before, v_balance_after, p_usd_amount,
    v_tx_id, p_org_id, NULL::TEXT, 'Credit deduction successful'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;