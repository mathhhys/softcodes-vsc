# Analytics Dashboard - Softcodes Extension & Backend Implementation Guide

## Overview

This guide details the implementation to ensure API usage from the VSCode extension is properly logged to the `api_request_logs` table for the analytics dashboard on the website. The backend already has logging integrated into [`deduct_user_credits`](database/migrations/012_log_api_requests.sql:12) and [`deduct_org_credits`](database/migrations/012_log_api_requests.sql:122) functions (migration 012).

**Key Requirements:**

- Extension must pass metadata `{ operationType: 'api_actual_usage', modelId, apiProvider, inputTokens, outputTokens, requestId }` to backend API calls that deduct credits.
- Backend verifies JWT (userId, organizationId from Clerk) and logs during deduction.
- No new DB migrations needed (013 adds RLS/indexes/functions).
- Website will query via RPCs [`get_org_analytics`](database/migrations/013_analytics_enhancements.sql:146), [`get_user_analytics`](database/migrations/013_analytics_enhancements.sql:207).

**Prerequisites:**

- Migrations 012 & 013 applied to Supabase DB.
- Clerk JWT template includes `userId`, `organizationId` (see website CLERK_JWT_TEMPLATE_CONFIG.md).
- Backend API endpoints use JWT middleware to extract IDs.

## Data Flow Diagram

```mermaid
graph TD
    A[VSCode Extension: API Request<br/>w/ JWT + metadata] --> B[Backend Middleware:<br/>Decode JWT (userId/orgId)]
    B --> C[Process Request<br/>(e.g. /api/chat)]
    C --> D[Calculate cost/tokens]
    D --> E[Call deduct_user/org_credits<br/>w/ usd_amount, metadata]
    E --> F[Log to api_request_logs<br/>(user_id, org_id, model_id, provider,<br/>input_tokens, output_tokens, total_cost)]
    F --> G[Update credits in users/organizations]
    G --> H[Return response to extension]
    I[Website Dashboard: Clerk Auth] --> J[Supabase Client RPC:<br/>get_org_analytics(orgId, dates)]
    J --> K[RLS Filtered Data:<br/>daily_usage_summary + logs]
    K --> L[Render Table/Charts:<br/>Org totals, per-seat rows]
```

## Backend Changes (Minimal - Logging Already Implemented)

1. **Verify deduct_credits Integration** (already in 012):

    - Triggers log if `metadata.operationType = 'api_actual_usage'`.
    - Fields logged: `user_id` (from JWT or metadata), `organization_id`, `task_id` (requestId), `model_id`, `provider`, `input_tokens`, `output_tokens`, `total_cost`, `metadata`.

2. **API Middleware** (src/api/middleware/auth.ts or similar):

    - Ensure all credit-deducting endpoints (e.g. /api/chat, /api/completion) call deduct_credits with metadata.
    - Example update in handler:
        ```
        // In src/api/chat.ts or equivalent
        const metadata = {
          operationType: 'api_actual_usage',
          modelId: model.id,
          apiProvider: provider,
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          requestId: request.id
        };
        const usdCost = calculateUsdCost(usage);
        await deduct_user_credits(userId, credits, usdCost, 'API Usage', metadata);
        ```

3. **Test Logging**:
    - Run `npx supabase db reset` (dev).
    - Make API call from extension.
    - Query: `SELECT * FROM api_request_logs ORDER BY created_at DESC LIMIT 5;`.

## Extension Changes (src/api/client.ts or equivalent)

Update API client to include metadata in requests.

1. **API Client Update** (e.g. [`src/api/client.ts`](src/api/client.ts) or `packages/cloud/src/api/`):

    ```
    // Add metadata to request body
    export async function chatCompletion(modelId: string, provider: string, messages: Message[], requestId: string) {
      const body = {
        modelId,
        provider,
        messages,
        requestId, // UUID for tracking
        // Backend will calc tokens/cost, but pre-send if known
      };
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwtToken}` },
        body: JSON.stringify(body),
      });
      // Backend extracts usage from response, passes to deduct_credits with metadata
      return response.json();
    }
    ```

2. **In Usage Handlers** (e.g. src/api/providers/fetchers/openai.ts):

    - After API response, extract `usage: {prompt_tokens, completion_tokens}`.
    - Calc cost, call deduct_credits with metadata.
    - Ensure backend handler passes usage to metadata.

3. **Credit Display** (optional, src/extension/statusbar.ts):
    ```
    // Fetch user analytics periodically
    const analytics = await supabase.rpc('get_user_analytics', { p_user_id: userId, p_start_date: '30 days ago', p_end_date: now });
    statusBar.text = `Credits used: ${analytics.total_credits}`;
    ```

## Testing & Deployment

1. **Local Test**:

    - `cd src && npx supabase start`
    - Apply migrations.
    - Run extension, make API call.
    - Check logs table.

2. **Deploy**:

    - `npx supabase db push`
    - Refresh daily summary: `supabase.rpc('refresh_daily_summary')`.

3. **Edge Cases**:
    - Org vs user credits.
    - No metadata -> no log.
    - RLS: Org members see org data only.

## Files to Update

- Backend: src/api/[endpoints]/\*.ts (add metadata to deduct calls)
- Extension: src/api/client.ts (add requestId/metadata)
- Tests: src/**tests**/api/\*.test.ts (mock deduct, assert log insert)

Contact for questions.
