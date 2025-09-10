import * as vscode from "vscode"
import { UnifiedAuthService } from "../auth/unifiedAuthService"
import { JWTVerificationService } from "../auth/jwtVerification"
import { JWTErrorType } from "../auth/jwtTypes"

export class ApiClient {
	private authService: UnifiedAuthService
	private jwtService: JWTVerificationService
	private baseUrl: string
	private refreshPromise: Promise<string | undefined> | null = null

	constructor(context: vscode.ExtensionContext) {
		this.authService = UnifiedAuthService.getInstance(context)
		this.jwtService = JWTVerificationService.getInstance()
		const config = vscode.workspace.getConfiguration("softcodes")
		this.baseUrl = config.get("backendUrl") || "https://softcodes.ai"
	}

	/**
	 * Make authenticated API request with JWT verification and automatic refresh
	 */
	async request(endpoint: string, options: RequestInit = {}): Promise<any> {
		let accessToken = await this.getValidAccessToken()

		if (!accessToken) {
			await this.handleAuthenticationRequired()
			throw new Error("Authentication required")
		}

		const response = await fetch(`${this.baseUrl}${endpoint}`, {
			...options,
			headers: {
				...options.headers,
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
		})

		if (response.status === 401) {
			console.log("Received 401, attempting token refresh...")

			// Try to refresh token
			const refreshedToken = await this.refreshTokenIfNeeded()

			if (refreshedToken && refreshedToken !== accessToken) {
				console.log("Token refreshed, retrying request...")
				// Retry with refreshed token
				return this.request(endpoint, options)
			} else {
				// Re-authentication needed
				await this.handleAuthenticationRequired()
				throw new Error("Authentication session expired. Please sign in again.")
			}
		}

		if (!response.ok) {
			const error = await response.json().catch(() => ({ message: "API request failed" }))
			throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`)
		}

		return response.json()
	}

	/**
	 * Get valid access token with JWT verification
	 */
	private async getValidAccessToken(): Promise<string | undefined> {
		const accessToken = await this.authService.getAccessToken()

		if (!accessToken) {
			return undefined
		}

		// Verify token locally first
		try {
			const verification = await this.jwtService.verifyJWT(accessToken)

			if (!verification.valid) {
				console.warn("Stored token is invalid:", verification.error?.message)

				// Try to refresh if it's an expiration issue
				if (verification.error?.type === JWTErrorType.TOKEN_EXPIRED) {
					return await this.refreshTokenIfNeeded()
				}

				// For other errors, clear the invalid token
				await this.authService.signOut()
				return undefined
			}

			// Check if token is near expiration
			if (verification.payload && this.jwtService.isTokenNearExpiration(verification.payload)) {
				console.log("Token is near expiration, attempting refresh...")
				const refreshedToken = await this.refreshTokenIfNeeded()
				return refreshedToken || accessToken // Fallback to current token if refresh fails
			}

			return accessToken
		} catch (error) {
			console.error("Token verification failed:", error)

			// For network errors or verification failures, use existing API validation
			return accessToken
		}
	}

	/**
	 * Refresh token if needed (with deduplication)
	 */
	private async refreshTokenIfNeeded(): Promise<string | undefined> {
		// Prevent multiple simultaneous refresh attempts
		if (this.refreshPromise) {
			console.log("Token refresh already in progress, waiting...")
			return await this.refreshPromise
		}

		this.refreshPromise = this.performTokenRefresh()

		try {
			const result = await this.refreshPromise
			return result
		} finally {
			this.refreshPromise = null
		}
	}

	/**
	 * Perform actual token refresh
	 */
	private async performTokenRefresh(): Promise<string | undefined> {
		try {
			// Use the unified refresh method
			const newAccessToken = await this.authService.refreshCurrentAccessToken()

			if (newAccessToken) {
				console.log("Token refresh successful")
				return newAccessToken
			}

			console.warn("Token refresh failed")
			return undefined
		} catch (error) {
			console.error("Token refresh error:", error)
			return undefined
		}
	}

	/**
	 * Handle authentication required scenario
	 */
	private async handleAuthenticationRequired(): Promise<void> {
		const signInAction = "Sign In"
		const selection = await vscode.window.showErrorMessage(
			"Your authentication session has expired. Please sign in again.",
			signInAction,
		)

		if (selection === signInAction) {
			vscode.commands.executeCommand("softcodes.signin")
		}
	}

	/**
	 * Check if user is authenticated with valid token
	 */
	async isAuthenticated(): Promise<boolean> {
		try {
			const token = await this.getValidAccessToken()
			return !!token
		} catch (error) {
			console.error("Authentication check failed:", error)
			return false
		}
	}

	/**
	 * Get current user information from token
	 */
	async getCurrentUser(): Promise<any> {
		const token = await this.getValidAccessToken()

		if (!token) {
			throw new Error("Not authenticated")
		}

		try {
			const verification = await this.jwtService.verifyJWT(token)

			if (verification.valid && verification.userInfo) {
				return verification.userInfo
			}
		} catch (error) {
			console.warn("Failed to extract user from JWT, falling back to API")
		}

		// Fallback to API
		return this.request("/api/auth/user-info")
	}

	/**
	 * Validate session
	 */
	async validateSession(sessionToken: string, extensionVersion: string): Promise<any> {
		return this.request("/api/vscode/session/validate", {
			method: "POST",
			body: JSON.stringify({ sessionToken, extensionVersion }),
		})
	}

	/**
	 * Validate current authentication state
	 */
	async validateCurrentAuth(): Promise<{ valid: boolean; user?: any; error?: string }> {
		try {
			const isAuth = await this.isAuthenticated()

			if (!isAuth) {
				return { valid: false, error: "Not authenticated" }
			}

			const user = await this.getCurrentUser()
			return { valid: true, user }
		} catch (error) {
			return {
				valid: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Track usage
	 */
	async trackUsage(data: any): Promise<any> {
		return this.request("/api/vscode/usage/track", {
			method: "POST",
			body: JSON.stringify(data),
		})
	}

	/**
	 * Get user balance
	 */
	async getUserBalance(): Promise<any> {
		return this.request("/api/vscode/user/balance")
	}

	/**
	 * Get user subscription status
	 */
	async getSubscriptionStatus(): Promise<any> {
		return this.request("/api/vscode/user/subscription")
	}

	/**
	 * Submit task for processing
	 */
	async submitTask(task: any): Promise<any> {
		return this.request("/api/vscode/tasks", {
			method: "POST",
			body: JSON.stringify(task),
		})
	}

	/**
	 * Get task status
	 */
	async getTaskStatus(taskId: string): Promise<any> {
		return this.request(`/api/vscode/tasks/${taskId}`)
	}
}
