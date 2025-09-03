# Unified Authentication Implementation Guide

This guide provides step-by-step instructions for implementing the unified authentication system in your website backend.

## Phase 1: API Compatibility Layer Implementation

### Step 1: Update Extension Callback Endpoint

**File**: `api/extension/auth/callback.ts` (or equivalent)

```typescript
import { VercelRequest, VercelResponse } from '@vercel/node';
import { auth } from '@clerk/nextjs';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, grant_type, redirect_uri, state, clerk_user_id, code_verifier } = req.body;

    // Determine client type based on grant_type
    const isVSCodeClient = grant_type === "authorization_code";

    if (isVSCodeClient) {
      // VSCode Extension Flow
      const tokens = await handleVSCodeAuth(code, code_verifier, redirect_uri, state);
      
      return res.json({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        session_id: tokens.session_id,
        organization_id: tokens.organization_id || null
      });
    } else {
      // Website Flow (existing logic)
      const result = await handleWebsiteAuth(code, state, clerk_user_id, redirect_uri);
      return res.json({ 
        success: true, 
        redirect_url: result.redirectUrl 
      });
    }
  } catch (error) {
    console.error('Auth callback error:', error);
    return res.status(400).json({ 
      error: error.message || 'Authentication failed' 
    });
  }
}

async function handleVSCodeAuth(code: string, codeVerifier: string, redirectUri: string, state: string) {
  // Exchange code with Clerk using PKCE
  const clerkTokenResponse = await fetch(`${process.env.CLERK_BASE_URL}/v1/client/sign_ins`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CLERK_SECRET_KEY}`
    },
    body: JSON.stringify({
      strategy: 'oauth_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri
    })
  });

  if (!clerkTokenResponse.ok) {
    throw new Error('Failed to exchange code with Clerk');
  }

  const clerkTokens = await clerkTokenResponse.json();
  
  // Get user data from Clerk
  const userResponse = await fetch(`${process.env.CLERK_BASE_URL}/v1/users/${clerkTokens.user_id}`, {
    headers: {
      'Authorization': `Bearer ${process.env.CLERK_SECRET_KEY}`
    }
  });

  const userData = await userResponse.json();

  // Sync user with Supabase if not exists
  await syncUserWithSupabase(userData);

  // Generate JWT access token
  const accessToken = await generateJWT({
    userId: userData.id,
    email: userData.email_addresses[0].email_address,
    organizationId: userData.organization_memberships?.[0]?.organization?.id
  });

  return {
    access_token: accessToken,
    refresh_token: clerkTokens.refresh_token,
    session_id: clerkTokens.session_id,
    organization_id: userData.organization_memberships?.[0]?.organization?.id
  };
}

async function syncUserWithSupabase(clerkUser: any) {
  const { error } = await supabase
    .from('users')
    .upsert({
      clerk_id: clerkUser.id,
      email: clerkUser.email_addresses[0].email_address,
      first_name: clerkUser.first_name,
      last_name: clerkUser.last_name,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'clerk_id'
    });

  if (error) {
    console.error('User sync failed:', error);
    // Don't throw - auth can continue without Supabase sync
  }
}
```

### Step 2: Create VSCode Auth Initiation Endpoint

**File**: `api/auth/initiate-vscode-auth.ts`

```typescript
import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { redirect_uri, code_challenge, state } = req.query;

    if (!redirect_uri || !code_challenge || !state) {
      return res.status(400).json({ 
        error: 'Missing required parameters: redirect_uri, code_challenge, state' 
      });
    }

    // Validate redirect URI for security
    if (redirect_uri !== 'vscode-softcodes://auth/callback') {
      return res.status(400).json({ 
        error: 'Invalid redirect URI' 
      });
    }

    // Generate Clerk OAuth URL
    const clerkAuthUrl = new URL(`${process.env.CLERK_BASE_URL}/oauth/authorize`);
    clerkAuthUrl.searchParams.set('client_id', process.env.CLERK_PUBLISHABLE_KEY!);
    clerkAuthUrl.searchParams.set('response_type', 'code');
    clerkAuthUrl.searchParams.set('scope', 'openid profile email');
    clerkAuthUrl.searchParams.set('redirect_uri', redirect_uri as string);
    clerkAuthUrl.searchParams.set('code_challenge', code_challenge as string);
    clerkAuthUrl.searchParams.set('code_challenge_method', 'S256');
    clerkAuthUrl.searchParams.set('state', state as string);

    // Store challenge and state for verification (in Redis/database)
    await storePKCEChallenge(state as string, {
      code_challenge: code_challenge as string,
      redirect_uri: redirect_uri as string
    });

    return res.json({
      auth_url: clerkAuthUrl.toString()
    });
  } catch (error) {
    console.error('Auth initiation error:', error);
    return res.status(500).json({ 
      error: 'Failed to initiate authentication' 
    });
  }
}
```

### Step 3: Create Token Refresh Endpoint

**File**: `api/auth/refresh-token.ts`

```typescript
import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { refresh_token, client_type } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ error: 'Missing refresh_token' });
    }

    // Refresh token with Clerk
    const clerkResponse = await fetch(`${process.env.CLERK_BASE_URL}/v1/client/sessions/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CLERK_SECRET_KEY}`
      },
      body: JSON.stringify({
        refresh_token
      })
    });

    if (!clerkResponse.ok) {
      return res.status(401).json({ error: 'Token refresh failed' });
    }

    const clerkTokens = await clerkResponse.json();

    if (client_type === 'vscode') {
      // Generate new JWT for VSCode
      const accessToken = await generateJWT({
        userId: clerkTokens.user_id,
        sessionId: clerkTokens.session_id
      });

      return res.json({
        access_token: accessToken,
        refresh_token: clerkTokens.refresh_token,
        session_id: clerkTokens.session_id
      });
    } else {
      // Return Clerk tokens directly for website
      return res.json(clerkTokens);
    }
  } catch (error) {
    console.error('Token refresh error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

### Step 4: Create Additional Support Endpoints

**File**: `api/auth/validate-session.ts`

```typescript
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    const { session_id, client_type } = req.body;

    if (!authHeader || !session_id) {
      return res.status(400).json({ error: 'Missing authentication data' });
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Validate JWT and session with Clerk
    const isValid = await validateJWTAndSession(token, session_id);
    
    if (isValid) {
      return res.status(200).json({ valid: true });
    } else {
      return res.status(401).json({ error: 'Invalid session' });
    }
  } catch (error) {
    console.error('Session validation error:', error);
    return res.status(500).json({ error: 'Validation failed' });
  }
}
```

**File**: `api/auth/user-info.ts`

```typescript
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const userInfo = await getUserInfoFromJWT(token);
    
    if (!userInfo) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Get additional user details from Supabase if needed
    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('clerk_id', userInfo.userId)
      .single();

    return res.json({
      email: userInfo.email,
      firstName: userData?.first_name,
      lastName: userData?.last_name,
      organizationName: userData?.organization_name,
      organizationId: userInfo.organizationId
    });
  } catch (error) {
    console.error('User info error:', error);
    return res.status(500).json({ error: 'Failed to fetch user info' });
  }
}
```

## Migration Steps

### Backend Migration Checklist

- [ ] Update existing `/api/extension/auth/callback` endpoint with format detection
- [ ] Create `/api/auth/initiate-vscode-auth` endpoint
- [ ] Create `/api/auth/refresh-token` endpoint  
- [ ] Create `/api/auth/validate-session` endpoint
- [ ] Create `/api/auth/user-info` endpoint
- [ ] Create `/api/auth/sign-out` endpoint
- [ ] Create `/api/webhooks/clerk` webhook handler
- [ ] Set up PKCE challenge storage (Redis/database)
- [ ] Implement JWT generation and validation utilities
- [ ] Configure Clerk webhook URL in Clerk dashboard
- [ ] Test all endpoints with Postman/curl
- [ ] Deploy to staging environment
- [ ] Run end-to-end authentication tests
- [ ] Deploy to production

### VSCode Extension Migration

The VSCode extension implementation is complete:

- [x] Created [`UnifiedAuthService`](src/auth/unifiedAuthService.ts) with unified authentication
- [x] Updated [`extension.ts`](src/extension.ts) to use new service  
- [x] Updated [`ApiClient`](src/api/client.ts) to use new service
- [x] Updated [`webviewMessageHandler.ts`](src/core/webview/webviewMessageHandler.ts) with auth handlers
- [x] Updated [`Softcodes.tsx`](webview-ui/src/components/settings/providers/Softcodes.tsx) component
- [x] Added comprehensive test coverage
- [x] Created configuration constants and utilities

## Testing Strategy

### 1. Unit Testing
```bash
# Run authentication service tests
cd src && npx vitest auth/__tests__/unifiedAuthService.test.ts
```

### 2. Integration Testing
```bash
# Test complete authentication flow
npm run test:auth-integration
```

### 3. Manual Testing Steps

1. **Start VSCode extension**
2. **Open Softcodes settings**
3. **Click "Sign In" button**
4. **Complete OAuth flow in browser** 
5. **Verify authentication state in extension**
6. **Test API calls with authenticated client**
7. **Test token refresh mechanism**
8. **Test sign out functionality**

## Success Criteria

### ✅ Authentication Flow Works
- [ ] VSCode extension can initiate OAuth
- [ ] Browser redirects to Clerk correctly
- [ ] Callback exchanges code for tokens
- [ ] API calls work with Bearer token
- [ ] Token refresh works automatically
- [ ] User info displays correctly

### ✅ Backward Compatibility
- [ ] Website authentication unchanged
- [ ] Existing user sessions continue working
- [ ] No breaking changes to current APIs

This implementation provides a robust, secure, and maintainable authentication system that unifies your VSCode extension and website while preserving backward compatibility.