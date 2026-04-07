# Credit Deduction System Fix - Comprehensive Plan

## 🔍 Root Cause Analysis

### Issue 1: Database Schema Problem 🔴 CRITICAL

- **Problem**: `credits` column is `INTEGER` instead of decimal type
- **Impact**: 199 - 0.38 credits → stored as 198 or worse (you saw 191), losing fractional parts
- **Evidence**: Multiple deductions compound the error (0.38 becomes 1, then another 0.38 becomes 1, etc.)

### Issue 2: Missing/Incorrect Database Function 🔴 CRITICAL

- **Problem**: No proper atomic `deduct_user_credits` function with row locking
- **Impact**: Race conditions, non-atomic deductions, precision loss

### Issue 3: UI Not Updating 🟡 HIGH

- **Problem**: ProfileView not receiving real-time credit updates after deductions
- **Impact**: Stale balance display until manual refresh

---

## 🎯 Comprehensive Solution

### Phase 1: Database Schema Migration (MUST DO FIRST)

#### Step 1.1 - Migrate credits column to support decimals

Run this SQL in Supabase SQL Editor:

```sql
-- Migration: Add support for fractional credits
-- IMPORTANT: This must be run in Supabase SQL Editor

BEGIN;

-- 1. Add new decimal column
ALTER TABLE public.users
ADD COLUMN credits_decimal NUMERIC(10, 2) DEFAULT 0.00;

-- 2. Migrate existing integer credits to decimal
UPDATE public.users
SET credits_decimal = credits::numeric;

-- 3. Drop old integer column (after verification)
ALTER TABLE public.users
DROP COLUMN credits;

-- 4. Rename decimal column to credits
ALTER TABLE public.users
RENAME COLUMN credits_decimal TO credits;

-- 5. Set NOT NULL constraint and default
ALTER TABLE public.users
ALTER COLUMN credits SET NOT NULL,
ALTER COLUMN credits SET DEFAULT 0.00;

-- 6. Update credits_used to support decimals too
ALTER TABLE public.users
ALTER COLUMN credits_used TYPE NUMERIC(10, 2);

-- 7. Recreate index on credits column
DROP INDEX IF EXISTS idx_users_credits;
CREATE INDEX idx_users_credits ON public.users(credits);

COMMIT;
```

#### Step 1.2 - Create atomic credit deduction function

```sql
-- Create atomic credit deduction function with proper error handling
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
BEGIN
    -- Get current balance with row lock (prevents race conditions)
    SELECT credits INTO v_current_credits
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE; -- CRITICAL: This locks the row for the transaction

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
            'user_not_found', -- error
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
            'insufficient_credits',
            format('Insufficient credits. Required: %s, Available: %s',
                   p_credits_to_deduct, v_current_credits)::TEXT;
        RETURN;
    END IF;

    -- Calculate new balance with precision
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
        -- Table doesn't exist yet, just continue
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

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.deduct_user_credits TO service_role;
```

#### Step 1.3 - Update get_user_credit_info function

```sql
CREATE OR REPLACE FUNCTION public.get_user_credit_info(
    p_clerk_id TEXT
)
RETURNS TABLE(
    success BOOLEAN,
    user_id UUID,
    clerk_id TEXT,
    current_credits NUMERIC(10, 2),
    credits_used NUMERIC(10, 2),
    total_spent_usd NUMERIC(10, 4),
    plan_type TEXT,
    last_credit_update TIMESTAMPTZ,
    message TEXT,
    error TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        TRUE,
        u.id,
        u.clerk_id,
        u.credits,
        COALESCE(u.credits_used, 0::NUMERIC(10, 2)),
        COALESCE(u.total_spent_usd, 0::NUMERIC(10, 4)),
        u.plan_type,
        u.last_credit_update,
        'User credit info retrieved successfully'::TEXT,
        NULL::TEXT
    FROM public.users u
    WHERE u.clerk_id = p_clerk_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT
            FALSE,
            NULL::UUID,
            p_clerk_id,
            0::NUMERIC(10, 2),
            0::NUMERIC(10, 2),
            0::NUMERIC(10, 4),
            NULL::TEXT,
            NULL::TIMESTAMPTZ,
            NULL::TEXT,
            'User not found'::TEXT;
    END IF;
END;
$$;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.get_user_credit_info TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_credit_info TO anon;
```

---

### Phase 2: Fix Credit Conversion Logic

**File: `src/services/creditManager.ts` (line 369-380)**

Current problematic code:

```typescript
private convertUSDToCredits(usdAmount: number, providerId?: string): number {
  const rate = this.config.CREDIT_TO_USD_RATE
  let credits = usdAmount / rate

  if (providerId === 'softcodes/openrouter') {
    // Fractional credits for OpenRouter: round to 2 decimal places for higher precision
    return Math.round(credits * 100) / 100
  } else {
    // Integer credits for other providers: ceil to whole number
    return Math.ceil(credits)
  }
}
```

**Fixed code** (always use 2 decimal precision):

```typescript
private convertUSDToCredits(usdAmount: number, providerId?: string): number {
  const rate = this.config.CREDIT_TO_USD_RATE
  const credits = usdAmount / rate

  // ALWAYS preserve 2 decimal places for precision
  // This matches the database NUMERIC(10, 2) type
  return Math.round(credits * 100) / 100
}
```

---

### Phase 3: Enhance Cache Invalidation

**File: `src/services/creditManager.ts` (line 164-173)**

Current code:

```typescript
// Step 6: Update cache on success
if (transaction.success) {
	this.updateUserCache(userInfo.userId, {
		...userCredits,
		currentCredits: transaction.balanceAfter!,
		creditsUsed: userCredits.creditsUsed + creditsToDeduct,
		totalSpent: userCredits.totalSpent + usdAmount,
	})

	console.log(`[CREDIT-MANAGER] ${requestId}: Credit deduction successful - New balance: ${transaction.balanceAfter}`)
}
```

**Enhanced code** (clear cache and broadcast immediately):

```typescript
// Step 6: Clear cache and broadcast update immediately
if (transaction.success) {
	// CRITICAL: Clear cache FIRST to force fresh read on next request
	this.clearUserCache(userInfo.userId)

	// Broadcast new balance to UI immediately via VSCode command
	try {
		const vscode = require("vscode")
		vscode.commands.executeCommand("softcodes.updateCreditBalance", transaction.balanceAfter)
		console.log(`[CREDIT-MANAGER] ${requestId}: Broadcasted balance update: ${transaction.balanceAfter}`)
	} catch (error) {
		console.warn(`[CREDIT-MANAGER] ${requestId}: Failed to broadcast balance:`, error)
	}

	console.log(`[CREDIT-MANAGER] ${requestId}: Credit deduction successful - New balance: ${transaction.balanceAfter}`)
}
```

---

### Phase 4: Enhance Real-time Update Handler

**File: `src/services/realtimeCreditUpdates.ts` (line 254-268)**

Current code:

```typescript
// Check for low credit warning
this.checkLowCreditWarning(newRecord)

// Invalidate cache for this user
creditManager.clearUserCache(newRecord.clerk_id)

// Call the callback
callback(updateEvent)

// Emit event for other listeners
this.emit("creditUpdate", updateEvent)
```

**Enhanced code** (also broadcast to UI):

```typescript
// Check for low credit warning
this.checkLowCreditWarning(newRecord)

// Invalidate cache for this user
creditManager.clearUserCache(newRecord.clerk_id)

// CRITICAL: Broadcast to UI immediately via VSCode command
try {
	const vscode = require("vscode")
	vscode.commands.executeCommand("softcodes.updateCreditBalance", newBalance)
	console.log(`[REALTIME-CREDITS] Broadcasted balance update: ${newBalance}`)
} catch (error) {
	console.warn(`[REALTIME-CREDITS] Failed to broadcast balance:`, error)
}

// Call the callback
callback(updateEvent)

// Emit event for other listeners
this.emit("creditUpdate", updateEvent)
```

---

### Phase 5: Verify ProfileView Update Handler

**File: `webview-ui/src/components/kilocode/profile/ProfileView.tsx` (line 181-190)**

Current code looks correct, but ensure it updates both state variables:

```typescript
} else if (message.type === "softcodesBalanceUpdate") {
  console.log("🔔 [ProfileView] Received balance update:", message.credits)
  setCreditBalance(message.credits ?? null)
  if (profileData) {
    setProfileData({
      ...profileData,
      credits: message.credits
    })
  }
}
```

This is already correct and should work once the backend properly broadcasts updates.

---

## 📋 Implementation Checklist

### Database (Run in Supabase SQL Editor):

- [ ] **CRITICAL**: Backup database before migration
- [ ] Run schema migration (Step 1.1) - converts credits to NUMERIC(10, 2)
- [ ] Create/update `deduct_user_credits` function (Step 1.2)
- [ ] Create/update `get_user_credit_info` function (Step 1.3)
- [ ] Verify functions work: `SELECT * FROM deduct_user_credits('test-uuid'::uuid, 0.38, 0.005, 'Test');`

### TypeScript Code Updates:

- [ ] Update `convertUSDToCredits` in `creditManager.ts` (Phase 2)
- [ ] Enhance cache invalidation in `creditManager.ts` (Phase 3)
- [ ] Add broadcast in `realtimeCreditUpdates.ts` (Phase 4)
- [ ] Verify ProfileView handler (Phase 5) - already correct

### Testing:

- [ ] Test with exact scenario: 199 credits - 0.38 credits = 198.62 credits
- [ ] Verify ProfileView updates immediately after deduction
- [ ] Test multiple small deductions (0.01, 0.05, 0.10) to verify precision
- [ ] Check that real-time subscription propagates updates

---

## ⚠️ Critical Notes

1. **Database migration MUST be done first** - existing integer column causes all fractional precision loss
2. **Backup database** before running migration
3. The `FOR UPDATE` lock in deduction function prevents race conditions
4. All decimal precision preserved with `NUMERIC(10, 2)` (supports values like 198.62)
5. ProfileView already has correct handler, just needs backend to broadcast properly

---

## 🧪 Test Plan

After implementing all changes:

1. **Database Test**:

    ```sql
    -- Should return balance_after = 198.62
    SELECT * FROM deduct_user_credits(
      'your-user-uuid'::uuid,
      0.38::numeric,
      0.005::numeric,
      'Test deduction'
    );
    ```

2. **Extension Test**:

    - Start with known balance (e.g., 199)
    - Make API call costing 0.38 credits
    - Verify ProfileView immediately shows 198.62
    - Check logs for broadcast messages

3. **Precision Test**:
    - Make 10 deductions of 0.01 credits each
    - Should result in exactly 0.10 total deduction
    - No rounding errors

---

## 🔄 Next Steps

1. Run database migration in Supabase (Phase 1)
2. Switch to Code mode to implement TypeScript changes (Phases 2-4)
3. Test with the exact scenario you described
4. Monitor logs for proper balance broadcasts
5. Verify ProfileView updates in real-time
