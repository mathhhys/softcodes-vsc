/**
 * Centralized Supabase Configuration Service
 *
 * Provides reliable, lazy-initialized Supabase clients with proper error handling,
 * configuration validation, and consistent environment variable patterns.
 *
 * Solves the "supabaseUrl is required" error by ensuring environment variables
 * are properly loaded before client initialization.
 */

import { SupabaseClient, createClient } from "@supabase/supabase-js"

/**
 * Supabase configuration interface
 */
export interface SupabaseConfig {
	url: string
	serviceRoleKey: string
	anonKey: string
	isValid: boolean
	errors: string[]
	warnings: string[]
}

/**
 * Client type enum for different authentication levels
 */
export enum SupabaseClientType {
	SERVICE_ROLE = "service_role", // For credit operations, admin functions
	ANON = "anon", // For realtime subscriptions, read-only
	AUTO = "auto", // Automatically choose best available
}

/**
 * Client initialization options
 */
export interface SupabaseClientOptions {
	clientType?: SupabaseClientType
	realtime?: {
		enabled?: boolean
		eventsPerSecond?: number
	}
	timeout?: number
	retries?: number
}

/**
 * Centralized Supabase Configuration Service
 */
export class SupabaseConfigService {
	private static instance: SupabaseConfigService
	private serviceRoleClient: SupabaseClient | null = null
	private anonClient: SupabaseClient | null = null
	private configCache: SupabaseConfig | null = null
	private initializationPromise: Promise<SupabaseConfig> | null = null
	private readonly MAX_RETRIES = 3
	private readonly INIT_TIMEOUT_MS = 10000

	private constructor() {
		// Private constructor for singleton pattern
	}

	static getInstance(): SupabaseConfigService {
		if (!SupabaseConfigService.instance) {
			SupabaseConfigService.instance = new SupabaseConfigService()
		}
		return SupabaseConfigService.instance
	}

	/**
	 * Get validated Supabase configuration with comprehensive error handling
	 */
	async getConfig(): Promise<SupabaseConfig> {
		// Return cached config if available
		if (this.configCache) {
			return this.configCache
		}

		// If initialization is already in progress, wait for it
		if (this.initializationPromise) {
			return this.initializationPromise
		}

		// Start initialization
		this.initializationPromise = this.initializeConfig()

		try {
			this.configCache = await this.initializationPromise
			return this.configCache
		} catch (error) {
			// Reset promise on error so next call can retry
			this.initializationPromise = null
			throw error
		}
	}

	/**
	 * Initialize configuration with retry logic and comprehensive validation
	 */
	private async initializeConfig(): Promise<SupabaseConfig> {
		console.log("[SUPABASE-CONFIG] Starting configuration initialization...")

		let lastError: Error | null = null

		for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
			try {
				console.log(`[SUPABASE-CONFIG] Initialization attempt ${attempt}/${this.MAX_RETRIES}`)

				// Wait for environment variables to be available
				await this.waitForEnvironmentVariables()

				const config = this.validateConfiguration()

				if (config.isValid) {
					console.log("[SUPABASE-CONFIG] ✅ Configuration validated successfully")
					return config
				} else {
					throw new Error(`Configuration validation failed: ${config.errors.join(", ")}`)
				}
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error))
				console.warn(`[SUPABASE-CONFIG] Attempt ${attempt} failed:`, lastError.message)

				if (attempt < this.MAX_RETRIES) {
					const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000) // Exponential backoff
					console.log(`[SUPABASE-CONFIG] Retrying in ${delay}ms...`)
					await new Promise((resolve) => setTimeout(resolve, delay))
				}
			}
		}

		throw new Error(`Supabase configuration failed after ${this.MAX_RETRIES} attempts: ${lastError?.message}`)
	}

	/**
	 * Wait for environment variables to be loaded
	 */
	private async waitForEnvironmentVariables(): Promise<void> {
		const startTime = Date.now()
		const timeout = this.INIT_TIMEOUT_MS

		while (Date.now() - startTime < timeout) {
			// Check if any of the expected environment variables are available
			const hasAnySupabaseVar = !!(
				process.env.SUPABASE_URL ||
				process.env.NEXT_PUBLIC_SUPABASE_URL ||
				process.env.SUPABASE_SERVICE_ROLE_KEY ||
				process.env.SUPABASE_ANON_KEY ||
				process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
			)

			if (hasAnySupabaseVar) {
				console.log("[SUPABASE-CONFIG] Environment variables detected")
				return
			}

			// Wait 100ms before checking again
			await new Promise((resolve) => setTimeout(resolve, 100))
		}

		console.warn("[SUPABASE-CONFIG] Timeout waiting for environment variables, proceeding with fallbacks")
	}

	/**
	 * Validate and extract Supabase configuration from environment
	 */
	private validateConfiguration(): SupabaseConfig {
		const errors: string[] = []
		const warnings: string[] = []

		console.log("[SUPABASE-CONFIG] Validating environment variables...")
		console.log("[SUPABASE-CONFIG] Environment check:", {
			SUPABASE_URL: !!process.env.SUPABASE_URL,
			NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
			SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
			SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
			NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
		})

		// Validate Supabase URL (REQUIRED - no fallbacks)
		const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL

		if (!url) {
			errors.push("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL environment variable is required")
		} else if (!url.startsWith("https://")) {
			errors.push("Supabase URL must use HTTPS for security")
		} else if (!url.includes(".supabase.co")) {
			warnings.push("URL does not appear to be a valid Supabase URL")
		}

		// Validate Service Role Key (REQUIRED - no fallbacks)
		const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

		if (!serviceRoleKey) {
			errors.push("SUPABASE_SERVICE_ROLE_KEY environment variable is required for credit operations")
		} else if (!this.isValidJWT(serviceRoleKey)) {
			errors.push("SUPABASE_SERVICE_ROLE_KEY appears to be invalid (not a valid JWT format)")
		} else if (!serviceRoleKey.includes("service_role")) {
			warnings.push("Service role key does not appear to contain expected role claim")
		}

		// Validate Anon Key (REQUIRED - no fallbacks)
		const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

		if (!anonKey) {
			errors.push(
				"SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable is required for realtime features",
			)
		} else if (!this.isValidJWT(anonKey)) {
			errors.push("SUPABASE_ANON_KEY appears to be invalid (not a valid JWT format)")
		} else if (!anonKey.includes("anon")) {
			warnings.push("Anonymous key does not appear to contain expected role claim")
		}

		// Additional security validations
		if (serviceRoleKey && anonKey && serviceRoleKey === anonKey) {
			errors.push("Service role key and anonymous key must be different")
		}

		// Validate URL and keys are from the same Supabase project
		if (url && serviceRoleKey && this.isValidJWT(serviceRoleKey)) {
			try {
				const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
				const keyPayload = JSON.parse(atob(serviceRoleKey.split(".")[1]))
				if (projectRef && keyPayload.ref && projectRef !== keyPayload.ref) {
					errors.push("Supabase URL and service role key are from different projects")
				}
			} catch (error) {
				warnings.push("Could not validate URL and key consistency")
			}
		}

		const config: SupabaseConfig = {
			url: url || "",
			serviceRoleKey: serviceRoleKey || "",
			anonKey: anonKey || "",
			isValid: errors.length === 0,
			errors,
			warnings,
		}

		// Log configuration status
		console.log("[SUPABASE-CONFIG] Configuration validation result:", {
			isValid: config.isValid,
			hasUrl: !!url,
			hasServiceKey: !!serviceRoleKey,
			hasAnonKey: !!anonKey,
			errorCount: errors.length,
			warningCount: warnings.length,
			url: url ? `${url.substring(0, 30)}...` : "none",
		})

		if (errors.length > 0) {
			console.error("[SUPABASE-CONFIG] Configuration errors:", errors)
		}

		if (warnings.length > 0) {
			console.warn("[SUPABASE-CONFIG] Configuration warnings:", warnings)
		}

		return config
	}

	/**
	 * Get Supabase client with specified authentication level
	 */
	async getClient(options: SupabaseClientOptions = {}): Promise<SupabaseClient> {
		const config = await this.getConfig()

		if (!config.isValid) {
			throw new Error(`Supabase configuration is invalid: ${config.errors.join(", ")}`)
		}

		const clientType = options.clientType || SupabaseClientType.AUTO

		// Auto-select client type based on availability
		let actualClientType = clientType
		if (clientType === SupabaseClientType.AUTO) {
			actualClientType = config.serviceRoleKey ? SupabaseClientType.SERVICE_ROLE : SupabaseClientType.ANON
		}

		console.log(`[SUPABASE-CONFIG] Creating ${actualClientType} client...`)

		// Return cached client if available
		if (actualClientType === SupabaseClientType.SERVICE_ROLE && this.serviceRoleClient) {
			return this.serviceRoleClient
		}
		if (actualClientType === SupabaseClientType.ANON && this.anonClient) {
			return this.anonClient
		}

		// Create new client with appropriate authentication
		const clientOptions: any = {
			auth: {
				autoRefreshToken: false, // VSCode extension doesn't need auto-refresh
				persistSession: false, // Don't persist sessions in VSCode
			},
		}

		// Add realtime configuration if requested
		if (options.realtime?.enabled) {
			clientOptions.realtime = {
				params: {
					eventsPerSecond: options.realtime.eventsPerSecond || 10,
				},
			}
		}

		let client: SupabaseClient
		let authKey: string

		if (actualClientType === SupabaseClientType.SERVICE_ROLE) {
			authKey = config.serviceRoleKey
			client = createClient(config.url, authKey, clientOptions)
			this.serviceRoleClient = client
			console.log("[SUPABASE-CONFIG] ✅ Service role client created and cached")
		} else {
			authKey = config.anonKey
			client = createClient(config.url, authKey, clientOptions)
			this.anonClient = client
			console.log("[SUPABASE-CONFIG] ✅ Anonymous client created and cached")
		}

		// Test connectivity
		if (options.clientType !== SupabaseClientType.ANON) {
			await this.testClientConnectivity(client, actualClientType)
		}

		return client
	}

	/**
	 * Test client connectivity and basic functionality
	 */
	private async testClientConnectivity(client: SupabaseClient, clientType: SupabaseClientType): Promise<void> {
		try {
			console.log(`[SUPABASE-CONFIG] Testing ${clientType} client connectivity...`)

			// Simple connectivity test - just check if we can make a basic query
			const { error } = await client.from("users").select("count", { count: "exact", head: true }).limit(1)

			if (error && !error.message.includes('relation "users" does not exist')) {
				throw new Error(`Database connectivity test failed: ${error.message}`)
			}

			console.log(`[SUPABASE-CONFIG] ✅ ${clientType} client connectivity verified`)
		} catch (error) {
			console.warn(`[SUPABASE-CONFIG] ⚠️ ${clientType} client connectivity test failed:`, error)
			// Don't throw - connectivity issues might be temporary
		}
	}

	/**
	 * Get service role client specifically for credit operations
	 */
	async getServiceRoleClient(): Promise<SupabaseClient> {
		return this.getClient({ clientType: SupabaseClientType.SERVICE_ROLE })
	}

	/**
	 * Get anonymous client specifically for realtime subscriptions
	 */
	async getRealtimeClient(): Promise<SupabaseClient> {
		return this.getClient({
			clientType: SupabaseClientType.ANON,
			realtime: { enabled: true, eventsPerSecond: 10 },
		})
	}

	/**
	 * Test if credit database functions are available
	 */
	async testCreditFunctions(): Promise<{
		available: boolean
		functions: Record<string, boolean>
		errors: string[]
	}> {
		try {
			const client = await this.getServiceRoleClient()
			const functions = {
				get_user_credit_info: false,
				deduct_user_credits: false,
				add_user_credits: false,
			}
			const errors: string[] = []

			// Test get_user_credit_info function
			try {
				const { error } = await client.rpc("get_user_credit_info", {
					p_clerk_id: "test_user_id_for_function_check",
				})

				// If we get a "user not found" error, the function exists and works
				// If we get a "function does not exist" error, we need to deploy schema
				if (!error || error.message.includes("user_not_found") || error.message.includes("User not found")) {
					functions.get_user_credit_info = true
				} else if (error.message.includes("function") && error.message.includes("does not exist")) {
					errors.push("get_user_credit_info function not found - schema needs deployment")
				}
			} catch (error) {
				errors.push(
					`get_user_credit_info test failed: ${error instanceof Error ? error.message : String(error)}`,
				)
			}

			// Test deduct_user_credits function
			try {
				const { error } = await client.rpc("deduct_user_credits", {
					p_user_id: "00000000-0000-0000-0000-000000000000", // Invalid UUID for test
					p_credits_to_deduct: 1,
					p_usd_amount: 0.014,
					p_description: "Function availability test",
				})

				if (!error || error.message.includes("user_not_found") || error.message.includes("User not found")) {
					functions.deduct_user_credits = true
				} else if (error.message.includes("function") && error.message.includes("does not exist")) {
					errors.push("deduct_user_credits function not found - schema needs deployment")
				}
			} catch (error) {
				errors.push(
					`deduct_user_credits test failed: ${error instanceof Error ? error.message : String(error)}`,
				)
			}

			const allFunctionsAvailable = Object.values(functions).every((available) => available)

			console.log("[SUPABASE-CONFIG] Credit functions test result:", {
				available: allFunctionsAvailable,
				functions,
				errorCount: errors.length,
			})

			return {
				available: allFunctionsAvailable,
				functions,
				errors,
			}
		} catch (error) {
			console.error("[SUPABASE-CONFIG] Credit functions test failed:", error)
			return {
				available: false,
				functions: {},
				errors: [`Credit functions test failed: ${error instanceof Error ? error.message : String(error)}`],
			}
		}
	}

	/**
	 * Check if a string is a valid JWT format
	 */
	private isValidJWT(token: string): boolean {
		if (!token || typeof token !== "string") {
			return false
		}

		const parts = token.split(".")
		return parts.length === 3 && parts.every((part) => part.length > 0)
	}

	/**
	 * Clear cached clients and configuration (useful for testing or reconnection)
	 */
	clearCache(): void {
		console.log("[SUPABASE-CONFIG] Clearing cached clients and configuration...")
		this.serviceRoleClient = null
		this.anonClient = null
		this.configCache = null
		this.initializationPromise = null
	}

	/**
	 * Get configuration status for debugging
	 */
	async getStatus(): Promise<{
		isConfigured: boolean
		hasServiceRoleClient: boolean
		hasAnonClient: boolean
		config?: SupabaseConfig
		lastError?: string
	}> {
		try {
			const config = await this.getConfig()
			return {
				isConfigured: config.isValid,
				hasServiceRoleClient: !!this.serviceRoleClient,
				hasAnonClient: !!this.anonClient,
				config,
			}
		} catch (error) {
			return {
				isConfigured: false,
				hasServiceRoleClient: false,
				hasAnonClient: false,
				lastError: error instanceof Error ? error.message : String(error),
			}
		}
	}
}

/**
 * Singleton instance for easy access
 */
export const supabaseConfig = SupabaseConfigService.getInstance()

/**
 * Convenience functions for common operations
 */

/**
 * Get service role client for credit operations
 */
export async function getSupabaseServiceClient(): Promise<SupabaseClient> {
	return supabaseConfig.getServiceRoleClient()
}

/**
 * Get realtime client for live updates
 */
export async function getSupabaseRealtimeClient(): Promise<SupabaseClient> {
	return supabaseConfig.getRealtimeClient()
}

/**
 * Test if Supabase is properly configured and credit functions are available
 */
export async function validateSupabaseSetup(): Promise<{
	configured: boolean
	functionsAvailable: boolean
	errors: string[]
	warnings: string[]
}> {
	try {
		const config = await supabaseConfig.getConfig()
		const functionsTest = await supabaseConfig.testCreditFunctions()

		return {
			configured: config.isValid,
			functionsAvailable: functionsTest.available,
			errors: [...config.errors, ...functionsTest.errors],
			warnings: config.warnings,
		}
	} catch (error) {
		return {
			configured: false,
			functionsAvailable: false,
			errors: [`Supabase setup validation failed: ${error instanceof Error ? error.message : String(error)}`],
			warnings: [],
		}
	}
}
