# VS Code Extension Authentication Implementation Guide

This guide provides step-by-step instructions to update the VS Code extension to work with the new web application authentication system.

## Overview

The extension needs minimal changes to work with the new ticket-based authentication system:

1. Update login URL to use dedicated extension endpoint
2. Modify ticket exchange logic
3. Enhance error handling and user feedback

## Prerequisites

- Web application authentication implemented (see WEBSITE_AUTHENTICATION_IMPLEMENTATION.md)
- Both extension and web app using the same base URL configuration
- Proper environment variables configured

## Implementation Steps

### 1. Update WebAuthService Login Method

Update `packages/cloud/src/auth/WebAuthService.ts`:

```typescript
// Replace the existing login method (around line 255)
public async login(): Promise<void> {
    try {
        // Generate a cryptographically random state parameter.
        const state = crypto.randomBytes(16).toString("hex")
        await this.context.globalState.update(AUTH_STATE_KEY, state)

        const params = new URLSearchParams({
            state,
            auth_redirect: `${vscode.env.uriScheme}://kilocode.kilo-code`,
        })

        // Use the dedicated extension sign-in endpoint
        const url = `${getRooCodeApiUrl()}/extension/sign-in?${params.toString()}`
        await vscode.env.openExternal(vscode.Uri.parse(url))

        this.log("[auth] Initiated extension authentication flow")
    } catch (error) {
        this.log(`[auth] Error initiating authentication: ${error}`)
        throw new Error(`Failed to initiate authentication: ${error}`)
    }
}
```

### 2. Update Ticket Exchange Method

Replace the `clerkSignIn` method in `packages/cloud/src/auth/WebAuthService.ts`:

```typescript
// Replace the existing clerkSignIn method (around line 450)
private async clerkSignIn(ticket: string): Promise<AuthCredentials> {
    this.log("[auth] Exchanging authentication ticket for credentials")

    try {
        const response = await fetch(`${getRooCodeApiUrl()}/api/extension/auth/exchange`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": this.userAgent(),
            },
            body: JSON.stringify({ ticket }),
            signal: AbortSignal.timeout(10000),
        })

        if (!response.ok) {
            const errorText = await response.text()
            let errorMessage = `HTTP ${response.status}: ${response.statusText}`

            try {
                const errorData = JSON.parse(errorText)
                errorMessage = errorData.error || errorMessage
            } catch {
                // Use default error message if response is not JSON
            }

            this.log(`[auth] Ticket exchange failed: ${errorMessage}`)
            throw new Error(errorMessage)
        }

        const credentials = await response.json()
        this.log("[auth] Successfully exchanged ticket for credentials")

        return authCredentialsSchema.parse(credentials)
    } catch (error) {
        this.log(`[auth] Error during ticket exchange: ${error}`)
        if (error instanceof Error) {
            throw error
        }
        throw new Error(`Failed to exchange authentication ticket: ${error}`)
    }
}
```

### 3. Update Session Token Creation Method

Update the `clerkCreateSessionToken` method to work with the new credential system:

```typescript
// Replace the existing clerkCreateSessionToken method (around line 483)
private async clerkCreateSessionToken(): Promise<string> {
    this.log("[auth] Creating new session token")

    if (!this.credentials?.clientToken) {
        throw new Error("No client token available for session creation")
    }

    // The clientToken from the exchange already contains the session JWT
    // Extract the JWT from the Bearer token format
    const token = this.credentials.clientToken.replace('Bearer ', '')

    this.log("[auth] Using exchanged session token")
    return token
}
```

### 4. Enhance Error Handling in Callback

Update the `handleCallback` method to provide better error messages:

```typescript
// Update the handleCallback method (around line 282) to add better error handling
public async handleCallback(
    code: string | null,
    state: string | null,
    organizationId?: string | null,
): Promise<void> {
    this.log("[auth] Processing authentication callback")

    if (!code || !state) {
        const errorMsg = "Invalid authentication callback - missing code or state parameter"
        this.log(`[auth] ${errorMsg}`)
        vscode.window.showErrorMessage("Authentication failed: Invalid callback parameters")
        return
    }

    try {
        // Validate state parameter to prevent CSRF attacks.
        const storedState = this.context.globalState.get(AUTH_STATE_KEY)

        if (state !== storedState) {
            this.log("[auth] State mismatch in callback - possible CSRF attempt")
            throw new Error("Invalid state parameter. Authentication request may have been tampered with.")
        }

        this.log("[auth] State validation successful, exchanging ticket")
        const credentials = await this.clerkSignIn(code)

        // Set organizationId (null for personal accounts)
        credentials.organizationId = organizationId || null

        await this.storeCredentials(credentials)
        this.log("[auth] Credentials stored successfully")

        vscode.window.showInformationMessage("Successfully authenticated with Softcodes")
        this.log("[auth] Authentication completed successfully")
    } catch (error) {
        this.log(`[auth] Error handling authentication callback: ${error}`)
        const previousState = this.state
        this.state = "logged-out"
        this.emit("logged-out", { previousState })

        // Show user-friendly error message
        const errorMessage = error instanceof Error ? error.message : "Unknown authentication error"
        vscode.window.showErrorMessage(`Authentication failed: ${errorMessage}`)

        throw new Error(`Failed to handle authentication callback: ${error}`)
    }
}
```

### 5. Add Better Logging and Debug Information

Add a debug method to help troubleshoot authentication issues:

```typescript
// Add this method to the WebAuthService class
private debugAuthState(): void {
    if (!this.log) return

    this.log("[auth] === Authentication State Debug ===")
    this.log(`[auth] Current state: ${this.state}`)
    this.log(`[auth] Has credentials: ${!!this.credentials}`)
    this.log(`[auth] Has session token: ${!!this.sessionToken}`)
    this.log(`[auth] Has user info: ${!!this.userInfo}`)
    this.log(`[auth] Clerk base URL: ${getClerkBaseUrl()}`)
    this.log(`[auth] API base URL: ${getRooCodeApiUrl()}`)
    this.log(`[auth] Auth credentials key: ${this.authCredentialsKey}`)
    this.log("[auth] =====================================")
}

// Call this method in initialize() for debugging
public async initialize(): Promise<void> {
    if (this.state !== "initializing") {
        this.log("[auth] initialize() called after already initialized")
        return
    }

    this.debugAuthState() // Add this line for debugging

    await this.handleCredentialsChange()

    // ... rest of existing initialize method
}
```

### 6. Update Configuration Validation

Add validation to ensure the configuration URLs are properly set:

```typescript
// Add this method to validate configuration
private validateConfiguration(): void {
    const clerkBaseUrl = getClerkBaseUrl()
    const apiBaseUrl = getRooCodeApiUrl()

    if (!clerkBaseUrl || !apiBaseUrl) {
        throw new Error("Authentication configuration is incomplete. Please check CLERK_BASE_URL and ROO_CODE_API_URL environment variables.")
    }

    this.log(`[auth] Configuration validated - Clerk: ${clerkBaseUrl}, API: ${apiBaseUrl}`)
}

// Call this in the constructor
constructor(context: vscode.ExtensionContext, log?: (...args: unknown[]) => void) {
    super()

    this.context = context
    this.log = log || console.log

    // Validate configuration
    this.validateConfiguration()

    // ... rest of existing constructor
}
```

### 7. Update Environment Variables (if needed)

Ensure your extension is using the correct base URLs. Update `packages/cloud/src/Config.ts` if needed:

```typescript
// Update these constants to match your deployment
export const PRODUCTION_CLERK_BASE_URL = "https://clerk.softcodes.ai"
export const PRODUCTION_ROO_CODE_API_URL = "https://softcodes.ai"

// The environment variable functions remain the same
export const getClerkBaseUrl = () => process.env.CLERK_BASE_URL || PRODUCTION_CLERK_BASE_URL
export const getRooCodeApiUrl = () => process.env.ROO_CODE_API_URL || PRODUCTION_ROO_CODE_API_URL
```

### 8. Add User Feedback During Authentication

Update the login method to provide better user feedback:

```typescript
// Enhanced login method with user feedback
public async login(): Promise<void> {
    try {
        // Show progress to user
        vscode.window.showInformationMessage("Opening browser for authentication...")

        const state = crypto.randomBytes(16).toString("hex")
        await this.context.globalState.update(AUTH_STATE_KEY, state)

        const params = new URLSearchParams({
            state,
            auth_redirect: `${vscode.env.uriScheme}://kilocode.kilo-code`,
        })

        const url = `${getRooCodeApiUrl()}/extension/sign-in?${params.toString()}`
        await vscode.env.openExternal(vscode.Uri.parse(url))

        this.log("[auth] Initiated extension authentication flow")

        // Show additional guidance
        vscode.window.showInformationMessage(
            "Complete authentication in your browser, then return to VS Code",
            "OK"
        )
    } catch (error) {
        this.log(`[auth] Error initiating authentication: ${error}`)
        vscode.window.showErrorMessage(`Failed to start authentication: ${error}`)
        throw new Error(`Failed to initiate authentication: ${error}`)
    }
}
```

## Testing the Extension Integration

### 1. Local Development Testing

Set up environment variables for testing:

```bash
# In your development environment
export CLERK_BASE_URL="https://your-clerk-domain.clerk.accounts.dev"
export ROO_CODE_API_URL="http://localhost:3000"  # Your local web app
```

### 2. Test Authentication Flow

1. **Start the web application locally**
2. **Launch VS Code with the extension in development mode**
3. **Trigger authentication** via the extension UI or command palette
4. **Verify the flow**:
    - Browser opens to `localhost:3000/extension/sign-in`
    - Authentication completes successfully
    - VS Code shows success message
    - Extension shows authenticated state

### 3. Debug Common Issues

Enable detailed logging in the extension:

```typescript
// In your test environment, add this to the log method
private log = (...args: unknown[]) => {
    const timestamp = new Date().toISOString()
    const message = args.join(' ')
    console.log(`[${timestamp}] ${message}`)

    // Also log to output channel for easier debugging
    if (this.outputChannel) {
        this.outputChannel.appendLine(`[${timestamp}] ${message}`)
    }
}
```

### 4. Verify State Persistence

Test that authentication persists across VS Code restarts:

```typescript
// Add this test method to verify credential storage
public async testCredentialStorage(): Promise<boolean> {
    try {
        const stored = await this.loadCredentials()
        this.log(`[auth] Stored credentials test: ${stored ? 'PASS' : 'FAIL'}`)
        return !!stored
    } catch (error) {
        this.log(`[auth] Credential storage test failed: ${error}`)
        return false
    }
}
```

## Integration Checklist

Before deploying, verify:

- [ ] Extension login URL points to `/extension/sign-in`
- [ ] Ticket exchange uses correct API endpoint
- [ ] Error handling provides useful feedback to users
- [ ] State validation works correctly
- [ ] Credentials are stored and retrieved properly
- [ ] Environment variables are configured correctly
- [ ] Web application authentication endpoints are deployed and working

## Deployment Considerations

### Production Environment Variables

```bash
# Production configuration
CLERK_BASE_URL=https://clerk.softcodes.ai
ROO_CODE_API_URL=https://softcodes.ai
```

### Error Monitoring

Consider adding error reporting to track authentication issues:

```typescript
// Add to error handling blocks
private reportError(error: Error, context: string): void {
    // Log to your error reporting service
    console.error(`Authentication error in ${context}:`, error)

    // You could integrate with services like Sentry, LogRocket, etc.
    // errorReportingService.captureException(error, { context })
}
```

## Connection Points with Website

Ensure these match between extension and website:

1. **URL Endpoints**:

    - Extension login URL: `/extension/sign-in`
    - Ticket exchange API: `/api/extension/auth/exchange`

2. **Parameter Names**:

    - State parameter validation
    - Organization ID handling
    - Auth redirect URL format

3. **Error Handling**:

    - Consistent error message formats
    - Proper HTTP status codes

4. **Security**:
    - Same ticket expiration time (5 minutes)
    - CSRF protection via state parameter
    - HTTPS enforcement in production

## Testing End-to-End Integration

Once both extension and website are deployed:

1. **Authentication Flow**: Complete sign-in process
2. **Token Refresh**: Verify automatic token refresh works
3. **Organization Context**: Test with both personal and organization accounts
4. **Error Scenarios**: Test with expired tickets, invalid states, network errors
5. **Logout Flow**: Verify clean logout and credential removal

The extension is now ready to work with the new web application authentication system!
