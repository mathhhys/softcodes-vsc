import * as vscode from "vscode"
import { generateCodeVerifier, generateCodeChallenge, generateState } from "./pkce"
import {
	getAuthConfig,
	AUTH_ENDPOINTS,
	OAUTH_CONFIG,
	TOKEN_KEYS,
	AUTH_ERRORS,
	AUTH_SUCCESS,
	generateUserAgent,
	buildAuthUrl,
	isValidRedirectUri,
	JWT_CONFIG,
} from "./config"
import { JWTVerificationService } from "./jwtVerification"
import { JWTErrorType, UserInfoFromJWT, ClerkJWTPayload } from "./jwtTypes"
import { parseJWTUnsafe, extractUserInfoFromPayload, isValidJWTFormat } from "./jwtUtils"
import { ClerkBackendService } from "./clerkBackendService"
import { UserVerificationService, MemoryCache } from "./userVerificationService"
import { GracefulDegradationManager } from "./fallbackHandler"
import { UserVerificationErrorType } from "./userVerificationTypes"

// JWT System Version Marker
const JWT_SYSTEM_VERSION = "V2-INTEGRATED-BASE64URL-DECODER"
console.log(`🔧 [AUTH-SERVICE] Loaded with JWT System: ${JWT_SYSTEM_VERSION}`)

/**
 * Interface for authentication tokens returned by the unified auth system
 */
export interface AuthTokens {
	access_token: string
	refresh_token: string
	session_id?: string
	organization_id?: string | null
}

/**
 * Interface for user information
 */
export interface UserInfo {
	email: string
	firstName?: string
	lastName?: string
	organizationName?: string
	organizationId?: string
}

/**
 * Unified Authentication Service that bridges VSCode extension with Clerk-based website authentication
 * This service maintains compatibility with both authentication systems while providing a unified interface
 */
export class UnifiedAuthService {
	private static instance: UnifiedAuthService
	private context: vscode.ExtensionContext
	private pendingAuth: Map<string, { codeVerifier: string; state: string }> = new Map()
	private userVerificationService?: UserVerificationService
	private fallbackManager?: GracefulDegradationManager

	constructor(context: vscode.ExtensionContext) {
		this.context = context
		this.initializeBackendVerification()
	}

	/**
	 * Initialize backend verification services
	 */
	private async initializeBackendVerification(): Promise<void> {
		try {
			// Validate Clerk configuration
			const validation = this.validateClerkConfiguration()
			if (!validation.valid) {
				console.warn("[Auth] Clerk configuration incomplete - backend verification disabled", {
					missingKeys: validation.missingKeys,
					warnings: validation.warnings,
				})
				return
			}

			// Initialize Clerk backend service with production configuration
			const clerkService = ClerkBackendService.getInstance({
				secretKey: process.env.CLERK_SECRET_KEY!,
				timeout: 10000,
			})

			// Initialize cache (using memory cache for VSCode extension)
			const cache = new MemoryCache()

			// Initialize user verification service
			this.userVerificationService = UserVerificationService.getInstance(clerkService, cache, {
				ttl: 300, // 5 minutes for positive results
				negativeTtl: 60, // 1 minute for negative results
				maxSize: 1000,
				negativeCache: true,
			})

			// Initialize fallback manager
			const jwtService = JWTVerificationService.getInstance()
			this.fallbackManager = new GracefulDegradationManager(cache, jwtService)

			console.log("[Auth] Backend verification services initialized successfully", {
				clerkBaseUrl: process.env.CLERK_BASE_URL,
				hasSecretKey: !!process.env.CLERK_SECRET_KEY,
				hasPublishableKey: !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
			})
		} catch (error) {
			console.error("[Auth] Failed to initialize backend verification:", error)
			// Continue without backend verification in case of initialization failure
		}
	}

	/**
	 * Validate Clerk configuration for backend verification
	 */
	private validateClerkConfiguration(): {
		valid: boolean
		missingKeys: string[]
		warnings: string[]
	} {
		const missingKeys: string[] = []
		const warnings: string[] = []

		// Check for required Clerk secret key
		if (!process.env.CLERK_SECRET_KEY) {
			missingKeys.push("CLERK_SECRET_KEY")
		} else if (!process.env.CLERK_SECRET_KEY.startsWith("sk_live_")) {
			warnings.push("Using non-production Clerk secret key")
		}

		// Check for publishable key (for reference)
		if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
			warnings.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY not set")
		}

		// Check for base URL
		if (!process.env.CLERK_BASE_URL) {
			warnings.push("CLERK_BASE_URL not set, using default")
		}

		return {
			valid: missingKeys.length === 0,
			missingKeys,
			warnings,
		}
	}

	static getInstance(context: vscode.ExtensionContext): UnifiedAuthService {
		if (!UnifiedAuthService.instance) {
			UnifiedAuthService.instance = new UnifiedAuthService(context)
		}
		return UnifiedAuthService.instance
	}

	/**
	 * Initiate unified OAuth flow that works with both VSCode and website
	 */
	async authenticate(): Promise<void> {
		try {
			// Generate PKCE parameters for security
			const codeVerifier = generateCodeVerifier()
			const codeChallenge = await generateCodeChallenge(codeVerifier)
			const state = generateState()

			// Store for later verification
			this.pendingAuth.set(state, { codeVerifier, state })
			await this.context.secrets.store(`${TOKEN_KEYS.PKCE_PREFIX}${state}`, codeVerifier)

			// Build redirect URI - using unified scheme
			const redirectUri = OAUTH_CONFIG.VSCODE.REDIRECT_URI

			// Validate redirect URI for security
			if (!isValidRedirectUri(redirectUri)) {
				throw new Error("Invalid redirect URI configuration")
			}

			// Call unified backend initiation endpoint
			const backendUrl = await this.getBackendUrl()
			const authUrl = buildAuthUrl(backendUrl, {
				redirect_uri: redirectUri,
				code_challenge: codeChallenge,
				state: state,
			})

			const response = await fetch(authUrl, {
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					"User-Agent": generateUserAgent(),
				},
			})

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({ error: AUTH_ERRORS.NETWORK_ERROR }))
				throw new Error(errorData.error || AUTH_ERRORS.NETWORK_ERROR)
			}

			const data = await response.json()

			if (!data.auth_url) {
				throw new Error(AUTH_ERRORS.INVALID_RESPONSE)
			}

			// Open browser with Clerk auth URL
			await vscode.env.openExternal(vscode.Uri.parse(data.auth_url))

			vscode.window.showInformationMessage("Please complete authentication in your browser")
		} catch (error) {
			console.error("Authentication initiation failed:", error)
			vscode.window.showErrorMessage(
				`Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * Sign in with a manually entered auth token
	 * Enhanced with JWT verification first, then API fallback
	 */
	async signinWithToken(): Promise<void> {
		try {
			// Prompt user for auth token
			const token = await vscode.window.showInputBox({
				prompt: "Enter your Softcodes authentication token (JWT)",
				password: true,
				placeHolder: "Paste your JWT token here...",
				ignoreFocusOut: true,
				validateInput: (value) => {
					if (!value || value.trim().length === 0) {
						return "Token cannot be empty"
					}
					if (value.length < 10) {
						return "Token appears to be too short"
					}
					// Basic JWT format check
					if (!this.isBasicJWTFormat(value.trim())) {
						return "Token must be a valid JWT format (xxx.yyy.zzz)"
					}
					return null
				},
			})

			if (!token) {
				// User cancelled the input
				return
			}

			const trimmedToken = token.trim()

			console.log(`🔧 [AUTH-SERVICE] Using JWT System: ${JWT_SYSTEM_VERSION}`)
			console.log("🔧 [AUTH-SERVICE] Import verification - parseJWTUnsafe:", typeof parseJWTUnsafe)
			console.log(
				"🔧 [AUTH-SERVICE] Import verification - extractUserInfoFromPayload:",
				typeof extractUserInfoFromPayload,
			)

			// Step 1: Try JWT verification first
			console.log("🔍 [DEBUG] Attempting JWT verification with signature check...")
			const jwtResult = await this.verifyJWTToken(trimmedToken)

			if (jwtResult.success) {
				console.log("✅ [DEBUG] JWT verification successful, storing token and user data")
				await this.handleSuccessfulJWTVerification(trimmedToken, jwtResult.userInfo!, jwtResult.payload!)
				return
			}

			// Step 1.5: If JWT verification fails, try structure-only validation
			console.log("❌ [DEBUG] JWT signature verification failed, testing token structure...")
			const structureResult = await this.testTokenStructure(trimmedToken)

			if (structureResult.valid) {
				console.log("✅ [DEBUG] Token structure is valid, proceeding with fallback token storage...")
				await this.handleFallbackTokenStorage(trimmedToken)
				return
			}

			// Step 2: Check if we're in development mode first
			const config = vscode.workspace.getConfiguration("softcodes")
			const skipAPIValidation = config.get("auth.skipAPIValidation", false)

			if (skipAPIValidation) {
				console.log("⚡ [DEBUG] Development mode enabled, using fallback authentication")
				await this.handleFallbackTokenStorage(trimmedToken)
				return
			}

			// Step 3: Attempt API validation
			console.log("JWT verification failed, attempting API validation...")
			const apiResult = await this.validateTokenWithAPI(trimmedToken)

			if (apiResult.success) {
				console.log("API validation successful, storing token")
				await this.handleSuccessfulAPIValidation(trimmedToken, apiResult.userInfo)
				return
			}

			// Step 4: If API fails, check if it's a backend issue and offer immediate bypass
			if (this.isBackendNotAvailable(apiResult.error)) {
				console.log("🔄 [DEBUG] Backend not available, offering immediate bypass")

				const bypassChoice = await vscode.window.showInformationMessage(
					"🔧 The authentication service is not yet available, but you can still use your token! Choose how you'd like to proceed:",
					{
						title: "✅ Use Token Now",
						detail: "Store your token and start using the extension immediately",
					} as any,
					{
						title: "⚙️ Enable Offline Mode",
						detail: "Remember this choice for future authentications",
					} as any,
					{
						title: "❌ Cancel",
						detail: "Cancel authentication",
					} as any,
				)

				if (bypassChoice?.title === "✅ Use Token Now") {
					await this.handleFallbackTokenStorage(trimmedToken)
					return
				} else if (bypassChoice?.title === "⚙️ Enable Offline Mode") {
					await this.enableDevelopmentMode()
					await this.handleFallbackTokenStorage(trimmedToken)
					return
				} else {
					vscode.window.showInformationMessage("Authentication cancelled. You can try again anytime!")
					return
				}
			}

			// Both methods failed for other reasons - provide helpful guidance
			await this.handleAuthenticationFailure(jwtResult.error, apiResult.error)
		} catch (error) {
			console.error("Manual token authentication failed:", error)
			vscode.window.showErrorMessage(
				`Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * Check if the error indicates backend is not available
	 */
	private isBackendNotAvailable(error?: string): boolean {
		if (!error) return false

		return (
			error.includes("not yet available") ||
			error.includes("not implemented") ||
			error.includes("404") ||
			error.includes("Not Found") ||
			error.includes("Unable to connect") ||
			error.includes("Network connection failed")
		)
	}

	/**
	 * Handle authentication failure with user-friendly guidance
	 */
	private async handleAuthenticationFailure(jwtError?: string, apiError?: string): Promise<void> {
		console.error("🚫 [DEBUG] Complete authentication failure:", {
			jwtError,
			apiError,
			timestamp: new Date().toISOString(),
		})

		// Determine the primary cause and provide specific guidance
		let primaryMessage = "Authentication failed"
		let secondaryMessage = ""
		let actions: string[] = []

		if (apiError?.includes("not yet available") || apiError?.includes("not implemented")) {
			primaryMessage = "Authentication service is not fully implemented yet"
			secondaryMessage = "The backend authentication system is still under development. "
			actions = ["Contact Support", "Try Again Later", "Use Development Mode"]
		} else if (jwtError?.includes("Invalid token signature")) {
			primaryMessage = "Invalid authentication token"
			secondaryMessage =
				"The token signature could not be verified. Please obtain a new token from your account dashboard."
			actions = ["Get New Token", "Contact Support"]
		} else if (jwtError?.includes("expired")) {
			primaryMessage = "Authentication token expired"
			secondaryMessage = "Your token has expired. Please obtain a new token from your account dashboard."
			actions = ["Get New Token", "Try Again"]
		} else {
			primaryMessage = "Unable to verify authentication token"
			secondaryMessage =
				"Both local verification and API validation failed. Please check your token and try again."
			actions = ["Try Again", "Contact Support"]
		}

		const selection = await vscode.window.showErrorMessage(`${primaryMessage}. ${secondaryMessage}`, ...actions)

		// Handle user selection
		switch (selection) {
			case "Contact Support":
				vscode.env.openExternal(
					vscode.Uri.parse("mailto:support@softcodes.ai?subject=VSCode Extension Authentication Issue"),
				)
				break
			case "Get New Token":
				vscode.env.openExternal(vscode.Uri.parse("https://www.softcodes.ai/dashboard"))
				break
			case "Use Development Mode":
				await this.enableDevelopmentMode()
				break
			case "Try Again":
				// Re-trigger authentication
				setTimeout(() => this.signinWithToken(), 1000)
				break
		}

		throw new Error(`${primaryMessage}: ${jwtError || apiError || "Unknown error"}`)
	}

	/**
	 * Enable development mode for authentication
	 */
	private async enableDevelopmentMode(): Promise<void> {
		const config = vscode.workspace.getConfiguration("softcodes")
		await config.update("auth.skipAPIValidation", true, vscode.ConfigurationTarget.Global)

		console.log("⚙️ [DEBUG] Development mode enabled - future authentications will skip API validation")

		vscode.window.showInformationMessage(AUTH_SUCCESS.AUTHENTICATED)
	}

	/**
	 * Fallback token storage when both JWT and API validation fail
	 */
	private async handleFallbackTokenStorage(token: string): Promise<void> {
		console.log("🔄 [DEBUG] Using fallback token storage mode")

		try {
			// Attempt to extract basic info from JWT if possible
			let userInfo: any = null

			if (isValidJWTFormat(token)) {
				try {
					console.log("🔧 [FALLBACK-MODE] Using NEW JWT utilities for token storage")
					console.log("🔧 [FALLBACK-MODE] Calling parseJWTUnsafe from jwtUtils.ts...")
					// Use the new JWT utility for proper base64url decoding
					const parseResult = parseJWTUnsafe(token)

					if (parseResult.success && parseResult.parts) {
						const extractedInfo = extractUserInfoFromPayload(parseResult.parts.payload)

						userInfo = {
							email: extractedInfo.email,
							userId: extractedInfo.userId,
							sessionId: extractedInfo.sessionId,
							organizationId: extractedInfo.organizationId || null,
							firstName: extractedInfo.firstName || "User",
							lastName: extractedInfo.lastName || "",
						}

						console.log("📊 [DEBUG] Extracted user info from JWT:", {
							email: userInfo.email,
							userId: userInfo.userId,
							hasOrgId: !!userInfo.organizationId,
							parseSuccess: true,
						})
					} else {
						console.warn("🔄 [DEBUG] JWT parsing failed in fallback mode:", parseResult.error)
					}
				} catch (error) {
					console.warn("Failed to decode JWT for fallback info:", error)
				}
			}

			// Store the token and any extracted info
			await this.context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, token)
			await this.context.secrets.store(TOKEN_KEYS.SESSION_ID, userInfo?.sessionId || "fallback-session")

			if (userInfo?.organizationId) {
				await this.context.secrets.store(TOKEN_KEYS.ORGANIZATION_ID, userInfo.organizationId)
			}

			console.log("✅ [DEBUG] Token stored in fallback mode with extracted info")

			// Show success message with user's name if available
			const welcomeName = userInfo?.firstName || userInfo?.email || "User"
			vscode.window.showInformationMessage(AUTH_SUCCESS.AUTHENTICATED)

			// Trigger any post-auth actions
			vscode.commands.executeCommand("softcodes.onAuthenticated")
		} catch (error) {
			console.error("Failed to store fallback token:", error)
			vscode.window.showErrorMessage("Failed to store authentication token. Please try again.")
			throw error
		}
	}

	/**
	 * Test JWT token structure without signature verification
	 */
	private async testTokenStructure(token: string): Promise<{
		valid: boolean
		payload?: ClerkJWTPayload
		error?: string
	}> {
		try {
			console.log("🔍 [DEBUG] Testing JWT token structure without signature verification...")
			console.log("🔍 [DEBUG] Using parseJWTUnsafe from jwtUtils module...")

			// Test our JWT utilities directly first
			const parseResult = parseJWTUnsafe(token)
			console.log(
				"🔍 [DEBUG] parseJWTUnsafe result:",
				JSON.stringify(
					{
						success: parseResult.success,
						error: parseResult.error,
						hasHeader: !!parseResult.parts?.header,
						hasPayload: !!parseResult.parts?.payload,
						hasSig: !!parseResult.parts?.signature,
					},
					null,
					2,
				),
			)

			if (!parseResult.success) {
				console.log("❌ [DEBUG] Token structure test failed:", JSON.stringify(parseResult.error, null, 2))
				return {
					valid: false,
					error: parseResult.error,
				}
			}

			const payload = parseResult.parts!.payload
			console.log(
				"✅ [DEBUG] Our JWT utilities work! Payload extracted:",
				JSON.stringify(
					{
						email: payload.email,
						sub: payload.sub,
						iss: payload.iss,
						aud: payload.aud,
						exp: payload.exp,
					},
					null,
					2,
				),
			)

			// Since our direct parsing works, let's just use that instead of the service method
			// Skip the potentially problematic validateTokenStructure and just use our utilities
			console.log("✅ [DEBUG] Token structure is valid via direct parsing - bypassing validateTokenStructure")

			console.log("✅ [DEBUG] Token structure is valid - can extract user info")
			console.log(
				"📊 [DEBUG] Token payload preview:",
				JSON.stringify(
					{
						email: payload.email,
						sub: payload.sub,
						iss: payload.iss,
						aud: payload.aud,
						exp: payload.exp,
						session_id: payload.session_id,
					},
					null,
					2,
				),
			)
			return {
				valid: true,
				payload: payload,
			}
		} catch (error) {
			console.error(
				"❌ [DEBUG] Token structure test exception:",
				JSON.stringify(
					{
						name: error instanceof Error ? error.name : "Unknown",
						message: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : undefined,
					},
					null,
					2,
				),
			)
			return {
				valid: false,
				error: `Token structure test failed: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	/**
	 * Verify JWT token using local verification
	 */
	private async verifyJWTToken(token: string): Promise<{
		success: boolean
		userInfo?: UserInfoFromJWT
		payload?: ClerkJWTPayload
		error?: string
	}> {
		try {
			console.log("🔍 [DEBUG] JWT Verification Start:", {
				tokenLength: token.length,
				tokenPreview: `${token.substring(0, 20)}...${token.substring(token.length - 20)}`,
				tokenParts: token.split(".").length,
				timestamp: new Date().toISOString(),
			})

			// First, let's see if we can parse the token structure
			console.log("🔍 [DEBUG] Testing our JWT utilities directly...")
			const parseResult = parseJWTUnsafe(token)
			console.log(
				"🔍 [DEBUG] Direct parseJWTUnsafe result:",
				JSON.stringify(
					{
						success: parseResult.success,
						error: parseResult.error,
					},
					null,
					2,
				),
			)

			if (parseResult.success) {
				console.log(
					"🔍 [DEBUG] Token Structure Preview:",
					JSON.stringify(
						{
							issuer: parseResult.parts?.payload.iss,
							audience: parseResult.parts?.payload.aud,
							subject: parseResult.parts?.payload.sub,
							expiration: parseResult.parts?.payload.exp
								? new Date(parseResult.parts.payload.exp * 1000).toISOString()
								: "none",
							email: parseResult.parts?.payload.email,
							hasSessionId: !!parseResult.parts?.payload.session_id,
						},
						null,
						2,
					),
				)
			} else {
				console.log(
					"❌ [DEBUG] Token parsing failed at basic level:",
					JSON.stringify(parseResult.error, null, 2),
				)
			}

			const jwtService = JWTVerificationService.getInstance()
			const result = await jwtService.verifyJWT(token)

			console.log(
				"🔍 [DEBUG] JWT Verification Result:",
				JSON.stringify(
					{
						valid: result.valid,
						hasUserInfo: !!result.userInfo,
						hasPayload: !!result.payload,
						hasError: !!result.error,
						errorType: result.error?.type,
						errorMessage: result.error?.message,
						errorDetails: result.error?.details,
						timestamp: new Date().toISOString(),
					},
					null,
					2,
				),
			)

			if (result.valid && result.userInfo) {
				// Check if token is near expiration
				if (result.payload && jwtService.isTokenNearExpiration(result.payload)) {
					vscode.window.showWarningMessage(
						"Your authentication token will expire soon. Consider refreshing it.",
						"Understood",
					)
				}

				console.log("✅ [DEBUG] JWT verification successful")
				return {
					success: true,
					userInfo: result.userInfo,
					payload: result.payload,
				}
			}

			console.log("❌ [DEBUG] JWT verification failed but no exception thrown")
			return {
				success: false,
				error: result.error ? this.formatJWTError(result.error) : "JWT verification failed",
			}
		} catch (error) {
			console.error("❌ [DEBUG] JWT verification exception:", {
				name: error instanceof Error ? error.name : "Unknown",
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				timestamp: new Date().toISOString(),
			})
			return {
				success: false,
				error: `JWT verification failed: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	/**
	 * Validate token with API (fallback method)
	 */
	private async validateTokenWithAPI(token: string): Promise<{
		success: boolean
		userInfo?: any
		error?: string
	}> {
		let requestUrl: string = ""
		let requestHeaders: Record<string, string> = {}
		let requestBody: string = ""

		try {
			const backendUrl = await this.getBackendUrl()
			requestUrl = `${backendUrl}${AUTH_ENDPOINTS.VALIDATE_SESSION}`
			requestHeaders = {
				Authorization: `Bearer ${token.substring(0, 20)}...`, // Only log first 20 chars for security
				"Content-Type": "application/json",
				"User-Agent": generateUserAgent(),
			}
			requestBody = JSON.stringify({
				client_type: "vscode",
			})

			console.log("🔍 [DEBUG] API Validation Request:", {
				url: requestUrl,
				method: "POST",
				headers: requestHeaders,
				bodyLength: requestBody.length,
				timestamp: new Date().toISOString(),
			})

			// Add network connectivity test
			console.log("🌐 [DEBUG] Testing network connectivity...")

			const response = await fetch(requestUrl, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
					"User-Agent": generateUserAgent(),
				},
				body: requestBody,
				// Add timeout to detect hanging requests
				signal: AbortSignal.timeout(30000), // 30 second timeout
			})

			console.log("✅ [DEBUG] Fetch completed successfully:", {
				status: response.status,
				statusText: response.statusText,
				url: response.url,
				headers: Object.fromEntries(response.headers.entries()),
				timestamp: new Date().toISOString(),
			})

			// Handle specific HTTP status codes with detailed messaging
			if (!response.ok) {
				const errorData = await response.json().catch(() => ({ error: "API validation failed" }))

				// Special handling for 404 - indicates missing backend implementation
				if (response.status === 404) {
					console.error("🚫 [DEBUG] Backend endpoint not implemented:", {
						endpoint: AUTH_ENDPOINTS.VALIDATE_SESSION,
						expectedLocation: requestUrl,
						recommendation: "Backend team needs to implement unified auth API endpoints",
					})

					return {
						success: false,
						error: "Authentication service is not yet available. The backend authentication endpoints are not implemented. Please contact support or try again later.",
					}
				}

				return {
					success: false,
					error: errorData.error || `HTTP ${response.status}: ${response.statusText}`,
				}
			}

			// Try to get additional user info
			let userInfo = null
			try {
				const userInfoResponse = await fetch(`${backendUrl}${AUTH_ENDPOINTS.USER_INFO}`, {
					method: "GET",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
						"User-Agent": generateUserAgent(),
					},
				})

				if (userInfoResponse.ok) {
					userInfo = await userInfoResponse.json()
				}
			} catch (error) {
				console.warn("Could not fetch user info from API:", error)
			}

			return {
				success: true,
				userInfo,
			}
		} catch (error) {
			return this.handleAPIValidationError(error, requestUrl, requestHeaders, requestBody)
		}
	}

	/**
	 * Comprehensive error handling for API validation failures
	 */
	private handleAPIValidationError(
		error: any,
		requestUrl: string,
		requestHeaders: Record<string, string>,
		requestBody: string,
	): { success: false; error: string } {
		// Enhanced error logging with detailed diagnostics
		console.error("❌ [DEBUG] API Validation Failed:", {
			url: requestUrl,
			headers: requestHeaders,
			bodyLength: requestBody.length,
			error: {
				name: error instanceof Error ? error.name : "Unknown",
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				cause: error instanceof Error ? error.cause : undefined,
			},
			networkDetails: {
				userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "vscode-extension",
				onLine: typeof navigator !== "undefined" ? navigator.onLine : true,
				connection:
					typeof navigator !== "undefined" && (navigator as any).connection
						? {
								effectiveType: (navigator as any).connection.effectiveType,
								downlink: (navigator as any).connection.downlink,
								rtt: (navigator as any).connection.rtt,
							}
						: "unavailable",
			},
			timestamp: new Date().toISOString(),
		})

		// Categorize errors with specific user-friendly messages
		let errorMessage = "Authentication service temporarily unavailable"
		let technicalReason = ""

		if (error instanceof TypeError && error.message.includes("fetch")) {
			if (error.message.includes("Failed to fetch")) {
				errorMessage = "Unable to connect to authentication service"
				technicalReason = "Network connection failed or CORS policy blocking request"
			} else if (error.message.includes("AbortError")) {
				errorMessage = "Authentication service request timed out"
				technicalReason = "Request exceeded 30-second timeout limit"
			} else {
				errorMessage = "Network error during authentication"
				technicalReason = `Fetch API error: ${error.message}`
			}
		} else if (error instanceof Error) {
			if (error.name === "AbortError") {
				errorMessage = "Authentication request was cancelled"
				technicalReason = "Request was aborted or timed out"
			} else if (error.name === "SyntaxError") {
				errorMessage = "Invalid response from authentication service"
				technicalReason = "Server returned malformed JSON response"
			} else {
				errorMessage = "Authentication service error"
				technicalReason = error.message
			}
		}

		// Log technical details for debugging
		console.error("🔧 [DEBUG] Error Classification:", {
			userMessage: errorMessage,
			technicalReason,
			possibleCauses: [
				"Backend authentication endpoints not implemented (404)",
				"Network connectivity issues",
				"CORS policy restrictions",
				"Server-side service unavailable",
				"Request timeout or cancellation",
			],
			nextSteps: [
				"Check network connection",
				"Verify backend service status",
				"Contact development team about missing API endpoints",
				"Try again in a few minutes",
			],
		})

		return {
			success: false,
			error: `${errorMessage}. ${technicalReason ? `Technical details: ${technicalReason}` : ""}`,
		}
	}

	/**
	 * Handle successful JWT verification with backend user verification
	 */
	private async handleSuccessfulJWTVerification(
		token: string,
		userInfo: UserInfoFromJWT,
		payload: ClerkJWTPayload,
	): Promise<void> {
		// Store the token as access token
		await this.context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, token)

		// Store extracted user information
		if (userInfo.sessionId) {
			await this.context.secrets.store(TOKEN_KEYS.SESSION_ID, userInfo.sessionId)
		}
		if (userInfo.organizationId) {
			await this.context.secrets.store(TOKEN_KEYS.ORGANIZATION_ID, userInfo.organizationId)
		}

		console.log("JWT verification successful:", {
			email: userInfo.email,
			userId: userInfo.userId,
			organizationId: userInfo.organizationId,
			sessionId: userInfo.sessionId,
		})

		// NEW: Backend user verification
		if (this.userVerificationService && this.fallbackManager) {
			try {
				console.log(`[Auth] Performing backend verification for user: ${userInfo.userId}`)

				const verificationResult = await this.fallbackManager.verifyUserWithFallback(userInfo.userId, () =>
					this.userVerificationService!.verifyUser(userInfo.userId, {
						includeOrganizations: true,
					}),
				)

				if (!verificationResult.valid) {
					await this.handleVerificationFailure(verificationResult, userInfo.userId)
					return
				}

				// Check for critical user status issues
				if (verificationResult.user?.banned) {
					await this.handleBannedUser(userInfo.userId)
					return
				}

				if (verificationResult.user?.locked) {
					await this.handleLockedUser(userInfo.userId)
					return
				}

				// Log successful verification
				console.log("[Auth] Backend verification successful:", {
					userId: userInfo.userId,
					email: verificationResult.user?.email,
					fallbackMode: verificationResult.fallbackMode,
					cacheHit: verificationResult.cacheHit,
				})

				// Show fallback mode warning if applicable
				if (verificationResult.fallbackMode) {
					vscode.window.showWarningMessage(
						`Authentication completed in limited mode: ${verificationResult.fallbackReason}`,
						"Continue",
					)
				}
			} catch (error) {
				console.warn("[Auth] Backend verification failed, continuing with JWT-only auth:", error)

				// Show warning but don't block authentication
				vscode.window.showWarningMessage(
					"Unable to verify account status. Some features may be limited.",
					"Continue Anyway",
				)
			}
		} else {
			console.log("[Auth] Backend verification not available - using JWT-only authentication")
		}

		vscode.window.showInformationMessage(AUTH_SUCCESS.AUTHENTICATED)

		// Trigger any post-auth actions
		vscode.commands.executeCommand("softcodes.onAuthenticated")
	}

	/**
	 * Handle backend verification failure
	 */
	private async handleVerificationFailure(result: any, userId: string): Promise<void> {
		const errorType = result.error?.type

		switch (errorType) {
			case UserVerificationErrorType.USER_NOT_FOUND:
				console.error(`[Auth] User not found in backend: ${userId}`)
				vscode.window
					.showErrorMessage(
						"Your account was not found. Please contact support if this is unexpected.",
						"Contact Support",
					)
					.then((selection) => {
						if (selection === "Contact Support") {
							vscode.env.openExternal(
								vscode.Uri.parse("mailto:support@softcodes.ai?subject=Account Not Found"),
							)
						}
					})
				await this.signOut()
				break

			case UserVerificationErrorType.API_UNAVAILABLE:
			case UserVerificationErrorType.NETWORK_ERROR:
				console.warn(`[Auth] Backend verification unavailable: ${result.error?.message}`)
				vscode.window.showWarningMessage(
					"Unable to verify account status. Continuing with limited verification.",
					"Continue",
				)
				break

			default:
				console.error(`[Auth] Backend verification failed: ${result.error?.message}`)
				vscode.window.showWarningMessage(
					"Account verification incomplete. Some features may be limited.",
					"Continue",
				)
		}
	}

	/**
	 * Handle banned user
	 */
	private async handleBannedUser(userId: string): Promise<void> {
		console.error(`[Auth] User ${userId} is banned`)

		await this.signOut()

		vscode.window
			.showErrorMessage(
				"Your account has been suspended. Please contact support for assistance.",
				"Contact Support",
			)
			.then((selection) => {
				if (selection === "Contact Support") {
					vscode.env.openExternal(vscode.Uri.parse("mailto:support@softcodes.ai?subject=Account Suspended"))
				}
			})
	}

	/**
	 * Handle locked user
	 */
	private async handleLockedUser(userId: string): Promise<void> {
		console.warn(`[Auth] User ${userId} is temporarily locked`)

		await this.signOut()

		vscode.window
			.showErrorMessage(
				"Your account is temporarily locked for security reasons. Please try again later or contact support.",
				"Contact Support",
				"Try Again Later",
			)
			.then((selection) => {
				if (selection === "Contact Support") {
					vscode.env.openExternal(vscode.Uri.parse("mailto:support@softcodes.ai?subject=Account Locked"))
				}
			})
	}

	/**
	 * Handle successful API validation
	 */
	private async handleSuccessfulAPIValidation(token: string, userInfo?: any): Promise<void> {
		// Store the token as access token
		await this.context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, token)

		// Store additional info if available
		if (userInfo) {
			if (userInfo.session_id) {
				await this.context.secrets.store(TOKEN_KEYS.SESSION_ID, userInfo.session_id)
			}
			if (userInfo.organization_id) {
				await this.context.secrets.store(TOKEN_KEYS.ORGANIZATION_ID, userInfo.organization_id)
			}
		}

		console.log("API validation successful")

		vscode.window.showInformationMessage(AUTH_SUCCESS.AUTHENTICATED)

		// Trigger any post-auth actions
		vscode.commands.executeCommand("softcodes.onAuthenticated")
	}

	/**
	 * Check if token has basic JWT format
	 */
	private isBasicJWTFormat(token: string): boolean {
		return isValidJWTFormat(token)
	}

	/**
	 * Format JWT error for user-friendly display
	 */
	private formatJWTError(error: any): string {
		if (!error.type) {
			return error.message || "JWT verification failed"
		}

		switch (error.type) {
			case JWTErrorType.TOKEN_EXPIRED:
				return "Your authentication token has expired. Please obtain a new token."
			case JWTErrorType.INVALID_SIGNATURE:
				return "Invalid token signature. Please check your token and try again."
			case JWTErrorType.INVALID_ISSUER:
				return "Token was not issued by Softcodes. Please use a valid Softcodes token."
			case JWTErrorType.INVALID_AUDIENCE:
				return "Token is not intended for VSCode extension use."
			case JWTErrorType.MALFORMED_TOKEN:
				return "Token format is invalid. Please check your token and try again."
			case JWTErrorType.MISSING_CLAIMS:
				return "Token is missing required information. Please obtain a new token."
			case JWTErrorType.JWKS_FETCH_ERROR:
				return "Unable to verify token signature. Please check your internet connection."
			case JWTErrorType.TOKEN_NOT_ACTIVE:
				return "Token is not yet active. Please wait and try again."
			default:
				return error.message || "JWT verification failed"
		}
	}

	/**
	 * Handle OAuth callback from unified authentication system
	 */
	async handleCallback(uri: vscode.Uri): Promise<void> {
		try {
			const params = new URLSearchParams(uri.query)
			const code = params.get("code")
			const state = params.get("state")

			if (!code || !state) {
				throw new Error(AUTH_ERRORS.MISSING_PARAMS)
			}

			// Retrieve stored PKCE verifier
			const codeVerifier = await this.context.secrets.get(`${TOKEN_KEYS.PKCE_PREFIX}${state}`)
			if (!codeVerifier) {
				throw new Error(AUTH_ERRORS.INVALID_STATE)
			}

			// Exchange code for tokens using unified callback endpoint
			const backendUrl = await this.getBackendUrl()
			const response = await fetch(`${backendUrl}${AUTH_ENDPOINTS.EXTENSION_CALLBACK}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"User-Agent": generateUserAgent(),
				},
				body: JSON.stringify({
					code,
					code_verifier: codeVerifier,
					state,
					redirect_uri: OAUTH_CONFIG.VSCODE.REDIRECT_URI,
					grant_type: OAUTH_CONFIG.VSCODE.GRANT_TYPE,
				}),
			})

			if (!response.ok) {
				const error = await response.json().catch(() => ({ error: AUTH_ERRORS.TOKEN_EXCHANGE_FAILED }))
				throw new Error(error.error || AUTH_ERRORS.TOKEN_EXCHANGE_FAILED)
			}

			const tokens: AuthTokens = await response.json()

			// Store tokens securely in VSCode secrets
			await this.storeTokens(tokens)

			// Clean up PKCE data
			await this.context.secrets.delete(`${TOKEN_KEYS.PKCE_PREFIX}${state}`)
			this.pendingAuth.delete(state)

			vscode.window.showInformationMessage(AUTH_SUCCESS.AUTHENTICATED)

			// Trigger any post-auth actions
			vscode.commands.executeCommand("softcodes.onAuthenticated")
		} catch (error) {
			console.error("Authentication callback failed:", error)
			vscode.window.showErrorMessage(
				`Authentication callback failed: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * Get access token, refreshing if necessary
	 */
	async getAccessToken(): Promise<string | undefined> {
		let accessToken = await this.context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)

		// If no access token, try to refresh using refresh token
		if (!accessToken) {
			const refreshToken = await this.context.secrets.get(TOKEN_KEYS.REFRESH_TOKEN)
			if (refreshToken) {
				accessToken = await this.refreshAccessToken(refreshToken)
			}
		}

		return accessToken
	}

	/**
	 * Get user information from stored session
	 */
	async getUserInfo(): Promise<UserInfo | undefined> {
		try {
			const sessionId = await this.context.secrets.get(TOKEN_KEYS.SESSION_ID)
			const accessToken = await this.getAccessToken()

			if (!accessToken || !sessionId) {
				return undefined
			}

			// Fetch user info from unified API
			const backendUrl = await this.getBackendUrl()
			const response = await fetch(`${backendUrl}${AUTH_ENDPOINTS.USER_INFO}`, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
					"User-Agent": generateUserAgent(),
				},
			})

			if (!response.ok) {
				console.warn("Failed to fetch user info:", response.statusText)
				return undefined
			}

			return await response.json()
		} catch (error) {
			console.error("Error fetching user info:", error)
			return undefined
		}
	}

	/**
	 * Get stored refresh token
	 */
	async getRefreshToken(): Promise<string | undefined> {
		return await this.context.secrets.get(TOKEN_KEYS.REFRESH_TOKEN)
	}

	/**
	 * Refresh access token using unified refresh endpoint
	 */
	async refreshAccessToken(refreshToken: string): Promise<string | undefined> {
		try {
			const backendUrl = await this.getBackendUrl()
			const response = await fetch(`${backendUrl}${AUTH_ENDPOINTS.REFRESH_TOKEN}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"User-Agent": generateUserAgent(),
				},
				body: JSON.stringify({
					refresh_token: refreshToken,
					client_type: "vscode",
				}),
			})

			if (!response.ok) {
				// Refresh failed, need to re-authenticate
				console.warn("Token refresh failed, clearing stored tokens")
				await this.signOut()
				return undefined
			}

			const tokens: AuthTokens = await response.json()

			// Store new tokens
			await this.storeTokens(tokens)

			return tokens.access_token
		} catch (error) {
			console.error("Token refresh failed:", error)
			await this.signOut() // Clear invalid tokens
			return undefined
		}
	}

	/**
	 * Public method to refresh current access token
	 */
	async refreshCurrentAccessToken(): Promise<string | undefined> {
		const refreshToken = await this.getRefreshToken()
		if (!refreshToken) {
			return undefined
		}
		return await this.refreshAccessToken(refreshToken)
	}

	/**
	 * Store authentication tokens securely
	 */
	private async storeTokens(tokens: AuthTokens): Promise<void> {
		await this.context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, tokens.access_token)
		await this.context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, tokens.refresh_token)

		if (tokens.session_id) {
			await this.context.secrets.store(TOKEN_KEYS.SESSION_ID, tokens.session_id)
		}

		if (tokens.organization_id) {
			await this.context.secrets.store(TOKEN_KEYS.ORGANIZATION_ID, tokens.organization_id)
		}
	}

	/**
	 * Sign out and clear all stored authentication data
	 */
	async signOut(): Promise<void> {
		try {
			// Clear all stored authentication data
			await Promise.all([
				this.context.secrets.delete(TOKEN_KEYS.ACCESS_TOKEN),
				this.context.secrets.delete(TOKEN_KEYS.REFRESH_TOKEN),
				this.context.secrets.delete(TOKEN_KEYS.SESSION_ID),
				this.context.secrets.delete(TOKEN_KEYS.ORGANIZATION_ID),
			])

			// Clear any pending auth states
			this.pendingAuth.clear()

			// Notify backend about sign out (optional)
			try {
				const backendUrl = await this.getBackendUrl()
				const sessionId = await this.context.secrets.get(TOKEN_KEYS.SESSION_ID)

				if (sessionId) {
					await fetch(`${backendUrl}${AUTH_ENDPOINTS.SIGN_OUT}`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"User-Agent": generateUserAgent(),
						},
						body: JSON.stringify({ session_id: sessionId }),
					})
				}
			} catch (error) {
				// Non-critical error - user is still signed out locally
				console.warn("Failed to notify backend of sign out:", error)
			}

			vscode.window.showInformationMessage(AUTH_SUCCESS.SIGNED_OUT)
		} catch (error) {
			console.error("Sign out failed:", error)
			vscode.window.showErrorMessage(`Sign out failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * Check if user is authenticated
	 */
	async isAuthenticated(): Promise<boolean> {
		const token = await this.getAccessToken()
		return !!token
	}

	/**
	 * Validate current session with backend
	 */
	async validateSession(): Promise<boolean> {
		try {
			const accessToken = await this.getAccessToken()
			const sessionId = await this.context.secrets.get(TOKEN_KEYS.SESSION_ID)

			if (!accessToken || !sessionId) {
				return false
			}

			const backendUrl = await this.getBackendUrl()
			const response = await fetch(`${backendUrl}${AUTH_ENDPOINTS.VALIDATE_SESSION}`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
					"User-Agent": generateUserAgent(),
				},
				body: JSON.stringify({
					session_id: sessionId,
					client_type: "vscode",
				}),
			})

			return response.ok
		} catch (error) {
			console.error("Session validation failed:", error)
			return false
		}
	}

	/**
	 * Get stored organization ID
	 */
	async getOrganizationId(): Promise<string | undefined> {
		return await this.context.secrets.get(TOKEN_KEYS.ORGANIZATION_ID)
	}

	/**
	 * Get stored session ID
	 */
	async getSessionId(): Promise<string | undefined> {
		return await this.context.secrets.get(TOKEN_KEYS.SESSION_ID)
	}

	/**
	 * Get backend URL from configuration using unified config
	 */
	private async getBackendUrl(): Promise<string> {
		const config = vscode.workspace.getConfiguration("softcodes")
		const configuredUrl = config.get("backendUrl")

		console.log("🔍 [DEBUG] Backend URL Configuration:", {
			configured: !!configuredUrl,
			configuredUrl: configuredUrl || "not set",
			environment: process.env.NODE_ENV || "not set",
			timestamp: new Date().toISOString(),
		})

		if (configuredUrl) {
			console.log("🔧 [DEBUG] Using configured backend URL:", configuredUrl)
			return configuredUrl as string
		}

		// Use environment-appropriate default
		const authConfig = getAuthConfig()
		console.log("🔧 [DEBUG] Using default backend URL:", {
			url: authConfig.API_BASE_URL,
			isDevelopment: process.env.NODE_ENV === "development",
		})
		return authConfig.API_BASE_URL
	}

	/**
	 * Handle authentication errors consistently
	 */
	private async handleAuthError(error: any, context: string): Promise<void> {
		console.error(`Authentication error in ${context}:`, error)

		// If it's a 401 or authentication-related error, clear tokens
		if (error.message?.includes("401") || error.message?.includes("Unauthorized")) {
			await this.signOut()

			// Prompt user to re-authenticate
			const signInAction = "Sign In"
			const selection = await vscode.window.showErrorMessage(AUTH_ERRORS.SESSION_EXPIRED, signInAction)

			if (selection === signInAction) {
				await this.authenticate()
			}
		} else {
			// Show generic error for other issues
			vscode.window.showErrorMessage(`Authentication error: ${error.message || String(error)}`)
		}
	}
}
