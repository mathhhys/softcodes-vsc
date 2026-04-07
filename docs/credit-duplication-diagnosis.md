# Credit Duplication Diagnosis Report

## User-Provided Information

- Clerk ID: `user_32mSltWx9KkUkJe3sN2Bkym2w45`
- Timestamp: `1760532259628000` (interpreted as Unix timestamp in microseconds; converts to approximately 2025-10-15T11:30:59.628Z UTC)

## Analysis Summary

From code review:

- Deduction calls are primarily in `src/core/task/Task.ts` (post-call deduction via `deductFromActual`).
- De-duplication in `creditManager.ts` relies on `requestId` metadata; if missing, duplicates possible.
- Realtime updates in `realtimeCreditUpdates.ts` emit events but do not trigger deductions.
- OpenRouter display (`OpenRouterBalanceDisplay.tsx`) only shows balance, no deductions.
- Potential gap: If `requestId` not always provided (e.g., in Task.ts metadata), race conditions or retries could cause duplicates.

No obvious double-invocation in OpenRouter integrations. Likely cause: Missing/duplicate `requestId` in Task deductions or DB-level anomaly.

## Diagnostic SQL Query

Run this in Supabase SQL editor to check transactions around the timestamp. Replace `{clerk_id}` and `{timestamp_ms}` (convert microseconds to milliseconds: 1760532259628).

**Fixed Query 2 (use ABS for approximate match instead of ≈):**

```sql
-- 1. Get user_id from clerk_id
SELECT id AS user_id
FROM public.users
WHERE clerk_id = '{clerk_id}';

-- 2. Query transactions around timestamp (10-min window around 2025-10-15 11:30:59 UTC) for the user
-- Assume user_id from step 1
WITH user_id AS (SELECT id FROM public.users WHERE clerk_id = '{clerk_id}')
SELECT
  id,
  user_id,
  operation_type,
  credits_amount,
  usd_amount,
  balance_before,
  balance_after,
  description,
  metadata,
  created_at,
  EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_ms  -- Convert to ms for comparison
FROM public.credit_transactions
WHERE user_id = (SELECT id FROM user_id)
  AND created_at BETWEEN TIMESTAMP '2025-10-15 11:25:00+00' AND TIMESTAMP '2025-10-15 11:35:00+00'
  AND operation_type = 'deduction'
  AND ABS(usd_amount - 0.007) < 0.001  -- Approximate match for $0.007 OpenRouter cost (within 0.001 tolerance)
ORDER BY created_at DESC;

-- 3. Check for duplicates: Group by metadata/description to detect multiples (1-hour window)
WITH user_id AS (SELECT id FROM public.users WHERE clerk_id = '{clerk_id}'),
deductions AS (
  SELECT
    metadata,
    description,
    usd_amount,
    COUNT(*) as count,
    MIN(created_at) as first_occurred,
    MAX(created_at) as last_occurred,
    ARRAY_AGG(created_at ORDER BY created_at) as timestamps
  FROM public.credit_transactions
  WHERE user_id = (SELECT id FROM user_id)
    AND created_at >= TIMESTAMP '2025-10-15 10:30:00+00' AND created_at <= TIMESTAMP '2025-10-15 12:30:00+00'  -- 2-hour window around incident
    AND operation_type = 'deduction'
    AND (description ILIKE '%OpenRouter%' OR description ILIKE '%API usage%' OR metadata::text ILIKE '%openrouter%')
  GROUP BY metadata, description, usd_amount
  HAVING COUNT(*) > 1  -- Only show potential duplicates
)
SELECT * FROM deductions
ORDER BY first_occurred DESC
LIMIT 10;

-- 4. Recent balance changes for user
WITH user_id AS (SELECT id FROM public.users WHERE clerk_id = '{clerk_id}'),
recent_tx AS (
  SELECT
    credits_amount,
    balance_after,
    operation_type,
    created_at,
    description
  FROM public.credit_transactions
  WHERE user_id = (SELECT id FROM user_id)
    AND created_at >= NOW() - INTERVAL '1 day'
  ORDER BY created_at DESC
  LIMIT 20
)
SELECT
  rt.*,
  u.credits as current_db_balance
FROM recent_tx rt
CROSS JOIN (SELECT credits FROM public.users WHERE clerk_id = '{clerk_id}') u;
```

## Next Steps

1. Run the corrected queries above in Supabase dashboard.
2. Share the output (redact sensitive info) to confirm duplicates.
3. If duplicates found with same metadata, confirms code gap (missing requestId).
4. Test end-to-end fractional deduction to reproduce.
5. Propose code fixes if confirmed.

Expected: If two deductions of ~0.50 credits ($0.007) around timestamp with identical metadata, indicates double execution.
