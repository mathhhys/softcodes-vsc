# Credit Calculation and Display in Softcodes

## Overview

This document outlines where and how credits are calculated and displayed in the Softcodes VSCode extension. Credits represent a unit of consumption for API usage, converted from USD costs. The system integrates with authentication (JWT/Supabase), handles resilient operations, and provides real-time updates via status bar badges and UI components.

## Credit Calculation Locations

### 1. Primary Calculation: `src/services/creditManager.ts`

- **Function**: `convertUSDToCredits(usdAmount: number, providerId?: string): number`
    - Converts USD amounts to credits using the `CREDIT_TO_USD_RATE` (configured via `CREDIT_CONFIG.USD_PER_CREDIT`).
    - Logic:
        - Base credits = `usdAmount / CREDIT_TO_USD_RATE`.
        - For provider `'softcodes/openrouter'`: Rounds to 1 decimal place (fractional credits supported).
        - For other providers: Ceil to nearest whole number (integer credits).
    - Used in deduction flows to determine how many credits to deduct for a given API cost.
- **Deduction Flow**: `deductCreditsFromJWT(jwtToken: string, usdAmount: number, ...): Promise<CreditTransaction>`
    - Extracts user from JWT (with caching for performance).
    - Converts USD to credits.
    - Checks sufficient balance (pre-validation).
    - Executes atomic deduction via Supabase RPC (`deduct_user_credits`).
    - Updates cache and returns transaction details (balance before/after, etc.).
- **Other Utilities**:
    - `convertCreditsToUSD(credits: number): number` – Reverse conversion.
    - `calculateCreditsForUSD(usdAmount: number, providerId?: string): number` – Wrapper for conversion.
    - Caching: User credits cached for 30s, JWT for 5min to minimize latency.
- **Integration**: Singleton `creditManager` instance exported for use across the app.

### 2. Resilient Calculation: `src/services/enhancedCreditSystem.ts`

- **Function**: `deductCredits(operationType: string, usdAmount: number, ...): Promise<CreditTransaction>`
    - Wraps `creditManager.deductCreditsFromJWT` for primary path.
    - On failure (e.g., auth issues), falls back to:
        - Queuing operations for retry (critical ops like 'CODE_GENERATION').
        - Offline tracking with estimated credits (`creditManager.calculateCreditsForUSD`).
    - Estimates credits using provider-aware conversion (defaults to OpenRouter).
    - Syncs queued/offline transactions when auth recovers.
- **Estimation**: Uses `creditManager.calculateCreditsForUSD(usdAmount, 'softcodes/openrouter')` for offline mode.
- **Background Sync**: Runs every 2 minutes to process queues and sync offline data.

### 3. Provider-Specific Calculation: `webview-ui/src/components/settings/providers/OpenRouterBalanceDisplay.tsx`

- **Hook**: `useOpenRouterKeyInfo(apiKey, baseUrl)`
    - Fetches key info from OpenRouter API (limit and usage in USD).
- **Calculation**:
    - `remainingDollars = keyInfo.limit - keyInfo.usage`
    - `remainingCredits = remainingDollars / 0.014` (hardcoded rate for OpenRouter).
    - Formatted to 2 decimal places.
- **Scope**: Specific to OpenRouter API keys; not part of core credit system.

### 4. Formatting: `src/services/priceFormatter.ts` (referenced but not read)

- Used in `creditManager.formatCost(providerId: string, amount: number): string` for display-friendly pricing.
- Likely handles locale/currency formatting for USD/credits.

## Credit Display Locations

### 1. Status Bar Badge: `src/services/creditBadge/CreditBadgeManager.ts`

- **Manager**: `CreditBadgeManager` orchestrates display via `StatusBarBadge`.
    - Initializes with config (e.g., dollarToCreditRate, thresholds).
    - Tracks session operations via `CreditAccumulator` (adds ops, computes totals).
- **Real Balance Display**:
    - `refreshUserCreditBalance()`: Fetches from `creditManager.getUserCreditBalance(jwtToken)`.
    - Updates via `statusBarBadge.updateRealCreditBalance(currentCredits)`.
    - Shows actual Supabase balance (currentCredits) alongside session usage.
- **Session Display**:
    - Tracks operations (e.g., `addOperation(operation: string, usdCost: number)`).
    - Converts to credits via `CreditConverter`.
    - Displays: Total session credits used, operation count, average, rate (ops/hour).
- **Updates**:
    - Real-time via `realtimeCreditService` subscription (on 'creditUpdate').
    - Periodic refresh (30s backup) and fallback polling (10s if realtime fails).
    - Immediate on operations: Invalidates cache, refreshes balance, updates display.
- **Visual Feedback**: `VisualFeedbackManager` shows animations/notifications for consumption.
- **Commands**:
    - `softcodes.creditBadge.showDetails`: Shows breakdown (credits used, recent ops).
    - Badge click: Triggers details view with reset/buy/settings options.

### 2. UI Component: `webview-ui/src/components/settings/providers/OpenRouterBalanceDisplay.tsx`

- Displays remaining OpenRouter credits as a clickable link to settings.
- Format: `{formattedCredits} credits` (e.g., "123.45 credits").
- Only shown if key info available; links to OpenRouter key management.

### 3. Integration Points

- **Realtime Updates**: `src/services/realtimeCreditUpdates.ts` (subscribes to user changes, emits to badge).
- **Auth Integration**: Uses `UnifiedAuthService` for tokens; falls back on structure validation.
- **Error Handling**: Displays warnings for low balance, offline mode.
- **Configuration**: VSCode settings (`softcodes.creditBadge.*`) for thresholds, reset behavior.

## Flow Summary

1. **API Call**: USD cost from provider (e.g., OpenRouter).
2. **Calculation**: `creditManager.convertUSDToCredits(usdAmount, providerId)` → credits to deduct.
3. **Deduction**: `enhancedCreditSystem.deductCredits` → atomic DB update or queue/offline.
4. **Update**: Cache invalidation → realtime emit → badge refresh.
5. **Display**: Status bar shows real balance + session stats; UI shows provider-specific (e.g., OpenRouter remaining).

## Recommendations

- For custom rates: Update `CREDIT_CONFIG.USD_PER_CREDIT`.
- Testing: Use `creditManager.checkSufficientCredits` before deductions.
- Monitoring: Badge provides session diagnostics; extend for full history webview.

This covers the core locations based on current codebase analysis.
