# Database Setup for Fractional Credits

This directory contains SQL migrations and functions needed to support fractional credit deductions in Softcodes.

## Problem Statement

The original `credits` column was defined as `INTEGER`, which caused:

- **Data Loss**: 199 - 0.38 credits → 198 (should be 198.62)
- **Accumulated Errors**: Multiple small deductions compound the error
- **Precision Issues**: Fractional credits were truncated to whole numbers

## Solution Overview

1. **Schema Migration**: Convert `credits` from INTEGER to NUMERIC(10, 2)
2. **Atomic Functions**: Implement row-level locking to prevent race conditions
3. **Type Safety**: Update TypeScript interfaces to handle decimal precision

---

## 📋 Installation Steps

### Step 1: Backup Your Database

**CRITICAL**: Always backup before running migrations!

In Supabase Dashboard:

1. Go to Database → Backups
2. Create a manual backup
3. Wait for completion before proceeding

### Step 2: Run Schema Migration

Open Supabase SQL Editor and run:

```sql
-- File: migrations/001_fractional_credits_support.sql
```

Copy the entire content of `migrations/001_fractional_credits_support.sql` and execute it.

**Verification**:

```sql
SELECT
  column_name,
  data_type,
  numeric_precision,
  numeric_scale
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN ('credits', 'credits_used');
```

Expected result:

```
column_name  | data_type | numeric_precision | numeric_scale
-------------|-----------|-------------------|---------------
credits      | numeric   | 10                | 2
credits_used | numeric   | 10                | 2
```

### Step 3: Create Database Functions

#### 3.1 Create deduct_user_credits function

Copy and run: `functions/deduct_user_credits.sql`

This function:

- ✅ Uses row-level locking (FOR UPDATE) to prevent race conditions
- ✅ Preserves decimal precision (0.38 credits exactly)
- ✅ Validates sufficient balance before deduction
- ✅ Creates transaction records for audit trail

**Test**:

```sql
-- Replace 'your-user-uuid' with actual UUID
SELECT * FROM deduct_user_credits(
  'your-user-uuid'::uuid,
  0.38::numeric,
  0.005::numeric,
  'Test fractional deduction'
);
```

Expected: `balance_after` should show exactly 0.38 less than `balance_before`

#### 3.2 Create get_user_credit_info function

Copy and run: `functions/get_user_credit_info.sql`

**Test**:

```sql
-- Replace 'your-clerk-id' with actual Clerk user ID
SELECT * FROM get_user_credit_info('your-clerk-id');
```

Expected: Should return `current_credits` with 2 decimal places (e.g., 198.62)

---

## 🔍 Verification Checklist

After running all SQL scripts, verify:

- [ ] Schema migration completed successfully
- [ ] `credits` column is NUMERIC(10, 2)
- [ ] `credits_used` column is NUMERIC(10, 2)
- [ ] `deduct_user_credits` function exists and is executable
- [ ] `get_user_credit_info` function exists and is executable
- [ ] Test deduction preserves decimal precision (0.38 credits)
- [ ] No data loss from integer → numeric conversion

---

## 🧪 Testing the Complete Flow

### Test 1: Fractional Deduction

```sql
-- Get initial balance
SELECT credits FROM users WHERE clerk_id = 'your-clerk-id';
-- Example result: 199.00

-- Deduct 0.38 credits
SELECT * FROM deduct_user_credits(
  (SELECT id FROM users WHERE clerk_id = 'your-clerk-id'),
  0.38,
  0.005,
  'Test deduction'
);

-- Verify new balance
SELECT credits FROM users WHERE clerk_id = 'your-clerk-id';
-- Expected result: 198.62
```

### Test 2: Multiple Small Deductions

```sql
-- Deduct 0.01 credits 10 times
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM users WHERE clerk_id = 'your-clerk-id';

  FOR i IN 1..10 LOOP
    PERFORM deduct_user_credits(v_user_id, 0.01, 0.0001, 'Test ' || i);
  END LOOP;
END $$;

-- Verify total deduction is exactly 0.10
SELECT credits FROM users WHERE clerk_id = 'your-clerk-id';
-- Should be 0.10 less than before (no rounding errors)
```

### Test 3: Insufficient Credits

```sql
-- Try to deduct more credits than available
SELECT * FROM deduct_user_credits(
  (SELECT id FROM users WHERE clerk_id = 'your-clerk-id'),
  999.99,
  10.00,
  'Should fail'
);
-- Expected: success = FALSE, error = 'insufficient_credits'
```

---

## 🚨 Troubleshooting

### Issue: Migration fails with "column already exists"

**Solution**: The migration is idempotent. If it partially completed, run:

```sql
-- Check current state
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name LIKE 'credits%';

-- If credits_decimal exists but credits is still INTEGER:
BEGIN;
DROP COLUMN IF EXISTS credits CASCADE;
RENAME COLUMN credits_decimal TO credits;
ALTER COLUMN credits SET NOT NULL;
COMMIT;
```

### Issue: Function "does not exist" error

**Solution**: Ensure you're running the function SQL in the correct schema:

```sql
-- List all functions
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE '%credit%';
```

### Issue: Permission denied

**Solution**: Grant execute permissions:

```sql
GRANT EXECUTE ON FUNCTION public.deduct_user_credits TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_credit_info TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_credit_info TO anon;
```

---

## 📊 Performance Considerations

### Row-Level Locking

The `FOR UPDATE` clause in `deduct_user_credits` locks the user's row during the transaction. This:

- ✅ Prevents race conditions
- ✅ Ensures atomic operations
- ⚠️ May cause brief waits if multiple deductions happen simultaneously

**Monitoring**:

```sql
-- Check for locked rows
SELECT * FROM pg_locks
WHERE locktype = 'tuple'
  AND relation = 'users'::regclass;
```

### Index Usage

The migration recreates the index on `credits` column:

```sql
CREATE INDEX idx_users_credits ON public.users(credits);
```

This ensures fast queries like:

```sql
SELECT * FROM users WHERE credits < 10;  -- Low credit users
```

---

## 🔗 Related Documentation

- [Credit Deduction Fix Plan](../docs/credit-deduction-fix-plan.md)
- [TypeScript Implementation](../src/services/creditManager.ts)
- [Real-time Updates](../src/services/realtimeCreditUpdates.ts)

---

## ✅ Success Criteria

After completing all steps, you should have:

1. ✅ Credits stored with 2 decimal precision (198.62, not 198 or 199)
2. ✅ Atomic credit deductions with no race conditions
3. ✅ Accurate balance updates in ProfileView UI
4. ✅ No data loss from fractional credits
5. ✅ Full audit trail via transaction records

---

## 📞 Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review the SQL error messages in Supabase logs
3. Verify your Supabase service role key is configured
4. Ensure you have database modification permissions
