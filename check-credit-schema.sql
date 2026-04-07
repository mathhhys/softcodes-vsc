-- Check current credit_transactions table schema
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'credit_transactions'
AND table_schema = 'public'
ORDER BY ordinal_position;

-- Check if transaction_type column exists (shouldn't exist based on our schema)
SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_transactions'
    AND column_name = 'transaction_type'
    AND table_schema = 'public'
) as has_transaction_type;

-- Check if operation_type column exists (should exist)
SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_transactions'
    AND column_name = 'operation_type'
    AND table_schema = 'public'
) as has_operation_type;