-- =====================================================
-- FIX USD_AMOUNT_OLD CONSTRAINT VIOLATION
-- =====================================================
-- This script fixes the "null value in column usd_amount_old violates not-null constraint" error
-- by aligning the database schema with the application expectations.

-- Step 1: Check current table structure and identify the issue
DO $$
DECLARE
    has_usd_amount_old BOOLEAN;
    has_usd_amount BOOLEAN;
    column_info RECORD;
BEGIN
    -- Check if usd_amount_old column exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'credit_transactions' 
        AND column_name = 'usd_amount_old'
        AND table_schema = 'public'
    ) INTO has_usd_amount_old;

    -- Check if usd_amount column exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'credit_transactions' 
        AND column_name = 'usd_amount'
        AND table_schema = 'public'
    ) INTO has_usd_amount;

    RAISE NOTICE '=== CREDIT TRANSACTIONS SCHEMA ANALYSIS ===';
    RAISE NOTICE 'Table: credit_transactions';
    RAISE NOTICE 'Has usd_amount_old column: %', has_usd_amount_old;
    RAISE NOTICE 'Has usd_amount column: %', has_usd_amount;

    -- Show all columns for reference
    RAISE NOTICE '=== ALL COLUMNS ===';
    FOR column_info IN 
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'credit_transactions' 
        AND table_schema = 'public'
        ORDER BY ordinal_position
    LOOP
        RAISE NOTICE 'Column: % | Type: % | Nullable: % | Default: %', 
            column_info.column_name, 
            column_info.data_type, 
            column_info.is_nullable, 
            COALESCE(column_info.column_default, 'NULL');
    END LOOP;
END $$;

-- Step 2: Fix the schema inconsistency
DO $$
DECLARE
    has_usd_amount_old BOOLEAN;
    has_usd_amount BOOLEAN;
BEGIN
    -- Check current state
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'credit_transactions' 
        AND column_name = 'usd_amount_old'
        AND table_schema = 'public'
    ) INTO has_usd_amount_old;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'credit_transactions' 
        AND column_name = 'usd_amount'
        AND table_schema = 'public'
    ) INTO has_usd_amount;

    RAISE NOTICE '=== APPLYING SCHEMA FIX ===';

    -- Case 1: Has usd_amount_old but not usd_amount (most likely scenario)
    IF has_usd_amount_old AND NOT has_usd_amount THEN
        RAISE NOTICE 'Renaming usd_amount_old to usd_amount...';
        
        -- Rename the column
        ALTER TABLE public.credit_transactions 
        RENAME COLUMN usd_amount_old TO usd_amount;
        
        RAISE NOTICE '✅ Successfully renamed usd_amount_old to usd_amount';

    -- Case 2: Has both columns (conflict situation)
    ELSIF has_usd_amount_old AND has_usd_amount THEN
        RAISE NOTICE 'Both columns exist - dropping usd_amount_old...';
        
        -- Drop the old column since we have the correct one
        ALTER TABLE public.credit_transactions 
        DROP COLUMN usd_amount_old;
        
        RAISE NOTICE '✅ Successfully dropped duplicate usd_amount_old column';

    -- Case 3: Has usd_amount but not usd_amount_old (already correct)
    ELSIF has_usd_amount AND NOT has_usd_amount_old THEN
        RAISE NOTICE '✅ Schema is already correct - usd_amount column exists';

    -- Case 4: Has neither (needs column creation)
    ELSE
        RAISE NOTICE 'Creating missing usd_amount column...';
        
        -- Create the missing column
        ALTER TABLE public.credit_transactions 
        ADD COLUMN usd_amount decimal(10,4) NOT NULL DEFAULT 0.00;
        
        RAISE NOTICE '✅ Successfully created usd_amount column';
    END IF;
END $$;

-- Step 3: Ensure the usd_amount column has proper constraints and defaults
DO $$
BEGIN
    RAISE NOTICE '=== ENSURING PROPER COLUMN CONSTRAINTS ===';
    
    -- Set NOT NULL constraint and default value
    ALTER TABLE public.credit_transactions 
    ALTER COLUMN usd_amount SET NOT NULL,
    ALTER COLUMN usd_amount SET DEFAULT 0.00;
    
    -- Ensure proper data type
    ALTER TABLE public.credit_transactions 
    ALTER COLUMN usd_amount TYPE decimal(10,4) USING COALESCE(usd_amount, 0.00);
    
    RAISE NOTICE '✅ Column constraints and defaults applied';
END $$;

-- Step 4: Update any existing NULL values to prevent constraint violations
UPDATE public.credit_transactions 
SET usd_amount = 0.00 
WHERE usd_amount IS NULL;

-- Step 5: Recreate the deduct_user_credits function to ensure it uses correct column names
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
  
  IF p_usd_amount < 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_usd_amount',
      'message', 'USD amount cannot be negative'
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
    COALESCE(p_credits_to_deduct, 0),      -- Ensure not null
    COALESCE(p_usd_amount, 0.00),          -- Ensure not null - using correct column name
    COALESCE(v_current_credits, 0),        -- Ensure not null
    COALESCE(v_new_balance, 0),            -- Ensure not null
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

-- Step 6: Recreate the add_user_credits function with correct column names
CREATE OR REPLACE FUNCTION add_user_credits(
  p_user_id uuid,
  p_credits_to_add integer,
  p_usd_amount decimal(10,4),
  p_operation_type text DEFAULT 'addition',
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
  
  -- Insert transaction record with explicit NULL handling
  INSERT INTO public.credit_transactions (
    user_id, operation_type, credits_amount, usd_amount,
    balance_before, balance_after, description, metadata
  ) VALUES (
    p_user_id,
    p_operation_type,
    COALESCE(p_credits_to_add, 0),         -- Ensure not null
    COALESCE(p_usd_amount, 0.00),          -- Ensure not null - using correct column name
    COALESCE(v_current_credits, 0),        -- Ensure not null
    COALESCE(v_new_balance, 0),            -- Ensure not null
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

-- Step 7: Verify the fix
DO $$
DECLARE
    column_info RECORD;
    has_usd_amount BOOLEAN;
    has_usd_amount_old BOOLEAN;
BEGIN
    RAISE NOTICE '=== VERIFICATION ===';
    
    -- Check if usd_amount column exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'credit_transactions'
        AND column_name = 'usd_amount'
        AND table_schema = 'public'
    ) INTO has_usd_amount;

    IF has_usd_amount THEN
        -- Get column properties separately
        SELECT
            column_name,
            data_type,
            is_nullable,
            column_default
        INTO column_info
        FROM information_schema.columns
        WHERE table_name = 'credit_transactions'
        AND column_name = 'usd_amount'
        AND table_schema = 'public';

        RAISE NOTICE '✅ usd_amount column exists';
        RAISE NOTICE '   Type: %', column_info.data_type;
        RAISE NOTICE '   Nullable: %', column_info.is_nullable;
        RAISE NOTICE '   Default: %', COALESCE(column_info.column_default, 'NULL');
    ELSE
        RAISE NOTICE '❌ usd_amount column still missing!';
    END IF;

    -- Check if usd_amount_old column still exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'credit_transactions'
        AND column_name = 'usd_amount_old'
        AND table_schema = 'public'
    ) INTO has_usd_amount_old;

    IF has_usd_amount_old THEN
        RAISE NOTICE '⚠️  usd_amount_old column still exists - this might cause issues';
    ELSE
        RAISE NOTICE '✅ usd_amount_old column properly removed/renamed';
    END IF;
END $$;

-- Final completion message
DO $$
BEGIN
    RAISE NOTICE '=== FIX COMPLETED ===';
    RAISE NOTICE 'The usd_amount_old constraint violation should now be resolved.';
    RAISE NOTICE 'Application can now successfully insert records into credit_transactions table.';
END $$;