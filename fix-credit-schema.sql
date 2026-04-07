-- =====================================================
-- FIX CREDIT SCHEMA - Handles existing tables gracefully
-- =====================================================

-- First, check if credit_transactions table exists and add missing columns
DO $$
BEGIN
    -- Check if credit_transactions table exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credit_transactions') THEN
        -- Create the table if it doesn't exist
        CREATE TABLE public.credit_transactions (
          id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
          user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
          operation_type text NOT NULL DEFAULT 'deduction' CHECK (operation_type IN ('deduction', 'addition', 'purchase', 'refund')),
          credits_amount decimal(10,2) NOT NULL,
          usd_amount decimal(10,4) NOT NULL DEFAULT 0.00,
          balance_before decimal(10,2) NOT NULL DEFAULT 0,
          balance_after decimal(10,2) NOT NULL DEFAULT 0,
          description text,
          metadata jsonb DEFAULT '{}',
          created_at timestamp with time zone DEFAULT now(),
          CONSTRAINT credit_transactions_pkey PRIMARY KEY (id)
        );
    ELSE
        -- Table exists, add missing columns if they don't exist
        ALTER TABLE public.credit_transactions
        ADD COLUMN IF NOT EXISTS operation_type text DEFAULT 'deduction',
        ADD COLUMN IF NOT EXISTS credits_amount decimal(10,2) DEFAULT 0.00,
        ADD COLUMN IF NOT EXISTS usd_amount decimal(10,4) DEFAULT 0.00,
        ADD COLUMN IF NOT EXISTS balance_before decimal(10,2) DEFAULT 0.00,
        ADD COLUMN IF NOT EXISTS balance_after decimal(10,2) DEFAULT 0.00,
        ADD COLUMN IF NOT EXISTS description text,
        ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

        -- Add constraint if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = 'credit_transactions_operation_type_check') THEN
            ALTER TABLE public.credit_transactions
            ADD CONSTRAINT credit_transactions_operation_type_check
            CHECK (operation_type IN ('deduction', 'addition', 'purchase', 'refund'));
        END IF;
    END IF;
END $$;

-- Add credit tracking columns to users table (safe to run multiple times)
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS credits_used decimal(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS total_spent_usd decimal(10,4) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS last_credit_update timestamp with time zone DEFAULT now();

-- Convert existing credits column to decimal if it exists as integer
DO $$
BEGIN
  -- Check if credits column exists and is integer
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'credits' AND data_type = 'integer') THEN
    -- Convert to decimal
    ALTER TABLE public.users ALTER COLUMN credits TYPE decimal(10,2) USING credits::decimal(10,2);
  END IF;
END $$;

-- Create indexes (safe to run multiple times)
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON public.credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON public.credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_operation_type ON public.credit_transactions(operation_type);
CREATE INDEX IF NOT EXISTS idx_users_credits ON public.users(credits);
CREATE INDEX IF NOT EXISTS idx_users_last_credit_update ON public.users(last_credit_update);

-- =====================================================
-- CREDIT FUNCTIONS (will replace if they exist)
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
  p_credits_to_deduct decimal(10,2),
  p_usd_amount decimal(10,4),
  p_description text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'
) RETURNS jsonb AS $$
DECLARE
  v_current_credits decimal(10,2);
  v_new_balance decimal(10,2);
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

  -- Insert transaction record
  INSERT INTO public.credit_transactions (
    user_id, operation_type, credits_amount, usd_amount,
    balance_before, balance_after, description, metadata
  ) VALUES (
    p_user_id, 'deduction', p_credits_to_deduct, p_usd_amount,
    v_current_credits, v_new_balance,
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

-- Function to add credits
CREATE OR REPLACE FUNCTION add_user_credits(
  p_user_id uuid,
  p_credits_to_add decimal(10,2),
  p_usd_amount decimal(10,4),
  p_operation_type text DEFAULT 'addition',
  p_description text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'
) RETURNS jsonb AS $$
DECLARE
  v_current_credits decimal(10,2);
  v_new_balance decimal(10,2);
  v_transaction_id uuid;
  v_user_exists boolean;
BEGIN
  -- Validate input parameters
  IF p_credits_to_add <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_amount',
      'message', 'Credits to add must be positive'
    );
  END IF;

  -- Validate operation type
  IF p_operation_type NOT IN ('addition', 'purchase', 'refund') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_operation_type',
      'message', 'Operation type must be addition, purchase, or refund'
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

  -- Calculate new balance
  v_new_balance := v_current_credits + p_credits_to_add;

  -- Update user credits
  UPDATE public.users
  SET
    credits = v_new_balance,
    last_credit_update = now(),
    updated_at = now()
  WHERE id = p_user_id;

  -- Insert transaction record
  INSERT INTO public.credit_transactions (
    user_id, operation_type, credits_amount, usd_amount,
    balance_before, balance_after, description, metadata
  ) VALUES (
    p_user_id, p_operation_type, p_credits_to_add, p_usd_amount,
    v_current_credits, v_new_balance,
    COALESCE(p_description, 'Credit addition'),
    COALESCE(p_metadata, '{}')
  ) RETURNING id INTO v_transaction_id;

  -- Return success response
  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'credits_added', p_credits_to_add,
    'balance_before', v_current_credits,
    'balance_after', v_new_balance,
    'usd_amount', p_usd_amount,
    'user_id', p_user_id
  );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- SECURITY & PERMISSIONS
-- =====================================================

-- Enable Row Level Security (safe to run multiple times)
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists, then create new one
DROP POLICY IF EXISTS "Users can view own credit transactions" ON public.credit_transactions;
CREATE POLICY "Users can view own credit transactions" ON public.credit_transactions
    FOR SELECT USING (user_id IN (
        SELECT id FROM public.users WHERE clerk_id = auth.jwt() ->> 'sub'
    ));

-- Grant permissions (safe to run multiple times)
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT ON public.credit_transactions TO authenticated;
GRANT EXECUTE ON FUNCTION deduct_user_credits TO authenticated;
GRANT EXECUTE ON FUNCTION add_user_credits TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_credit_info TO authenticated;

-- =====================================================
-- DEPLOYMENT COMPLETE
-- =====================================================

-- Test the deployment with:
-- SELECT * FROM get_user_credit_info('your_clerk_user_id_here');