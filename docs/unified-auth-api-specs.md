# Unified Authentication API Specifications

This document specifies the API endpoints that need to be implemented on the website backend to support unified authentication between the VSCode extension and website.

## Overview

The unified authentication system bridges VSCode extension OAuth with Clerk-based website authentication while maintaining backward compatibility for both systems.

## Required API Endpoints

### 1. VSCode Auth Initiation Endpoint

**Endpoint**: `GET /api/auth/initiate-vscode-auth`

**Purpose**: Initiate OAuth flow for VSCode extension clients

**Query Parameters**:

- `redirect_uri` (required): VSCode callback URI (`vscode-softcodes://auth/callback`)
- `code_challenge` (required): PKCE code challenge
- `state` (required): CSRF protection state parameter
- `client_id` (optional): Configurable client ID retrieved from VSCode settings (`vscode.workspace.getConfiguration('softcodes.auth').get('clientId')`); defaults to production Clerk client ID if not set

**Configuration Retrieval**:
The client ID is dynamically retrieved from VSCode workspace settings to allow customization without code changes. This supports testing with dev/staging environments or custom OAuth providers.

**Response Format**:

```json
{
	"auth_url": "https://clerk.softcodes.ai/oauth/authorize?client_id=...&redirect_uri=...&code_challenge=...&state=..."
}
```

**Implementation Notes**:

- Generate Clerk OAuth URL with VSCode-specific parameters
- Store code_challenge and state for later verification
- Ensure redirect_uri validation for security

### 2. Unified Callback Endpoint

**Endpoint**: `POST /api/extension/auth/callback`

**Purpose**: Handle OAuth callbacks for both VSCode extension and website

**Request Body Formats**:

**VSCode Extension Format** (when `grant_type` is present):

```json
{
	"code": "auth-code-123",
	"code_verifier": "pkce-verifier",
	"state": "csrf-state",
	"redirect_uri": "vscode-softcodes://auth/callback",
	"grant_type": "authorization_code"
}
```

**Website Format** (legacy support):

```json
{
	"state": "csrf-state",
	"code": "auth-code-123",
	"clerk_user_id": "user_123",
	"redirect_uri": "https://softcodes.ai/dashboard"
}
```

**Response Formats**:

**VSCode Extension Response** (when `grant_type === "authorization_code"`):

```json
{
	"access_token": "jwt-access-token",
	"refresh_token": "clerk-refresh-token",
	"session_id": "clerk-session-id",
	"organization_id": "org-123"
}
```

**Website Response** (legacy format):

```json
{
	"success": true,
	"redirect_url": "https://softcodes.ai/dashboard"
}
```

**Implementation Requirements**:

- Detect client type using `grant_type` parameter
- Exchange authorization code with Clerk
- Generate JWT for VSCode clients
- Sync user data with Supabase if new user
- Return appropriate response format

### 3. Token Refresh Endpoint

**Endpoint**: `POST /api/auth/refresh-token`

**Purpose**: Refresh access tokens for authenticated clients

**Request Body**:

```json
{
	"refresh_token": "clerk-refresh-token",
	"client_type": "vscode"
}
```

**Response**:

```json
{
	"access_token": "new-jwt-access-token",
	"refresh_token": "new-clerk-refresh-token",
	"session_id": "clerk-session-id"
}
```

### 4. Session Validation Endpoint

**Endpoint**: `POST /api/auth/validate-session`

**Purpose**: Validate current user session

**Request Body**:

```json
{
	"session_id": "clerk-session-id",
	"client_type": "vscode"
}
```

**Headers**:

```
Authorization: Bearer jwt-access-token
```

**Response**:

- `200 OK`: Session is valid
- `401 Unauthorized`: Session is invalid

### 5. User Info Endpoint

**Endpoint**: `GET /api/auth/user-info`

**Purpose**: Get current user information

**Headers**:

```
Authorization: Bearer jwt-access-token
```

**Response**:

```json
{
	"email": "user@example.com",
	"firstName": "John",
	"lastName": "Doe",
	"organizationName": "Test Organization",
	"organizationId": "org-123"
}
```

### 6. Sign Out Endpoint

**Endpoint**: `POST /api/auth/sign-out`

**Purpose**: Sign out user and invalidate session

**Request Body**:

```json
{
	"session_id": "clerk-session-id"
}
```

**Response**:

```json
{
	"success": true
}
```

## Webhook Endpoints

### 7. Clerk User Sync Webhook

**Endpoint**: `POST /api/webhooks/clerk`

**Purpose**: Sync Clerk users with Supabase database

**Request Body** (from Clerk):

```json
{
	"type": "user.created",
	"data": {
		"id": "user_123",
		"email_addresses": [
			{
				"email_address": "user@example.com"
			}
		],
		"first_name": "John",
		"last_name": "Doe",
		"created_at": 1234567890
	}
}
```

**Implementation**:

- Verify webhook signature from Clerk
- Auto-create user record in Supabase
- Handle user updates and deletions

## Security Considerations

### Token Management

Tokens are managed securely within the VSCode extension:

- **Storage**: Access tokens, refresh tokens, and session IDs are stored using VSCode's SecretStorage API (`vscode.secrets.store()`), which encrypts data via the OS keychain (e.g., macOS Keychain). This prevents exposure in files or memory dumps.
- **Retrieval**: Tokens are fetched on-demand (`vscode.secrets.get()`) for API calls and deleted on sign-out (`vscode.secrets.delete()`).
- **Lifecycle**:
    - Access tokens: Used for authorization; refreshed proactively on expiry.
    - Refresh tokens: Rotated on use to enhance security.
    - No persistence: Tokens are never logged or written to disk.
- **No Hardcoded Credentials**: Token handling relies solely on dynamic OAuth responses and secure storage, with no embedded secrets.

### Authentication Flow Security

1. **PKCE (Proof Key for Code Exchange)**: All VSCode flows use PKCE for enhanced security. PKCE is crucial for public clients like VSCode extensions, where client secrets cannot be securely stored. It protects against authorization code interception by binding the code to a dynamic verifier.

    **PKCE Flow Details**:

    - Generate random `code_verifier` and derive `code_challenge` (SHA-256 hash, base64url encoded).
    - Include `code_challenge` and `code_challenge_method=S256` in authorization request.
    - Server verifies by recomputing challenge from `code_verifier` during token exchange.

    **Benefits for Public Clients**:

    - No client secrets needed: Eliminates exposure risks in client-side code.
    - Prevents replay attacks: Only the originating client can exchange the code.
    - Compliant with OAuth 2.0 RFC 7636 for native apps.

2. **State Parameter**: CSRF protection for all OAuth flows
3. **Redirect URI Validation**: Strict validation of redirect URIs
4. **JWT Token Security**: Short-lived access tokens with refresh token rotation
5. **No Hardcoded Credentials**: All sensitive values (e.g., client IDs, API endpoints) are sourced from VSCode settings or environment variables, never embedded in code. This ensures security across deployments.

### Error Handling

- Consistent error response formats
- Proper HTTP status codes
- Detailed error logging (server-side only)
- User-friendly error messages

### Rate Limiting

- Implement rate limiting on authentication endpoints
- Protect against brute force attacks
- Monitor for suspicious authentication patterns

## Configuration

### Configurable Client ID

The system supports a configurable client ID via VSCode settings for flexibility:

- **Default Behavior**: Uses the production Clerk client ID.
- **Customization**: Override in `settings.json`:
    ```json
    {
    	"softcodes.auth.clientId": "pk_test_your-custom-client-id"
    }
    ```
    - Retrieved via `vscode.workspace.getConfiguration('softcodes.auth').get('clientId')`.
    - Benefits: Enables environment-specific setups (dev/prod) or integration with custom Clerk instances without rebuilding the extension.

### Setting Up Custom Client IDs

1. Create or select a Clerk application in the dashboard and copy the publishable key (client ID).
2. Add to VSCode settings: `"softcodes.auth.clientId": "your-client-id"`.
3. Reload the VSCode window for changes to apply.
4. The extension validates the ID format during auth initiation and falls back to default if invalid.

This approach maintains security while providing extensibility. No hardcoded credentials are used; all configuration is user-controlled or environment-based.

## Implementation Priority

### Phase 1: Critical (Days 1-2)

1. **Unified Callback Endpoint**: Update existing `/api/extension/auth/callback`
2. **VSCode Auth Initiation**: Create `/api/auth/initiate-vscode-auth`

### Phase 2: High Priority (Days 3-4)

3. **Token Refresh Bridge**: Update `/api/auth/refresh-token`
4. **Session Validation**: Create `/api/auth/validate-session`
5. **User Info Endpoint**: Create `/api/auth/user-info`

### Phase 3: Medium Priority (Days 5-6)

6. **Sign Out Endpoint**: Create `/api/auth/sign-out`
7. **Clerk Webhook**: Create `/api/webhooks/clerk`

## Testing Requirements

### End-to-End Flow Testing

1. VSCode extension authentication initiation
2. Clerk OAuth flow completion
3. Token exchange and storage
4. API calls with Bearer token
5. Token refresh mechanism
6. Session validation
7. Sign out flow

### Error Scenario Testing

1. Invalid authorization codes
2. Expired tokens
3. Network failures
4. Invalid redirect URIs
5. Malformed requests

## Backward Compatibility

The unified system maintains full backward compatibility:

- Website authentication flows remain unchanged
- Existing API endpoints continue to work
- No breaking changes to current user sessions
- Gradual migration path for existing integrations

## Configuration Alignment

### Clerk Configuration

Both VSCode extension and website must use the same Clerk instance:

**Environment Variables**:

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_live_[your_key]
NEXT_PUBLIC_CLERK_FRONTEND_API=https://clerk.softcodes.ai
CLERK_SECRET_KEY=sk_live_[your_secret]
```

**VSCode Extension Config**:

```typescript
export const AUTH_CONFIG = {
	PRODUCTION: {
		CLERK_BASE_URL: "https://clerk.softcodes.ai",
		API_BASE_URL: "https://softcodes.ai",
	},
}
```
