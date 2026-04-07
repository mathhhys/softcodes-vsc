-- Migration: Add billing period grant logic for paying users
-- Description: Adds billing_period_start column, updates grant function to check plan_type='pro' and period, 
-- resets credits/used at period start. Updates callers to use new logic.

-- 1. Add billing_period_start column to users table if it doesn't exist
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS billing_period_start timestamp with time zone DEFAULT NULL;

-- 2. Set initial billing_period_start for existing pro users (one-time)
UPDATE public.users 
SET billing_period_start = COALESCE(billing_period_start, now())
WHERE plan_type = 'pro' AND billing_period_start IS NULL;

-- 3. Create or replace the billing period grant function
CREATE OR REPLACE FUNCTION apply_billing_period_grant(p_user_id uuid)
RETURNS void AS $$
DECLARE
  v_period_start timestamp with time zone;
  v_current_credits decimal(10,2);
  v_plan_type text;
  v_period_end timestamp with time zone;
BEGIN
  -- Lock the user row to prevent race conditions
  SELECT billing_period_start, credits, plan_type INTO v_period_start, v_current_credits, v_plan_type
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;
  
  -- Only apply for pro users
  IF v_plan_type != 'pro' THEN
    RETURN;
  END IF;
  
  -- If no period start, set it now (shouldn't happen for pro, but safe)
  IF v_period_start IS NULL THEN
    UPDATE public.users
    SET billing_period_start = now(),
        updated_at = now()
    WHERE id = p_user_id;
    RETURN;
  END IF;
  
  -- Calculate period end (1 month from start)
  v_period_end := v_period_start + interval '1 month';
  
  -- Check if billing period has ended (now >= period end)
  IF now() >= v_period_end THEN
    -- Reset credits to 500, used to 0
    UPDATE public.users
    SET 
      credits = 500.00,
      credits_used = 0.00,
      billing_period_start = now(),
      last_credit_update = now(),
      updated_at = now()
    WHERE id = p_user_id;
    
    -- Log the transaction
    INSERT INTO public.credit_transactions (
      user_id, operation_type, credits_amount, usd_amount,
      balance_before, balance_after, description, metadata
    ) VALUES (
      p_user_id, 'addition', 500.00, 0.00,
      COALESCE(v_current_credits, 0), 500.00,
      'Billing period credit reset',
      '{"type": "billing_period_grant", "plan_type": "pro"}'::jsonb
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 4. Update get_user_credit_info to apply period grant before returning info
CREATE OR REPLACE FUNCTION get_user_credit_info(p_clerk_id text)
RETURNS jsonb AS $$
DECLARE
  v_user_record record;
  v_user_id uuid;
BEGIN
  -- Get user ID first
  SELECT id INTO v_user_id FROM public.users WHERE clerk_id = p_clerk_id;
  
  IF v_user_id IS NOT NULL THEN
    -- Check and apply billing period grant if needed (only for pro)
    PERFORM apply_billing_period_grant(v_user_id);
  END IF;

  -- Fetch updated user info
  SELECT 
    id, clerk_id, credits, credits_used, total_spent_usd, 
    last_credit_update, plan_type, billing_period_start
  INTO v_user_record
  FROM public.users 
  WHERE clerk_id = p_clerk_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'user_not_found',
      'message', 'User not found'
    );
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_record.id,
    'clerk_id', v_user_record.clerk_id,
    'current_credits', COALESCE(v_user_record.credits, 0),
    'credits_used', COALESCE(v_user_record.credits_used, 0),
    'total_spent_usd', COALESCE(v_user_record.total_spent_usd, 0.00),
    'last_credit_update', v_user_record.last_credit_update,
    'plan_type', v_user_record.plan_type,
    'billing_period_start', v_user_record.billing_period_start
  );
END;
$$ LANGUAGE plpgsql;

-- 5. Update deduct_user_credits to apply period grant before deduction (for pro users)
CREATE OR REPLACE FUNCTION deduct_user_credits(
  p_user_id uuid,
  p_credits_to_deduct decimal(10,2),
  p_usd_amount decimal(10,4),
  p_description text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}',
  p_request_id text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_current_credits decimal(10,2);
  v_new_balance decimal(10,2);
  v_transaction_id uuid;
  v_user_exists boolean;
  v_existing_transaction record;
  v_plan_type text;
BEGIN
  -- Validate input parameters
  IF p_credits_to_deduct <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_amount',
      'message', 'Credits to deduct must be positive'
    );
  END IF;
  
  IF p_usd_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_usd_amount',
      'message', 'USD amount must be positive'
    );
  END IF;

  -- If request_id provided, check for existing transaction (idempotency)
  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_existing_transaction
    FROM public.credit_transactions
    WHERE user_id = p_user_id AND request_id = p_request_id AND operation_type = 'deduction';
    
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'transaction_id', v_existing_transaction.id,
        'credits_deducted', v_existing_transaction.credits_amount,
        'balance_before', v_existing_transaction.balance_before,
        'balance_after', v_existing_transaction.balance_after,
        'usd_amount', v_existing_transaction.usd_amount,
        'user_id', p_user_id,
        'message', 'Idempotent deduction - transaction already processed'
      );
    END IF;
  END IF;

  -- Check and apply billing period grant if needed BEFORE deduction (only for pro)
  SELECT plan_type INTO v_plan_type FROM public.users WHERE id = p_user_id;
  IF v_plan_type = 'pro' THEN
    PERFORM apply_billing_period_grant(p_user_id);
  END IF;

  -- Lock the user row and get current credits
  SELECT credits, true INTO v_current_credits, v_user_exists
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;
  
  -- Check if user exists
  IF NOT v_user_exists OR v_current_credits IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'user_not_found',
      'message', 'User not found'
    );
  END IF;
  
  -- Check sufficient credits
  IF v_current_credits < p_credits_to_deduct THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'insufficient_credits',
      'current_credits', v_current_credits,
      'required_credits', p_credits_to_deduct,
      'message', 'Insufficient credits'
    );
  END IF;
  
  -- Calculate new balance
  v_new_balance := v_current_credits - p_credits_to_deduct;
  
  -- Update user credits and tracking fields
  UPDATE public.users
  SET
    credits = v_new_balance,
    credits_used = COALESCE(credits_used, 0) + p_credits_to_deduct,
    total_spent_usd = COALESCE(total_spent_usd, 0) + p_usd_amount,
    last_credit_update = now(),
    updated_at = now()
  WHERE id = p_user_id;
  
  -- Insert transaction record
  INSERT INTO public.credit_transactions (
    user_id, operation_type, credits_amount, usd_amount,
    balance_before, balance_after, description, metadata, request_id
  ) VALUES (
    p_user_id, 'deduction', p_credits_to_deduct, p_usd_amount,
    v_current_credits, v_new_balance,
    COALESCE(p_description, 'Credit deduction'),
    COALESCE(p_metadata, '{}'),
    p_request_id
  ) RETURNING id INTO v_transaction_id;
  
  -- Return success response with full details
  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'credits_deducted', p_credits_to_deduct,
    'balance_before', v_current_credits,
    'balance_after', v_new_balance,
    'usd_amount', p_usd_amount,
    'user_id', p_user_id
  );
END;
$$ LANGUAGE plpgsql;

-- 6. Update check_and_deduct_user_credits similarly (apply grant only for pro)
CREATE OR REPLACE FUNCTION check_and_deduct_user_credits(
  p_clerk_id text,
  p_credits_to_deduct decimal(10,2),
  p_usd_amount decimal(10,4),
  p_description text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}',
  p_request_id text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_user_id uuid;
  v_current_credits decimal(10,2);
  v_new_balance decimal(10,2);
  v_transaction_id uuid;
  v_user_exists boolean;
  v_existing_transaction record;
  v_plan_type text;
BEGIN
  -- Validate input parameters
  IF p_credits_to_deduct <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_amount',
      'message', 'Credits to deduct must be positive'
    );
  END IF;
  
  IF p_usd_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_usd_amount',
      'message', 'USD amount must be positive'
    );
  END IF;

  -- Step 1: Lookup user by clerk_id
  SELECT id, plan_type INTO v_user_id, v_plan_type
  FROM public.users
  WHERE clerk_id = p_clerk_id;
  
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'user_not_found',
      'message', 'User not found'
    );
  END IF;

  -- Step 2: Idempotency check
  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_existing_transaction
    FROM public.credit_transactions
    WHERE user_id = v_user_id AND request_id = p_request_id AND operation_type = 'deduction';
    
    IF FOUND THEN
      -- Fetch current balance for response
      SELECT credits INTO v_current_credits
      FROM public.users
      WHERE id = v_user_id;
      
      RETURN jsonb_build_object(
        'success', true,
        'transaction_id', v_existing_transaction.id,
        'credits_deducted', v_existing_transaction.credits_amount,
        'balance_before', v_existing_transaction.balance_before,
        'balance_after', v_existing_transaction.balance_after,
        'current_credits', v_current_credits,
        'usd_amount', v_existing_transaction.usd_amount,
        'user_id', v_user_id,
        'clerk_id', p_clerk_id,
        'message', 'Idempotent deduction - transaction already processed'
      );
    END IF;
  END IF;

  -- Step 3: Apply billing period grant if pro
  IF v_plan_type = 'pro' THEN
    PERFORM apply_billing_period_grant(v_user_id);
  END IF;

  -- Step 4: Atomic lock, fetch, validate, deduct
  SELECT credits, true INTO v_current_credits, v_user_exists
  FROM public.users
  WHERE id = v_user_id
  FOR UPDATE;
  
  IF NOT v_user_exists OR v_current_credits IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'user_not_found',
      'message', 'User not found'
    );
  END IF;
  
  IF v_current_credits < p_credits_to_deduct THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'insufficient_credits',
      'current_credits', v_current_credits,
      'required_credits', p_credits_to_deduct,
      'message', 'Insufficient credits'
    );
  END IF;
  
  v_new_balance := v_current_credits - p_credits_to_deduct;
  
  UPDATE public.users
  SET
    credits = v_new_balance,
    credits_used = COALESCE(credits_used, 0) + p_credits_to_deduct,
    total_spent_usd = COALESCE(total_spent_usd, 0) + p_usd_amount,
    last_credit_update = now(),
    updated_at = now()
  WHERE id = v_user_id;
  
  INSERT INTO public.credit_transactions (
    user_id, operation_type, credits_amount, usd_amount,
    balance_before, balance_after, description, metadata, request_id
  ) VALUES (
    v_user_id, 'deduction', p_credits_to_deduct, p_usd_amount,
    v_current_credits, v_new_balance,
    COALESCE(p_description, 'Credit deduction'),
    COALESCE(p_metadata, '{}'),
    p_request_id
  ) RETURNING id INTO v_transaction_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'credits_deducted', p_credits_to_deduct,
    'balance_before', v_current_credits,
    'balance_after', v_new_balance,
    'current_credits', v_new_balance,
    'usd_amount', p_usd_amount,
    'user_id', v_user_id,
    'clerk_id', p_clerk_id
  );
END;
$$ LANGUAGE plpgsql;

-- Note: The old check_and_apply_monthly_grant can be deprecated or dropped after testing
-- This migration assumes plan_type is already in users table; if not, add it first