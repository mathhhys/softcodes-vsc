-- =====================================================
-- FIX CREDIT_TRANSACTIONS TABLE STRUCTURE
-- =====================================================

-- Check current table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'credit_transactions'
ORDER BY ordinal_position;

-- Fix any missing or incorrect columns
ALTER TABLE public.credit_transactions
ADD COLUMN IF NOT EXISTS credits_amount integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS usd_amount decimal(10,4) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS balance_before integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS balance_after integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

-- If there's an 'amount' column that's causing issues, rename it or drop it
DO $$
BEGIN
    -- Check if there's an 'amount' column that's not supposed to be there
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'credit_transactions'
        AND column_name = 'amount'
        AND table_schema = 'public'
    ) THEN
        -- Rename 'amount' to 'usd_amount' if it exists
        ALTER TABLE public.credit_transactions
        RENAME COLUMN amount TO usd_amount_old;

        -- Update the renamed column to have proper type
        ALTER TABLE public.credit_transactions
        ALTER COLUMN usd_amount_old TYPE decimal(10,4) USING COALESCE(usd_amount_old::decimal(10,4), 0.00);

        -- If usd_amount doesn't exist, use the renamed column
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'credit_transactions'
            AND column_name = 'usd_amount'
            AND table_schema = 'public'
        ) THEN
            ALTER TABLE public.credit_transactions
            RENAME COLUMN usd_amount_old TO usd_amount;
        END IF;
    END IF;
END $$;

-- Ensure all required columns are NOT NULL with defaults
ALTER TABLE public.credit_transactions
ALTER COLUMN credits_amount SET NOT NULL,
ALTER COLUMN credits_amount SET DEFAULT 0,
ALTER COLUMN usd_amount SET NOT NULL,
ALTER COLUMN usd_amount SET DEFAULT 0.00,
ALTER COLUMN balance_before SET NOT NULL,
ALTER COLUMN balance_before SET DEFAULT 0,
ALTER COLUMN balance_after SET NOT NULL,
ALTER COLUMN balance_after SET DEFAULT 0;

-- =====================================================
-- RECREATE FUNCTIONS WITH PROPER NULL HANDLING
-- =====================================================

-- Function to get user credit information by Clerk ID
CREATE OR REPLACE FUNCTION get_user_credit_info(p_clerk_id text)
RETURNS jsonb AS $$
DECLARE
  v_user_record record;
BEGIN
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

-- Function to deduct credits atomically
CREATE OR REPLACE FUNCTION deduct_user_credits(
  p_user_id uuid,
  p_credits_to_deduct integer,
  p_usd_amount decimal(10,4),
  p_description text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'
) RETURNS jsonb AS $$
DECLARE
  v_current_credits integer;
  v_new_balance integer;
  v_transaction_id uuid;
  v_user_exists boolean;
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

  -- Insert transaction record with explicit NULL handling
  INSERT INTO public.credit_transactions (
    user_id, operation_type, credits_amount, usd_amount,
    balance_before, balance_after, description, metadata
  ) VALUES (
    p_user_id,
    'deduction',
    COALESCE(p_credits_to_deduct, 0),  -- Ensure not null
    COALESCE(p_usd_amount, 0.00),      -- Ensure not null
    COALESCE(v_current_credits, 0),    -- Ensure not null
    COALESCE(v_new_balance, 0),        -- Ensure not null
    COALESCE(p_description, 'Credit deduction'),
    COALESCE(p_metadata, '{}')
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

-- =====================================================
-- TEST THE FIX
-- =====================================================

-- Test query to verify the fix
-- SELECT * FROM get_user_credit_info('your_clerk_user_id_here');