# Backend Authentication Testing Instructions for Softcodes.ai

This document provides step-by-step instructions to verify the authentication and token refresh functionality from the Softcodes.ai backend perspective. These tests ensure that the VSCode extension's communication (OAuth, token exchange, refresh, validation) works correctly with the backend APIs.

## Prerequisites

- **Backend Environment**: Running Softcodes.ai backend (production: `https://softcodes.ai`, development: `http://localhost:3000`).
- **Clerk Configuration**:
    - Production: `CLERK_BASE_URL: https://clerk.softcodes.ai`
    - Ensure Clerk webhooks are set up to sync users to Supabase.
- **Supabase**: Configured with service role key for user verification. Tables: `users` with columns like `clerk_id`, `email`, `first_name`, etc.
- **Testing Tools**:
    - `curl` or Postman for API calls.
    - Browser for OAuth flow.
    - VSCode with the extension installed (for end-to-end testing).
- **Environment Variables** (in `.env` or equivalent):
    ```
    CLERK_SECRET_KEY=sk_live_...
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
    NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
    ```
- **Test User**: Create a test account in Clerk dashboard (e.g., email: `test@example.com`, user_id: `user_test123`).

## 1. Verify Configuration

Run these checks to ensure backend setup is correct:

### Check Clerk Config

```bash
# In backend root
echo "CLERK_BASE_URL: $CLERK_BASE_URL"
echo "CLERK_SECRET_KEY starts with sk_live_: $(echo $CLERK_SECRET_KEY | cut -c1-8)"
curl -I "https://clerk.softcodes.ai/.well-known/jwks.json"  # Should return 200
```

### Check Supabase Config

```bash
# Test Supabase connection (using curl or Supabase CLI)
curl -X GET "https://your-project.supabase.co/rest/v1/users?select=*" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

- Expected: Returns user list (empty if no users).

### Validate Endpoints Exist

```bash
# Base URL (adjust for dev/prod)
BASE_URL="https://softcodes.ai"  # or http://localhost:3000

# Check key auth endpoints (should return 405/200, not 404)
curl -I "$BASE_URL/api/auth/initiate-vscode-auth"
curl -I "$BASE_URL/api/extension/auth/callback"
curl -I "$BASE_URL/api/auth/refresh-token"
curl -I "$BASE_URL/api/auth/validate-session"
curl -I "$BASE_URL/api/auth/user-info"
curl -I "$BASE_URL/api/auth/sign-out"
```

- Expected: No 404s. 405 (Method Not Allowed) is OK for HEAD/GET on POST endpoints.

## 2. Test OAuth Flow (Initial Authentication)

This simulates the VSCode extension's `authenticate()` → browser redirect → callback.

### Step 2.1: Initiate Auth (Extension Side)

- In VSCode: Run command `Softcodes: Sign In` (triggers `authenticate()`).
- Or simulate with curl (generate PKCE params first):

    ```bash
    # Generate PKCE (Node.js script or online tool)
    node -e "
    const crypto = require('crypto');
    const verifier = crypto.randomBytes(32).toString('base64url');
    console.log('VERIFIER:', verifier);
    const hash = crypto.createHash('sha256').update(verifier).digest('base64url');
    console.log('CHALLENGE:', hash);
    const state = crypto.randomBytes(16).toString('base64url');
    console.log('STATE:', state);
    "

    # Use values in curl
    VERIFIER="your-verifier"
    CHALLENGE="your-challenge"
    STATE="your-state"

    curl -X GET "$BASE_URL/api/auth/initiate-vscode-auth?redirect_uri=vscode-softcodes://auth/callback&code_challenge=$CHALLENGE&state=$STATE"
    ```

- Expected Response (200 JSON):
    ```json
    {
    	"auth_url": "https://clerk.softcodes.ai/v1/client/sign_ins?redirect_url=...&response_mode=query&..."
    }
    ```
- Action: Open `auth_url` in browser, complete login (use test user).

### Step 2.2: Handle Callback (Token Exchange)

- After Clerk login, browser redirects to `vscode-softcodes://auth/callback?code=auth_code&state=your-state`.
- Simulate exchange (extension calls this):
    ```bash
    curl -X POST "$BASE_URL/api/extension/auth/callback" \
      -H "Content-Type: application/json" \
      -d '{
        "code": "auth_code_from_redirect",
        "code_verifier": "'$VERIFIER'",
        "state": "'$STATE'",
        "redirect_uri": "vscode-softcodes://auth/callback"
      }'
    ```
- Expected Response (200 JSON):
    ```json
    {
    	"success": true,
    	"access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...", // 24h JWT
    	"refresh_token": "rt_...", // 30d
    	"expires_in": 86400 // seconds
    }
    ```
- Verify Tokens:
    - Access token: Decode at jwt.io (issuer: `https://clerk.softcodes.ai`, exp: ~24h).
    - Store in VSCode secrets (manual for testing: use extension debug or VSCode storage inspector).

### Step 2.3: Validate Initial Session

```bash
ACCESS_TOKEN="your-access-token"

curl -X POST "$BASE_URL/api/auth/validate-session" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_type": "vscode",
    "workspace_path": "/path/to/workspace",
    "workspace_name": "test-workspace"
  }'
```

- Expected: 200 with `{ "valid": true, "user": { "id": "...", "email": "test@example.com" } }`.

## 3. Test Token Refresh

Simulate expiration and refresh.

### Step 3.1: Force Token Expiration (for Testing)

- In VSCode: Manually set `token_expiry` in globalState to past timestamp (via extension host debug).
- Or use a short-lived test token from Clerk dashboard.

### Step 3.2: Perform Refresh

```bash
REFRESH_TOKEN="your-refresh-token"

curl -X POST "$BASE_URL/api/auth/refresh-token" \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "'$REFRESH_TOKEN'",
    "client_type": "vscode"
  }'
```

- Expected Response (200 JSON): Same as token exchange (new access/refresh tokens).
- Verify:
    - New access_token has fresh `iat`/`exp` (~24h from now).
    - Backend logs: Check for user sync to Supabase via Clerk webhook.
    - Supabase Query: `SELECT * FROM users WHERE clerk_id = 'user_test123';` – Should exist with credits, plan, etc.

### Step 3.3: Test Refresh Failure Scenarios

- Invalid refresh_token: Expect 401 `{ "error": "Invalid refresh token" }`.
- Expired refresh_token: Expect 401.
- Network timeout: Use slow network; backend should handle with 10s timeout.
- Retry: Extension retries 3x; backend should be idempotent.

## 4. Test User Info and Sign Out

### User Info

```bash
curl -X GET "$BASE_URL/api/auth/user-info" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

- Expected: 200 with `{ "email": "...", "plan_type": "...", "credits": 100 }` (from Supabase).

### Sign Out

```bash
SESSION_ID="your-session-id"  # From initial tokens

curl -X POST "$BASE_URL/api/auth/sign-out" \
  -H "Content-Type: application/json" \
  -d '{ "session_id": "'$SESSION_ID'" }'
```

- Expected: 200 `{ "success": true }`. Backend should invalidate session in Clerk/Supabase.

## 5. End-to-End Testing with VSCode Extension

1. Install extension in VSCode.
2. Run `Softcodes: Sign In` → Complete OAuth.
3. Check logs (`Output` panel → Softcodes): Look for "Token stored", "Supabase verified".
4. Trigger API call (e.g., chat or autocomplete) → Should refresh transparently.
5. Wait for expiry (or force via debug) → Extension prompts re-auth on next call.
6. Verify Supabase: User record created/updated on first auth.

## 6. Common Issues and Debugging

- **404 on Endpoints**: Implement missing routes in backend (e.g., Next.js API routes).
- **CORS Errors**: Add `https://softcodes.ai` to allowed origins in backend.
- **Clerk Webhook Failures**: Check Clerk dashboard → Webhooks → Test sync to Supabase.
- **JWT Invalid**: Verify RS256 algo, JWKS fetch. Test with `jwt.io`.
- **Supabase User Not Found**: Ensure webhook creates user on Clerk signup.
- **Logs**: Backend: Check console/PM2 logs for auth requests. Extension: VSCode Output.
- **Rate Limiting**: If hits, check `USER_VERIFICATION_CONFIG.RATE_LIMITING`.

## 7. Production Deployment Checklist

- [ ] All endpoints implemented and tested.
- [ ] Clerk webhooks active (user.created, user.updated → Supabase insert/update).
- [ ] HTTPS enforced (no HTTP redirects).
- [ ] Error monitoring (Sentry/LogRocket for 401s/timeouts).
- [ ] Load testing: 100 concurrent refreshes (use Artillery or similar).

Run these tests before each deploy. If issues, check backend logs and Clerk/Supabase dashboards.
