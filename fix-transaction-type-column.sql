-- =====================================================
-- FIX TRANSACTION_TYPE vs OPERATION_TYPE MISMATCH
-- =====================================================
-- This script fixes the mismatch where the database has 'transaction_type'
-- but the application code expects 'operation_type'

DO $$
DECLARE
    has_transaction_type BOOLEAN;
    has_operation_type BOOLEAN;
BEGIN
    RAISE NOTICE '=== CHECKING COLUMN NAMES ===';

    -- Check if transaction_type column exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'credit_transactions'
        AND column_name = 'transaction_type'
        AND table_schema = 'public'
    ) INTO has_transaction_type;

    -- Check if operation_type column exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'credit_transactions'
        AND column_name = 'operation_type'
        AND table_schema = 'public'
    ) INTO has_operation_type;

    RAISE NOTICE 'Has transaction_type column: %', has_transaction_type;
    RAISE NOTICE 'Has operation_type column: %', has_operation_type;

    -- Case 1: Has transaction_type but not operation_type (rename needed)
    IF has_transaction_type AND NOT has_operation_type THEN
        RAISE NOTICE '🔄 Renaming transaction_type to operation_type...';

        -- Rename the column
        ALTER TABLE public.credit_transactions
        RENAME COLUMN transaction_type TO operation_type;

        RAISE NOTICE '✅ Successfully renamed transaction_type to operation_type';

    -- Case 2: Has both columns (conflict - shouldn't happen)
    ELSIF has_transaction_type AND has_operation_type THEN
        RAISE NOTICE '⚠️  Both columns exist - dropping transaction_type...';

        -- Drop the incorrect column
        ALTER TABLE public.credit_transactions
        DROP COLUMN transaction_type;

        RAISE NOTICE '✅ Dropped duplicate transaction_type column';

    -- Case 3: Has operation_type but not transaction_type (already correct)
    ELSIF has_operation_type AND NOT has_transaction_type THEN
        RAISE NOTICE '✅ Schema is already correct - operation_type column exists';

    -- Case 4: Has neither (missing column)
    ELSE
        RAISE NOTICE '❌ Missing operation_type column - creating it...';

        -- Add the missing column
        ALTER TABLE public.credit_transactions
        ADD COLUMN operation_type text NOT NULL DEFAULT 'deduction'
        CHECK (operation_type IN ('deduction', 'addition', 'purchase', 'refund'));

        RAISE NOTICE '✅ Created operation_type column';
    END IF;

    -- Ensure proper constraints
    RAISE NOTICE '=== ENSURING PROPER CONSTRAINTS ===';

    -- Add check constraint if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'credit_transactions_operation_type_check'
    ) THEN
        ALTER TABLE public.credit_transactions
        ADD CONSTRAINT credit_transactions_operation_type_check
        CHECK (operation_type IN ('deduction', 'addition', 'purchase', 'refund'));

        RAISE NOTICE '✅ Added operation_type check constraint';
    END IF;

    -- Ensure NOT NULL constraint
    ALTER TABLE public.credit_transactions
    ALTER COLUMN operation_type SET NOT NULL;

    RAISE NOTICE '✅ Ensured NOT NULL constraint on operation_type';

END $$;

-- Verify the fix
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'credit_transactions'
AND table_schema = 'public'
AND column_name IN ('operation_type', 'transaction_type')
ORDER BY column_name;

-- Final verification message
DO $$
BEGIN
    RAISE NOTICE '=== FIX COMPLETED ===';
    RAISE NOTICE 'The transaction_type/operation_type mismatch should now be resolved.';
    RAISE NOTICE 'Credit deduction operations should work correctly.';
END $$;