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
	validateSupabaseConfig,
	validateAuthConfig,
	validateAndEncodeURI,
	encodeWorkspacePath,
} from "./config"
import { JWTVerificationService } from "./jwtVerification"
import { JWTErrorType, UserInfoFromJWT, ClerkJWTPayload } from "./jwtTypes"
import { parseJWTUnsafe, extractUserInfoFromPayload, isValidJWTFormat } from "./jwtUtils"
import { ClerkBackendService } from "./clerkBackendService"
import { UserVerificationService, MemoryCache } from "./userVerificationService"
import { GracefulDegradationManager } from "./fallbackHandler"
import { UserVerificationErrorType } from "./userVerificationTypes"
import { verifyJWTUserInSupabase, SupabaseVerificationResult } from "./supabaseUserVerification"
import { ContextProxy } from "../core/config/ContextProxy"

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
 * Enhanced authentication state
 */
export interface AuthenticationState {
	isAuthenticated: boolean
	isConnected: boolean // JWT valid AND user exists in Supabase
	signedOut?: boolean
	clerkId?: string
	supabaseVerified?: boolean
	supabaseUserData?: any
	clerkFallbackData?: any // Fallback Clerk data when Supabase fails
	error?: string
}

/**
 * Extended user information with Supabase data
 */
export interface ExtendedUserInfo extends UserInfo {
	clerkId: string
	planType?: string
	credits?: number
	isOrganization?: boolean
	orgId?: string
	stripeCustomerId?: string
	createdAt?: string
	updatedAt?: string
	avatarUrl?: string
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
	private authenticationState: AuthenticationState = {
		isAuthenticated: false,
		isConnected: false,
		signedOut: false,
	}
	private signedOut = false
	private tokenRefreshPromise: Promise<string | undefined> | null = null
	private tokenRefreshInProgress = false
	private stateChangeCallback?: (authState: AuthenticationState) => void

	constructor(context: vscode.ExtensionContext) {
		this.context = context
		this.initializeBackendVerification()
	}

	/**
	 * Initialize backend verification services
	 */
	private async initializeBackendVerification(): Promise<void> {
		try {
			// Feature gate: allow disabling Clerk backend verification to avoid 401 spam when Supabase is authoritative
			const cfg = vscode.workspace.getConfiguration("softcodes")
			const enableClerkBackend = cfg.get<boolean>("auth.enableClerkBackend", false)
			if (!enableClerkBackend) {
				console.log(
					"[Auth] Clerk backend verification disabled by configuration (softcodes.auth.enableClerkBackend=false)",
				)
				return
			}

			// Validate complete authentication configuration (Clerk + Supabase)
			const authValidation = validateAuthConfig()

			if (!authValidation.valid) {
				console.warn("[Auth] Authentication configuration incomplete:", {
					clerkValid: authValidation.clerkConfig.valid,
					supabaseValid: authValidation.supabaseConfig.valid,
					errors: authValidation.overallErrors,
					warnings: authValidation.overallWarnings,
				})

				// Continue with limited functionality if only some services are available
				if (!authValidation.clerkConfig.valid) {
					console.warn("[Auth] Clerk configuration missing - OAuth flows disabled")
				}
				if (!authValidation.supabaseConfig.valid) {
					console.warn("[Auth] Supabase configuration missing - user verification limited")
				}
			} else {
				console.log("[Auth] Complete authentication configuration validated successfully")
			}

			// Show warnings to user if there are configuration issues
			if (authValidation.overallWarnings.length > 0) {
				console.warn("[Auth] Configuration warnings:", authValidation.overallWarnings)
			}

			// Validate Clerk configuration for backend services
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

			// Build redirect URI - using unified scheme with proper validation
			const redirectUri = OAUTH_CONFIG.VSCODE.REDIRECT_URI

			// Validate and encode redirect URI for security
			const uriValidation = validateAndEncodeURI(redirectUri)
			if (!uriValidation.isValid) {
				throw new Error(`Invalid redirect URI configuration: ${uriValidation.error}`)
			}

			const validatedRedirectUri = uriValidation.encodedUri || redirectUri
			if (!isValidRedirectUri(validatedRedirectUri)) {
				throw new Error("Redirect URI failed security validation")
			}

			// Call unified backend initiation endpoint with proper encoding
			const backendUrl = await this.getBackendUrl()
			const authUrl = buildAuthUrl(backendUrl, {
				redirect_uri: validatedRedirectUri,
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
	async signinWithToken(): Promise<boolean> {
		try {
			// FIRST: Clear any expired tokens before prompting for new one
			await this.clearExpiredTokens()

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
					// Check if token is expired before proceeding
					try {
						const parseResult = parseJWTUnsafe(value.trim())
						if (parseResult.success && parseResult.parts?.payload.exp) {
							const expirationTime = parseResult.parts.payload.exp * 1000
							const currentTime = Date.now()
							if (expirationTime <= currentTime) {
								return "This token has already expired. Please generate a new token."
							}
						}
					} catch (error) {
						// If we can't parse the token, let the main validation handle it
					}
					return null
				},
			})

			if (!token) {
				// User cancelled the input
				return false
			}

			const trimmedToken = token.trim()

			// SECOND: Before processing, clear any existing tokens to prevent conflicts
			console.log("🧹 [AUTH-SERVICE] Clearing existing tokens before storing new one...")
			await this.clearStoredTokens()

			// LOGGING: Track signedOut state before reset
			console.log("🔍 [AUTH-LOG] signedOut state before explicit reset:", this.signedOut)

			// FIX: Explicitly reset signedOut flag after clearing tokens to ensure fresh authentication state
			console.log("🔄 [AUTH-FIX] Explicitly resetting signedOut flag to false for new authentication attempt")
			this.signedOut = false
			// Immediately persist the reset state
			await this.updateAuthenticationState({
				isAuthenticated: false,
				isConnected: false,
				signedOut: false,
			})

			// LOGGING: Track signedOut state after reset
			console.log("🔍 [AUTH-LOG] signedOut state after explicit reset:", this.signedOut)

			console.log(`🔧 [AUTH-SERVICE] Using JWT System: ${JWT_SYSTEM_VERSION}`)
			console.log("🔧 [AUTH-SERVICE] Import verification - parseJWTUnsafe:", typeof parseJWTUnsafe)
			console.log(
				"🔧 [AUTH-SERVICE] Import verification - extractUserInfoFromPayload:",
				typeof extractUserInfoFromPayload,
			)

			// Step 1: Try JWT verification first
			console.log("🔍 [DEBUG] Attempting JWT verification with signature check...")
			console.log("🔍 [AUTH-LOG] signedOut state before JWT verification:", this.signedOut)
			const jwtResult = await this.verifyJWTToken(trimmedToken)

			if (jwtResult.success) {
				console.log("✅ [DEBUG] JWT verification successful, storing token and user data")
				console.log("🔍 [AUTH-LOG] signedOut state before handleSuccessfulJWTVerification:", this.signedOut)
				await this.handleSuccessfulJWTVerification(trimmedToken, jwtResult.userInfo!, jwtResult.payload!)
				console.log("🔍 [AUTH-LOG] signedOut state after handleSuccessfulJWTVerification:", this.signedOut)
				return true
			}

			// Step 1.5: If JWT verification fails, try structure-only validation
			console.log("❌ [DEBUG] JWT signature verification failed, testing token structure...")
			console.log("🔍 [AUTH-LOG] signedOut state before structure validation:", this.signedOut)
			const structureResult = await this.testTokenStructure(trimmedToken)

			if (structureResult.valid) {
				console.log("✅ [DEBUG] Token structure is valid, proceeding with fallback token storage...")
				console.log("🔍 [AUTH-LOG] signedOut state before handleFallbackTokenStorage:", this.signedOut)
				await this.handleFallbackTokenStorage(trimmedToken)
				console.log("🔍 [AUTH-LOG] signedOut state after handleFallbackTokenStorage:", this.signedOut)
				return true
			}

			// Step 2: Check if we're in development mode first
			const config = vscode.workspace.getConfiguration("softcodes")
			const skipAPIValidation = config.get("auth.skipAPIValidation", false)

			if (skipAPIValidation) {
				console.log("⚡ [DEBUG] Development mode enabled, using fallback authentication")
				console.log("🔍 [AUTH-LOG] signedOut state before dev mode fallback:", this.signedOut)
				await this.handleFallbackTokenStorage(trimmedToken)
				console.log("🔍 [AUTH-LOG] signedOut state after dev mode fallback:", this.signedOut)
				return true
			}

			// Step 3: Attempt API validation
			console.log("JWT verification failed, attempting API validation...")
			console.log("🔍 [AUTH-LOG] signedOut state before API validation:", this.signedOut)
			const apiResult = await this.validateTokenWithAPI(trimmedToken)

			if (apiResult.success) {
				console.log("API validation successful, storing token")
				console.log("🔍 [AUTH-LOG] signedOut state before handleSuccessfulAPIValidation:", this.signedOut)
				await this.handleSuccessfulAPIValidation(trimmedToken, apiResult.userInfo)
				console.log("🔍 [AUTH-LOG] signedOut state after handleSuccessfulAPIValidation:", this.signedOut)
				return true
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
					console.log("🔍 [AUTH-LOG] signedOut state before bypass fallback:", this.signedOut)
					await this.handleFallbackTokenStorage(trimmedToken)
					console.log("🔍 [AUTH-LOG] signedOut state after bypass fallback:", this.signedOut)
					return true
				} else if (bypassChoice?.title === "⚙️ Enable Offline Mode") {
					await this.enableDevelopmentMode()
					console.log("🔍 [AUTH-LOG] signedOut state before offline fallback:", this.signedOut)
					await this.handleFallbackTokenStorage(trimmedToken)
					console.log("🔍 [AUTH-LOG] signedOut state after offline fallback:", this.signedOut)
					return true
				} else {
					vscode.window.showInformationMessage("Authentication cancelled. You can try again anytime!")
					return false
				}
			}

			// Both methods failed for other reasons - provide helpful guidance
			await this.handleAuthenticationFailure(jwtResult.error, apiResult.error)
			return false
		} catch (error) {
			console.error("Manual token authentication failed:", error)
			vscode.window.showErrorMessage(
				`Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
			)
			return false
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
	 * Verify user in Supabase database using clerk_id from JWT
	 */
	private async verifyUserInSupabase(token: string): Promise<AuthenticationState> {
		console.log("🔍 [SUPABASE-AUTH] Starting Supabase user verification...")

		try {
			// First, extract Clerk/JWT data as fallback
			const parseResult = parseJWTUnsafe(token)
			let clerkData: any = null
			if (parseResult.success && parseResult.parts?.payload) {
				const payload = parseResult.parts.payload
				clerkData = {
					clerkId: payload.sub,
					email: payload.email,
					firstName: payload.first_name,
					lastName: payload.last_name,
					avatarUrl: payload.picture || payload.avatar_url,
					name: payload.name,
				}
				console.log("📊 [SUPABASE-AUTH] Extracted Clerk fallback data:", {
					clerkId: clerkData.clerkId,
					email: clerkData.email,
					hasName: !!clerkData.name,
					hasAvatar: !!clerkData.avatarUrl,
				})
			}

			// Verify JWT user exists in Supabase
			const supabaseResult = await verifyJWTUserInSupabase(token)

			console.log("📊 [SUPABASE-AUTH] Supabase verification result:", {
				success: supabaseResult.success,
				userExists: supabaseResult.userExistsInSupabase,
				hasUserDetails: !!supabaseResult.userDetails,
				userIdExtracted: !!supabaseResult.userIdExtracted,
				error: supabaseResult.error,
			})

			if (supabaseResult.success && supabaseResult.userExistsInSupabase && supabaseResult.userDetails) {
				// User exists in Supabase - full verification successful
				console.log("✅ [SUPABASE-AUTH] User verified in Supabase database", {
					userId: supabaseResult.userIdExtracted,
					email: supabaseResult.userDetails.email,
					planType: supabaseResult.userDetails.plan_type,
					credits: supabaseResult.userDetails.credits,
					created_at: supabaseResult.userDetails.created_at,
				})

				return {
					isAuthenticated: true,
					isConnected: true,
					signedOut: false, // FIX: Explicitly set signedOut to false for successful verification
					clerkId: supabaseResult.userIdExtracted,
					supabaseVerified: true,
					supabaseUserData: supabaseResult.userDetails,
				}
			} else if (supabaseResult.success && !supabaseResult.userExistsInSupabase) {
				// JWT is valid but user doesn't exist in Supabase - fallback to Clerk data
				console.warn(
					"⚠️ [SUPABASE-AUTH] Valid JWT but user not found in Supabase database - using Clerk fallback",
					{
						userId: supabaseResult.userIdExtracted,
						clerkId: clerkData?.clerkId,
						timestamp: new Date().toISOString(),
						recommendation: "Check if Clerk webhook has synced user to Supabase",
					},
				)

				return {
					isAuthenticated: true,
					isConnected: false,
					signedOut: false, // FIX: Explicitly set signedOut to false for authenticated fallback
					clerkId: clerkData?.clerkId || supabaseResult.userIdExtracted,
					supabaseVerified: false,
					supabaseUserData: null,
					error: "User not found in Supabase database - using Clerk data",
					clerkFallbackData: clerkData,
				}
			} else {
				// Supabase verification failed - fallback to Clerk data
				console.warn("⚠️ [SUPABASE-AUTH] Supabase verification failed - falling back to Clerk JWT data", {
					userId: supabaseResult.userIdExtracted,
					error: supabaseResult.error,
					clerkId: clerkData?.clerkId,
					timestamp: new Date().toISOString(),
				})

				return {
					isAuthenticated: true,
					isConnected: false,
					signedOut: false, // FIX: Explicitly set signedOut to false for authenticated fallback
					clerkId: clerkData?.clerkId || supabaseResult.userIdExtracted,
					supabaseVerified: false,
					supabaseUserData: null,
					error: `Supabase verification failed: ${supabaseResult.error || "Unknown error"} - using Clerk fallback data`,
					clerkFallbackData: clerkData,
				}
			}
		} catch (error) {
			console.error("❌ [SUPABASE-AUTH] Supabase verification exception - falling back to Clerk JWT data", error)

			// Extract Clerk data as fallback even on exception
			const parseResult = parseJWTUnsafe(token)
			const clerkData =
				parseResult.success && parseResult.parts?.payload
					? {
							clerkId: parseResult.parts.payload.sub,
							email: parseResult.parts.payload.email,
							firstName: parseResult.parts.payload.first_name,
							lastName: parseResult.parts.payload.last_name,
							avatarUrl: parseResult.parts.payload.picture || parseResult.parts.payload.avatar_url,
							name: parseResult.parts.payload.name,
						}
					: null

			return {
				isAuthenticated: true,
				isConnected: false,
				signedOut: false, // FIX: Explicitly set signedOut to false even on exception fallback
				clerkId: clerkData?.clerkId,
				supabaseVerified: false,
				supabaseUserData: null,
				error: `Supabase verification exception: ${error instanceof Error ? error.message : String(error)} - using Clerk fallback data`,
				clerkFallbackData: clerkData,
			}
		}
	}

	/**
	 * Fallback token storage when both JWT and API validation fail
	 * Now enhanced with Supabase verification
	 */
	private async handleFallbackTokenStorage(token: string): Promise<void> {
		console.log("🔄 [DEBUG] Using fallback token storage mode with Supabase verification")

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

			// NEW: Perform Supabase verification
			console.log("🔍 [FALLBACK-MODE] Performing Supabase user verification...")
			const authState = await this.verifyUserInSupabase(token)

			// Store the token and any extracted info
			console.log("🔐 [FALLBACK-STORAGE] Storing access token...")
			await this.context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, token)
			console.log("✅ [FALLBACK-STORAGE] Access token stored")

			console.log("🔐 [FALLBACK-STORAGE] Storing session ID...")
			await this.context.secrets.store(TOKEN_KEYS.SESSION_ID, userInfo?.sessionId || "fallback-session")
			console.log("✅ [FALLBACK-STORAGE] Session ID stored")

			if (userInfo?.organizationId) {
				console.log("🔐 [FALLBACK-STORAGE] Storing organization ID...")
				await this.context.secrets.store(TOKEN_KEYS.ORGANIZATION_ID, userInfo.organizationId)
				console.log("✅ [FALLBACK-STORAGE] Organization ID stored")
			}

			// Sync JWT token to legacy kilocodeToken field for ProfileView compatibility
			try {
				const contextProxy = ContextProxy.instance
				await contextProxy.setProviderSettings({
					...contextProxy.getProviderSettings(),
					kilocodeToken: token,
				})
				console.log("✅ [FALLBACK-MODE] JWT token synced to kilocodeToken field")
			} catch (error) {
				console.warn("⚠️ [FALLBACK-MODE] Failed to sync JWT to kilocodeToken:", error)
			}

			// Update and persist authentication state
			await this.updateAuthenticationState(authState)

			console.log("✅ [DEBUG] Token stored in fallback mode with Supabase verification")

			// Show appropriate success message based on connection status
			if (authState.isConnected) {
				const welcomeName =
					authState.supabaseUserData?.first_name || userInfo?.firstName || userInfo?.email || "User"
				vscode.window.showInformationMessage(`Welcome back, ${welcomeName}! You are now connected.`)
			} else if (authState.isAuthenticated) {
				vscode.window.showWarningMessage(
					"Authentication successful, but your account needs to be set up in our system. Some features may be limited.",
				)
			}

			// Trigger any post-auth actions
			vscode.commands.executeCommand("softcodes.onAuthenticated")

			// Force immediate webview state refresh after successful authentication
			setTimeout(() => {
				vscode.commands.executeCommand("softcodes.refreshAuthState")
			}, 100)
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

			// Properly encode the URL components
			const encodedBackendUrl = encodeURI(backendUrl)
			requestUrl = `${encodedBackendUrl}${AUTH_ENDPOINTS.VALIDATE_SESSION}`

			// Get workspace path for context (properly encoded)
			let workspaceInfo = {}
			try {
				const vscode = require("vscode")
				if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
					const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath
					workspaceInfo = {
						workspace_path: encodeWorkspacePath(workspacePath),
						workspace_name: encodeURIComponent(vscode.workspace.workspaceFolders[0].name || "unknown"),
					}
				}
			} catch (error) {
				console.warn("Could not get workspace info:", error)
			}

			requestHeaders = {
				Authorization: `Bearer ${token.substring(0, 20)}...`, // Only log first 20 chars for security
				"Content-Type": "application/json",
				"User-Agent": generateUserAgent(),
			}
			requestBody = JSON.stringify({
				client_type: "vscode",
				...workspaceInfo,
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
					Authorization: `Bearer ${token.substring(0, 20)}...`, // Only log first 20 chars for security
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
						Authorization: `Bearer ${token.substring(0, 20)}...`, // Only log first 20 chars for security
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
	 * Handle successful JWT verification with Supabase user verification
	 */
	private async handleSuccessfulJWTVerification(
		token: string,
		userInfo: UserInfoFromJWT,
		payload: ClerkJWTPayload,
	): Promise<void> {
		console.log("🔐 [JWT-VERIFICATION] Starting token storage after successful JWT verification...")
		console.log("🔐 [JWT-VERIFICATION] Token length:", token.length)
		console.log("🔐 [JWT-VERIFICATION] User info:", {
			email: userInfo.email,
			userId: userInfo.userId,
			hasSessionId: !!userInfo.sessionId,
			hasOrgId: !!userInfo.organizationId,
		})

		// Store the token as access token
		await this.context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, token)
		console.log("✅ [JWT-VERIFICATION] Access token stored")

		// Store extracted user information
		if (userInfo.sessionId) {
			await this.context.secrets.store(TOKEN_KEYS.SESSION_ID, userInfo.sessionId)
			console.log("✅ [JWT-VERIFICATION] Session ID stored")
		}
		if (userInfo.organizationId) {
			await this.context.secrets.store(TOKEN_KEYS.ORGANIZATION_ID, userInfo.organizationId)
			console.log("✅ [JWT-VERIFICATION] Organization ID stored")
		}

		console.log("JWT verification successful:", {
			email: userInfo.email,
			userId: userInfo.userId,
			organizationId: userInfo.organizationId,
			sessionId: userInfo.sessionId,
		})

		// NEW: Supabase user verification
		console.log(`[Auth] Performing Supabase verification for user: ${userInfo.userId}`)
		const authState = await this.verifyUserInSupabase(token)

		// Sync JWT token to legacy kilocodeToken field for ProfileView compatibility
		try {
			const contextProxy = ContextProxy.instance
			await contextProxy.setProviderSettings({
				...contextProxy.getProviderSettings(),
				kilocodeToken: token,
			})
			console.log("✅ [AUTH-SERVICE] JWT token synced to kilocodeToken field")
		} catch (error) {
			console.warn("⚠️ [AUTH-SERVICE] Failed to sync JWT to kilocodeToken:", error)
		}

		// Update and persist authentication state
		await this.updateAuthenticationState(authState)

		// Handle verification results
		if (authState.isConnected) {
			console.log("✅ [Auth] User is fully connected (JWT + Supabase verified)")

			const userData = authState.supabaseUserData
			const welcomeName = userData?.first_name || userInfo.firstName || userInfo.email || "User"

			vscode.window.showInformationMessage(`You are connected to Softcodes !`)

			// Important: Skip any Clerk backend verification when Supabase connection is established
			console.log("[Auth] Skipping Clerk backend verification because Supabase connection is established")
			return
		} else if (authState.isAuthenticated && !authState.supabaseVerified) {
			console.warn("⚠️ [Auth] JWT valid but user not found in Supabase")

			// Handle user not found in Supabase scenario
			await this.handleUserNotFoundInSupabase(userInfo.userId, userInfo.email)
			return
		} else {
			console.error("❌ [Auth] Authentication verification failed")
			vscode.window.showErrorMessage(`Authentication verification failed: ${authState.error}`)
			return
		}

		// Legacy: Backend user verification for additional checks
		// Only perform Clerk backend verification if explicitly forced OR Supabase connection not established.
		const forceBackendVerification = vscode.workspace
			.getConfiguration("softcodes")
			.get("auth.forceBackendVerification", false)

		if (
			this.userVerificationService &&
			this.fallbackManager &&
			(forceBackendVerification || !authState.isConnected)
		) {
			try {
				console.log(`[Auth] Performing additional backend verification for user: ${userInfo.userId}`)

				// Narrow possibly undefined properties to local non-null vars for TypeScript
				const fm = this.fallbackManager as GracefulDegradationManager
				const uvs = this.userVerificationService as UserVerificationService

				const verificationResult = await fm.verifyUserWithFallback(userInfo.userId, () =>
					uvs.verifyUser(userInfo.userId, {
						includeOrganizations: true,
					}),
				)

				if (!verificationResult.valid) {
					console.warn("[Auth] Backend verification failed, but Supabase verification succeeded")
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
			} catch (error) {
				console.warn("[Auth] Backend verification failed, continuing with Supabase verification:", error)
			}
		} else {
			console.log(
				"[Auth] Skipping Clerk backend verification (either Supabase connected or not forced by configuration)",
			)
		}

		// Trigger any post-auth actions
		vscode.commands.executeCommand("softcodes.onAuthenticated")

		// Force immediate webview state refresh after successful authentication
		setTimeout(() => {
			vscode.commands.executeCommand("softcodes.refreshAuthState")
		}, 100)
	}

	/**
	 * Handle user not found in Supabase scenario
	 */
	private async handleUserNotFoundInSupabase(clerkId: string, email: string): Promise<void> {
		console.warn(`[Auth] User ${clerkId} (${email}) not found in Supabase database`)

		const choice = await vscode.window.showWarningMessage(
			"Your account is not set up in our system yet. Would you like to complete your registration?",
			"Complete Setup",
			"Continue Limited",
			"Contact Support",
		)

		switch (choice) {
			case "Complete Setup":
				// Open registration/setup URL
				vscode.env.openExternal(vscode.Uri.parse("https://softcodes.ai/setup"))
				break
			case "Continue Limited":
				// Allow limited access
				const limitedState = {
					isAuthenticated: true,
					isConnected: false,
					clerkId,
					supabaseVerified: false,
					error: "User not found in Supabase - limited access",
				}
				await this.updateAuthenticationState(limitedState)
				vscode.window.showInformationMessage(
					"Continuing with limited access. Some features may not be available.",
				)
				vscode.commands.executeCommand("softcodes.onAuthenticated")
				break
			case "Contact Support":
				vscode.env.openExternal(
					vscode.Uri.parse(
						"mailto:support@softcodes.ai?subject=Account Setup Issue&body=My account is not found in the system.",
					),
				)
				break
			default:
				// User dismissed the dialog
				await this.signOut()
				break
		}
	}

	/**
	 * Get current authentication state
	 * IMPORTANT: This method should NOT trigger token refresh or change state.
	 * It should only return the current stored state.
	 */
	async getAuthenticationState(): Promise<AuthenticationState> {
		try {
			console.log("🔍 [DEBUG] getAuthenticationState called - checking stored state...")

			// Try to get stored state first
			const storedStateStr = await this.context.secrets.get("auth_state")
			let baseState: Partial<AuthenticationState> = {
				isAuthenticated: false,
				isConnected: false,
			}

			if (storedStateStr) {
				try {
					const storedState = JSON.parse(storedStateStr)
					console.log("🔍 [DEBUG] getAuthenticationState - loaded stored state:", {
						isAuthenticated: storedState.isAuthenticated,
						isConnected: storedState.isConnected,
						signedOut: storedState.signedOut,
						hasError: !!storedState.error,
					})
					baseState = storedState
				} catch (parseError) {
					console.warn(
						"⚠️ [DEBUG] getAuthenticationState - failed to parse stored state, using defaults:",
						parseError,
					)
				}
			} else {
				console.log("🔍 [DEBUG] getAuthenticationState - no stored auth_state found")
			}

			// Check if we have any tokens at all (for legacy compatibility)
			const accessToken = await this.context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)
			if (accessToken && baseState.isAuthenticated === undefined) {
				console.log(
					"🔍 [DEBUG] getAuthenticationState - found access token but no stored state, setting basic authenticated",
				)
				baseState.isAuthenticated = true
				baseState.isConnected = false // We don't know the connection status without verification
			}

			// CRITICAL: Always include the instance's signedOut flag to handle race conditions
			const finalState: AuthenticationState = {
				isAuthenticated: baseState.isAuthenticated ?? false,
				isConnected: baseState.isConnected ?? false,
				signedOut: this.signedOut, // Always use instance's signedOut flag
				clerkId: baseState.clerkId,
				supabaseVerified: baseState.supabaseVerified,
				supabaseUserData: baseState.supabaseUserData,
				clerkFallbackData: baseState.clerkFallbackData,
				error: baseState.error,
			}

			console.log("🔍 [DEBUG] getAuthenticationState - final state after merging signedOut:", {
				isAuthenticated: finalState.isAuthenticated,
				isConnected: finalState.isConnected,
				signedOut: finalState.signedOut,
				hasError: !!finalState.error,
				instanceSignedOut: this.signedOut,
			})

			// Update local cache but DON'T store it here - let updateAuthenticationState handle persistence
			this.authenticationState = finalState

			return finalState
		} catch (error) {
			console.error("❌ [DEBUG] getAuthenticationState - error retrieving state:", error)
			return {
				isAuthenticated: false,
				isConnected: false,
				signedOut: this.signedOut, // Still include signedOut even on error
				error: "Failed to retrieve authentication state",
			}
		}
	}

	/**
	 * Update and persist authentication state
	 * This should be called whenever the authentication state changes
	 */
	private async updateAuthenticationState(state: AuthenticationState): Promise<void> {
		// LOGGING: Track incoming state and instance signedOut before update
		console.log("🔍 [AUTH-LOG] updateAuthenticationState called with state:", {
			isAuthenticated: state.isAuthenticated,
			isConnected: state.isConnected,
			signedOut: state.signedOut,
			instanceSignedOutBefore: this.signedOut,
		})

		// FIX: Always ensure signedOut is false when authenticating successfully, regardless of previous state
		if (state.isAuthenticated && state.signedOut !== false) {
			console.log("🔄 [AUTH-STATE-FIX] Forcing signedOut to false for successful authentication")
			state.signedOut = false
		}

		if (state.signedOut !== undefined) {
			this.signedOut = state.signedOut
		} else if (state.isAuthenticated) {
			this.signedOut = false
		}

		const updatedState = {
			...state,
			signedOut: this.signedOut,
		}

		this.authenticationState = updatedState
		try {
			await this.context.secrets.store("auth_state", JSON.stringify(updatedState))
			console.log("🔄 [AUTH-STATE] Updated authentication state:", {
				isAuthenticated: updatedState.isAuthenticated,
				isConnected: updatedState.isConnected,
				signedOut: updatedState.signedOut,
				hasClerkId: !!updatedState.clerkId,
				hasError: !!updatedState.error,
				timestamp: new Date().toISOString(),
				instanceSignedOutAfter: this.signedOut,
			})

			// Trigger callback to notify webview of state changes
			if (this.stateChangeCallback) {
				console.log("📡 [AUTH-STATE] Triggering state change callback")
				this.stateChangeCallback(updatedState)
			}
		} catch (error) {
			console.error("Failed to persist authentication state:", error)
		}
	}

	/**
	 * Set callback for authentication state changes
	 * This allows the webview to be notified immediately when auth state changes
	 */
	setStateChangeCallback(callback: (authState: AuthenticationState) => void): void {
		this.stateChangeCallback = callback
		console.log("📡 [AUTH-STATE] State change callback registered")
	}

	/**
	 * Get extended user information with Supabase data
	 */
	async getExtendedUserInfo(): Promise<ExtendedUserInfo | undefined> {
		try {
			const authState = await this.getAuthenticationState()

			// If connected to Supabase, return full data
			if (authState.isConnected && authState.supabaseUserData) {
				const userData = authState.supabaseUserData
				return {
					email: userData.email,
					firstName: userData.first_name,
					lastName: userData.last_name,
					organizationName: userData.organization_name || userData.organizationName,
					organizationId: userData.organization_id || userData.organizationId,
					clerkId: userData.clerk_id || authState.clerkId,
					planType: userData.plan_type,
					credits: userData.credits,
					isOrganization: userData.is_organization,
					orgId: userData.org_id,
					stripeCustomerId: userData.stripe_customer_id,
					createdAt: userData.created_at,
					updatedAt: userData.updated_at,
					avatarUrl: userData.avatar_url,
				}
			}

			// Fallback: if not connected but have Clerk data, return basic info
			if (authState.isAuthenticated && authState.clerkFallbackData) {
				const clerkData = authState.clerkFallbackData
				console.warn("⚠️ [EXTENDED-INFO] Returning Clerk fallback data (no Supabase connection)")
				return {
					email: clerkData.email,
					firstName: clerkData.firstName,
					lastName: clerkData.lastName,
					clerkId: clerkData.clerkId,
					planType: undefined, // No plan without Supabase
					credits: undefined, // No credits without Supabase
					avatarUrl: clerkData.avatarUrl,
					organizationName: undefined,
					organizationId: undefined,
					stripeCustomerId: undefined,
					createdAt: undefined,
					updatedAt: undefined,
				}
			}

			return undefined
		} catch (error) {
			console.error("Failed to get extended user info:", error)
			return undefined
		}
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

		// Sync JWT token to legacy kilocodeToken field for ProfileView compatibility
		try {
			const contextProxy = ContextProxy.instance
			await contextProxy.setProviderSettings({
				...contextProxy.getProviderSettings(),
				kilocodeToken: token,
			})
			console.log("✅ [API-VALIDATION] JWT token synced to kilocodeToken field")
		} catch (error) {
			console.warn("⚠️ [API-VALIDATION] Failed to sync JWT to kilocodeToken:", error)
		}

		console.log("API validation successful")

		// Update authentication state for API-based authentication
		const apiAuthState = {
			isAuthenticated: true,
			isConnected: true, // API validation means we're connected
			supabaseVerified: false, // API validation doesn't include Supabase verification
		}
		await this.updateAuthenticationState(apiAuthState)

		vscode.window.showInformationMessage(AUTH_SUCCESS.AUTHENTICATED)

		// Trigger any post-auth actions
		vscode.commands.executeCommand("softcodes.onAuthenticated")

		// Force immediate webview state refresh after successful authentication
		setTimeout(() => {
			vscode.commands.executeCommand("softcodes.refreshAuthState")
		}, 100)
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

			// Exchange code for tokens using unified callback endpoint with proper URI encoding
			const apiBaseUrl = vscode.workspace
				.getConfiguration("softcodes")
				.get<string>("apiBaseUrl", "https://yourapp.com")
			const redirectUri = OAUTH_CONFIG.VSCODE.REDIRECT_URI // Use consistent scheme

			// Validate and encode the API URL
			const urlValidation = validateAndEncodeURI(`${apiBaseUrl}/api/auth/complete-vscode-auth`)
			if (!urlValidation.isValid) {
				throw new Error(`Invalid API URL: ${urlValidation.error}`)
			}

			const response = await fetch(urlValidation.encodedUri!, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					code,
					code_verifier: codeVerifier,
					state,
					redirect_uri: redirectUri,
				}),
			})

			if (!response.ok) {
				const error = await response.json().catch(() => ({ error: AUTH_ERRORS.TOKEN_EXCHANGE_FAILED }))
				throw new Error(error.error || AUTH_ERRORS.TOKEN_EXCHANGE_FAILED)
			}

			const data = await response.json()
			if (data.success) {
				const tokens: AuthTokens = {
					access_token: data.access_token,
					refresh_token: data.refresh_token,
				}
				await this.storeTokens(tokens)
				// Store expiry
				this.context.globalState.update("token_expiry", Date.now() + data.expires_in * 1000)
				this.context.globalState.update("auth_in_progress", false)

				// Clean up PKCE data
				await this.context.secrets.delete("auth_state")
				await this.context.secrets.delete("code_verifier")
				this.pendingAuth.delete(state)

				vscode.window.showInformationMessage("Authentication successful!")

				// Trigger any post-auth actions
				vscode.commands.executeCommand("softcodes.onAuthenticated")
			} else {
				throw new Error("Token exchange failed")
			}
		} catch (error) {
			console.error("Authentication callback failed:", error)
			vscode.window.showErrorMessage(
				`Authentication callback failed: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * Get stored access token without refreshing
	 * IMPORTANT: This method should NOT trigger token refresh.
	 * Use ensureValidAccessToken() when you need a guaranteed valid token.
	 */
	async getAccessToken(): Promise<string | undefined> {
		console.log("🔍 [GET-ACCESS-TOKEN] Starting getAccessToken...")
		console.log("🔍 [GET-ACCESS-TOKEN] Attempting to retrieve token from secrets store...")

		const token = await this.context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)
		console.log("🔍 [GET-ACCESS-TOKEN] Retrieved token from secrets:", token ? "token present" : "undefined")

		if (token) {
			console.log("🔍 [GET-ACCESS-TOKEN] Token details:", {
				length: token.length,
				isJWT: token.includes("."),
				startsWith: token.substring(0, 15),
				endsWith: token.substring(token.length - 15),
				hasValidStructure: token.split(".").length === 3,
			})
		} else {
			console.log("🔍 [GET-ACCESS-TOKEN] No token found in secrets store")
			console.log("🔍 [GET-ACCESS-TOKEN] Checking other stored authentication data...")

			// Check if we have other auth-related data
			const refreshToken = await this.context.secrets.get(TOKEN_KEYS.REFRESH_TOKEN)
			const sessionId = await this.context.secrets.get(TOKEN_KEYS.SESSION_ID)
			const orgId = await this.context.secrets.get(TOKEN_KEYS.ORGANIZATION_ID)

			console.log("🔍 [GET-ACCESS-TOKEN] Other auth data status:", {
				hasRefreshToken: !!refreshToken,
				hasSessionId: !!sessionId,
				hasOrgId: !!orgId,
			})
		}

		// If we have a token, check if it's expired and clear it automatically
		if (token) {
			try {
				console.log("🔍 [GET-ACCESS-TOKEN] Token found, checking expiration...")
				const parseResult = parseJWTUnsafe(token)
				console.log("🔍 [GET-ACCESS-TOKEN] Parse result:", {
					success: parseResult.success,
					hasPayload: !!parseResult.parts?.payload,
					hasExp: !!parseResult.parts?.payload.exp,
				})

				if (parseResult.success && parseResult.parts?.payload.exp) {
					const expirationTime = parseResult.parts.payload.exp * 1000
					const currentTime = Date.now()
					const timeUntilExpiration = expirationTime - currentTime

					console.log("🔍 [GET-ACCESS-TOKEN] Expiration analysis:", {
						expirationTime: new Date(expirationTime).toISOString(),
						currentTime: new Date(currentTime).toISOString(),
						timeUntilExpiration: Math.floor(timeUntilExpiration / 1000) + "s",
						isExpired: expirationTime <= currentTime,
					})

					if (expirationTime <= currentTime) {
						console.log("⚠️ [TOKEN-STATUS] Found expired token in getAccessToken")
						console.log("⚠️ [TOKEN-STATUS] Token expired at:", new Date(expirationTime).toISOString())
						console.log("⚠️ [TOKEN-STATUS] Current time:", new Date(currentTime).toISOString())
						// Strict policy: do not return expired tokens to callers
						// Let higher-level ensureValidAccessToken handle refresh via refresh_token
						const hasRefreshToken = !!(await this.context.secrets.get(TOKEN_KEYS.REFRESH_TOKEN))
						if (hasRefreshToken) {
							console.log(
								"⏳ [TOKEN-STATUS] Expired token detected; refresh token is available. Returning undefined to trigger refresh flow.",
							)
						} else {
							console.log(
								"🚪 [TOKEN-STATUS] Expired token and no refresh token available. Returning undefined to prompt re-auth.",
							)
						}
						return undefined
					} else {
						console.log("✅ [GET-ACCESS-TOKEN] Token is still valid")
					}
				} else {
					console.warn("⚠️ [GET-ACCESS-TOKEN] Could not parse token for expiration check")
				}
			} catch (error) {
				console.warn("⚠️ [TOKEN-CLEANUP] Error checking token expiration in getAccessToken:", error)
			}
		} else {
			console.log("🔍 [GET-ACCESS-TOKEN] No token stored in secrets")
		}

		console.log("🔍 [GET-ACCESS-TOKEN] Returning token:", token ? "token present" : "undefined")
		return token
	}

	/**
	 * Ensure we have a valid access token, refreshing if necessary
	 * Enhanced with more resilient refresh logic and longer validity windows
	 */
	async ensureValidAccessToken(): Promise<string | undefined> {
		// Immediate check for signed out state
		if (this.signedOut) {
			console.log("🚫 [ENSURE-VALID-TOKEN] Signed out flag detected - returning undefined immediately")
			return undefined
		}

		const sessionId = Date.now().toString(36)
		console.log(`🔍 [ENSURE-VALID-TOKEN] [${sessionId}] Starting enhanced token validation...`)
		console.log(`🔍 [ENSURE-VALID-TOKEN] [${sessionId}] Current timestamp:`, new Date().toISOString())
		console.log(`🔍 [ENSURE-VALID-TOKEN] [${sessionId}] Signed out flag:`, this.signedOut)

		let accessToken = await this.getAccessToken()
		console.log(
			`🔍 [ENSURE-VALID-TOKEN] [${sessionId}] getAccessToken returned:`,
			accessToken ? "token present" : "undefined",
		)

		if (accessToken) {
			console.log(`🔍 [ENSURE-VALID-TOKEN] [${sessionId}] Token details:`, {
				length: accessToken.length,
				isJWT: accessToken.includes("."),
				startsWith: accessToken.substring(0, 10),
				endsWith: accessToken.substring(accessToken.length - 10),
			})

			// Add token expiration analysis with session tracking
			try {
				const parseResult = parseJWTUnsafe(accessToken)
				if (parseResult.success && parseResult.parts?.payload.exp) {
					const expirationTime = parseResult.parts.payload.exp * 1000
					const currentTime = Date.now()
					const timeUntilExpiration = expirationTime - currentTime
					const hoursUntilExpiration = timeUntilExpiration / (1000 * 60 * 60)

					console.log(`🔍 [TOKEN-LIFECYCLE] [${sessionId}] Token expiration analysis:`, {
						expirationTime: new Date(expirationTime).toISOString(),
						currentTime: new Date(currentTime).toISOString(),
						timeUntilExpirationMinutes: Math.floor(timeUntilExpiration / (1000 * 60)),
						timeUntilExpirationHours: hoursUntilExpiration.toFixed(2),
						isExpired: expirationTime <= currentTime,
						willExpireSoon: timeUntilExpiration < 5 * 60 * 1000,
						originalLifespanHours: parseResult.parts.payload.iat
							? ((parseResult.parts.payload.exp - parseResult.parts.payload.iat) / 3600).toFixed(2)
							: "unknown",
					})
				}
			} catch (error) {
				console.warn(`⚠️ [TOKEN-LIFECYCLE] [${sessionId}] Could not analyze token expiration:`, error)
			}
		}

		// If no access token, try to refresh using refresh token (with race condition protection)
		if (!accessToken) {
			console.log(`🔍 [ENSURE-VALID-TOKEN] [${sessionId}] No access token found, checking for refresh token...`)
			const refreshToken = await this.context.secrets.get(TOKEN_KEYS.REFRESH_TOKEN)
			console.log(`🔍 [ENSURE-VALID-TOKEN] [${sessionId}] Refresh token found:`, refreshToken ? "yes" : "no")
			if (refreshToken) {
				accessToken = await this.performTokenRefreshWithLocking(sessionId, refreshToken)
			} else {
				console.log(
					`❌ [ENSURE-VALID-TOKEN] [${sessionId}] No refresh token available - user needs to re-authenticate`,
				)
			}
		}

		// Enhanced token expiration handling with configured threshold and strict expiry policy
		if (accessToken) {
			try {
				const parseResult = parseJWTUnsafe(accessToken)
				if (parseResult.success && parseResult.parts?.payload.exp) {
					const expirationTime = parseResult.parts.payload.exp * 1000
					const currentTime = Date.now()
					const timeUntilExpiration = expirationTime - currentTime
					const thresholdMs = (JWT_CONFIG.TOKEN_REFRESH_THRESHOLD ?? 300) * 1000

					console.log("🔍 [ENSURE-VALID-TOKEN] Token expiration check:", {
						expirationTime: new Date(expirationTime).toISOString(),
						currentTime: new Date(currentTime).toISOString(),
						timeUntilExpiration: Math.floor(timeUntilExpiration / 1000) + "s",
						thresholdSeconds: thresholdMs / 1000,
					})

					if (timeUntilExpiration <= 0) {
						console.log(
							`⛔ [TOKEN-REFRESH] [${sessionId}] Token already expired. Attempting immediate refresh...`,
						)
						const refreshToken = await this.context.secrets.get(TOKEN_KEYS.REFRESH_TOKEN)
						if (refreshToken) {
							const refreshed = await this.performTokenRefreshWithLocking(sessionId, refreshToken)
							if (refreshed) {
								accessToken = refreshed
							} else {
								console.log(`❌ [TOKEN-REFRESH] [${sessionId}] Refresh failed for expired token`)
								accessToken = undefined
							}
						} else {
							console.log(
								`❌ [TOKEN-REFRESH] [${sessionId}] No refresh token available for expired access token`,
							)
							accessToken = undefined
						}
					} else if (timeUntilExpiration < thresholdMs) {
						console.log(
							`⏰ [TOKEN-REFRESH] [${sessionId}] Token expires within configured threshold (${thresholdMs / 1000}s), attempting proactive refresh...`,
						)
						const refreshToken = await this.context.secrets.get(TOKEN_KEYS.REFRESH_TOKEN)
						if (refreshToken) {
							const refreshedToken = await this.performTokenRefreshWithLocking(sessionId, refreshToken)
							if (refreshedToken) {
								accessToken = refreshedToken
							} else {
								console.log(
									`⚠️ [TOKEN-REFRESH] [${sessionId}] Proactive refresh failed, continuing with existing token`,
								)
							}
						} else {
							console.log(
								`⚠️ [TOKEN-REFRESH] [${sessionId}] No refresh token available for proactive refresh`,
							)
						}
					} else {
						console.log(
							`✅ [TOKEN-LIFECYCLE] [${sessionId}] Token healthy - ${Math.floor(timeUntilExpiration / (1000 * 60))} minutes until expiration`,
						)
					}
				} else {
					console.warn("⚠️ [ENSURE-VALID-TOKEN] Could not parse token for expiration check")
				}
			} catch (error) {
				console.warn("⚠️ [TOKEN-REFRESH] Error checking token expiration:", error)
				// Continue with existing token if expiration check fails
			}
		}

		console.log(
			`🔍 [ENSURE-VALID-TOKEN] [${sessionId}] Final result:`,
			accessToken ? "returning token" : "returning undefined",
		)

		// Final token health summary
		if (accessToken) {
			try {
				const parseResult = parseJWTUnsafe(accessToken)
				if (parseResult.success && parseResult.parts?.payload.exp) {
					const expirationTime = parseResult.parts.payload.exp * 1000
					const timeUntilExpiration = expirationTime - Date.now()
					console.log(`📊 [TOKEN-LIFECYCLE] [${sessionId}] Final token status:`, {
						hasToken: true,
						minutesUntilExpiration: Math.floor(timeUntilExpiration / (1000 * 60)),
						tokenAge: parseResult.parts.payload.iat
							? Math.floor((Date.now() - parseResult.parts.payload.iat * 1000) / (1000 * 60)) + " minutes"
							: "unknown",
					})
				}
			} catch (error) {
				console.log(`📊 [TOKEN-LIFECYCLE] [${sessionId}] Final token status: has token but cannot parse`)
			}
		} else {
			console.log(`📊 [TOKEN-LIFECYCLE] [${sessionId}] Final token status: no token available`)
		}

		return accessToken
	}

	/**
	 * Get user information from stored session or JWT token
	 */
	async getUserInfo(): Promise<UserInfo | undefined> {
		try {
			const accessToken = await this.ensureValidAccessToken()

			if (!accessToken) {
				console.log("❌ [USER-INFO] No access token available")
				return undefined
			}

			// First try to get user info from backend API
			const backendUrl = await this.getBackendUrl()
			const sessionId = await this.context.secrets.get(TOKEN_KEYS.SESSION_ID)

			if (sessionId) {
				try {
					console.log("🔍 [USER-INFO] Attempting to fetch user info from backend API...")
					const response = await fetch(`${backendUrl}${AUTH_ENDPOINTS.USER_INFO}`, {
						method: "GET",
						headers: {
							Authorization: `Bearer ${accessToken}`,
							"Content-Type": "application/json",
							"User-Agent": generateUserAgent(),
						},
					})

					if (response.ok) {
						const userInfo = await response.json()
						console.log("✅ [USER-INFO] Successfully fetched user info from backend API")
						return userInfo
					}

					// If backend returns 404, fall back to JWT extraction
					if (response.status === 404) {
						console.log(
							"⚠️ [USER-INFO] Backend user info endpoint not available, falling back to JWT extraction",
						)
					} else {
						console.warn(
							"⚠️ [USER-INFO] Backend user info request failed, falling back to JWT extraction:",
							response.statusText,
						)
					}
				} catch (error) {
					console.warn(
						"⚠️ [USER-INFO] Backend user info request error, falling back to JWT extraction:",
						error,
					)
				}
			}

			// Fallback: Extract user info from JWT token
			console.log("🔍 [USER-INFO] Extracting user info from JWT token...")
			try {
				const parseResult = parseJWTUnsafe(accessToken)
				if (parseResult.success && parseResult.parts?.payload) {
					const payload = parseResult.parts.payload
					const userInfo: UserInfo = {
						email:
							payload.email ||
							(payload.org_slug
								? `${payload.org_slug}@organization.softcodes.ai`
								: payload.sub || "unknown@softcodes.ai"),
						firstName: payload.first_name || "User",
						lastName: payload.last_name || "",
						organizationName: payload.org_slug || undefined, // Use org_slug as organization name
						organizationId: payload.org_id || undefined,
					}
					console.log("✅ [USER-INFO] Successfully extracted user info from JWT token")
					return userInfo
				} else {
					console.warn("❌ [USER-INFO] Failed to parse JWT token for user info")
					return undefined
				}
			} catch (error) {
				console.error("❌ [USER-INFO] Error extracting user info from JWT:", error)
				return undefined
			}
		} catch (error) {
			console.error("❌ [USER-INFO] Error fetching user info:", error)
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
	 * Perform token refresh with locking to prevent race conditions
	 */
	private async performTokenRefreshWithLocking(sessionId: string, refreshToken: string): Promise<string | undefined> {
		// Check if refresh is already in progress
		if (this.tokenRefreshInProgress) {
			console.log(`🔒 [TOKEN-REFRESH] [${sessionId}] Refresh already in progress, waiting for completion...`)

			// Wait for existing refresh to complete
			if (this.tokenRefreshPromise) {
				try {
					const result = await this.tokenRefreshPromise
					console.log(`✅ [TOKEN-REFRESH] [${sessionId}] Existing refresh completed, using result`)
					return result
				} catch (error) {
					console.warn(`⚠️ [TOKEN-REFRESH] [${sessionId}] Existing refresh failed:`, error)
				}
			}

			// If existing refresh failed, continue with our own attempt
		}

		// Set lock and start refresh
		this.tokenRefreshInProgress = true
		console.log(`🔒 [TOKEN-REFRESH] [${sessionId}] Starting locked token refresh`)

		const refreshStartTime = Date.now()
		this.tokenRefreshPromise = this.refreshAccessTokenResilient(refreshToken)

		try {
			const result = await this.tokenRefreshPromise
			const refreshDuration = Date.now() - refreshStartTime

			if (result) {
				console.log(`✅ [TOKEN-REFRESH] [${sessionId}] Locked refresh successful in ${refreshDuration}ms`)
			} else {
				console.log(`❌ [TOKEN-REFRESH] [${sessionId}] Locked refresh failed after ${refreshDuration}ms`)
			}

			return result
		} finally {
			// Always clear the lock
			this.tokenRefreshInProgress = false
			this.tokenRefreshPromise = null
			console.log(`🔓 [TOKEN-REFRESH] [${sessionId}] Refresh lock released`)
		}
	}

	/**
	 * Enhanced resilient token refresh with fallback strategies
	 */
	async refreshAccessTokenResilient(refreshToken: string): Promise<string | undefined> {
		try {
			const backendUrl = await this.getBackendUrl()

			// First check if refresh endpoint exists with timeout
			console.log("🔍 [TOKEN-REFRESH] Checking refresh endpoint availability...")

			const checkResponse = await Promise.race([
				fetch(`${backendUrl}${AUTH_ENDPOINTS.REFRESH_TOKEN}`, {
					method: "HEAD",
				}),
				new Promise<Response>((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000)),
			]).catch(() => null)

			// If endpoint doesn't exist, use fallback strategy
			if (!checkResponse || !checkResponse.ok) {
				console.log("⚠️ [TOKEN-REFRESH] Refresh endpoint not available, using fallback token extension")
				return await this.extendTokenLifetime(refreshToken)
			}

			// Attempt normal refresh with retry logic
			console.log("🔄 [TOKEN-REFRESH] Attempting token refresh with retry logic...")

			for (let attempt = 1; attempt <= 3; attempt++) {
				try {
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
						signal: AbortSignal.timeout(10000), // 10 second timeout
					})

					if (response.ok) {
						const tokens: AuthTokens = await response.json()
						await this.storeTokens(tokens)

						// Update authentication state
						const currentState = await this.getAuthenticationState()
						if (currentState.isAuthenticated) {
							await this.updateAuthenticationState({
								...currentState,
								isConnected: true, // Successful refresh means we're connected
							})
						}

						console.log(`✅ [TOKEN-REFRESH] Token refresh successful on attempt ${attempt}`)
						return tokens.access_token
					} else {
						console.warn(`⚠️ [TOKEN-REFRESH] Refresh failed on attempt ${attempt}: ${response.status}`)

						if (attempt === 3) {
							// On final attempt failure, try fallback extension
							return await this.extendTokenLifetime(refreshToken)
						}

						// Wait before retry (exponential backoff)
						await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
					}
				} catch (error) {
					console.warn(`⚠️ [TOKEN-REFRESH] Refresh attempt ${attempt} failed:`, error)

					if (attempt === 3) {
						// On final attempt failure, try fallback extension
						return await this.extendTokenLifetime(refreshToken)
					}

					// Wait before retry
					await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
				}
			}

			// If all retries failed, use fallback
			return await this.extendTokenLifetime(refreshToken)
		} catch (error) {
			console.warn("⚠️ [TOKEN-REFRESH] Token refresh error, using fallback:", error)
			return await this.extendTokenLifetime(refreshToken)
		}
	}

	/**
	 * Fallback token lifetime extension when refresh is not available
	 */
	private async extendTokenLifetime(refreshToken: string): Promise<string | undefined> {
		try {
			// Only allow fallback token extension in development or when explicitly enabled
			const devBypass =
				vscode.workspace.getConfiguration("softcodes").get("auth.skipAPIValidation", false) ||
				process.env.NODE_ENV === "development"

			if (!devBypass) {
				console.log(
					"🛑 [TOKEN-EXTEND] Fallback token lifetime extension is disabled in production. Prompting re-auth.",
				)
				return undefined
			}

			console.log("🔄 [TOKEN-EXTEND] Using fallback token lifetime extension (development mode)...")

			// Get token directly from storage, bypassing getAccessToken() to access expired tokens
			const currentToken = await this.context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)
			if (!currentToken) {
				console.log("❌ [TOKEN-EXTEND] No current token to extend")
				return undefined
			}

			// Parse current token to check if it's still usable
			const parseResult = parseJWTUnsafe(currentToken)
			if (parseResult.success && parseResult.parts?.payload.exp) {
				const expirationTime = parseResult.parts.payload.exp * 1000
				const currentTime = Date.now()
				const timeUntilExpiration = expirationTime - currentTime
				const thresholdMs = (JWT_CONFIG.TOKEN_REFRESH_THRESHOLD ?? 300) * 1000

				// If token has more than configured threshold left, continue using it
				if (timeUntilExpiration > thresholdMs) {
					console.log("✅ [TOKEN-EXTEND] Current token still has sufficient time, continuing to use it")
					return currentToken
				}

				// Extended tolerance (development only): If token has expired but by less than 30 minutes, allow temporary use
				if (timeUntilExpiration > -30 * 60 * 1000) {
					console.log(
						"⚠️ [TOKEN-EXTEND] Token recently expired, attempting to use with extended clock tolerance (development only)",
					)
					return currentToken
				}
			}

			// Token is too old or can't be parsed - user needs to re-authenticate
			console.log("❌ [TOKEN-EXTEND] Token is too old, user needs to re-authenticate")
			return undefined
		} catch (error) {
			console.error("❌ [TOKEN-EXTEND] Token extension failed:", error)
			return undefined
		}
	}

	/**
	 * Legacy refresh method for backward compatibility
	 */
	async refreshAccessToken(refreshToken: string): Promise<string | undefined> {
		return this.refreshAccessTokenResilient(refreshToken)
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
	public async storeTokens(tokens: AuthTokens): Promise<void> {
		console.log("🔐 [STORE-TOKENS] Starting token storage process...")
		console.log("🔐 [STORE-TOKENS] Access token length:", tokens.access_token.length)
		console.log("🔐 [STORE-TOKENS] Has refresh token:", !!tokens.refresh_token)
		console.log("🔐 [STORE-TOKENS] Has session ID:", !!tokens.session_id)
		console.log("🔐 [STORE-TOKENS] Has organization ID:", !!tokens.organization_id)

		try {
			// Always prefer storing the custom 24h JWT as access token
			await this.context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, tokens.access_token)
			console.log("✅ [STORE-TOKENS] Access token stored successfully (24h JWT)")

			await this.context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, tokens.refresh_token)
			console.log("✅ [STORE-TOKENS] Refresh token stored successfully (30d lifetime)")

			if (tokens.session_id) {
				await this.context.secrets.store(TOKEN_KEYS.SESSION_ID, tokens.session_id)
				console.log("✅ [STORE-TOKENS] Session ID stored successfully")
			}

			if (tokens.organization_id) {
				await this.context.secrets.store(TOKEN_KEYS.ORGANIZATION_ID, tokens.organization_id)
				console.log("✅ [STORE-TOKENS] Organization ID stored successfully")
			}

			// Decode JWT to log expiration details
			try {
				const parseResult = parseJWTUnsafe(tokens.access_token)
				if (parseResult.success && parseResult.parts?.payload.exp) {
					const expirationTime = parseResult.parts.payload.exp * 1000
					const issueTime = parseResult.parts.payload.iat ? parseResult.parts.payload.iat * 1000 : undefined
					console.log("📊 [STORE-TOKENS] Token expiration info:", {
						expirationTime: new Date(expirationTime).toISOString(),
						issueTime: issueTime ? new Date(issueTime).toISOString() : "unknown",
						lifetimeHours: issueTime ? ((expirationTime - issueTime) / 3600000).toFixed(2) : "unknown",
						timeUntilExpirationMinutes: Math.floor((expirationTime - Date.now()) / (1000 * 60)),
					})
				}
			} catch (e) {
				console.warn("⚠️ [STORE-TOKENS] Could not parse token for expiration logging:", e)
			}

			// Immediately verify storage worked
			console.log("🔍 [STORE-TOKENS] Verifying storage...")
			const storedToken = await this.context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)
			console.log("🔍 [STORE-TOKENS] Verification result:", storedToken ? "token found" : "token NOT found")

			if (storedToken) {
				console.log("🔍 [STORE-TOKENS] Stored token matches input:", storedToken === tokens.access_token)
			}

			console.log("✅ [STORE-TOKENS] Token storage process completed")
		} catch (error) {
			console.error("❌ [STORE-TOKENS] Error during token storage:", error)
			throw error
		}
	}

	/**
	 * Exchange authorization code for tokens (static for URI handler)
	 */
	static async exchangeToken(
		code: string,
		verifier: string,
		state: string,
		redirectUri: string,
		context: vscode.ExtensionContext,
	) {
		const apiBaseUrl = vscode.workspace
			.getConfiguration("softcodes")
			.get<string>("apiBaseUrl", "https://yourapp.com")
		try {
			const response = await fetch(`${apiBaseUrl}/api/auth/complete-vscode-auth`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code, code_verifier: verifier, state, redirect_uri: redirectUri }),
			})
			if (!response.ok) {
				const errorData = await response.json()
				throw new Error(errorData.error || "Exchange failed")
			}
			const data = await response.json()
			if (data.success) {
				const instance = UnifiedAuthService.getInstance(context)
				const tokens: AuthTokens = {
					access_token: data.access_token,
					refresh_token: data.refresh_token,
				}
				await instance.storeTokens(tokens)
				// Store expiry
				context.globalState.update("token_expiry", Date.now() + data.expires_in * 1000)
				context.globalState.update("auth_in_progress", false)
				return data
			}
		} catch (error) {
			console.error("Token exchange error:", error)
			vscode.window.showErrorMessage(`Authentication failed: ${error}`)
			context.globalState.update("auth_in_progress", false)
		}
	}

	/**
	 * Start expiry monitor for proactive token refresh (class method)
	 */
	startExpiryMonitor(context: vscode.ExtensionContext) {
		const interval = setInterval(async () => {
			if (await this.isAuthenticated()) {
				const expiry = context.globalState.get("token_expiry") as number
				if (Date.now() > expiry - 600000) {
					// 10min early
					try {
						await this.refreshCurrentAccessToken()
					} catch (e) {
						console.log("Pro-active refresh failed, will handle on next call")
					}
				}
			}
		}, 300000) // 5min
		context.subscriptions.push({ dispose: () => clearInterval(interval) })
	}

	/**
	 * Clear expired tokens from storage
	 */
	private async clearExpiredTokens(): Promise<void> {
		try {
			const accessToken = await this.context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)

			if (accessToken) {
				// Check if the current token is expired
				const parseResult = parseJWTUnsafe(accessToken)
				if (parseResult.success && parseResult.parts?.payload.exp) {
					const expirationTime = parseResult.parts.payload.exp * 1000
					const currentTime = Date.now()

					if (expirationTime <= currentTime) {
						console.log("🧹 [TOKEN-CLEANUP] Found expired token, clearing it...")
						await this.clearStoredTokens()

						// Also clear the legacy kilocodeToken field
						try {
							const contextProxy = ContextProxy.instance
							await contextProxy.setProviderSettings({
								...contextProxy.getProviderSettings(),
								kilocodeToken: undefined,
							})
							console.log("✅ [TOKEN-CLEANUP] Cleared expired kilocodeToken field")
						} catch (error) {
							console.warn("⚠️ [TOKEN-CLEANUP] Failed to clear kilocodeToken:", error)
						}

						console.log("✅ [TOKEN-CLEANUP] Expired token cleared successfully")
					} else {
						console.log("✅ [TOKEN-CLEANUP] Current token is still valid")
					}
				}
			}
		} catch (error) {
			console.warn("⚠️ [TOKEN-CLEANUP] Error checking for expired tokens:", error)
		}
	}

	/**
	 * Clear all stored tokens and authentication data
	 */
	private async clearStoredTokens(): Promise<void> {
		// LOGGING: Track signedOut state before clearing
		console.log("🔍 [AUTH-LOG] signedOut state before clearStoredTokens:", this.signedOut)

		try {
			await Promise.all([
				this.context.secrets.delete(TOKEN_KEYS.ACCESS_TOKEN),
				this.context.secrets.delete(TOKEN_KEYS.REFRESH_TOKEN),
				this.context.secrets.delete(TOKEN_KEYS.SESSION_ID),
				this.context.secrets.delete(TOKEN_KEYS.ORGANIZATION_ID),
				this.context.secrets.delete("auth_state"),
			])

			// Reset authentication state - explicitly set signedOut to false for fresh start, but mark as not authenticated
			await this.updateAuthenticationState({
				isAuthenticated: false,
				isConnected: false,
				signedOut: false, // FIX: Reset signedOut to false during token clearing for new auth attempts
			})

			console.log("✅ [TOKEN-CLEANUP] All stored tokens cleared with signedOut reset to false")

			// LOGGING: Track signedOut state after clearing
			console.log("🔍 [AUTH-LOG] signedOut state after clearStoredTokens:", this.signedOut)
		} catch (error) {
			console.error("❌ [TOKEN-CLEANUP] Failed to clear stored tokens:", error)
			throw error
		}
	}

	/**
	 * Sign out and clear all stored authentication data
	 */
	async signOut(): Promise<void> {
		try {
			console.log("🔓 [SIGN-OUT] Starting enhanced sign out process...")

			// Set signedOut flag immediately to block any concurrent token operations
			this.signedOut = true
			console.log("🚫 [SIGN-OUT] Signed out flag set to true")

			// Clear all stored authentication data using the centralized method
			await this.clearStoredTokens()
			console.log("✅ [SIGN-OUT] All stored tokens cleared")

			// Clear legacy kilocodeToken field for ProfileView compatibility
			try {
				const contextProxy = ContextProxy.instance
				await contextProxy.setProviderSettings({
					...contextProxy.getProviderSettings(),
					kilocodeToken: undefined,
				})
				console.log("✅ [SIGN-OUT] Cleared kilocodeToken field")
			} catch (error) {
				console.warn("⚠️ [SIGN-OUT] Failed to clear kilocodeToken:", error)
			}

			// Clear any pending auth states
			this.pendingAuth.clear()
			console.log("✅ [SIGN-OUT] Pending auth states cleared")

			// Update authentication state with signedOut flag
			await this.updateAuthenticationState({
				isAuthenticated: false,
				isConnected: false,
				signedOut: true,
			})
			console.log("📡 [SIGN-OUT] Authentication state updated with signedOut: true")

			// Notify backend about sign out (optional, but do it after state update)
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
					console.log("✅ [SIGN-OUT] Backend notified of sign out")
				}
			} catch (error) {
				// Non-critical error - user is still signed out locally
				console.warn("⚠️ [SIGN-OUT] Failed to notify backend of sign out:", error)
			}

			// Step 6: FORCE IMMEDIATE WEBVIEW NOTIFICATION - Critical for stopping polling
			console.log("📡 [SIGN-OUT] Triggering immediate auth state refresh command...")
			try {
				await vscode.commands.executeCommand("softcodes.refreshAuthState")
				console.log("✅ [SIGN-OUT] softcodes.refreshAuthState command executed successfully")
			} catch (commandError) {
				console.warn("⚠️ [SIGN-OUT] Failed to execute refreshAuthState command:", commandError)
				// Fallback: Trigger onAuthenticated which might also refresh state
				try {
					await vscode.commands.executeCommand("softcodes.onAuthenticated")
					console.log("✅ [SIGN-OUT] Fallback onAuthenticated command executed")
				} catch (fallbackError) {
					console.error("❌ [SIGN-OUT] Both refresh commands failed:", fallbackError)
				}
			}

			// Show success message
			vscode.window.showInformationMessage(AUTH_SUCCESS.SIGNED_OUT)
			console.log("✅ [SIGN-OUT] Sign out process completed successfully - forced webview refresh added")
		} catch (error) {
			console.error("❌ [SIGN-OUT] Sign out failed:", error)
			// Even on error, ensure signedOut flag is set
			this.signedOut = true
			vscode.window.showErrorMessage(`Sign out failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * Check if user is authenticated
	 * IMPORTANT: This method should NOT trigger token refresh.
	 * It should only check for the existence of stored tokens.
	 */
	async isAuthenticated(): Promise<boolean> {
		const token = await this.context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)
		if (!token) return false

		// Check expiry
		const expiry = this.context.globalState.get("token_expiry") as number | undefined
		if (!expiry || Date.now() >= expiry) {
			return false
		}

		return true
	}

	/**
	 * Validate current session with backend or fallback to JWT validation
	 */
	async validateSession(): Promise<boolean> {
		try {
			const accessToken = await this.ensureValidAccessToken()

			if (!accessToken) {
				console.log("❌ [SESSION-VALIDATION] No access token available")
				return false
			}

			// First try backend validation if available
			const backendUrl = await this.getBackendUrl()
			const sessionId = await this.context.secrets.get(TOKEN_KEYS.SESSION_ID)

			if (sessionId) {
				try {
					console.log("🔍 [SESSION-VALIDATION] Attempting backend session validation...")
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

					if (response.ok) {
						console.log("✅ [SESSION-VALIDATION] Backend session validation successful")
						return true
					}

					// If backend validation fails with 404, fall back to JWT validation
					if (response.status === 404) {
						console.log(
							"⚠️ [SESSION-VALIDATION] Backend validation not available, falling back to JWT validation",
						)
					} else {
						console.warn(
							"⚠️ [SESSION-VALIDATION] Backend validation failed, falling back to JWT validation",
						)
					}
				} catch (error) {
					console.warn(
						"⚠️ [SESSION-VALIDATION] Backend validation error, falling back to JWT validation:",
						error,
					)
				}
			}

			// Fallback: Validate JWT token directly
			console.log("🔍 [SESSION-VALIDATION] Performing JWT-based session validation...")
			const jwtService = JWTVerificationService.getInstance()
			const jwtResult = await jwtService.verifyJWT(accessToken)

			if (jwtResult.valid) {
				console.log("✅ [SESSION-VALIDATION] JWT-based session validation successful")
				return true
			} else {
				console.log("❌ [SESSION-VALIDATION] JWT-based session validation failed:", jwtResult.error?.message)
				return false
			}
		} catch (error) {
			console.error("❌ [SESSION-VALIDATION] Session validation failed:", error)
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
