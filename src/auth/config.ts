/**
 * Unified Authentication Configuration
 *
 * This file contains configuration constants for the unified authentication system
 * that bridges the VSCode extension with the Clerk-based website authentication.
 */

/**
 * Environment-specific configuration
 */
export const AUTH_CONFIG = {
	// Production URLs (aligned with website)
	PRODUCTION: {
		CLERK_BASE_URL: "https://clerk.softcodes.ai",
		API_BASE_URL: "https://softcodes.ai",
		WEBSITE_URL: "https://softcodes.ai",
	},

	// Development URLs (for testing)
	DEVELOPMENT: {
		CLERK_BASE_URL: "https://clerk.softcodes.ai", // Use production Clerk for consistency
		API_BASE_URL: "http://localhost:3000",
		WEBSITE_URL: "http://localhost:3000",
	},
} as const

/**
 * OAuth Configuration
 */
export const OAUTH_CONFIG = {
	// VSCode-specific OAuth parameters
	VSCODE: {
		REDIRECT_URI: "vscode-softcodes://auth/callback",
		SCOPE: "openid profile email",
		RESPONSE_TYPE: "code",
		GRANT_TYPE: "authorization_code",
	},

	// Website OAuth parameters (for reference)
	WEBSITE: {
		REDIRECT_URI_PATTERN: /^https:\/\/(softcodes\.ai|localhost:3000)/,
		SCOPE: "openid profile email",
		RESPONSE_TYPE: "code",
	},
} as const

/**
 * API Endpoints for unified authentication
 */
export const AUTH_ENDPOINTS = {
	// New unified endpoints
	INITIATE_VSCODE_AUTH: "/api/auth/initiate-vscode-auth",
	EXTENSION_CALLBACK: "/api/extension/auth/callback",
	REFRESH_TOKEN: "/api/auth/refresh-token",
	SESSION_TOKEN: "/api/auth/session-token",
	VALIDATE_SESSION: "/api/auth/validate-session",
	USER_INFO: "/api/auth/user-info",
	SIGN_OUT: "/api/auth/sign-out",

	// Webhook endpoints (for backend implementation)
	CLERK_WEBHOOK: "/api/webhooks/clerk",

	// Legacy endpoints (for backward compatibility)
	LEGACY: {
		TOKEN_EXCHANGE: "/api/auth/token",
	},
} as const

/**
 * Token Storage Keys
 */
export const TOKEN_KEYS = {
	ACCESS_TOKEN: "access_token",
	REFRESH_TOKEN: "refresh_token",
	SESSION_ID: "session_id",
	ORGANIZATION_ID: "organization_id",
	PKCE_PREFIX: "pkce_",
} as const

/**
 * Error Messages
 */
export const AUTH_ERRORS = {
	MISSING_PARAMS: "Missing authentication parameters",
	INVALID_STATE: "Invalid authentication state",
	TOKEN_EXCHANGE_FAILED: "Token exchange failed",
	REFRESH_FAILED: "Token refresh failed",
	SESSION_EXPIRED: "Your session has expired. Please sign in again.",
	NETWORK_ERROR: "Network error during authentication",
	INVALID_RESPONSE: "Invalid response from authentication service",
} as const

/**
 * Success Messages
 */
export const AUTH_SUCCESS = {
	AUTHENTICATED: "You're now authenticated to Softcodes!",
	SIGNED_OUT: "Signed out from Softcodes",
	TOKEN_REFRESHED: "Authentication token refreshed",
} as const

/**
 * Get the current environment configuration
 */
export function getAuthConfig() {
	// Check if we're in development mode
	const isDevelopment = process.env.NODE_ENV === "development"
	return isDevelopment ? AUTH_CONFIG.DEVELOPMENT : AUTH_CONFIG.PRODUCTION
}

/**
 * Build authentication URL with proper parameters and URI encoding
 */
export function buildAuthUrl(baseUrl: string, params: Record<string, string>): string {
	try {
		// Ensure baseUrl is properly encoded
		const encodedBaseUrl = encodeURI(baseUrl)
		const url = new URL(AUTH_ENDPOINTS.INITIATE_VSCODE_AUTH, encodedBaseUrl)

		// Properly encode all parameters
		Object.entries(params).forEach(([key, value]) => {
			// Use encodeURIComponent for parameter values to handle spaces and special characters
			url.searchParams.set(key, encodeURIComponent(value))
		})

		const finalUrl = url.toString()
		console.log(`[buildAuthUrl] Generated URL: ${finalUrl}`)
		return finalUrl
	} catch (error) {
		console.error(`[buildAuthUrl] Error building auth URL:`, error)
		throw new Error(`Failed to build authentication URL: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * Validate redirect URI for security with enhanced URI encoding checks
 */
export function isValidRedirectUri(redirectUri: string): boolean {
	try {
		// Check for basic format
		if (!redirectUri || typeof redirectUri !== "string") {
			console.error(`[isValidRedirectUri] Invalid redirectUri format: ${redirectUri}`)
			return false
		}

		// VSCode extension should always use the specific scheme
		if (redirectUri === OAUTH_CONFIG.VSCODE.REDIRECT_URI) {
			return true
		}

		// Try to parse as URI to ensure it's valid
		const uri = new URL(redirectUri)

		// Check for VSCode scheme variations (handle encoding issues)
		if (uri.protocol === "vscode-softcodes:") {
			// Validate the path component
			if (uri.pathname === "/auth/callback" || uri.pathname === "/callback") {
				return true
			}
		}

		// Website redirects should match the pattern
		const isValidWebsite = OAUTH_CONFIG.WEBSITE.REDIRECT_URI_PATTERN.test(redirectUri)

		console.log(`[isValidRedirectUri] Validation result for ${redirectUri}: ${isValidWebsite}`)
		return isValidWebsite
	} catch (error) {
		console.error(`[isValidRedirectUri] Error validating URI ${redirectUri}:`, error)
		return false
	}
}

/**
 * Validate and encode URI components for workspace paths with spaces
 */
export function validateAndEncodeURI(uri: string): { isValid: boolean; encodedUri?: string; error?: string } {
	try {
		if (!uri || typeof uri !== "string") {
			return { isValid: false, error: "URI is empty or not a string" }
		}

		// Try to parse the URI first to check basic validity
		const parsedUri = new URL(uri)

		// For vscode schemes, ensure proper encoding of components
		if (parsedUri.protocol === "vscode-softcodes:") {
			// Reconstruct with proper encoding
			const encodedUri = `${parsedUri.protocol}//${encodeURIComponent(parsedUri.hostname || "")}${encodeURI(parsedUri.pathname || "")}${parsedUri.search || ""}${parsedUri.hash || ""}`
			return { isValid: true, encodedUri }
		}

		// For other schemes, apply general URI encoding
		const encodedUri = encodeURI(uri)
		return { isValid: true, encodedUri }
	} catch (error) {
		return {
			isValid: false,
			error: `Invalid URI format: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

/**
 * Create a properly encoded redirect URI for VSCode authentication
 */
export function createVSCodeRedirectUri(): string {
	// Always use the standard VSCode scheme
	return OAUTH_CONFIG.VSCODE.REDIRECT_URI
}

/**
 * Validate workspace path and encode for URI usage
 */
export function encodeWorkspacePath(workspacePath: string): string {
	if (!workspacePath) {
		return ""
	}

	// Handle paths with spaces and special characters
	try {
		// Split path into components and encode each part
		const pathComponents = workspacePath.split("/")
		const encodedComponents = pathComponents.map((component) =>
			component ? encodeURIComponent(component) : component,
		)
		return encodedComponents.join("/")
	} catch (error) {
		console.warn(`[encodeWorkspacePath] Error encoding path ${workspacePath}:`, error)
		// Fallback to basic URI encoding
		return encodeURI(workspacePath)
	}
}

/**
 * Generate User-Agent string for API requests
 */
export function generateUserAgent(): string {
	try {
		const vscode = require("vscode")
		const extension = vscode.extensions.getExtension("softcodes.softcodes")
		const version = extension?.packageJSON?.version || "unknown"
		return `VSCode-Softcodes/${version}`
	} catch {
		return "VSCode-Softcodes/unknown"
	}
}

/**
 * JWT Configuration for Clerk verification
 * Using vscode-session template - no audience claim expected
 */
export const JWT_CONFIG = {
	CLERK_JWKS_URL: `${process.env.CLERK_BASE_URL || "https://clerk.softcodes.ai"}/.well-known/jwks.json`,
	ISSUER: process.env.CLERK_BASE_URL || "https://clerk.softcodes.ai",
	AUDIENCE: undefined, // vscode-session template doesn't include audience claim
	CLOCK_TOLERANCE: 300, // 5 minutes clock tolerance for network delays
	CACHE_TTL: 14400, // 4 hours in seconds (extended for longer sessions)
	TOKEN_REFRESH_THRESHOLD: 600, // Refresh if expires within 10 minutes
	ALGORITHM: "RS256", // Clerk uses RS256 for JWT signing
} as const

/**
 * JWT Error Types
 */
export const JWT_ERRORS = {
	INVALID_SIGNATURE: "Invalid JWT signature",
	TOKEN_EXPIRED: "JWT token has expired",
	TOKEN_NOT_ACTIVE: "JWT token is not yet active",
	INVALID_ISSUER: "Invalid JWT issuer",
	INVALID_AUDIENCE: "Invalid JWT audience",
	MISSING_CLAIMS: "Required JWT claims are missing",
	MALFORMED_TOKEN: "JWT token is malformed",
	JWKS_FETCH_ERROR: "Failed to fetch JWKS keys",
	VERIFICATION_FAILED: "JWT verification failed",
} as const

/**
 * User Verification Configuration
 */
export const USER_VERIFICATION_CONFIG = {
	// Cache configuration
	CACHE: {
		TTL: 300, // 5 minutes for positive results
		NEGATIVE_TTL: 60, // 1 minute for negative results
		MAX_SIZE: 1000, // Maximum cache entries
		NEGATIVE_CACHE: true, // Cache "user not found" results
	},

	// Rate limiting configuration
	RATE_LIMITING: {
		WINDOW_MS: 15 * 60 * 1000, // 15 minutes
		MAX_REQUESTS: 100, // Per IP per window
		STRICT_WINDOW_MS: 5 * 60 * 1000, // 5 minutes for strict limiting
		STRICT_MAX_REQUESTS: 10,
	},

	// Circuit breaker configuration
	CIRCUIT_BREAKER: {
		FAILURE_THRESHOLD: 5, // Open after 5 failures
		TIMEOUT: 30000, // 30 second timeout
		RESET_TIMEOUT: 60000, // 1 minute before trying half-open
	},

	// Clerk backend configuration
	CLERK_BACKEND: {
		TIMEOUT: 10000, // 10 second API timeout
		RETRY_ATTEMPTS: 3, // Number of retry attempts
		BATCH_SIZE: 10, // Batch size for bulk operations
	},
} as const

/**
 * Get user verification configuration
 */
export function getUserVerificationConfig() {
	return USER_VERIFICATION_CONFIG
}

/**
 * Validate Clerk configuration
 */
export function validateClerkConfig(): {
	valid: boolean
	missingKeys: string[]
	warnings: string[]
} {
	const missingKeys: string[] = []
	const warnings: string[] = []

	// Check for Clerk secret key
	const clerkSecretKey = process.env.CLERK_SECRET_KEY
	if (!clerkSecretKey) {
		missingKeys.push("CLERK_SECRET_KEY")
	} else if (!clerkSecretKey.startsWith("sk_live_")) {
		warnings.push("Using non-production Clerk secret key (should start with sk_live_ for production)")
	}

	// Check for publishable key
	const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
	if (!publishableKey) {
		missingKeys.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")
	} else if (!publishableKey.startsWith("pk_live_")) {
		warnings.push("Using non-production Clerk publishable key (should start with pk_live_ for production)")
	}

	// Check for base URL
	const baseUrl = process.env.CLERK_BASE_URL
	if (!baseUrl) {
		warnings.push("CLERK_BASE_URL not set, using default https://clerk.softcodes.ai")
	}

	// Validate base URL format
	if (baseUrl && !baseUrl.startsWith("https://")) {
		warnings.push("CLERK_BASE_URL should use HTTPS for production")
	}

	return {
		valid: missingKeys.length === 0,
		missingKeys,
		warnings,
	}
}

/**
 * Validate Supabase configuration
 */
export function validateSupabaseConfig(): {
	valid: boolean
	missingKeys: string[]
	warnings: string[]
} {
	const missingKeys: string[] = []
	const warnings: string[] = []

	// Check for Supabase URL
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
	if (!supabaseUrl) {
		missingKeys.push("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL")
	} else if (!supabaseUrl.startsWith("https://")) {
		warnings.push("SUPABASE_URL should use HTTPS for production")
	}

	// Check for Supabase service role key (for server-side operations)
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
	if (!serviceRoleKey) {
		missingKeys.push("SUPABASE_SERVICE_ROLE_KEY")
	}

	// Check for Supabase anon key (fallback)
	const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
	if (!anonKey) {
		warnings.push("NEXT_PUBLIC_SUPABASE_ANON_KEY not set (recommended for fallback)")
	}

	return {
		valid: missingKeys.length === 0,
		missingKeys,
		warnings,
	}
}

/**
 * Get Supabase configuration
 */
export function getSupabaseConfig() {
	return {
		url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
		serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
		anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
	}
}

/**
 * Validate complete authentication configuration (Clerk + Supabase)
 */
export function validateAuthConfig(): {
	valid: boolean
	clerkConfig: ReturnType<typeof validateClerkConfig>
	supabaseConfig: ReturnType<typeof validateSupabaseConfig>
	overallErrors: string[]
	overallWarnings: string[]
} {
	const clerkConfig = validateClerkConfig()
	const supabaseConfig = validateSupabaseConfig()

	const overallErrors: string[] = []
	const overallWarnings: string[] = []

	// Combine errors and warnings
	overallErrors.push(...clerkConfig.missingKeys.map((key) => `Clerk: ${key}`))
	overallErrors.push(...supabaseConfig.missingKeys.map((key) => `Supabase: ${key}`))

	overallWarnings.push(...clerkConfig.warnings.map((warning) => `Clerk: ${warning}`))
	overallWarnings.push(...supabaseConfig.warnings.map((warning) => `Supabase: ${warning}`))

	return {
		valid: clerkConfig.valid && supabaseConfig.valid,
		clerkConfig,
		supabaseConfig,
		overallErrors,
		overallWarnings,
	}
}

/**
 * Get production Clerk configuration
 */
export function getProductionClerkConfig() {
	return {
		secretKey: process.env.CLERK_SECRET_KEY!,
		publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!,
		baseUrl: process.env.CLERK_BASE_URL || "https://clerk.softcodes.ai",
		jwksUrl: `${process.env.CLERK_BASE_URL || "https://clerk.softcodes.ai"}/.well-known/jwks.json`,
	}
}
