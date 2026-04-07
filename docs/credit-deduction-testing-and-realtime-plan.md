# Implementation Plan: Testing and Fixing Credit Over-Deduction with Actual Usage Deduction

## Problem Statement

The current credit deduction system appears to deduct more credits from the Supabase database than the actual USD spent on API calls (e.g., via OpenRouter). This could stem from:

- **Conversion Rate Mismatches**: The fixed `USD_PER_CREDIT` rate (0.014 USD/credit from `constants.ts`) may not align with OpenRouter's dynamic pricing, model-specific rates, or additional fees (e.g., reasoning tokens in Gemini models).
- **Estimation vs. Actual Usage**: Deductions use pre-call estimated USD amounts, but actual costs (from `openrouter.ts` usage response: `cost_details.upstream_inference_cost + cost`) might differ due to token counts, caching, or provider fallbacks.
- **Double/Retry Deductions**: The `enhancedCreditSystem.ts` queues retries on failures, potentially causing multiple deductions if syncs overlap.
- **Caching Inconsistencies**: `creditManager.ts` caches balances (30s TTL), but real-time updates (`realtimeCreditUpdates.ts`) invalidate on DB changes—race conditions could lead to over-deductions.
- **Rounding/Precision**: Fractional credits for OpenRouter (1 decimal) vs. integer for others; RPC (`deduct_user_credits`) might ceil or mishandle floats.
- **Missing Actual Cost Integration**: `openrouter.ts` computes `totalCost` post-response but doesn't feed it back to deduction logic.

This revised plan focuses on using **actual usage only** for deductions (post-call), with a pre-call sufficiency check using a conservative estimate to prevent failed API calls. No upfront deduction—credits are deducted precisely after the response is received.

## 1. Analysis of Potential Causes

Based on codebase review:

- **Conversion Logic** (`creditManager.ts:369-380`): `credits = usdAmount / 0.014`; fractional for OpenRouter. But `priceFormatter.ts` mirrors this—mismatch if OpenRouter reports different effective rates.
- **Deduction Trigger** (`creditManager.ts:104-188`): Uses `usdAmount` passed from API handler (e.g., `openrouter.ts`). If handler estimates high (e.g., conservative max_tokens), over-deduction occurs.
- **API Usage Reporting** (`openrouter.ts:617-625`): Yields actual `totalCost` at stream end, but deduction happens pre-call. No integration to adjust post-response.
- **DB RPC** (`creditManager.ts:322-328`): `deduct_user_credits` takes `p_usd_amount` (passed value), not actual. Supabase logs in `credit_transactions` but doesn't auto-adjust.
- **Real-Time** (`realtimeCreditUpdates.ts`): Subscribes to `users` (balance updates) and `credit_transactions` (inserts). Emits `creditUpdate` on changes, invalidates cache—but reactive, not preventive.
- **Supabase Config** (`supabaseConfig.ts`): Service role client for deductions; tests RPC availability. No built-in adjustment logic.
- **Constants** (`constants.ts`): `USD_PER_CREDIT: 0.014`—verify against OpenRouter docs (e.g., model-specific rates vary).

**Hypothesis**: Pre-call estimates (e.g., based on prompt length) exceed actual costs; no refund/adjustment mechanism. Solution: Defer deduction to post-call using exact `totalCost`.

## 2. Testing Plan

Test in phases: unit (isolation), integration (DB/API), end-to-end (simulation). Use Vitest (from codebase) for tests. Run from correct dirs: `cd src && npx vitest ...` for backend. Focus on verifying actual usage accuracy and pre-check sufficiency.

### Phase 1: Unit Tests for Conversion & Estimation (Focus: Mismatch Detection)

- **Files**: Add to `src/services/__tests__/creditSystem.test.ts` and `src/services/__tests__/priceFormatter.test.ts`.
- **Scenarios**:
    1. **Rate Accuracy**:
        - Input: Actual USD amounts (0.014, 0.028, 1.00).
        - Expected: Credits = USD / 0.014 (e.g., 1, 2, 71.43).
        - Test: `expect(convertUSDToCredits(0.014, 'softcodes/openrouter')).toBe(1)` (fractional).
        - Edge: Vary `providerId`; assert integer ceil for non-OpenRouter.
    2. **Pre-Check Estimation**: New function `estimateUSDForCall(promptLength: number, model: string)` (e.g., conservative: prompt_tokens \* rate + max_completion).
        - Assert estimate >= actual (from mock responses).
    3. **Formatter Consistency**:
        - `formatPrice('softcodes/openrouter', 0.014)` → "1.00 credits".
        - Compare with actual OpenRouter response costs.
    4. **Precision**: Test rounding (1 decimal vs. ceil); mock `CREDIT_CONFIG.USD_PER_CREDIT = 0.01` for variance.
- **Mock**: Use Jest mocks for `CREDIT_CONFIG`.
- **Run**: `cd src && npx vitest services/__tests__/creditSystem.test.ts`.
- **Metrics**: 100% coverage on conversion; assert estimate covers 95% of actual costs in mocks.

### Phase 2: Integration Tests for RPC Deduction (Focus: DB Accuracy with Actuals)

- **Files**: Extend `src/services/__tests__/creditSystem.test.ts`; use Supabase test client (service role).
- **Setup**: Mock JWT with test Clerk ID; use Supabase test project (or local with Docker).
- **Scenarios**:
    1. **Post-Call Deduction**:
        - Setup: Insert test user with 100 credits.
        - Mock API actual USD: 0.012 → Call `deductFromActual(mockJWT, 0.012)` → Expect balance 99.14 (fractional).
        - Assert: `balanceAfter = balanceBefore - (0.012 / 0.014)`.
    2. **Pre-Check Only**:
        - Estimate 0.02 USD → Check sufficient → No deduction yet.
        - Then deduct actual 0.012 → Full flow assert.
    3. **Retry/Queue** (`enhancedCreditSystem.ts`):
        - Simulate post-call failure → Queue actual deduction → Recover → Assert single deduction.
    4. **Insufficient Pre-Check**: Estimate 101 USD, balance 100 → Block call, no deduction.
    5. **Constraint Violations**: Test post-call insufficient (rare); assert error, no partial deduction.
- **Tools**: Supabase JS client; mock `getSupabaseServiceClient` for isolation.
- **Run**: `cd src && npx vitest services/__tests__/creditSystem.test.ts --runInBand` (for DB consistency).
- **Metrics**: Verify RPC deducts exact credits from actual USD; simulate 10 runs, assert deducted == actual / rate.

### Phase 3: End-to-End Simulation (Focus: Real API Flow with Actuals)

- **Files**: New test in `src/services/__tests__/endToEndCredit.test.ts`; integrate with `openrouter.ts`.
- **Setup**: Use test OpenRouter API key (free tier models); mock Supabase for DB.
- **Scenarios**:
    1. **Full Flow**:
        - Estimate USD (conservative) → Pre-check sufficient.
        - Trigger API call (e.g., simple prompt via `OpenRouterHandler.createMessage`).
        - Stream response → Capture actual `totalCost` from usage.
        - Deduct exact: Assert credits = actual USD / 0.014 (±0.01 tolerance).
    2. **Over-Deduction Prevention**:
        - Run 5 calls with varying prompts.
        - Log: Estimated (pre-check) vs. Actual USD; deducted only actual.
        - Assert: No deduction until post-call; balance exact.
    3. **Block on Estimate**:
        - Low balance, high-estimate prompt → Pre-check fails → No call, no deduction.
    4. **Real-Time Verification**:
        - Subscribe via `realtimeCreditUpdates.ts`.
        - Assert balance updates only post-call; matches actual.
- **Mock**: Use `nock` for OpenRouter responses; Vitest for DB mocks.
- **Run**: `cd src && npx vitest services/__tests__/endToEndCredit.test.ts`.
- **Metrics**: Run 20 simulations; assert 100% use actual (no over-deduction); pre-check blocks 100% insufficient cases.

### Testing Tools & Coverage

- **Framework**: Vitest (existing); add mocks for Supabase/OpenRouter.
- **Coverage**: `npx vitest --coverage`; target 90% on credit paths.
- **Debug**: Add logs in `creditManager.ts` (e.g., "Pre-check estimate Y USD; deducted Z from actual").
- **Environment**: Test DB (Supabase local); prod-like with real API key (low-cost models).

## 3. Solution Design: Actual Usage Deduction

**Goal**: Perform a pre-call sufficiency check with conservative estimate (no deduction), then deduct exact credits post-call using actual `totalCost` from API response. This eliminates over-deduction while preventing failed calls.

### Key Changes

- **Pre-Call Check**: Use estimate to verify sufficient credits (e.g., `checkSufficientCredits` with conservative USD projection based on prompt/model).
- **Post-Call Deduction**: After stream ends, deduct precise credits from actual USD (no upfront hold).
- **Event-Driven**: Use `realtimeCreditUpdates.ts` to broadcast deductions; update badge instantly.
- **Precision**: Always use OpenRouter's `totalCost` (USD) for deduction; estimate only for check.
- **Error Handling**: If post-call fails (e.g., offline), queue actual deduction for sync. If pre-check fails, block call.

### Architecture

1. **API Handler Integration** (`openrouter.ts`):

    - Modify `createMessage` to return `{ stream, actualUsage: lastUsage, totalCost: number }`.
    - Expose `totalCost` in yielded usage chunk for immediate access.

2. **Credit Manager Update** (`creditManager.ts`):

    - Existing: `checkSufficientCredits(jwtToken, estimatedUSD)` → Returns `{ sufficient, requiredCredits }` (no deduction).
    - New method: `deductFromActual(jwtToken: string, actualUSD: number, metadata?: any)`.
        - Convert actualUSD to credits.
        - Call RPC `deduct_user_credits` with actual values.
        - Log in `credit_transactions` as "actual_usage".
    - Update flow: Callers (e.g., API services) check pre, deduct post.

3. **Enhanced System** (`enhancedCreditSystem.ts`):

    - `deductCredits`: Pre-check estimate; if OK, proceed to API; post-call, call `deductFromActual` or queue if failed.
    - Queue "actual_deduction" ops for post-call sync.

4. **Supabase RPC** (Updated):

    - `deduct_user_credits`: Add param `p_is_actual: boolean` for logging (vs. estimate).
    - No new RPC needed; reuse with actual params.

5. **Real-Time** (`realtimeCreditUpdates.ts`):

    - Subscribe to `credit_transactions` (filter `operation_type='actual_usage'`).
    - Emit `creditDeduction` event for UI (e.g., "Deducted X credits for actual usage").

6. **UI/Badge** (`creditBadge/CreditBadgeManager.ts`):
    - On pre-check fail: Show "Insufficient credits (estimate)".
    - On post-deduction: Update with actual delta; tooltip "Deducted based on actual usage".

### Benefits & Trade-offs

- **Precision**: 100% actual costs; zero over-deduction.
- **UX**: Pre-check blocks low-balance calls; deduction visible post-response.
- **Resilience**: Queues post-call deductions like before.
- **Trade-off**: Users might start calls they can't complete if estimate wrong (rare with conservative calc); one DB call post-call.
- **Fallback**: If actual unavailable (e.g., error), use estimate or retry.

## 4. Implementation Steps

1. **Prep (1-2 days)**:

    - Run tests from Phase 1-2 to baseline (e.g., log 10 real calls: estimate vs. actual).
    - Implement conservative `estimateUSDForCall` (e.g., prompt_tokens _ rate _ 1.2 + fixed overhead).

2. **Core Changes (2-3 days)**:

    - Add `deductFromActual` in `creditManager.ts`.
    - Update API callers (e.g., in `ApiService.ts` or wherever `createMessage` is used): Pre-check → Call API → `deductFromActual(actualUSD)`.
    - Integrate in `openrouter.ts`: Ensure `totalCost` returned/accessible.

3. **Testing (1-2 days)**:

    - Implement Phase 3 tests; assert pre-check passes, post-deduction exact.
    - E2E: Simulate full flow → Assert deducted == actual / rate.

4. **Real-Time & UI (1 day)**:

    - Extend subscriptions in `realtimeCreditUpdates.ts` for actual deductions.
    - Update badge for post-call events.

5. **Deployment & Monitoring (1 day)**:
    - Add metrics: Pre-check blocks, actual vs. estimate ratio (via logs).
    - Rollout: Feature flag in `constants.ts` (`ENABLE_ACTUAL_DEDUCTION: true`).
    - Monitor: Run prod tests; alert on estimate inaccuracies >10%.

## 5. Risks & Mitigations

- **Under-Estimate**: Call starts but balance insufficient post → Queue deduction, notify user.
- **API Failures**: If response lost, retry call or use logged estimate.
- **DB Load**: Single post-call call; same as before.
- **Backward Compat**: Keep estimate deduction optional via flag.

## Next Actions

- Review/approve this revised plan.
- Switch to Code mode for implementation.
- Estimated Effort: 5-7 days (simpler without adjustments).

This revised plan uses actual usage only for deductions, with pre-checks to ensure feasibility.
