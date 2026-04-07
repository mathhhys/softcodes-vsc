# Why Token Refresh Tests Cannot Pass (Technical Analysis)

## Critical Issue: Circular Dependency in Token Refresh Logic

### The Problem

The token refresh tests fail because of a **fundamental design contradiction** in the current implementation:

```
┌──────────────────────────────────────────────────────────────────────┐
│  ensureValidAccessToken() Flow                                       │
│                                                                      │
│  1. Call getAccessToken()                                           │
│     └─> Returns undefined for expired tokens (line 1733)            │
│                                                                      │
│  2. No token? Try refresh with refreshToken                          │
│     └─> performTokenRefreshWithLocking()                            │
│         └─> refreshAccessTokenResilient()                           │
│             ├─> Try API refresh (fails in tests)                    │
│             └─> Fallback: extendTokenLifetime()                     │
│                 └─> Calls getAccessToken() again!                   │
│                     └─> Still returns undefined                     │
│                         └─> Can't extend - returns undefined        │
│                                                                      │
│  Result: undefined (refresh failed)                                  │
└──────────────────────────────────────────────────────────────────────┘
```

### Code Evidence

**In [`getAccessToken()`](../unifiedAuthService.ts:1721-1733):**

```typescript
if (expirationTime <= currentTime) {
	// Strict policy: do not return expired tokens to callers
	return undefined // ❌ Expired token not accessible
}
```

**In [`extendTokenLifetime()`](../unifiedAuthService.ts:2129-2133):**

```typescript
// Get current access token
const currentToken = await this.getAccessToken() // ❌ Returns undefined for expired tokens!
if (!currentToken) {
	console.log("❌ [TOKEN-EXTEND] No current token to extend")
	return undefined
}
```

## Why Each Failing Test Can't Pass

### 1. ❌ "should refresh expired tokens when refresh token is available"

**Why It Fails:**

- Stores expired token (-60s)
- `ensureValidAccessToken()` calls `getAccessToken()` → gets `undefined`
- Tries to refresh via API
- API calls require proper HEAD + POST mock setup
- Falls back to `extendTokenLifetime()`
- `extendTokenLifetime()` calls `getAccessToken()` → gets `undefined` again
- Returns `undefined` instead of refreshed token

**To Make It Pass, Need:**

- Direct access to expired tokens in `extendTokenLifetime()`
- OR proper API endpoint mocking with HEAD + POST responses

### 2. ❌ "should use fallback token extension in development mode"

**Why It Fails:**

- Same circular dependency as above
- Even with `auth.skipAPIValidation = true`, can't extend what it can't access
- `getAccessToken()` prevents access to expired tokens

**Cannot Pass Because:**

- Implementation bug: `extendTokenLifetime()` relies on `getAccessToken()` which filters out expired tokens
- This defeats the purpose of "extending" expired tokens

### 3. ❌ "should handle tokens near expiration" & "should respect JWT_CONFIG.TOKEN_REFRESH_THRESHOLD"

**Why They Fail:**

- Token expires in 2 minutes (within 5-minute threshold)
- Should trigger proactive refresh
- But token isn't "expired" yet, so `getAccessToken()` returns it
- Then `ensureValidAccessToken()` checks if it's within threshold
- Tries to refresh, but mocks aren't complete
- Returns original token instead of refreshed one

**To Make Them Pass, Need:**

- Complete mock setup with HEAD check + POST refresh
- Currently only mocking POST, missing HEAD check

### 4. ❌ "should prevent race conditions during concurrent refresh attempts"

**Why It Fails:**

- Same mock issue as above
- The locking mechanism WORKS correctly
- But the underlying refresh fails due to incomplete mocks
- So all three concurrent calls get `undefined`

### 5. ❌ "should handle token refresh rotation correctly"

**Why It Fails:**

- Expired token stored
- Refresh attempted but incomplete mocks cause failure
- Tokens don't get rotated because refresh never completes

## Solutions

### Solution 1: Fix the Implementation ✅ (Recommended)

Change `extendTokenLifetime()` to access expired tokens directly:

```typescript
private async extendTokenLifetime(refreshToken: string): Promise<string | undefined> {
    // Get token directly from storage, bypassing getAccessToken()
    const currentToken = await this.context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)
    if (!currentToken) {
        return undefined
    }

    // Check if recently expired (within 30-minute grace period)
    const parseResult = parseJWTUnsafe(currentToken)
    if (parseResult.success && parseResult.parts?.payload.exp) {
        const timeUntilExpiration = parseResult.parts.payload.exp * 1000 - Date.now()

        if (timeUntilExpiration > -30 * 60 * 1000) {
            return currentToken // Allow recently expired tokens
        }
    }

    return undefined
}
```

### Solution 2: Complete Mock Setup ✅ (For Tests)

Update test mocks to handle the full refresh flow:

```typescript
// Mock the complete refresh sequence
mockFetch
	.mockResolvedValueOnce({ ok: true }) // HEAD check
	.mockResolvedValueOnce({
		// POST refresh
		ok: true,
		json: async () => ({
			access_token: newToken,
			refresh_token: newRefreshToken,
		}),
	})
```

### Solution 3: Simplify Tests ⚠️ (Compromise)

Accept that refresh logic is too complex for unit tests and:

- Test only the happy path (valid tokens)
- Skip edge cases (expired + refresh scenarios)
- Use integration tests when backend is available

## Recommendation

**Implement Solution 1 + Solution 2:**

1. Fix `extendTokenLifetime()` to access expired tokens directly from storage
2. Update test mocks to properly simulate the full API flow
3. This will make ALL tests pass and fix a real implementation bug

The bug is that expired tokens cannot be extended in development mode, which defeats the purpose of the fallback mechanism.
