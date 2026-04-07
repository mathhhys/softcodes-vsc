/**
 * Centralized Application Configuration
 *
 * This file contains all configurable constants used throughout the application.
 * All values are sourced from environment variables with proper validation.
 * No hardcoded production secrets or URLs should exist outside this file.
 */

// Environment variable validation helper
function getRequiredEnvVar(name: string, description?: string): string {
	const value = process.env[name]
	if (!value) {
		throw new Error(`Required environment variable ${name} is not set${description ? `: ${description}` : ""}`)
	}
	return value
}

function getOptionalEnvVar(name: string, defaultValue: string): string {
	return process.env[name] || defaultValue
}

function getNumericEnvVar(name: string, defaultValue: number): number {
	const value = process.env[name]
	if (!value) return defaultValue
	const parsed = parseFloat(value)
	if (isNaN(parsed)) {
		throw new Error(`Environment variable ${name} must be a valid number, got: ${value}`)
	}
	return parsed
}

function getBooleanEnvVar(name: string, defaultValue: boolean): boolean {
	const value = process.env[name]
	if (!value) return defaultValue
	return value.toLowerCase() === "true"
}

/**
 * API Configuration
 */
export const API_CONFIG = {
	// OpenRouter Configuration
	OPENROUTER: {
		BASE_URL: getOptionalEnvVar("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
		API_KEY: process.env.OPENROUTER_API_KEY, // Optional - can be user-provided
	},

	// Clerk Authentication Configuration
	CLERK: {
		PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
		SECRET_KEY: process.env.CLERK_SECRET_KEY,
		BASE_URL: process.env.CLERK_BASE_URL,
	},

	// Supabase Configuration (handled by SupabaseConfigService)
	SUPABASE: {
		URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
		SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
		ANON_KEY: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
	},

	// OAuth Configuration
	OAUTH: {
		VSCODE_CLIENT_ID: process.env.VSCODE_OAUTH_CLIENT_ID,
	},

	// Gemini Configuration
	GEMINI: {
		CLIENT_ID: getOptionalEnvVar(
			"GEMINI_CLIENT_ID",
			"681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
		),
	},
} as const

/**
 * Credit System Configuration
 */
export const CREDIT_CONFIG = {
	// Credit conversion rate (USD per credit)
	USD_PER_CREDIT: getNumericEnvVar("CREDIT_USD_RATE", 0.014),

	// Low credit threshold for notifications
	LOW_CREDIT_THRESHOLD: getNumericEnvVar("CREDIT_LOW_THRESHOLD", 10),

	// Maximum credits that can be deducted in a single operation
	MAX_SINGLE_DEDUCTION: getNumericEnvVar("CREDIT_MAX_DEDUCTION", 1000),

	// Credit badge configuration
	BADGE: {
		UPDATE_INTERVAL_MS: getNumericEnvVar("CREDIT_BADGE_UPDATE_INTERVAL", 1000),
		ENABLE_NOTIFICATIONS: getBooleanEnvVar("CREDIT_ENABLE_NOTIFICATIONS", true),
		NOTIFICATION_THRESHOLD: getNumericEnvVar("CREDIT_NOTIFICATION_THRESHOLD", 10),
		SHOW_ANIMATIONS: getBooleanEnvVar("CREDIT_SHOW_ANIMATIONS", true),
	},
} as const

/**
 * Application URLs and Endpoints
 */
export const APP_URLS = {
	// Main application URL
	MAIN_SITE: getOptionalEnvVar("APP_MAIN_URL", "https://www.softcodes.ai"),

	// API endpoints
	ROO_CODE_API: getOptionalEnvVar("ROO_CODE_API_URL", "https://api.kilocode.ai"),

	// Documentation and support
	DOCUMENTATION: "https://docs.softcodes.ai",
	SUPPORT: "https://support.softcodes.ai",

	// Legal pages
	PRIVACY_POLICY: "https://www.softcodes.ai/privacy",
	TERMS_OF_SERVICE: "https://www.softcodes.ai/terms",
} as const

/**
 * Security Configuration
 */
export const SECURITY_CONFIG = {
	// JWT validation settings
	JWT: {
		ALGORITHM: "RS256",
		ISSUER_WHITELIST: ["https://clerk.softcodes.ai", "https://softcodes.clerk.accounts.dev"],
		MAX_AGE_SECONDS: 3600, // 1 hour
		CLOCK_SKEW_SECONDS: 300, // 5 minutes
	},

	// Rate limiting
	RATE_LIMITING: {
		ENABLED: getBooleanEnvVar("RATE_LIMITING_ENABLED", true),
		MAX_REQUESTS_PER_MINUTE: getNumericEnvVar("RATE_LIMIT_RPM", 60),
		MAX_REQUESTS_PER_HOUR: getNumericEnvVar("RATE_LIMIT_RPH", 1000),
	},

	// CORS settings
	CORS: {
		ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS?.split(",") || ["https://softcodes.ai"],
		ALLOW_CREDENTIALS: getBooleanEnvVar("CORS_ALLOW_CREDENTIALS", true),
	},
} as const

/**
 * Development and Debug Configuration
 */
export const DEBUG_CONFIG = {
	// Enable debug logging
	ENABLED: getBooleanEnvVar("DEBUG_ENABLED", false),

	// Log levels
	LOG_LEVEL: getOptionalEnvVar("LOG_LEVEL", "info"),

	// Performance monitoring
	ENABLE_PERFORMANCE_MONITORING: getBooleanEnvVar("ENABLE_PERF_MONITORING", false),

	// Mock services for testing
	USE_MOCK_SERVICES: getBooleanEnvVar("USE_MOCK_SERVICES", false),
} as const

/**
 * Feature Flags
 */
export const FEATURE_FLAGS = {
	// Credit system features
	CREDIT_SYSTEM_ENABLED: getBooleanEnvVar("FEATURE_CREDIT_SYSTEM", true),
	CREDIT_BADGE_ENABLED: getBooleanEnvVar("FEATURE_CREDIT_BADGE", true),

	// Authentication features
	OAUTH_ENABLED: getBooleanEnvVar("FEATURE_OAUTH", true),
	JWT_VALIDATION_ENABLED: getBooleanEnvVar("FEATURE_JWT_VALIDATION", true),

	// AI features
	AUTOCOMPLETE_ENABLED: getBooleanEnvVar("FEATURE_AUTOCOMPLETE", true),
	GHOST_TEXT_ENABLED: getBooleanEnvVar("FEATURE_GHOST_TEXT", true),

	// Development features
	TELEMETRY_ENABLED: getBooleanEnvVar("FEATURE_TELEMETRY", true),
	ERROR_REPORTING_ENABLED: getBooleanEnvVar("FEATURE_ERROR_REPORTING", true),
} as const

/**
 * Validation helper to check if all required configuration is present
 */
export function validateConfiguration(): {
	isValid: boolean
	errors: string[]
	warnings: string[]
} {
	const errors: string[] = []
	const warnings: string[] = []

	// Check required Supabase configuration
	if (!API_CONFIG.SUPABASE.URL) {
		errors.push("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required")
	}
	if (!API_CONFIG.SUPABASE.SERVICE_ROLE_KEY) {
		errors.push("SUPABASE_SERVICE_ROLE_KEY is required")
	}
	if (!API_CONFIG.SUPABASE.ANON_KEY) {
		errors.push("SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY is required")
	}

	// Check authentication configuration
	if (!API_CONFIG.CLERK.PUBLISHABLE_KEY) {
		warnings.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY not set - authentication may not work")
	}
	if (!API_CONFIG.CLERK.SECRET_KEY) {
		warnings.push("CLERK_SECRET_KEY not set - server-side auth operations may fail")
	}

	// Check credit system configuration
	if (CREDIT_CONFIG.USD_PER_CREDIT <= 0) {
		errors.push("CREDIT_USD_RATE must be greater than 0")
	}
	if (CREDIT_CONFIG.USD_PER_CREDIT > 1) {
		warnings.push("CREDIT_USD_RATE seems unusually high (>$1 per credit)")
	}

	return {
		isValid: errors.length === 0,
		errors,
		warnings,
	}
}

/**
 * Get configuration summary for debugging (without sensitive values)
 */
export function getConfigurationSummary(): Record<string, any> {
	return {
		apis: {
			openrouter: !!API_CONFIG.OPENROUTER.BASE_URL,
			clerk: !!API_CONFIG.CLERK.PUBLISHABLE_KEY,
			supabase: !!API_CONFIG.SUPABASE.URL,
		},
		credit: {
			usdPerCredit: CREDIT_CONFIG.USD_PER_CREDIT,
			lowThreshold: CREDIT_CONFIG.LOW_CREDIT_THRESHOLD,
			badgeEnabled: FEATURE_FLAGS.CREDIT_BADGE_ENABLED,
		},
		features: FEATURE_FLAGS,
		debug: {
			enabled: DEBUG_CONFIG.ENABLED,
			logLevel: DEBUG_CONFIG.LOG_LEVEL,
			mockServices: DEBUG_CONFIG.USE_MOCK_SERVICES,
		},
	}
}
