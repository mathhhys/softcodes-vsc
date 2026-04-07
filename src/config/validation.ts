/**
 * Configuration Validation Module
 *
 * Provides runtime validation for environment variables and configuration
 * to prevent security issues and ensure proper application setup.
 */

import { API_CONFIG } from "./constants"

interface ValidationResult {
	isValid: boolean
	errors: string[]
	warnings: string[]
}

interface EnvironmentValidation {
	variable: string
	required: boolean
	description: string
	validate?: (value: string | undefined) => boolean
	errorMessage?: string
}

const REQUIRED_ENV_VARS: EnvironmentValidation[] = [
	{
		variable: "SUPABASE_URL",
		required: true,
		description: "Supabase project URL",
		validate: (value) => value !== undefined && value.startsWith("https://"),
		errorMessage: "SUPABASE_URL must be a valid HTTPS URL",
	},
	{
		variable: "SUPABASE_SERVICE_ROLE_KEY",
		required: true,
		description: "Supabase service role key with full permissions",
		validate: (value) => value !== undefined && value.length > 20,
		errorMessage: "SUPABASE_SERVICE_ROLE_KEY must be a valid service role key",
	},
	{
		variable: "SUPABASE_ANON_KEY",
		required: true,
		description: "Supabase anonymous key for client-side operations",
		validate: (value) => value !== undefined && value.length > 20,
		errorMessage: "SUPABASE_ANON_KEY must be a valid anonymous key",
	},
	{
		variable: "OPENROUTER_API_KEY",
		required: true,
		description: "OpenRouter API key for AI model access",
		validate: (value) => value !== undefined && value.length > 20,
		errorMessage: "OPENROUTER_API_KEY must be a valid API key",
	},
	{
		variable: "CLERK_SECRET_KEY",
		required: true,
		description: "Clerk authentication secret key",
		validate: (value) => value !== undefined && value.length > 20,
		errorMessage: "CLERK_SECRET_KEY must be a valid secret key",
	},
]

const OPTIONAL_ENV_VARS: EnvironmentValidation[] = [
	{
		variable: "REQUESTY_API_KEY",
		required: false,
		description: "Requesty API key (optional)",
	},
	{
		variable: "GLAMA_API_KEY",
		required: false,
		description: "Glama API key (optional)",
	},
	{
		variable: "KILOCODE_POSTHOG_API_KEY",
		required: false,
		description: "PostHog analytics API key (optional)",
	},
	{
		variable: "NEXT_PUBLIC_POSTHOG_KEY",
		required: false,
		description: "Public PostHog key for client-side analytics (optional)",
	},
]

export class ConfigValidator {
	/**
	 * Validate all environment variables and configuration
	 */
	static validateEnvironment(): ValidationResult {
		const errors: string[] = []
		const warnings: string[] = []

		// Check required environment variables
		for (const envVar of REQUIRED_ENV_VARS) {
			const value = process.env[envVar.variable]

			if (envVar.required && (value === undefined || value === "")) {
				errors.push(`Missing required environment variable: ${envVar.variable} - ${envVar.description}`)
				continue
			}

			if (value && envVar.validate && !envVar.validate(value)) {
				errors.push(`${envVar.variable}: ${envVar.errorMessage}`)
			}
		}

		// Check optional environment variables for basic validation
		for (const envVar of OPTIONAL_ENV_VARS) {
			const value = process.env[envVar.variable]
			if (value && envVar.validate && !envVar.validate(value)) {
				warnings.push(`${envVar.variable}: ${envVar.errorMessage}`)
			}
		}

		// Check for common security issues
		this.checkSecurityIssues(warnings)

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
		}
	}

	/**
	 * Check for common security configuration issues
	 */
	private static checkSecurityIssues(warnings: string[]): void {
		// Check for default or test values in production
		if (process.env.NODE_ENV === "production") {
			const testPatterns = [/test/i, /example/i, /placeholder/i, /your\-/i, /dummy/i, /mock/i]

			for (const envVar of [...REQUIRED_ENV_VARS, ...OPTIONAL_ENV_VARS]) {
				const value = process.env[envVar.variable]
				if (value && testPatterns.some((pattern) => pattern.test(value))) {
					warnings.push(`Potential test value detected in production for ${envVar.variable}`)
				}
			}

			// Check for weak keys
			for (const envVar of REQUIRED_ENV_VARS) {
				const value = process.env[envVar.variable]
				if (value && value.length < 30) {
					warnings.push(`Short key detected for ${envVar.variable} - consider using longer, more secure keys`)
				}
			}
		}

		// Check for development values in non-development environment
		if (process.env.NODE_ENV !== "development") {
			const devPatterns = [
				/localhost/,
				/127\.0\.0\.1/,
				/\.local$/,
				/^https?:\/\/localhost/,
				/^https?:\/\/127\.0\.0\.1/,
			]

			const supabaseUrl = process.env.SUPABASE_URL
			if (supabaseUrl && devPatterns.some((pattern) => pattern.test(supabaseUrl))) {
				warnings.push("Development Supabase URL detected in non-development environment")
			}
		}
	}

	/**
	 * Validate API configuration
	 */
	static validateApiConfig(): ValidationResult {
		const errors: string[] = []
		const warnings: string[] = []

		// Check that API endpoints are properly configured
		if (!API_CONFIG.SUPABASE.URL || API_CONFIG.SUPABASE.URL.includes("test.supabase.co")) {
			warnings.push("Supabase URL is using test configuration")
		}

		if (!API_CONFIG.OPENROUTER.BASE_URL || API_CONFIG.OPENROUTER.BASE_URL.includes("test")) {
			warnings.push("OpenRouter base URL may be using test configuration")
		}

		if (!API_CONFIG.CLERK.BASE_URL || API_CONFIG.CLERK.BASE_URL?.includes("test")) {
			warnings.push("Clerk base URL may be using test configuration")
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
		}
	}

	/**
	 * Get environment validation report
	 */
	static getValidationReport(): string {
		const envValidation = this.validateEnvironment()
		const apiValidation = this.validateApiConfig()

		const allErrors = [...envValidation.errors, ...apiValidation.errors]
		const allWarnings = [...envValidation.warnings, ...apiValidation.warnings]

		let report = `Environment Configuration Validation Report\n`
		report += `===============================================\n\n`
		report += `Timestamp: ${new Date().toISOString()}\n`
		report += `Node Environment: ${process.env.NODE_ENV || "not set"}\n\n`

		if (allErrors.length > 0) {
			report += `❌ ERRORS (${allErrors.length}):\n`
			allErrors.forEach((error, index) => {
				report += `${index + 1}. ${error}\n`
			})
			report += "\n"
		} else {
			report += `✅ No critical errors found\n\n`
		}

		if (allWarnings.length > 0) {
			report += `⚠️  WARNINGS (${allWarnings.length}):\n`
			allWarnings.forEach((warning, index) => {
				report += `${index + 1}. ${warning}\n`
			})
			report += "\n"
		} else {
			report += `✅ No warnings\n\n`
		}

		report += `Environment Variables Status:\n`
		report += `-----------------------------\n`

		const allEnvVars = [...REQUIRED_ENV_VARS, ...OPTIONAL_ENV_VARS]
		allEnvVars.forEach((envVar) => {
			const value = process.env[envVar.variable]
			const status = value ? "✅ Set" : "❌ Missing"
			const maskedValue = value ? this.maskSensitiveValue(envVar.variable, value) : "Not set"

			report += `${envVar.variable}: ${status} (${maskedValue}) - ${envVar.description}\n`
		})

		return report
	}

	/**
	 * Mask sensitive values for logging
	 */
	private static maskSensitiveValue(variable: string, value: string): string {
		const sensitivePatterns = [/_KEY$/, /_SECRET$/, /_PASSWORD$/, /_TOKEN$/]

		if (sensitivePatterns.some((pattern) => pattern.test(variable))) {
			if (value.length <= 8) {
				return "***"
			}
			return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`
		}

		return value
	}

	/**
	 * Throw error if configuration is invalid
	 */
	static ensureValidConfiguration(): void {
		const validation = this.validateEnvironment()

		if (!validation.isValid) {
			throw new Error(
				`Invalid configuration:\n${validation.errors.join("\n")}\n\n` +
					`Please check your environment variables and try again.`,
			)
		}

		// Log warnings but don't throw
		if (validation.warnings.length > 0) {
			console.warn("Configuration warnings:\n", validation.warnings.join("\n"))
		}
	}
}

// Export singleton instance for easy access
export const configValidator = new ConfigValidator()

// Auto-validate on import in non-test environments
if (process.env.NODE_ENV !== "test") {
	const validation = ConfigValidator.validateEnvironment()
	if (!validation.isValid) {
		console.error("❌ Configuration validation failed:")
		validation.errors.forEach((error) => console.error(`   ${error}`))

		if (process.env.NODE_ENV === "production") {
			throw new Error("Production configuration validation failed")
		}
	}

	if (validation.warnings.length > 0) {
		console.warn("⚠️  Configuration warnings:")
		validation.warnings.forEach((warning) => console.warn(`   ${warning}`))
	}
}
