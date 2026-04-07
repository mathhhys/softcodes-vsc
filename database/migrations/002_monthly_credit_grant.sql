-- Migration: Add monthly credit grant logic
-- Description: Adds a mechanism to grant 500 credits monthly to users, accumulating with existing credits.

-- 1. Add last_monthly_grant column to users table if it doesn't exist
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS last_monthly_grant timestamp with time zone DEFAULT now();

-- 2. Create function to check and apply monthly grant
CREATE OR REPLACE FUNCTION check_and_apply_monthly_grant(p_user_id uuid)
RETURNS void AS $$
DECLARE
  v_last_grant timestamp with time zone;
  v_current_credits integer;
  v_new_balance integer;
  v_transaction_id uuid;
BEGIN
  -- Lock the user row to prevent race conditions
  SELECT last_monthly_grant, credits INTO v_last_grant, v_current_credits
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  -- Check if a month has passed since the last grant
  -- If last_grant is null, treat it as never granted (should be initialized to now() on creation, but safe fallback)
  IF v_last_grant IS NULL OR v_last_grant < (now() - interval '1 month') THEN
    
    -- Calculate new balance (add 500 credits)
    v_new_balance := COALESCE(v_current_credits, 0) + 500;
    
    -- Update user record
    UPDATE public.users
    SET 
      credits = v_new_balance,
      last_monthly_grant = now(),
      last_credit_update = now(),
      updated_at = now()
    WHERE id = p_user_id;
    
    -- Log the transaction
    INSERT INTO public.credit_transactions (
      user_id, operation_type, credits_amount, usd_amount,
      balance_before, balance_after, description, metadata
    ) VALUES (
      p_user_id, 'addition', 500, 0.00,
      COALESCE(v_current_credits, 0), v_new_balance,
      'Monthly credit grant',
      '{"type": "monthly_grant"}'::jsonb
    );
    
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 3. Update get_user_credit_info to apply grant before returning info
CREATE OR REPLACE FUNCTION get_user_credit_info(p_clerk_id text)
RETURNS jsonb AS $$
DECLARE
  v_user_record record;
  v_user_id uuid;
BEGIN
  -- Get user ID first
  SELECT id INTO v_user_id FROM public.users WHERE clerk_id = p_clerk_id;
  
  IF v_user_id IS NOT NULL THEN
    -- Check and apply monthly grant if needed
    PERFORM check_and_apply_monthly_grant(v_user_id);
  END IF;

  -- Fetch updated user info
  SELECT 
    id, clerk_id, credits, credits_used, total_spent_usd, 
    last_credit_update, plan_type
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
    'plan_type', v_user_record.plan_type
  );
END;
$$ LANGUAGE plpgsql;

-- 4. Update deduct_user_credits to return TABLE (CRITICAL FIX)
CREATE OR REPLACE FUNCTION deduct_user_credits(
  p_user_id uuid,
  p_credits_to_deduct NUMERIC(10, 2),  -- Changed to NUMERIC for decimal precision
  p_usd_amount NUMERIC(10, 4),
  p_description text DEFAULT 'Credit deduction',
  p_metadata jsonb DEFAULT '{}'::jsonb
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
  -- Check and apply monthly grant if needed BEFORE deduction
  PERFORM check_and_apply_monthly_grant(p_user_id);

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

-- 5. Update check_and_deduct_user_credits to apply grant before deduction
CREATE OR REPLACE FUNCTION check_and_deduct_user_credits(
  p_clerk_id text,
  p_credits_to_deduct integer,
  p_usd_amount decimal(10,4),
  p_description text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}',
  p_request_id text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_user_id uuid;
  v_current_credits integer;
  v_new_balance integer;
  v_transaction_id uuid;
  v_user_exists boolean;
  v_existing_transaction record;
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

  -- Step 1: Lookup user by clerk_id (non-locking read for existence check)
  SELECT id INTO v_user_id
  FROM public.users
  WHERE clerk_id = p_clerk_id;
  
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'user_not_found',
      'message', 'User not found'
    );
  END IF;

  -- Step 2: If request_id provided, check for existing transaction (idempotency)
  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_existing_transaction
    FROM public.credit_transactions
    WHERE user_id = v_user_id AND request_id = p_request_id AND operation_type = 'deduction';
    
    IF FOUND THEN
      -- Fetch current balance for response consistency
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

  -- Step 3: Check and apply monthly grant if needed BEFORE deduction
  PERFORM check_and_apply_monthly_grant(v_user_id);

  -- Step 4: Atomic lock, fetch, validate, and deduct
  SELECT credits, true INTO v_current_credits, v_user_exists
  FROM public.users
  WHERE id = v_user_id
  FOR UPDATE;
  
  -- Double-check user exists (paranoia)
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
  WHERE id = v_user_id;
  
  -- Insert transaction record
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
  
  -- Return full success response including clerk_id for client convenience
  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'credits_deducted', p_credits_to_deduct,
    'balance_before', v_current_credits,
    'balance_after', v_new_balance,
    'current_credits', v_new_balance,  -- Alias for consistency with get_user_credit_info
    'usd_amount', p_usd_amount,
    'user_id', v_user_id,
    'clerk_id', p_clerk_id
  );
END;
$$ LANGUAGE plpgsql;