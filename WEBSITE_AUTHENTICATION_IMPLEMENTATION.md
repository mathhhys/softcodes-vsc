# Website Authentication Implementation Guide

This guide provides step-by-step instructions to implement VS Code extension authentication support in the web application.

## Overview

The web application needs to handle VS Code extension authentication requests by:

1. Providing a dedicated sign-in page for extensions
2. Generating secure authentication tickets
3. Redirecting back to VS Code with credentials

## Prerequisites

- Next.js application with Clerk authentication
- Environment variables properly configured
- JWT library for secure ticket generation

## Implementation Steps

### 1. Environment Configuration

Create or update your `.env.local` file:

```bash
# Clerk Configuration
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
CLERK_SECRET_KEY=sk_test_your_secret_here

# Extension Authentication Secret (generate a strong random key)
EXTENSION_AUTH_SECRET=your-super-secure-random-secret-key-256-bits

# Your application URL
NEXT_PUBLIC_APP_URL=https://softcodes.ai
```

### 2. Install Required Dependencies

```bash
npm install jsonwebtoken @types/jsonwebtoken
```

### 3. Create Extension Authentication Library

Create `src/lib/extension-auth.ts`:

```typescript
import jwt from "jsonwebtoken"
import { clerkClient } from "@clerk/nextjs"
import { randomBytes } from "crypto"

interface TicketPayload {
	userId: string
	organizationId?: string | null
	sessionId?: string
}

interface ExtensionTicketData {
	userId: string
	organizationId?: string | null
	sessionId: string
	nonce: string
	iat: number
	exp: number
}

/**
 * Generate a secure authentication ticket for VS Code extension
 */
export async function generateExtensionTicket(userId: string, organizationId?: string | null): Promise<string> {
	const secret = process.env.EXTENSION_AUTH_SECRET
	if (!secret) {
		throw new Error("EXTENSION_AUTH_SECRET not configured")
	}

	try {
		// Verify user exists and get current session
		const user = await clerkClient.users.getUser(userId)
		if (!user) {
			throw new Error("User not found")
		}

		// Create a new session for the extension
		const session = await clerkClient.sessions.createSession({
			userId,
			// Only include organizationId if it's not null
			...(organizationId && organizationId !== "null" ? { organizationId } : {}),
		})

		// Create secure ticket data
		const ticketData: ExtensionTicketData = {
			userId,
			organizationId: organizationId === "null" ? null : organizationId,
			sessionId: session.id,
			nonce: randomBytes(16).toString("hex"),
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 5 * 60, // 5 minutes expiry
		}

		// Sign the ticket
		return jwt.sign(ticketData, secret, { algorithm: "HS256" })
	} catch (error) {
		console.error("Failed to generate extension ticket:", error)
		throw new Error("Failed to generate authentication ticket")
	}
}

/**
 * Verify and decode an extension authentication ticket
 */
export async function verifyExtensionTicket(ticket: string): Promise<ExtensionTicketData> {
	const secret = process.env.EXTENSION_AUTH_SECRET
	if (!secret) {
		throw new Error("EXTENSION_AUTH_SECRET not configured")
	}

	try {
		const decoded = jwt.verify(ticket, secret, { algorithms: ["HS256"] }) as ExtensionTicketData
		return decoded
	} catch (error) {
		console.error("Failed to verify extension ticket:", error)
		throw new Error("Invalid or expired authentication ticket")
	}
}

/**
 * Exchange ticket for extension credentials
 */
export async function exchangeTicketForCredentials(ticket: string) {
	const decoded = await verifyExtensionTicket(ticket)

	try {
		// Get the session from Clerk
		const session = await clerkClient.sessions.getSession(decoded.sessionId)
		if (!session || session.status !== "active") {
			throw new Error("Session not active")
		}

		// Get session token for API calls
		const sessionToken = await clerkClient.sessions.createSessionToken(decoded.sessionId, {
			// Include organization context if available
			...(decoded.organizationId ? { organizationId: decoded.organizationId } : {}),
		})

		return {
			clientToken: `Bearer ${sessionToken.jwt}`,
			sessionId: decoded.sessionId,
			organizationId: decoded.organizationId,
		}
	} catch (error) {
		console.error("Failed to exchange ticket for credentials:", error)
		throw new Error("Failed to exchange ticket for credentials")
	}
}
```

### 4. Create Extension Sign-In Page

Create `src/app/extension/sign-in/page.tsx`:

```typescript
"use client"

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { SignIn, useAuth, useUser } from '@clerk/nextjs'

export default function ExtensionSignIn() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { isSignedIn } = useAuth()
  const { user } = useUser()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Extract parameters from URL
  const state = searchParams.get('state')
  const authRedirect = searchParams.get('auth_redirect')
  const organizationId = searchParams.get('organization_id')

  // Validate required parameters
  useEffect(() => {
    if (!state || !authRedirect) {
      setError('Missing required authentication parameters')
      return
    }

    if (!authRedirect.startsWith('vscode://')) {
      setError('Invalid redirect URL - must be VS Code scheme')
      return
    }
  }, [state, authRedirect])

  // Handle successful authentication
  useEffect(() => {
    if (isSignedIn && user && state && authRedirect && !isLoading) {
      handleAuthenticationSuccess()
    }
  }, [isSignedIn, user, state, authRedirect, isLoading])

  const handleAuthenticationSuccess = async () => {
    if (isLoading) return

    setIsLoading(true)
    setError(null)

    try {
      // Generate authentication ticket
      const response = await fetch('/api/extension/auth/ticket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organizationId: organizationId === 'null' ? null : organizationId
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to generate authentication ticket')
      }

      const { ticket } = await response.json()

      // Construct callback URL for VS Code
      const callbackUrl = `${authRedirect}/auth/clerk/callback?` +
        `code=${encodeURIComponent(ticket)}&` +
        `state=${encodeURIComponent(state!)}&` +
        `organizationId=${encodeURIComponent(organizationId || 'null')}`

      // Redirect back to VS Code
      window.location.href = callbackUrl
    } catch (error) {
      console.error('Authentication failed:', error)
      setError(error instanceof Error ? error.message : 'Authentication failed')
      setIsLoading(false)
    }
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
              <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h3 className="mt-2 text-sm font-medium text-gray-900">Authentication Error</h3>
            <p className="mt-1 text-sm text-gray-500">{error}</p>
            <div className="mt-6">
              <button
                onClick={() => window.close()}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700"
              >
                Close Window
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100">
              <svg className="animate-spin h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <h3 className="mt-2 text-sm font-medium text-gray-900">Authenticating...</h3>
            <p className="mt-1 text-sm text-gray-500">Connecting your VS Code extension</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Sign in to Softcodes</h1>
          <p className="mt-2 text-sm text-gray-600">
            Authenticate your VS Code extension to access your account
          </p>
        </div>

        <SignIn
          afterSignInUrl="#" // Prevent default redirect
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "shadow-none border-0",
              headerTitle: "hidden",
              headerSubtitle: "hidden",
            }
          }}
        />
      </div>
    </div>
  )
}
```

### 5. Create Ticket Generation API

Create `src/app/api/extension/auth/ticket/route.ts`:

```typescript
import { auth } from "@clerk/nextjs"
import { NextRequest, NextResponse } from "next/server"
import { generateExtensionTicket } from "../../../../../lib/extension-auth"

export async function POST(request: NextRequest) {
	try {
		// Get current user from Clerk
		const { userId } = auth()
		if (!userId) {
			return NextResponse.json({ error: "User not authenticated" }, { status: 401 })
		}

		// Parse request body
		const body = await request.json()
		const { organizationId } = body

		// Generate secure authentication ticket
		const ticket = await generateExtensionTicket(userId, organizationId)

		return NextResponse.json({ ticket })
	} catch (error) {
		console.error("Ticket generation failed:", error)

		const errorMessage = error instanceof Error ? error.message : "Failed to generate authentication ticket"
		return NextResponse.json({ error: errorMessage }, { status: 500 })
	}
}
```

### 6. Create Ticket Exchange API

Create `src/app/api/extension/auth/exchange/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server"
import { exchangeTicketForCredentials } from "../../../../../lib/extension-auth"

export async function POST(request: NextRequest) {
	try {
		// Parse request body
		const body = await request.json()
		const { ticket } = body

		if (!ticket) {
			return NextResponse.json({ error: "Authentication ticket is required" }, { status: 400 })
		}

		// Exchange ticket for credentials
		const credentials = await exchangeTicketForCredentials(ticket)

		return NextResponse.json(credentials)
	} catch (error) {
		console.error("Ticket exchange failed:", error)

		const errorMessage = error instanceof Error ? error.message : "Failed to exchange authentication ticket"
		const statusCode = errorMessage.includes("Invalid") || errorMessage.includes("expired") ? 401 : 500

		return NextResponse.json({ error: errorMessage }, { status: statusCode })
	}
}
```

### 7. Update Middleware (if needed)

Update `src/middleware.ts` to allow public access to extension auth routes:

```typescript
import { authMiddleware } from "@clerk/nextjs"

export default authMiddleware({
	publicRoutes: [
		"/",
		"/extension/sign-in",
		"/api/extension/auth/(.*)",
		// ... other public routes
	],
	apiRoutes: ["/api/(.*)"],
})

export const config = {
	matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
}
```

### 8. Testing the Implementation

1. **Test the sign-in page directly:**

    ```
    https://your-domain.com/extension/sign-in?state=test123&auth_redirect=vscode://kilocode.kilo-code
    ```

2. **Test ticket generation API:**

    ```bash
    curl -X POST https://your-domain.com/api/extension/auth/ticket \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer your-session-token" \
      -d '{"organizationId": null}'
    ```

3. **Test ticket exchange API:**
    ```bash
    curl -X POST https://your-domain.com/api/extension/auth/exchange \
      -H "Content-Type: application/json" \
      -d '{"ticket": "your-generated-ticket"}'
    ```

## Security Considerations

1. **Ticket Expiry**: Tickets expire in 5 minutes to minimize security risk
2. **Secret Management**: Store `EXTENSION_AUTH_SECRET` securely
3. **HTTPS Only**: Ensure all authentication flows use HTTPS
4. **State Validation**: The extension validates the state parameter to prevent CSRF
5. **Origin Validation**: Only allow redirects to `vscode://` schemes

## Deployment Checklist

- [ ] Environment variables configured
- [ ] Dependencies installed
- [ ] All files created in correct locations
- [ ] Middleware updated to allow public routes
- [ ] HTTPS configured for production
- [ ] Error logging and monitoring setup

## Next Steps

After implementing these changes:

1. Deploy the web application
2. Test the authentication flow end-to-end
3. Update the VS Code extension (see EXTENSION_AUTHENTICATION_IMPLEMENTATION.md)
4. Verify the complete integration works

The web application is now ready to handle VS Code extension authentication requests!
