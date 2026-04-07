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
		const { generateCodeVerifier, generateCodeChallenge, generateState } = await import("../../../../src/auth/pkce")

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
