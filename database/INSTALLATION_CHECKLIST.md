# 🚀 Database Installation Checklist

Follow these steps **exactly in order** to fix your credit deduction issues.

---

## ⚠️ Step 0: Pre-Installation (CRITICAL)

- [ ] **Backup your Supabase database**
    - Open Supabase Dashboard
    - Go to: **Database → Backups**
    - Click: **Create Manual Backup**
    - ⏳ Wait for "Backup completed" message
    - ✅ Verify backup exists in backup list

---

## 📝 Step 1: Schema Migration

- [ ] Open Supabase Dashboard → **SQL Editor**
- [ ] Click **New Query**
- [ ] Copy **ALL** content from: `database/migrations/001_fractional_credits_support.sql`
- [ ] Paste into SQL Editor
- [ ] Click **Run** (or press Cmd/Ctrl + Enter)
- [ ] ✅ Wait for success message: "Success. No rows returned"
- [ ] 📋 **VERIFY MIGRATION**:
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
    - [ ] ✅ Confirm `credits` shows: `numeric | 10 | 2`
    - [ ] ✅ Confirm `credits_used` shows: `numeric | 10 | 2`

**⚠️ If verification fails, STOP and check error messages!**

---

## 🔧 Step 2: Create deduct_user_credits Function

- [ ] In Supabase SQL Editor, click **New Query**
- [ ] Copy **ALL** content from: `database/functions/deduct_user_credits.sql`
- [ ] Paste into SQL Editor
- [ ] Click **Run**
- [ ] ✅ Wait for success message
- [ ] 📋 **VERIFY FUNCTION**:
    ```sql
    SELECT routine_name
    FROM information_schema.routines
    WHERE routine_schema = 'public'
      AND routine_name = 'deduct_user_credits';
    ```
    - [ ] ✅ Confirm function exists

---

## 🔧 Step 3: Create get_user_credit_info Function

- [ ] In Supabase SQL Editor, click **New Query**
- [ ] Copy **ALL** content from: `database/functions/get_user_credit_info.sql`
- [ ] Paste into SQL Editor
- [ ] Click **Run**
- [ ] ✅ Wait for success message
- [ ] 📋 **VERIFY FUNCTION**:
    ```sql
    SELECT routine_name
    FROM information_schema.routines
    WHERE routine_schema = 'public'
      AND routine_name = 'get_user_credit_info';
    ```
    - [ ] ✅ Confirm function exists

---

## 🧪 Step 4: Test Fractional Deduction

Replace `YOUR_CLERK_ID` with your actual Clerk user ID:

- [ ] **Get your current balance**:

    ```sql
    SELECT clerk_id, credits
    FROM users
    WHERE clerk_id = 'YOUR_CLERK_ID';
    ```

    - [ ] Write down current balance: ****\_\_**** credits

- [ ] **Test fractional deduction**:

    ```sql
    SELECT * FROM deduct_user_credits(
      (SELECT id FROM users WHERE clerk_id = 'YOUR_CLERK_ID'),
      0.38::numeric,
      0.005::numeric,
      'Test fractional deduction - installation'
    );
    ```

    - [ ] ✅ Confirm `success = true`
    - [ ] ✅ Confirm `credits_deducted = 0.38`
    - [ ] ✅ Confirm `balance_after` = (previous balance - 0.38)

- [ ] **Verify new balance**:
    ```sql
    SELECT clerk_id, credits
    FROM users
    WHERE clerk_id = 'YOUR_CLERK_ID';
    ```
    - [ ] ✅ Confirm balance is **exactly** 0.38 less than before
    - [ ] ✅ Confirm balance has 2 decimal places (e.g., 198.62)

**⚠️ If balance is wrong (e.g., whole number only), migration failed!**

---

## 🎯 Step 5: Test in VSCode Extension

- [ ] **Restart VSCode** to load TypeScript changes
- [ ] Open a project and activate Softcodes extension
- [ ] Check your current balance in ProfileView
- [ ] Make an API call that costs credits (any AI request)
- [ ] **Verify ProfileView updates immediately**
    - [ ] ✅ Balance changed without page refresh
    - [ ] ✅ New balance shows 2 decimal places
    - [ ] ✅ Deduction amount is precise (not rounded)

---

## ✅ Step 6: Final Verification

Run this comprehensive test:

```sql
-- Test: Multiple small deductions should be precise
DO $$
DECLARE
  v_user_id UUID;
  v_initial_balance NUMERIC(10, 2);
  v_final_balance NUMERIC(10, 2);
BEGIN
  SELECT id, credits INTO v_user_id, v_initial_balance
  FROM users
  WHERE clerk_id = 'YOUR_CLERK_ID';

  -- Deduct 0.01 credits 10 times
  FOR i IN 1..10 LOOP
    PERFORM deduct_user_credits(
      v_user_id,
      0.01,
      0.0001,
      'Precision test ' || i
    );
  END LOOP;

  SELECT credits INTO v_final_balance
  FROM users
  WHERE id = v_user_id;

  RAISE NOTICE 'Initial: %, Final: %, Difference: %',
    v_initial_balance,
    v_final_balance,
    v_initial_balance - v_final_balance;
END $$;
```

- [ ] ✅ Difference should be **exactly** 0.10 (not 0.09 or 0.11)
- [ ] ✅ Final balance has 2 decimal places

---

## 🎉 Success Criteria

You've successfully completed the installation if:

- [x] ✅ All SQL scripts executed without errors
- [x] ✅ Credits column is NUMERIC(10, 2)
- [x] ✅ Test deduction of 0.38 credits works exactly
- [x] ✅ Multiple 0.01 deductions total exactly 0.10
- [x] ✅ ProfileView updates immediately after deductions
- [x] ✅ All balances show 2 decimal places

**🎊 Congratulations! Your credit system now has penny-perfect precision!**

---

## ❌ Rollback (If Something Goes Wrong)

If you need to rollback:

1. Go to: **Database → Backups**
2. Find the backup you created in Step 0
3. Click **Restore**
4. Wait for restoration to complete
5. Contact support with error messages

---

## 📞 Need Help?

If any step fails:

1. **Check Supabase logs**: Database → Logs → SQL logs
2. **Common errors**: See `database/README.md` troubleshooting section
3. **Verify permissions**: Ensure service role key is configured
4. **Error messages**: Copy full error text for debugging

---

## 📊 Before vs After

### Before Fix:

```
Balance: 199 credits (INTEGER)
Deduct: 0.38 credits
Result: 198 credits ❌ (Lost 0.62!)
```

### After Fix:

```
Balance: 199.00 credits (NUMERIC)
Deduct: 0.38 credits
Result: 198.62 credits ✅ (Perfect!)
```

---

**Last Updated**: 2025-10-14
**TypeScript Changes**: Already implemented ✅
**Database Changes**: Pending your action ⏳
