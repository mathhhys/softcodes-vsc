# VSCode Extension Implementation Guide

## Softcodes Blue Byte Booster Authentication Integration

This guide provides detailed, step-by-step instructions for implementing the authentication bridge in the Softcodes VSCode extension.

---

## 📋 Overview

This implementation adds OAuth 2.0 + PKCE authentication to the Softcodes VSCode extension, connecting it with the Blue Byte Booster website for user authentication and credit management.

### Files to Create/Modify

```
softcodes-extension/
├── packages/cloud/src/
│   ├── auth/
│   │   ├── SoftcodesAuthService.ts          [CREATE]
│   │   ├── TokenManager.ts                  [CREATE]
│   │   └── types.ts                         [CREATE]
│   └── CloudService.ts                      [MODIFY]
├── src/
│   ├── auth/
│   │   └── pkce.ts                          [EXISTS - No changes needed]
│   ├── activate/
│   │   └── handleUri.ts                     [MODIFY]
│   └── core/
│       └── webview/
│           ├── ClineProvider.ts             [MODIFY]
│           └── webviewMessageHandler.ts     [MODIFY]
└── webview-ui/src/
    └── components/
        └── settings/
            └── providers/
                └── Softcodes.tsx            [MODIFY]
```

---

## 🚀 Step-by-Step Implementation

### Step 1: Create Authentication Types

**File**: `packages/cloud/src/auth/types.ts`

```typescript
/**
 * Authentication types for Softcodes Blue Byte Booster integration
 */

export interface AuthTokens {
	access_token: string
	refresh_token: string
	token_type: "Bearer"
	expires_in: number
	session_id: string
}

export interface UserInfo {
	clerk_id: string
	email: string
	username: string
	plan_type: "starter" | "pro" | "teams"
	credits: number
	organization_id?: string
}

export interface AuthState {
	isAuthenticated: boolean
	user: UserInfo | null
	sessionId: string | null
}

export interface PKCEParams {
	code_verifier: string
	code_challenge: string
	state: string
}

export interface TokenExchangeRequest {
	code: string
	grant_type: "authorization_code" | "refresh_token"
	code_verifier?: string
	refresh_token?: string
	state: string
}

export interface TokenExchangeResponse extends AuthTokens {
	user: UserInfo
}

export interface AuthError {
	error: string
	error_description?: string
}

export interface AuthConfig {
	apiBaseUrl: string
	redirectUri: string
	authEndpoint: string
	tokenEndpoint: string
	refreshEndpoint: string
}
```

---

### Step 2: Create Token Manager

**File**: `packages/cloud/src/auth/TokenManager.ts`

```typescript
import * as vscode from "vscode"
import { AuthTokens, UserInfo, AuthState } from "./types"

/**
 * Manages secure storage and retrieval of authentication tokens
 * Uses VSCode's SecretStorage API for secure credential storage
 */
export class TokenManager {
	private static readonly KEYS = {
		ACCESS_TOKEN: "softcodes.auth.access_token",
		REFRESH_TOKEN: "softcodes.auth.refresh_token",
		TOKEN_EXPIRES_AT: "softcodes.auth.expires_at",
		SESSION_ID: "softcodes.auth.session_id",
		USER_DATA: "softcodes.auth.user_data",
		PKCE_VERIFIER: "softcodes.auth.pkce_verifier",
		PKCE_STATE: "softcodes.auth.pkce_state",
	} as const

	constructor(private secretStorage: vscode.SecretStorage) {}

	/**
	 * Store authentication tokens securely
	 */
	async storeTokens(tokens: AuthTokens, user: UserInfo): Promise<void> {
		try {
			await this.secretStorage.store(TokenManager.KEYS.ACCESS_TOKEN, tokens.access_token)
			await this.secretStorage.store(TokenManager.KEYS.REFRESH_TOKEN, tokens.refresh_token)
			await this.secretStorage.store(TokenManager.KEYS.SESSION_ID, tokens.session_id)
			await this.secretStorage.store(TokenManager.KEYS.USER_DATA, JSON.stringify(user))

			// Calculate and store expiration timestamp
			const expiresAt = Date.now() + tokens.expires_in * 1000
			await this.secretStorage.store(TokenManager.KEYS.TOKEN_EXPIRES_AT, expiresAt.toString())

			console.log("✅ Tokens stored securely")
		} catch (error) {
			console.error("❌ Failed to store tokens:", error)
			throw new Error("Failed to store authentication tokens")
		}
	}

	/**
	 * Get access token if valid, null otherwise
	 */
	async getAccessToken(): Promise<string | null> {
		const token = await this.secretStorage.get(TokenManager.KEYS.ACCESS_TOKEN)
		return token || null
	}

	/**
	 * Get refresh token
	 */
	async getRefreshToken(): Promise<string | null> {
		const token = await this.secretStorage.get(TokenManager.KEYS.REFRESH_TOKEN)
		return token || null
	}

	/**
	 * Get session ID
	 */
	async getSessionId(): Promise<string | null> {
		const sessionId = await this.secretStorage.get(TokenManager.KEYS.SESSION_ID)
		return sessionId || null
	}

	/**
	 * Get stored user information
	 */
	async getUserInfo(): Promise<UserInfo | null> {
		try {
			const userDataStr = await this.secretStorage.get(TokenManager.KEYS.USER_DATA)
			if (!userDataStr) return null

			const userData = JSON.parse(userDataStr) as UserInfo
			return userData
		} catch (error) {
			console.error("Failed to parse user data:", error)
			return null
		}
	}

	/**
	 * Check if access token is expired or about to expire
	 * @param bufferSeconds Buffer time before expiration (default 5 minutes)
	 */
	async isTokenExpired(bufferSeconds: number = 300): Promise<boolean> {
		const expiresAtStr = await this.secretStorage.get(TokenManager.KEYS.TOKEN_EXPIRES_AT)
		if (!expiresAtStr) return true

		const expiresAt = parseInt(expiresAtStr, 10)
		const bufferMs = bufferSeconds * 1000

		return Date.now() >= expiresAt - bufferMs
	}

	/**
	 * Update only the access token (used after refresh)
	 */
	async updateAccessToken(accessToken: string, expiresIn: number): Promise<void> {
		await this.secretStorage.store(TokenManager.KEYS.ACCESS_TOKEN, accessToken)

		const expiresAt = Date.now() + expiresIn * 1000
		await this.secretStorage.store(TokenManager.KEYS.TOKEN_EXPIRES_AT, expiresAt.toString())
	}

	/**
	 * Store PKCE parameters temporarily during auth flow
	 */
	async storePKCEParams(verifier: string, state: string): Promise<void> {
		await this.secretStorage.store(TokenManager.KEYS.PKCE_VERIFIER, verifier)
		await this.secretStorage.store(TokenManager.KEYS.PKCE_STATE, state)
	}

	/**
	 * Retrieve PKCE parameters
	 */
	async getPKCEParams(): Promise<{ verifier: string; state: string } | null> {
		const verifier = await this.secretStorage.get(TokenManager.KEYS.PKCE_VERIFIER)
		const state = await this.secretStorage.get(TokenManager.KEYS.PKCE_STATE)

		if (!verifier || !state) return null

		return { verifier, state }
	}

	/**
	 * Clear PKCE parameters after successful auth
	 */
	async clearPKCEParams(): Promise<void> {
		await this.secretStorage.delete(TokenManager.KEYS.PKCE_VERIFIER)
		await this.secretStorage.delete(TokenManager.KEYS.PKCE_STATE)
	}

	/**
	 * Clear all stored authentication data
	 */
	async clearAll(): Promise<void> {
		await this.secretStorage.delete(TokenManager.KEYS.ACCESS_TOKEN)
		await this.secretStorage.delete(TokenManager.KEYS.REFRESH_TOKEN)
		await this.secretStorage.delete(TokenManager.KEYS.TOKEN_EXPIRES_AT)
		await this.secretStorage.delete(TokenManager.KEYS.SESSION_ID)
		await this.secretStorage.delete(TokenManager.KEYS.USER_DATA)
		await this.clearPKCEParams()

		console.log("🧹 All auth data cleared")
	}

	/**
	 * Get current authentication state
	 */
	async getAuthState(): Promise<AuthState> {
		const accessToken = await this.getAccessToken()
		const user = await this.getUserInfo()
		const sessionId = await this.getSessionId()
		const isExpired = await this.isTokenExpired()

		return {
			isAuthenticated: !!accessToken && !isExpired && !!user,
			user,
			sessionId,
		}
	}
}
```

---

### Step 3: Create Softcodes Authentication Service

**File**: `packages/cloud/src/auth/SoftcodesAuthService.ts`

```typescript
import * as vscode from "vscode"
import { TokenManager } from "./TokenManager"
import {
	AuthConfig,
	AuthTokens,
	UserInfo,
	TokenExchangeRequest,
	TokenExchangeResponse,
	AuthError,
	PKCEParams,
} from "./types"

/**
 * Handles authentication with Blue Byte Booster platform
 * Implements OAuth 2.0 + PKCE flow
 */
export class SoftcodesAuthService {
	private tokenManager: TokenManager
	private config: AuthConfig

	constructor(
		private context: vscode.ExtensionContext,
		private outputChannel: vscode.OutputChannel,
	) {
		this.tokenManager = new TokenManager(context.secrets)

		// Configure based on environment
		const isProduction = context.extensionMode === vscode.ExtensionMode.Production
		const apiBaseUrl = isProduction
			? "https://softcodes.ai"
			: process.env.SOFTCODES_API_URL || "http://localhost:3000"

		this.config = {
			apiBaseUrl,
			redirectUri: "vscode://softcodes.softcodes/auth/clerk/callback",
			authEndpoint: "/api/auth/initiate-vscode-auth",
			tokenEndpoint: "/api/extension/auth/token",
			refreshEndpoint: "/api/auth/token",
		}

		this.log(`🔧 Initialized with API base: ${this.config.apiBaseUrl}`)
	}

	/**
	 * Initiate OAuth login flow
	 * Opens browser for user authentication
	 */
	async login(): Promise<void> {
		try {
			this.log("🚀 Initiating authentication flow...")

			// Generate PKCE parameters
			const pkceParams = await this.generatePKCEParams()
			this.log("✅ PKCE parameters generated")

			// Store PKCE parameters for later validation
			await this.tokenManager.storePKCEParams(pkceParams.code_verifier, pkceParams.state)
			this.log("💾 PKCE parameters stored")

			// Build authentication URL
			const authUrl = this.buildAuthUrl(pkceParams)
			this.log(`🌐 Opening browser: ${authUrl}`)

			// Open browser for authentication
			const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl))

			if (opened) {
				vscode.window
					.showInformationMessage(
						"🔐 Opening browser for authentication. Please sign in and you will be redirected back to VSCode.",
						"Cancel",
					)
					.then((selection) => {
						if (selection === "Cancel") {
							this.log("❌ User cancelled authentication")
						}
					})
			} else {
				throw new Error("Failed to open browser")
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error"
			this.log(`❌ Login error: ${message}`)
			vscode.window.showErrorMessage(`Authentication failed: ${message}`)
			throw error
		}
	}

	/**
	 * Handle OAuth callback from browser
	 */
	async handleCallback(
		code: string | null,
		state: string | null,
		organizationId: string | null = null,
	): Promise<boolean> {
		try {
			this.log("📥 Received authentication callback")

			if (!code || !state) {
				throw new Error("Missing authentication parameters")
			}

			// Retrieve stored PKCE parameters
			const pkceParams = await this.tokenManager.getPKCEParams()
			if (!pkceParams) {
				throw new Error("PKCE parameters not found. Please try logging in again.")
			}

			// Validate state parameter (CSRF protection)
			if (state !== pkceParams.state) {
				throw new Error("State mismatch - possible CSRF attack detected")
			}
			this.log("✅ State validation passed")

			// Exchange authorization code for tokens
			const tokens = await this.exchangeCodeForTokens(code, pkceParams.verifier, state)
			this.log("✅ Tokens received")

			// Store tokens securely
			await this.tokenManager.storeTokens(tokens, tokens.user)
			this.log("💾 Tokens stored securely")

			// Clean up PKCE parameters
			await this.tokenManager.clearPKCEParams()
			this.log("🧹 PKCE parameters cleaned up")

			// Show success message
			vscode.window.showInformationMessage(
				`✅ Successfully authenticated as ${tokens.user.username || tokens.user.email}!`,
			)

			return true
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error"
			this.log(`❌ Callback error: ${message}`)
			vscode.window.showErrorMessage(`Authentication failed: ${message}`)

			// Clean up on error
			await this.tokenManager.clearPKCEParams()

			return false
		}
	}

	/**
	 * Check if user is authenticated
	 */
	async isAuthenticated(): Promise<boolean> {
		const authState = await this.tokenManager.getAuthState()
		return authState.isAuthenticated
	}

	/**
	 * Get valid access token, refreshing if necessary
	 */
	async getAccessToken(): Promise<string | null> {
		try {
			// Check if token is expired
			const isExpired = await this.tokenManager.isTokenExpired()

			if (isExpired) {
				this.log("⏰ Access token expired, refreshing...")
				const refreshed = await this.refreshAccessToken()
				if (!refreshed) {
					this.log("❌ Token refresh failed")
					return null
				}
				this.log("✅ Token refreshed successfully")
			}

			return await this.tokenManager.getAccessToken()
		} catch (error) {
			this.log(`❌ Error getting access token: ${error}`)
			return null
		}
	}

	/**
	 * Get user information
	 */
	async getUserInfo(): Promise<UserInfo | null> {
		return await this.tokenManager.getUserInfo()
	}

	/**
	 * Logout and clear all stored data
	 */
	async logout(): Promise<void> {
		this.log("👋 Logging out...")
		await this.tokenManager.clearAll()
		vscode.window.showInformationMessage("✅ Logged out successfully")
	}

	/**
	 * Make authenticated API request
	 */
	async makeAuthenticatedRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
		const accessToken = await this.getAccessToken()

		if (!accessToken) {
			throw new Error("Not authenticated. Please log in first.")
		}

		const url = `${this.config.apiBaseUrl}${endpoint}`
		const response = await fetch(url, {
			...options,
			headers: {
				...options.headers,
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
		})

		if (!response.ok) {
			if (response.status === 401) {
				// Token might be invalid, try to refresh
				const refreshed = await this.refreshAccessToken()
				if (refreshed) {
					// Retry request with new token
					return this.makeAuthenticatedRequest(endpoint, options)
				}
				throw new Error("Authentication expired. Please log in again.")
			}

			const errorData = await response.json().catch(() => ({}))
			throw new Error(errorData.error || `Request failed: ${response.statusText}`)
		}

		return response.json()
	}

	// ========== Private Methods ==========

	/**
	 * Generate PKCE parameters
	 */
	private async generatePKCEParams(): Promise<PKCEParams> {
		const { generateCodeVerifier, generateCodeChallenge, generateState } = await import("../../../src/auth/pkce")

		const code_verifier = generateCodeVerifier()
		const code_challenge = await generateCodeChallenge(code_verifier)
		const state = generateState()

		return { code_verifier, code_challenge, state }
	}

	/**
	 * Build authentication URL
	 */
	private buildAuthUrl(pkceParams: PKCEParams): string {
		const url = new URL(`${this.config.apiBaseUrl}${this.config.authEndpoint}`)
		url.searchParams.set("code_challenge", pkceParams.code_challenge)
		url.searchParams.set("state", pkceParams.state)
		url.searchParams.set("redirect_uri", this.config.redirectUri)
		return url.toString()
	}

	/**
	 * Exchange authorization code for tokens
	 */
	private async exchangeCodeForTokens(
		code: string,
		codeVerifier: string,
		state: string,
	): Promise<TokenExchangeResponse> {
		this.log("🔄 Exchanging authorization code for tokens...")

		const requestBody: TokenExchangeRequest = {
			code,
			grant_type: "authorization_code",
			code_verifier: codeVerifier,
			state,
		}

		const response = await fetch(`${this.config.apiBaseUrl}${this.config.tokenEndpoint}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(requestBody),
		})

		if (!response.ok) {
			const error: AuthError = await response.json()
			throw new Error(error.error_description || error.error || "Token exchange failed")
		}

		return response.json()
	}

	/**
	 * Refresh access token using refresh token
	 */
	private async refreshAccessToken(): Promise<boolean> {
		try {
			const refreshToken = await this.tokenManager.getRefreshToken()

			if (!refreshToken) {
				this.log("❌ No refresh token available")
				return false
			}

			this.log("🔄 Refreshing access token...")

			const response = await fetch(`${this.config.apiBaseUrl}${this.config.refreshEndpoint}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					grant_type: "refresh_token",
					refresh_token: refreshToken,
				}),
			})

			if (!response.ok) {
				this.log(`❌ Token refresh failed: ${response.status}`)
				// Refresh token might be expired, clear all auth data
				await this.tokenManager.clearAll()
				return false
			}

			const tokens: { access_token: string; expires_in: number } = await response.json()
			await this.tokenManager.updateAccessToken(tokens.access_token, tokens.expires_in)

			this.log("✅ Access token refreshed successfully")
			return true
		} catch (error) {
			this.log(`❌ Token refresh error: ${error}`)
			return false
		}
	}

	/**
	 * Log message to output channel
	 */
	private log(message: string): void {
		const timestamp = new Date().toISOString()
		this.outputChannel.appendLine(`[${timestamp}] ${message}`)
	}
}
```

---

### Step 4: Update CloudService Integration

**File**: `packages/cloud/src/CloudService.ts`

**Changes to make:**

```typescript
import { SoftcodesAuthService } from "./auth/SoftcodesAuthService"
import { UserInfo } from "./auth/types"

export class CloudService {
	private static _instance: CloudService | null = null
	private authService: SoftcodesAuthService
	private outputChannel: vscode.OutputChannel

	private constructor(context: vscode.ExtensionContext) {
		// ... existing code ...

		// Initialize output channel for auth logs
		this.outputChannel = vscode.window.createOutputChannel("Softcodes Authentication")

		// Initialize auth service
		this.authService = new SoftcodesAuthService(context, this.outputChannel)
	}

	// ... existing static methods ...

	/**
	 * Login to Softcodes
	 */
	public async login(): Promise<void> {
		try {
			await this.authService.login()
		} catch (error) {
			console.error("Login failed:", error)
			throw error
		}
	}

	/**
	 * Handle OAuth callback
	 */
	public async handleAuthCallback(
		code: string | null,
		state: string | null,
		organizationId: string | null = null,
	): Promise<void> {
		const success = await this.authService.handleCallback(code, state, organizationId)

		if (success) {
			// Notify webview of auth state change
			await this.postAuthStateToWebview()
		}
	}

	/**
	 * Check if user is authenticated
	 */
	public async isAuthenticated(): Promise<boolean> {
		return await this.authService.isAuthenticated()
	}

	/**
	 * Get current user info
	 */
	public async getUserInfo(): Promise<UserInfo | null> {
		return await this.authService.getUserInfo()
	}

	/**
	 * Logout
	 */
	public async logout(): Promise<void> {
		await this.authService.logout()
		await this.postAuthStateToWebview()
	}

	/**
	 * Make authenticated API request
	 */
	public async makeAuthenticatedRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
		return await this.authService.makeAuthenticatedRequest<T>(endpoint, options)
	}

	/**
	 * Post auth state to webview
	 */
	private async postAuthStateToWebview(): Promise<void> {
		// Trigger webview refresh if ClineProvider exists
		const provider = ClineProvider.getVisibleInstance()
		if (provider) {
			await provider.postStateToWebview()
		}
	}

	// ... rest of existing methods ...
}
```

---

### Step 5: Update URI Handler

**File**: `src/activate/handleUri.ts`

**Add the Clerk callback handler:**

```typescript
import * as vscode from "vscode"
import { CloudService } from "@roo-code/cloud"
import { ClineProvider } from "../core/webview/ClineProvider"

export const handleUri = async (uri: vscode.Uri) => {
	const path = uri.path
	const query = new URLSearchParams(uri.query.replace(/\+/g, "%2B"))
	const visibleProvider = ClineProvider.getVisibleInstance()

	if (!visibleProvider) {
		return
	}

	switch (path) {
		case "/glama": {
			const code = query.get("code")
			if (code) {
				await visibleProvider.handleGlamaCallback(code)
			}
			break
		}
		case "/openrouter": {
			const code = query.get("code")
			if (code) {
				await visibleProvider.handleOpenRouterCallback(code)
			}
			break
		}
		case "/kilocode": {
			const token = query.get("token")
			if (token) {
				await visibleProvider.handleKiloCodeCallback(token)
			}
			break
		}
		case "/requesty": {
			const code = query.get("code")
			if (code) {
				await visibleProvider.handleRequestyCallback(code)
			}
			break
		}
		// ========== ADD THIS CASE ==========
		case "/auth/clerk/callback": {
			const code = query.get("code")
			const state = query.get("state")
			const organizationId = query.get("organizationId")

			// Handle Softcodes authentication callback
			await CloudService.instance.handleAuthCallback(
				code,
				state,
				organizationId === "null" ? null : organizationId,
			)

			// Show webview after successful auth
			await vscode.commands.executeCommand("kilocode.plusButtonTapped")

			break
		}
		// ===================================
		default:
			break
	}
}
```

---

### Step 6: Update ClineProvider

**File**: `src/core/webview/ClineProvider.ts`

**Add auth state to webview state:**

```typescript
import { CloudService } from "@roo-code/cloud"
import { UserInfo } from "@roo-code/cloud/auth/types"

export class ClineProvider implements vscode.WebviewViewProvider {
	// ... existing code ...

	async getStateToPostToWebview(): Promise<ExtensionState> {
		// ... existing code ...

		// Get Softcodes auth state
		let softcodesAuth: { isAuthenticated: boolean; user: UserInfo | null } = {
			isAuthenticated: false,
			user: null,
		}

		try {
			if (CloudService.hasInstance()) {
				const isAuthenticated = await CloudService.instance.isAuthenticated()
				const user = await CloudService.instance.getUserInfo()
				softcodesAuth = { isAuthenticated, user }
			}
		} catch (error) {
			console.error("Failed to get Softcodes auth state:", error)
		}

		return {
			// ... existing state properties ...
			softcodesAuth, // Add this new property
		}
	}

	// ... rest of existing code ...
}
```

---

### Step 7: Update Webview Message Handler

**File**: `src/core/webview/webviewMessageHandler.ts`

**Add auth message handlers:**

```typescript
import { CloudService } from "@roo-code/cloud"

export async function handleWebviewMessage(provider: ClineProvider, message: ExtensionMessage): Promise<void> {
	// ... existing message handlers ...

	switch (message.type) {
		// ... existing cases ...

		// ========== ADD THESE CASES ==========
		case "softcodesLogin": {
			try {
				await CloudService.instance.login()
			} catch (error) {
				console.error("Softcodes login error:", error)
				vscode.window.showErrorMessage(
					`Failed to initiate login: ${error instanceof Error ? error.message : "Unknown error"}`,
				)
			}
			break
		}

		case "softcodesLogout": {
			try {
				await CloudService.instance.logout()
				await provider.postStateToWebview()
			} catch (error) {
				console.error("Softcodes logout error:", error)
				vscode.window.showErrorMessage(
					`Failed to logout: ${error instanceof Error ? error.message : "Unknown error"}`,
				)
			}
			break
		}

		case "refreshSoftcodesAuth": {
			try {
				await provider.postStateToWebview()
			} catch (error) {
				console.error("Failed to refresh auth state:", error)
			}
			break
		}
		// =====================================

		// ... rest of existing cases ...
	}
}
```

---

### Step 8: Update Webview UI Component

**File**: `webview-ui/src/components/settings/providers/Softcodes.tsx`

**Update to show auth status and credits:**

```tsx
import React, { useEffect, useState } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"

export const Softcodes: React.FC = () => {
	const { softcodesAuth } = useExtensionState()
	const [isLoading, setIsLoading] = useState(false)

	const handleLogin = async () => {
		setIsLoading(true)
		try {
			vscode.postMessage({ type: "softcodesLogin" })
		} finally {
			// Keep loading state until auth completes
			setTimeout(() => setIsLoading(false), 2000)
		}
	}

	const handleLogout = async () => {
		if (confirm("Are you sure you want to logout from Softcodes?")) {
			vscode.postMessage({ type: "softcodesLogout" })
		}
	}

	const handleRefresh = () => {
		vscode.postMessage({ type: "refreshSoftcodesAuth" })
	}

	if (!softcodesAuth) {
		return null
	}

	return (
		<div className="mb-4 p-4 border border-vscode-panel-border rounded-md">
			<h3 className="text-lg font-semibold mb-3">Softcodes Authentication</h3>

			{softcodesAuth.isAuthenticated && softcodesAuth.user ? (
				<div className="space-y-3">
					{/* User Info */}
					<div className="bg-vscode-editor-background p-3 rounded">
						<div className="flex items-center justify-between mb-2">
							<span className="text-sm text-vscode-descriptionForeground">Signed in as</span>
							<VSCodeButton appearance="icon" onClick={handleRefresh} title="Refresh auth status">
								↻
							</VSCodeButton>
						</div>

						<div className="space-y-1">
							<p className="font-medium">{softcodesAuth.user.username || softcodesAuth.user.email}</p>
							<p className="text-sm text-vscode-descriptionForeground">{softcodesAuth.user.email}</p>
						</div>
					</div>

					{/* Credits Display */}
					<div className="bg-vscode-editor-background p-3 rounded">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-sm text-vscode-descriptionForeground mb-1">Available Credits</p>
								<p className="text-2xl font-bold text-vscode-textLink-activeForeground">
									{softcodesAuth.user.credits.toLocaleString()}
								</p>
							</div>
							<div className="text-right">
								<p className="text-sm text-vscode-descriptionForeground mb-1">Plan</p>
								<p className="text-sm font-semibold capitalize">{softcodesAuth.user.plan_type}</p>
							</div>
						</div>
					</div>

					{/* Actions */}
					<div className="flex gap-2">
						<VSCodeButton
							className="flex-1"
							onClick={() => {
								vscode.postMessage({
									type: "openExternal",
									url: "https://softcodes.ai/dashboard",
								})
							}}>
							Manage Account
						</VSCodeButton>
						<VSCodeButton appearance="secondary" onClick={handleLogout}>
							Logout
						</VSCodeButton>
					</div>
				</div>
			) : (
				<div className="space-y-3">
					<p className="text-sm text-vscode-descriptionForeground">
						Sign in to Softcodes to access your credits and premium features.
					</p>

					<VSCodeButton onClick={handleLogin} disabled={isLoading} className="w-full">
						{isLoading ? "Opening browser..." : "Sign In with Softcodes"}
					</VSCodeButton>

					<p className="text-xs text-vscode-descriptionForeground text-center">
						Don't have an account?{" "}
						<a
							href="#"
							onClick={(e) => {
								e.preventDefault()
								vscode.postMessage({
									type: "openExternal",
									url: "https://softcodes.ai/sign-up",
								})
							}}
							className="text-vscode-textLink-foreground hover:underline">
							Sign up for free
						</a>
					</p>
				</div>
			)}
		</div>
	)
}
```

---

### Step 9: Update Extension State Types

**File**: `src/shared/ExtensionMessage.ts` (or wherever types are defined)

**Add new message types:**

```typescript
export type ExtensionMessage =
  | /* ... existing types ... */
  | { type: "softcodesLogin" }
  | { type: "softcodesLogout" }
  | { type: "refreshSoftcodesAuth" }
```

**File**: `src/shared/ExtensionState.ts` (or wherever types are defined)

**Add auth state to ExtensionState:**

```typescript
import { UserInfo } from "@roo-code/cloud/auth/types"

export interface ExtensionState {
	// ... existing properties ...
	softcodesAuth?: {
		isAuthenticated: boolean
		user: UserInfo | null
	}
}
```

---

## 🧪 Testing the Implementation

### Manual Testing Steps

1. **Test Authentication Flow**

    ```bash
    # 1. Start the extension in debug mode
    # Press F5 in VSCode

    # 2. Open extension webview
    # Click Softcodes icon in sidebar

    # 3. Click "Sign In with Softcodes"
    # Browser should open to auth page

    # 4. Sign in via Clerk
    # Should redirect back to VSCode

    # 5. Verify auth state
    # Extension should show user info and credits
    ```

2. **Test Token Refresh**

    ```typescript
    // In VSCode developer console
    // Get current token expiration
    const state = await vscode.commands.executeCommand("kilocode.getState")
    console.log(state.softcodesAuth)

    // Wait for token to expire (or manually expire it)
    // Make an API call
    // Should automatically refresh
    ```

3. **Test Logout**
    ```bash
    # 1. Click logout button
    # 2. Verify tokens are cleared
    # 3. Verify UI shows logged out state
    ```

### Debug Logging

Add this to your launch.json for better debugging:

```json
{
	"name": "Run Extension",
	"type": "extensionHost",
	"request": "launch",
	"args": ["--extensionDevelopmentPath=${workspaceFolder}"],
	"outFiles": ["${workspaceFolder}/out/**/*.js"],
	"env": {
		"SOFTCODES_API_URL": "http://localhost:3000",
		"DEBUG": "softcodes:*"
	}
}
```

---

## 🔧 Configuration

### Environment Variables

For development, create `.env` file:

```bash
# Development API endpoint
SOFTCODES_API_URL=http://localhost:3000

# Enable debug logging
DEBUG=softcodes:*
```

For production, these are set automatically based on extension mode.

---

## 📝 Common Issues & Solutions

### Issue 1: Browser doesn't open

**Solution**: Check if default browser is configured

```typescript
// Test browser opening
await vscode.env.openExternal(vscode.Uri.parse("https://google.com"))
```

### Issue 2: Callback not received

**Solution**: Verify URI handler is registered

```typescript
// In activate() function
context.subscriptions.push(
	vscode.window.registerUriHandler({
		handleUri: async (uri: vscode.Uri) => {
			await handleUri(uri)
		},
	}),
)
```

### Issue 3: Token not refreshing

**Solution**: Check token manager and refresh logic

```typescript
// Add debug logging
this.log(`Token expires at: ${expiresAt}`)
this.log(`Current time: ${Date.now()}`)
this.log(`Is expired: ${isExpired}`)
```

### Issue 4: PKCE validation fails

**Solution**: Ensure code_verifier is correctly stored and retrieved

```typescript
// Debug PKCE
const stored = await this.tokenManager.getPKCEParams()
console.log("Stored verifier:", stored?.verifier)
console.log("Stored state:", stored?.state)
```

---

## 🚀 Deployment Checklist

Before deploying to production:

- [ ] Test complete auth flow in development
- [ ] Verify token refresh works correctly
- [ ] Test logout clears all data
- [ ] Verify error handling for network issues
- [ ] Test on Windows, Mac, and Linux
- [ ] Update extension version
- [ ] Update CHANGELOG.md
- [ ] Create release notes
- [ ] Test with production API
- [ ] Monitor error logs after release

---

## 📚 Additional Resources

- [VSCode Extension API - Authentication](https://code.visualstudio.com/api/references/vscode-api#authentication)
- [VSCode Extension API - SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)
- [OAuth 2.0 PKCE Flow](https://oauth.net/2/pkce/)
- [Blue Byte Booster Auth Architecture](./softcodes-bluebyteBooster-auth-architecture.md)

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-02  
**Status**: Ready for Implementation
