import * as vscode from "vscode"
import { UnifiedAuthService } from "../auth/unifiedAuthService"
import { JWTVerificationService } from "../auth/jwtVerification"
import { JWTErrorType } from "../auth/jwtTypes"
import { API_CONFIG } from "../config/constants"

export class ApiClient {
	private authService: UnifiedAuthService
	private jwtService: JWTVerificationService
	private baseUrl: string
	private refreshPromise: Promise<string | undefined> | null = null

	constructor(context: vscode.ExtensionContext) {
		this.authService = UnifiedAuthService.getInstance(context)
		this.jwtService = JWTVerificationService.getInstance()
		// Base URL will be determined dynamically from the token
		this.baseUrl = API_CONFIG.OPENROUTER.BASE_URL.replace("/api/v1", "") // Default to OpenRouter, will be overridden
	}

	/**
	 * Make authenticated API request with JWT verification and automatic refresh
	 */
	async request(endpoint: string, options: RequestInit = {}): Promise<any> {
		console.log("🚀 [API-CLIENT] Starting authenticated request")
		console.log("🔍 [API-CLIENT] Request details:", {
			endpoint,
			method: options.method || "GET",
			hasBody: !!options.body,
			bodyLength: options.body ? String(options.body).length : 0,
			bodyPreview: options.body ? `${String(options.body).substring(0, 50)}...` : "no body",
			headersCount: options.headers ? Object.keys(options.headers).length : 0,
			headers: options.headers || {},
		})

		let accessToken = await this.getValidAccessToken()

		// Dynamically determine base URL from token
		const dynamicBaseUrl = await this.getBaseUrlFromToken(accessToken)
		const baseUrl = dynamicBaseUrl || this.baseUrl

		console.log("🔍 [API-CLIENT] Base URL determination:", {
			dynamicBaseUrl,
			fallbackBaseUrl: this.baseUrl,
			finalBaseUrl: baseUrl,
			fullUrl: `${baseUrl}${endpoint}`,
		})

		if (!accessToken) {
			console.error("❌ [API-CLIENT] No access token available - authentication required")
			await this.handleAuthenticationRequired()
			throw new Error("Authentication required")
		}

		console.log("🔍 [API-CLIENT] Making request to:", `${baseUrl}${endpoint}`)
		console.log("🔍 [API-CLIENT] Authorization header:", `Bearer ${accessToken.substring(0, 20)}...`)
		console.log("🔍 [API-CLIENT] Full token length:", accessToken.length)
		console.log(
			"🔍 [API-CLIENT] Token preview:",
			`${accessToken.substring(0, 30)}...${accessToken.substring(accessToken.length - 10)}`,
		)

		const requestHeaders = {
			...options.headers,
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		}

		console.log("📡 [API-CLIENT] Final request headers:", requestHeaders)

		let response
		try {
			console.log("📡 [API-CLIENT] Executing fetch request...")
			response = await fetch(`${baseUrl}${endpoint}`, {
				...options,
				headers: requestHeaders,
			})
			console.log("✅ [API-CLIENT] Fetch request completed")
		} catch (error) {
			console.error("❌ [API-CLIENT] Fetch request failed:", {
				error: error instanceof Error ? error.message : String(error),
				errorType: error instanceof Error ? error.constructor.name : typeof error,
				isNetworkError: error instanceof TypeError,
				timestamp: new Date().toISOString(),
			})
			throw error
		}

		console.log("🔍 [API-CLIENT] Response status:", response.status)
		console.log("🔍 [API-CLIENT] Response status text:", response.statusText)
		console.log("🔍 [API-CLIENT] Response headers:", Object.fromEntries(response.headers.entries()))
		console.log("🔍 [API-CLIENT] Response URL:", response.url)

		if (response.status === 401) {
			console.log("❌ [API-CLIENT] Received 401 Unauthorized!")
			console.log("🔍 [API-CLIENT] Request URL:", `${baseUrl}${endpoint}`)
			console.log("🔍 [API-CLIENT] Response status:", response.status)
			console.log("🔍 [API-CLIENT] Response status text:", response.statusText)

			// Try to get response body for more details
			try {
				const errorBody = await response.clone().json()
				console.log("🔍 [API-CLIENT] 401 Error response body:", errorBody)
			} catch (e) {
				try {
					const errorText = await response.clone().text()
					console.log("🔍 [API-CLIENT] 401 Error response text:", errorText)
				} catch (e2) {
					console.log("🔍 [API-CLIENT] Could not read 401 error response body")
				}
			}

			console.log("🔄 [API-CLIENT] Attempting token refresh...")

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
	 * Get valid access token - simplified to trust the UnifiedAuthService
	 */
	private async getValidAccessToken(): Promise<string | undefined> {
		console.log("🔍 [API-CLIENT] Requesting access token from UnifiedAuthService...")

		try {
			// Use ensureValidAccessToken which handles all refresh logic and verification
			console.log("🔄 [API-CLIENT] Calling authService.ensureValidAccessToken()...")
			const accessToken = await this.authService.ensureValidAccessToken()
			console.log("✅ [API-CLIENT] ensureValidAccessToken() completed")

			if (!accessToken) {
				console.error("❌ [API-CLIENT] No access token available from UnifiedAuthService")
				console.log("🔍 [API-CLIENT] Checking if user is authenticated via isAuthenticated()...")

				const isAuth = await this.authService.isAuthenticated()
				console.log("🔍 [API-CLIENT] isAuthenticated() result:", isAuth)

				// Additional debugging for authentication state
				console.log("🔍 [API-CLIENT] Getting detailed authentication state...")
				const authState = await this.authService.getAuthenticationState()
				console.log("🔍 [API-CLIENT] Authentication state:", {
					isAuthenticated: authState.isAuthenticated,
					isConnected: authState.isConnected,
					hasClerkId: !!authState.clerkId,
					hasError: !!authState.error,
					error: authState.error,
				})

				return undefined
			}

			console.log("✅ [API-CLIENT] Got access token from UnifiedAuthService")
			console.log("🔍 [API-CLIENT] Token details:", {
				length: accessToken.length,
				startsWith: accessToken.substring(0, 10),
				endsWith: accessToken.substring(accessToken.length - 10),
				isJWT: accessToken.includes("."),
				partsCount: accessToken.split(".").length,
			})

			// Basic JWT structure validation
			if (accessToken.includes(".")) {
				const parts = accessToken.split(".")
				console.log("🔍 [API-CLIENT] JWT structure validation:", {
					hasHeader: parts.length > 0 && parts[0].length > 0,
					hasPayload: parts.length > 1 && parts[1].length > 0,
					hasSignature: parts.length > 2 && parts[2].length > 0,
					headerLength: parts[0]?.length || 0,
					payloadLength: parts[1]?.length || 0,
					signatureLength: parts[2]?.length || 0,
				})
			}

			// Trust the UnifiedAuthService - if it returned a token, use it
			// Don't do additional JWT verification here to avoid conflicts
			return accessToken
		} catch (error) {
			console.error("❌ [API-CLIENT] Error getting valid access token:", {
				error: error instanceof Error ? error.message : String(error),
				errorType: error instanceof Error ? error.constructor.name : typeof error,
				stack: error instanceof Error ? error.stack : "no stack trace",
				timestamp: new Date().toISOString(),
			})
			throw error
		}
	}

	/**
	 * Get base URL from token using the same logic as kilocode-openrouter provider
	 */
	private async getBaseUrlFromToken(token: string | undefined): Promise<string> {
		if (!token) {
			return API_CONFIG.OPENROUTER.BASE_URL.replace("/api/v1", "")
		}

		// Import the function to get base URL from token
		const { getKiloBaseUriFromToken } = await import("../utils/kilocode-token")
		return getKiloBaseUriFromToken(token)
	}

	/**
	 * Refresh token if needed (simplified - delegate to UnifiedAuthService)
	 */
	private async refreshTokenIfNeeded(): Promise<string | undefined> {
		// Prevent multiple simultaneous refresh attempts
		if (this.refreshPromise) {
			console.log("🔄 [API-CLIENT] Token refresh already in progress, waiting...")
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
	 * Perform actual token refresh - delegate to UnifiedAuthService
	 */
	private async performTokenRefresh(): Promise<string | undefined> {
		try {
			console.log("🔄 [API-CLIENT] Delegating token refresh to UnifiedAuthService...")

			// Just call ensureValidAccessToken again - it handles all refresh logic
			const newAccessToken = await this.authService.ensureValidAccessToken()

			if (newAccessToken) {
				console.log("✅ [API-CLIENT] Token refresh via UnifiedAuthService successful")
				return newAccessToken
			}

			console.log("⚠️ [API-CLIENT] UnifiedAuthService returned no token")
			return undefined
		} catch (error) {
			console.warn("⚠️ [API-CLIENT] Token refresh via UnifiedAuthService failed:", error)
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

		console.log("🔍 [API-CLIENT] Getting current user info...")

		// Try to extract user info from JWT first (more reliable)
		try {
			const verification = await this.jwtService.verifyJWT(token)

			if (verification.valid && verification.userInfo) {
				console.log("✅ [API-CLIENT] Successfully extracted user info from JWT")
				return verification.userInfo
			}
		} catch (error) {
			console.warn("⚠️ [API-CLIENT] Failed to extract user from JWT, trying API fallback:", error)
		}

		// Fallback to API if JWT extraction fails
		try {
			console.log("🔄 [API-CLIENT] Falling back to API for user info...")
			return await this.request("/api/auth/user-info")
		} catch (error) {
			// If API also fails, try to use the UnifiedAuthService getUserInfo which has better fallback logic
			console.warn("⚠️ [API-CLIENT] API fallback failed, trying UnifiedAuthService getUserInfo:", error)

			try {
				const userInfo = await this.authService.getUserInfo()
				if (userInfo) {
					console.log("✅ [API-CLIENT] Successfully got user info from UnifiedAuthService")
					return userInfo
				}
			} catch (serviceError) {
				console.error("❌ [API-CLIENT] UnifiedAuthService getUserInfo also failed:", serviceError)
			}

			// If everything fails, throw the original API error
			throw error
		}
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
		try {
			console.log("🔍 [API-CLIENT] Getting user balance...")
			return await this.request("/api/vscode/user/balance")
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			console.warn("⚠️ [API-CLIENT] Failed to get user balance from API:", errorMessage)

			// Check if this is a 401/authentication error vs a "not implemented" error
			if (
				error instanceof Error &&
				(error.message.includes("401") ||
					error.message.includes("Authentication required") ||
					error.message.includes("Not authenticated"))
			) {
				// This is a real authentication error
				throw error
			} else {
				// This might be a "not implemented" error - throw with more context
				throw new Error(`API request failed: ${errorMessage}`)
			}
		}
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
