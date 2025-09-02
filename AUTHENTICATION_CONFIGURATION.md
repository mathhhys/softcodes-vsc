# Authentication Configuration Guide

This guide explains how to configure the Softcodes extension to use custom authentication domains, specifically for migrating from roocode.com to softcodes.vercel.app.

## Overview

The authentication system uses two main endpoints:

- **Clerk Authentication**: Handles user login/logout and session management
- **API Backend**: Handles extension-specific API calls and data

## Current Configuration System

The configuration is managed in [`packages/cloud/src/Config.ts`](packages/cloud/src/Config.ts) with environment variable fallbacks:

```typescript
// Production constants (defaults)
export const PRODUCTION_CLERK_BASE_URL = "https://clerk.roocode.com"
export const PRODUCTION_ROO_CODE_API_URL = "https://app.roocode.com"

// Functions with environment variable fallbacks
export const getClerkBaseUrl = () => process.env.CLERK_BASE_URL || PRODUCTION_CLERK_BASE_URL
export const getRooCodeApiUrl = () => process.env.ROO_CODE_API_URL || PRODUCTION_ROO_CODE_API_URL
```

## Configuration for softcodes.vercel.app

### Method 1: Environment Variables (Recommended)

Set these environment variables in your development/deployment environment:

#### Development Configuration

```bash
export CLERK_BASE_URL="https://rested-mouse-99.clerk.accounts.dev"
export ROO_CODE_API_URL="https://softcodes.vercel.app"
```

#### Production Configuration

```bash
export CLERK_BASE_URL="https://your-production-clerk-domain"
export ROO_CODE_API_URL="https://softcodes.io"
```

### Method 2: Direct Code Changes (Alternative)

If you prefer to modify the production constants directly, update [`packages/cloud/src/Config.ts`](packages/cloud/src/Config.ts):

```typescript
// Production constants
export const PRODUCTION_CLERK_BASE_URL = "https://rested-mouse-99.clerk.accounts.dev"
export const PRODUCTION_ROO_CODE_API_URL = "https://softcodes.vercel.app"
```

## Setting Environment Variables

### VS Code Development

Create a `.env` file in your project root:

```bash
CLERK_BASE_URL=https://rested-mouse-99.clerk.accounts.dev
ROO_CODE_API_URL=https://softcodes.vercel.app
```

### Terminal/Shell

Add to your shell profile (`.bashrc`, `.zshrc`, etc.):

```bash
export CLERK_BASE_URL="https://rested-mouse-99.clerk.accounts.dev"
export ROO_CODE_API_URL="https://softcodes.vercel.app"
```

### Docker/Container Deployment

```dockerfile
ENV CLERK_BASE_URL=https://rested-mouse-99.clerk.accounts.dev
ENV ROO_CODE_API_URL=https://softcodes.vercel.app
```

### Vercel Deployment

In your Vercel dashboard, add environment variables:

- `CLERK_BASE_URL`: `https://rested-mouse-99.clerk.accounts.dev`
- `ROO_CODE_API_URL`: `https://softcodes.vercel.app`

## Authentication Flow Impact

When configured, the authentication system will:

1. **Sign-in Flow**: Redirect users to `https://softcodes.vercel.app/extension/sign-in`
2. **Clerk API Calls**: Use `https://rested-mouse-99.clerk.accounts.dev` for authentication
3. **Session Management**: Store credentials scoped to the new Clerk base URL
4. **API Requests**: Route all extension API calls to `https://softcodes.vercel.app`

## Verification Steps

After configuration, verify the setup:

1. **Check Configuration Loading**:

    ```typescript
    import { getClerkBaseUrl, getRooCodeApiUrl } from "@roo-code/cloud"
    console.log("Clerk URL:", getClerkBaseUrl())
    console.log("API URL:", getRooCodeApiUrl())
    ```

2. **Test Authentication Flow**:

    - Open VS Code extension
    - Click "Sign In" button
    - Verify redirect goes to softcodes.vercel.app
    - Complete authentication flow

3. **Monitor Network Requests**:
    - Check browser dev tools for API calls
    - Ensure all requests go to correct domains

## Troubleshooting

### Common Issues

1. **Environment Variables Not Loading**:

    - Ensure `.env` file is in correct location
    - Restart VS Code after setting environment variables
    - Check that variables are exported in shell

2. **Authentication Redirect Fails**:

    - Verify Clerk configuration matches your domain
    - Check that redirect URI is properly configured in Clerk dashboard
    - Ensure `vscode://` URI scheme is registered

3. **API Calls Failing**:
    - Verify softcodes.vercel.app is accessible
    - Check CORS configuration on your API
    - Ensure API endpoints exist at new domain

### Debug Commands

```bash
# Check current environment variables
echo $CLERK_BASE_URL
echo $ROO_CODE_API_URL

# Test API connectivity
curl -I https://softcodes.vercel.app/api/health
curl -I https://rested-mouse-99.clerk.accounts.dev/v1/client
```

## Security Considerations

- **HTTPS Required**: Both domains must use HTTPS for security
- **CORS Configuration**: Ensure your API allows requests from VS Code extension
- **Clerk Configuration**: Update Clerk dashboard with new redirect URIs
- **Token Storage**: Credentials are automatically scoped to the Clerk base URL

## Files That May Need Updates

When changing domains, these files may contain hardcoded references:

- Test files with mock URLs
- Documentation and README files
- Configuration examples
- Deployment scripts

The system automatically handles most URL references through the configuration functions, but manual updates may be needed for:

- Test mocks and fixtures
- Documentation examples
- Hardcoded fallback URLs

## Quick Setup Instructions

### Step 1: Set Environment Variables

Create a `.env` file in your project root with:

```bash
# Authentication Configuration for softcodes.vercel.app
CLERK_BASE_URL=https://rested-mouse-99.clerk.accounts.dev
ROO_CODE_API_URL=https://softcodes.vercel.app
```

### Step 2: Restart VS Code

After setting environment variables, restart VS Code to ensure they are loaded.

### Step 3: Test Authentication

1. Open the Softcodes extension
2. Click "Sign In" - should redirect to softcodes.vercel.app
3. Complete authentication flow
4. Verify API calls work correctly

## Implementation Checklist

The following tasks need to be completed to fully migrate to softcodes.vercel.app:

- [ ] Create `.env` file with new authentication URLs
- [ ] Update hardcoded test URLs in test files
- [ ] Test authentication flow with new configuration
- [ ] Verify all API endpoints work with new base URL
- [ ] Update deployment configurations if needed

## Files Requiring Updates

Based on the codebase analysis, these files contain hardcoded roocode.com references that may need updates:

### Test Files

- `packages/cloud/src/__tests__/auth/WebAuthService.spec.ts` - Mock URLs in tests
- `packages/cloud/src/__tests__/ShareService.test.ts` - API endpoint mocks
- `packages/cloud/src/__tests__/TelemetryClient.test.ts` - API endpoint expectations

### Configuration Files

- `webview-ui/src/components/account/AccountView.tsx` - Fallback cloud URL
- Various test files with hardcoded domain expectations

## Next Steps

To implement this configuration, you should:

1. **Switch to Code mode** to make the necessary file changes
2. **Create the `.env` file** with the authentication URLs
3. **Update test files** to use the new domains or make them configurable
4. **Test the complete authentication flow** to ensure everything works

Use the following command to switch to Code mode and implement these changes:

```
Switch to Code mode to implement the authentication domain configuration
```
