/**
 * Credit Management Service
 *
 * High-performance credit management service with minimal latency for VSCode extension.
 * Integrates with existing JWT verification and Supabase user systems.
 * Supports both user credits and organization credits based on JWT org_id claim.
 */

import Decimal from "decimal.js"

import { JWTVerificationService, extractUserFromJWT } from "../auth/jwtVerification"
import { verifyJWTUserInSupabase } from "../auth/supabaseUserVerification"
import { getSupabaseServiceClient } from "./supabaseConfig"
import { logCreditDeductionAttempt, diagnoseDatabaseSchema } from "./creditDiagnosticLogger"
import { creditDeduplicationLogger } from "./creditDeduplicationLogger"
import { CREDIT_CONFIG } from "../config/constants"
import { parseJWTUnsafe } from "../auth/jwtUtils"

/**
 * Credit conversion configuration
 */
interface CreditConfig {
	OPERATION_DEDUP_TTL_MS: number
	CREDIT_TO_USD_RATE: number
	LOW_CREDIT_THRESHOLD: number
	MIN_CREDIT_BALANCE: number
	CACHE_TTL_MS: number
	JWT_CACHE_TTL_MS: number
}

/**
 * Credit transaction result
 */
interface CreditTransaction {
	success: boolean
	creditsDeducted?: number
	balanceBefore?: number
	balanceAfter?: number
	usdAmount?: number
	transactionId?: string
	userId?: string
	error?: string
	message?: string
}

/**
 * User credit information
 */
interface UserCreditInfo {
	userId: string
	clerkId: string
	currentCredits: number
	totalSpent: number
	creditsUsed: number
	planType?: string
	lastUpdate?: string
}

/**
 * Cache entry structure
 */
interface CacheEntry<T> {
	data: T
	expires: number
}

/**
 * Credit operation metadata
 */
interface CreditOperationMetadata {
	operationType?: string
	extensionVersion?: string
	apiEndpoint?: string
	requestId?: string
	[key: string]: any
}

/**
 * High-performance credit management service with minimal latency
 * Supports organization-aware credit operations via JWT org_id claim
 */
export class CreditManagerService {
	private static instance: CreditManagerService
	private jwtService: JWTVerificationService
	private userCache = new Map<string, CacheEntry<UserCreditInfo>>()
	private jwtCache = new Map<string, CacheEntry<any>>()
	private operationLocks = new Map<string, Promise<CreditTransaction>>()
	private processedOperations = new Map<string, CacheEntry<CreditTransaction>>()
	private readonly config: CreditConfig

	private constructor() {
		this.jwtService = JWTVerificationService.getInstance()
		this.config = {
			CREDIT_TO_USD_RATE: CREDIT_CONFIG.USD_PER_CREDIT,
			LOW_CREDIT_THRESHOLD: CREDIT_CONFIG.LOW_CREDIT_THRESHOLD,
			MIN_CREDIT_BALANCE: 0,
			CACHE_TTL_MS: 30000, // 30 seconds for user data cache - enables near real-time updates
			JWT_CACHE_TTL_MS: 300000, // 5 minutes for JWT cache - balance between performance and freshness
			OPERATION_DEDUP_TTL_MS: 60000, // Remember successful operations for 60 seconds to prevent duplicate deductions
		}
	}

	static getInstance(): CreditManagerService {
		if (!CreditManagerService.instance) {
			CreditManagerService.instance = new CreditManagerService()
		}
		return CreditManagerService.instance
	}

	/**
	 * Extract organization ID from JWT token
	 * Returns undefined if no org_id is present, enabling automatic fallback to user credits
	 */
	extractOrgIdFromJWT(jwtToken: string): string | undefined {
		try {
			const parseResult = parseJWTUnsafe(jwtToken)
			if (parseResult.success && parseResult.parts?.payload) {
				return parseResult.parts.payload.org_id
			}
		} catch (error) {
			console.warn("[CREDIT-MANAGER] Failed to extract org_id from JWT:", error)
		}
		return undefined
	}

	/**
	 * Main function: Deduct credits with JWT verification
	 * Optimized for minimal latency with intelligent caching
	 */
	async deductCreditsFromJWT(
		jwtToken: string,
		usdAmount: number,
		description?: string,
		metadata?: CreditOperationMetadata,
		providerId?: string,
	): Promise<CreditTransaction> {
		const startTime = Date.now()
		const requestId = metadata?.requestId || this.generateRequestId()
		const mergedMetadata: CreditOperationMetadata = { ...metadata, requestId }

		// Enhanced duplicate detection with operation fingerprint
		const operationFingerprint = this.generateOperationFingerprint(jwtToken, usdAmount, description, requestId)
		const cachedResult = this.getProcessedOperation(operationFingerprint)

		if (cachedResult) {
			console.log(
				`[CREDIT-MANAGER] ${requestId}: Duplicate deduction request detected (fingerprint: ${operationFingerprint}), returning cached transaction`,
			)
			return cachedResult
		}

		const inFlight = this.operationLocks.get(operationFingerprint)
		if (inFlight) {
			console.log(
				`[CREDIT-MANAGER] ${requestId}: Awaiting in-flight deduction to prevent duplicate operations (fingerprint: ${operationFingerprint})`,
			)
			return inFlight
		}

		const deductionPromise = this.performDeductionFlow(
			jwtToken,
			usdAmount,
			description,
			mergedMetadata,
			providerId,
			startTime,
			requestId,
		)

		this.operationLocks.set(operationFingerprint, deductionPromise)

		try {
			const transaction = await deductionPromise
			if (transaction.success) {
				this.storeProcessedOperation(operationFingerprint, transaction)
				// Also store by requestId for backward compatibility
				this.storeProcessedOperation(requestId, transaction)
			}
			return transaction
		} finally {
			this.operationLocks.delete(operationFingerprint)
		}
	}

	private async performDeductionFlow(
		jwtToken: string,
		usdAmount: number,
		description: string | undefined,
		metadata: CreditOperationMetadata | undefined,
		providerId: string | undefined,
		startTime: number,
		requestId: string,
	): Promise<CreditTransaction> {
		try {
			console.log(`[CREDIT-MANAGER] ${requestId}: Starting credit deduction for $${usdAmount}`)

			// Step 1: Fast JWT verification and user extraction (cached)
			const userInfo = await this.extractUserFromJWTCached(jwtToken)

			if (!userInfo) {
				return {
					success: false,
					error: "invalid_jwt",
					message: "Invalid or expired JWT token",
				}
			}

			// Step 2: Convert USD to credits
			const creditsToDeduct = this.convertUSDToCredits(usdAmount, providerId)
			console.log(`[CREDIT-MANAGER] ${requestId}: Converting $${usdAmount} to ${creditsToDeduct} credits`)

			// Step 3: Fast user verification with cache
			const userCredits = await this.getUserCreditsWithCache(userInfo.userId, jwtToken)

			if (!userCredits) {
				return {
					success: false,
					error: "user_not_found",
					message: "User not found in database",
				}
			}

			// Step 4: Pre-validation (avoid database call if insufficient)
			if (userCredits.currentCredits < creditsToDeduct) {
				console.log(
					`[CREDIT-MANAGER] ${requestId}: Insufficient credits - Required: ${creditsToDeduct}, Available: ${userCredits.currentCredits}`,
				)
				return {
					success: false,
					error: "insufficient_credits",
					message: `Insufficient credits. Required: ${creditsToDeduct}, Available: ${userCredits.currentCredits}`,
					balanceBefore: userCredits.currentCredits,
				}
			}

			// Step 5: Atomic database operation
			const transaction = await this.executeAtomicDeduction(
				userCredits.userId,
				creditsToDeduct,
				usdAmount,
				description,
				{ ...metadata, providerId },
				jwtToken,
			)

			// Step 6: Update cache and broadcast update immediately
			if (transaction.success) {
				// Update cache with new balance instead of clearing it
				// This prevents hitting Supabase on the next immediate request (e.g. pre-check)
				if (transaction.balanceAfter !== undefined) {
					const updatedUserCredits: UserCreditInfo = {
						...userCredits,
						currentCredits: transaction.balanceAfter,
						creditsUsed: userCredits.creditsUsed + (transaction.creditsDeducted || 0),
						totalSpent: userCredits.totalSpent + (transaction.usdAmount || 0),
						lastUpdate: new Date().toISOString(),
					}
					this.updateUserCache(userInfo.userId, updatedUserCredits)
					console.log(
						`[CREDIT-MANAGER] ${requestId}: Updated user cache with new balance: ${transaction.balanceAfter}`,
					)
				} else {
					// Fallback if balanceAfter is missing (shouldn't happen)
					this.clearUserCache(userInfo.userId)
				}

				// Broadcast new balance to UI immediately via VSCode command
				try {
					const vscode = require("vscode")
					vscode.commands.executeCommand("softcodes.updateCreditBalance", transaction.balanceAfter)
					console.log(
						`[CREDIT-MANAGER] ${requestId}: Broadcasted balance update: ${transaction.balanceAfter}`,
					)
				} catch (error) {
					console.warn(`[CREDIT-MANAGER] ${requestId}: Failed to broadcast balance:`, error)
				}

				console.log(
					`[CREDIT-MANAGER] ${requestId}: Credit deduction successful - New balance: ${transaction.balanceAfter}`,
				)
			}

			const totalTime = Date.now() - startTime
			console.log(`[CREDIT-MANAGER] ${requestId}: Credit deduction completed in ${totalTime}ms`)

			return transaction
		} catch (error) {
			console.error(`[CREDIT-MANAGER] ${requestId}: Credit deduction failed:`, error)
			return {
				success: false,
				error: "system_error",
				message: `Credit deduction failed: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	/**
	 * Extract user info from JWT with caching for performance
	 * Uses structure validation instead of full signature verification for better reliability
	 */
	private async extractUserFromJWTCached(jwtToken: string): Promise<any> {
		// Create a safe cache key from token
		const tokenKey = this.createTokenCacheKey(jwtToken)
		const cached = this.jwtCache.get(tokenKey)

		if (cached && cached.expires > Date.now()) {
			return cached.data
		}

		try {
			// First try full JWT verification (with signature check)
			console.log("[CREDIT-MANAGER] Attempting full JWT verification for user extraction...")
			const userInfo = await extractUserFromJWT(jwtToken)

			if (userInfo) {
				console.log("[CREDIT-MANAGER] Full JWT verification successful")
				// Cache for short period to avoid repeated JWT verification
				this.jwtCache.set(tokenKey, {
					data: userInfo,
					expires: Date.now() + this.config.JWT_CACHE_TTL_MS,
				})
				return userInfo
			}
		} catch (error) {
			console.warn("[CREDIT-MANAGER] Full JWT verification failed, falling back to structure validation:", error)
		}

		// Fallback: Use structure validation without signature verification
		console.log("[CREDIT-MANAGER] Attempting JWT structure validation for user extraction...")
		try {
			const structureResult = await this.jwtService.validateTokenStructure(jwtToken)

			if (structureResult.valid && structureResult.payload) {
				console.log("[CREDIT-MANAGER] JWT structure validation successful, extracting user info...")

				// Extract user info from the validated payload
				const userInfo = this.jwtService.extractUserInfo(structureResult.payload)

				if (userInfo && userInfo.userId) {
					console.log("[CREDIT-MANAGER] User info extracted successfully from structure-validated JWT")

					// Cache the result (shorter TTL for structure-validated tokens)
					this.jwtCache.set(tokenKey, {
						data: userInfo,
						expires: Date.now() + this.config.JWT_CACHE_TTL_MS / 2, // Half the normal cache time
					})

					return userInfo
				} else {
					console.error("[CREDIT-MANAGER] Structure validation passed but user info extraction failed")
				}
			} else {
				console.error("[CREDIT-MANAGER] JWT structure validation failed:", structureResult.error)
			}
		} catch (error) {
			console.error("[CREDIT-MANAGER] JWT structure validation also failed:", error)
		}

		console.error("[CREDIT-MANAGER] All JWT validation methods failed for token extraction")
		return null
	}

	/**
	 * Get user credits with intelligent caching
	 * Routes to organization or user credits based on org_id presence in JWT
	 */
	private async getUserCreditsWithCache(clerkUserId: string, jwtToken?: string): Promise<UserCreditInfo | null> {
		const cached = this.userCache.get(clerkUserId)

		if (cached && cached.expires > Date.now()) {
			return cached.data
		}

		// Fetch fresh data from Supabase using our database function
		try {
			const supabase = await getSupabaseServiceClient()

			// Extract org_id from JWT for context-aware credit lookup
			const orgId = jwtToken ? this.extractOrgIdFromJWT(jwtToken) : undefined

			// Map Clerk identifier -> internal users.id (uuid) before calling get_credits_auto(uuid, uuid)
			let internalUserId: string
			try {
				const { data: mappedUser, error: mappedUserError } = await supabase
					.from("users")
					.select("id")
					.eq("clerk_id", clerkUserId)
					.single()

				if (mappedUserError) {
					// PGRST116: no rows (user not found)
					if (mappedUserError.code === "PGRST116") {
						console.log(`[CREDIT-MANAGER] No Supabase user row found for clerk_id: ${clerkUserId}`)
						return null
					}

					console.error("[CREDIT-MANAGER] Failed to map clerk_id to users.id:", mappedUserError)
					return null
				}

				if (!mappedUser?.id) {
					console.log(`[CREDIT-MANAGER] Supabase user mapping returned no id for clerk_id: ${clerkUserId}`)
					return null
				}

				internalUserId = String(mappedUser.id)
			} catch (mappingError) {
				console.error("[CREDIT-MANAGER] Failed to map clerk_id to users.id (exception):", mappingError)
				return null
			}

			// Use the new automatic context-aware credit lookup
			console.log(
				`[CREDIT-MANAGER] Fetching context-aware credits for: ${clerkUserId} (User: ${internalUserId}, Org: ${orgId || "none"})`,
			)
			// Cast to uuid explicitly to ensure PostgreSQL function signature match
			const { data, error } = await supabase.rpc("get_credits_auto", {
				p_user_id: internalUserId,
				p_org_id: orgId || null,
			})

			if (error || !data || !data.success) {
				console.error("[CREDIT-MANAGER] Credit lookup failed:", error || data?.message)

				// Fallback to legacy method if auto fails (e.g. migration not applied yet)
				console.log("[CREDIT-MANAGER] Falling back to legacy get_user_credit_info...")
				const { data: legacyData, error: legacyError } = await supabase.rpc("get_user_credit_info", {
					p_clerk_id: clerkUserId,
				})

				if (legacyError || !legacyData || !legacyData.success) {
					console.error("[CREDIT-MANAGER] Legacy lookup also failed:", legacyError || legacyData?.message)
					return null
				}

				const userCredits: UserCreditInfo = {
					userId: legacyData.user_id,
					clerkId: legacyData.clerk_id,
					currentCredits: legacyData.current_credits || 0,
					creditsUsed: legacyData.credits_used || 0,
					totalSpent: parseFloat(legacyData.total_spent_usd || "0"),
					planType: legacyData.plan_type,
					lastUpdate: legacyData.last_credit_update,
				}
				return userCredits
			}

			const userCredits: UserCreditInfo = {
				userId: data.user_id,
				clerkId: clerkUserId, // Use provided clerkId
				currentCredits: data.current_credits || 0,
				creditsUsed: data.credits_used || 0,
				totalSpent: parseFloat(data.total_spent_usd || "0"),
				planType: data.plan_type,
				lastUpdate: data.last_credit_update,
			}

			// Cache the result
			this.updateUserCache(clerkUserId, userCredits)

			return userCredits
		} catch (error) {
			console.error("[CREDIT-MANAGER] Error fetching user credits:", error)
			return null
		}
	}

	/**
	 * Execute atomic credit deduction using Supabase function
	 * Routes to organization or user credit deduction based on org_id in JWT
	 */
	private async executeAtomicDeduction(
		userId: string,
		creditsToDeduct: number,
		usdAmount: number,
		description?: string,
		metadata?: CreditOperationMetadata,
		jwtToken?: string,
	): Promise<CreditTransaction> {
		try {
			// Log detailed diagnostic information for debugging
			await logCreditDeductionAttempt(userId, creditsToDeduct, usdAmount, description, metadata)

			const supabase = await getSupabaseServiceClient()

			// Extract org_id from JWT for context-aware credit deduction
			const orgId = jwtToken ? this.extractOrgIdFromJWT(jwtToken) : undefined

			// Use the new automatic context-aware deduction wrapper
			console.log(`[CREDIT-MANAGER] Executing auto-deduction for user: ${userId} (Org: ${orgId || "none"})`)

			// Inject userId into metadata for proper seat attribution in analytics
			const enhancedMetadata = {
				...(metadata || {}),
				userId: userId,
			}

			const { data, error } = await supabase.rpc("deduct_credits_auto", {
				p_usd_amount: usdAmount,
				p_description: description || `Credit deduction for $${usdAmount}`,
				p_metadata: enhancedMetadata,
				p_user_id: userId,
				p_org_id: orgId || null,
			})

			if (error) {
				console.error("[CREDIT-MANAGER] Database deduction failed:", error)

				// If this is the usd_amount_old constraint violation, run comprehensive diagnosis
				if (error.message.includes("usd_amount_old") && error.message.includes("not-null constraint")) {
					console.error("[CREDIT-MANAGER] 🚨 DETECTED: usd_amount_old constraint violation!")
					console.error("[CREDIT-MANAGER] Running comprehensive database diagnosis...")

					try {
						const diagnosticResult = await diagnoseDatabaseSchema()
						console.error(
							"[CREDIT-MANAGER] Database diagnostic result:",
							JSON.stringify(diagnosticResult, null, 2),
						)
					} catch (diagError) {
						console.error("[CREDIT-MANAGER] Failed to run diagnostic:", diagError)
					}
				}

				throw new Error(`Database error: ${error.message}`)
			}

			// Handle TABLE return type: data is an array, first row contains the result
			if (!data || data.length === 0) {
				throw new Error("No result returned from deduct_user_credits function")
			}

			const result = data[0] // First (and only) row

			const transaction: CreditTransaction = {
				success: result.success,
				creditsDeducted: result.credits_deducted,
				balanceBefore: result.balance_before,
				balanceAfter: result.balance_after,
				usdAmount: result.usd_amount,
				transactionId: result.transaction_id,
				userId: result.user_id,
				error: result.error,
				message: result.message,
			}

			// Log if the operation failed (even if no Supabase error, function might return success=false)
			if (!transaction.success) {
				console.error("[CREDIT-MANAGER] Credit deduction failed in database function:", {
					error: transaction.error,
					message: transaction.message,
					balanceBefore: transaction.balanceBefore,
				})
			}

			return transaction
		} catch (error) {
			console.error("[CREDIT-MANAGER] Error executing deduction:", error)
			throw error
		}
	}

	/**
	 * Convert USD amount to credits
	 * ALWAYS use 2 decimal places to match database NUMERIC(10, 2) precision
	 */
	private convertUSDToCredits(usdAmount: number, providerId?: string): number {
		const rate = new Decimal(this.config.CREDIT_TO_USD_RATE)
		const usd = new Decimal(usdAmount)
		const credits = usd.div(rate)

		// Round to exactly 2 decimal places using banker's rounding (matches DB NUMERIC(10,2))
		// This eliminates floating-point precision errors
		return +credits.toFixed(2)
	}

	/**
	 * Convert credits to USD amount
	 */
	private convertCreditsToUSD(credits: number): number {
		return credits * this.config.CREDIT_TO_USD_RATE
	}

	/**
	 * Format cost display based on provider
	 */
	public formatCost(providerId: string, amount: number): string {
		const { formatPrice } = require("./priceFormatter")
		return formatPrice(providerId, amount)
	}

	/**
	 * Update user cache
	 */
	private updateUserCache(clerkUserId: string, data: UserCreditInfo): void {
		this.userCache.set(clerkUserId, {
			data,
			expires: Date.now() + this.config.CACHE_TTL_MS,
		})
	}

	/**
	 * Create safe cache key from JWT token
	 */
	private createTokenCacheKey(token: string): string {
		if (token.length < 20) return token
		// Use first 10 and last 10 characters for caching
		return token.substring(0, 10) + token.substring(token.length - 10)
	}

	/**
	 * Generate unique request ID for tracking
	 */
	private generateRequestId(): string {
		return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	}

	private getProcessedOperation(requestId: string): CreditTransaction | null {
		const cached = this.processedOperations.get(requestId)
		if (cached && cached.expires > Date.now()) {
			return cached.data
		}

		if (cached) {
			this.processedOperations.delete(requestId)
		}

		return null
	}

	private storeProcessedOperation(requestId: string, transaction: CreditTransaction): void {
		this.processedOperations.set(requestId, {
			data: transaction,
			expires: Date.now() + this.config.OPERATION_DEDUP_TTL_MS,
		})
	}

	/**
	 * Generate a unique fingerprint for an operation to prevent duplicates
	 * Combines user ID, amount, and request ID for stronger deduplication
	 */
	private generateOperationFingerprint(
		jwtToken: string,
		usdAmount: number,
		description?: string,
		requestId?: string,
	): string {
		try {
			// Extract user info from JWT without full validation for fingerprinting
			const tokenParts = jwtToken.split(".")
			if (tokenParts.length === 3) {
				const payload = JSON.parse(Buffer.from(tokenParts[1], "base64").toString())
				const userId = payload.sub || payload.user_id || "unknown"

				// Create fingerprint from user, amount, description, and request ID
				const fingerprintData = {
					requestId: requestId || "no-request-id", // Move to top to ensure uniqueness in truncated hash
					userId,
					usdAmount: usdAmount.toFixed(6), // High precision to catch small differences
					description: description?.substring(0, 50) || "no-description",
				}

				// Increase substring length to 64 to capture more entropy, especially with requestId at the start
				return `op_${Buffer.from(JSON.stringify(fingerprintData)).toString("base64").substring(0, 64)}`
			}
		} catch (error) {
			console.warn(
				"[CREDIT-MANAGER] Failed to generate operation fingerprint, falling back to request ID:",
				error,
			)
		}

		// Fallback to request ID if JWT parsing fails
		return requestId || `fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	}

	/**
	 * Clear user from cache (call after credit purchases)
	 */
	public clearUserCache(clerkUserId: string): void {
		this.userCache.delete(clerkUserId)
		console.log(`[CREDIT-MANAGER] Cleared user cache for: ${clerkUserId}`)
	}

	/**
	 * Clear all caches
	 */
	public clearAllCaches(): void {
		this.userCache.clear()
		this.jwtCache.clear()
		this.operationLocks.clear()
		this.processedOperations.clear()
		console.log("[CREDIT-MANAGER] Cleared all caches")
	}

	/**
	 * Get current user credit balance
	 */
	async getUserCreditBalance(jwtToken?: string): Promise<UserCreditInfo | null> {
		if (!jwtToken) {
			console.warn("[CREDIT-MANAGER] getUserCreditBalance called without JWT token")
			return null
		}

		try {
			// Extract user info from JWT
			console.log(
				"[CREDIT-MANAGER] Attempting to extract user from JWT. Token preview:",
				jwtToken ? jwtToken.substring(0, 15) + "..." : "EMPTY",
			)
			const userInfo = await this.extractUserFromJWTCached(jwtToken)
			if (!userInfo) {
				console.error(
					"[CREDIT-MANAGER] Failed to extract user info from JWT - token may be invalid, expired, or missing required claims",
				)
				return null
			}

			// Get user credits from database
			return await this.getUserCreditsWithCache(userInfo.userId, jwtToken)
		} catch (error) {
			console.error("[CREDIT-MANAGER] Error getting user credit balance:", error)
			return null
		}
	}

	/**
	 * Check if user has sufficient credits (without deducting)
	 */
	async checkSufficientCredits(
		jwtToken: string,
		usdAmount: number,
	): Promise<{
		sufficient: boolean
		currentCredits: number
		requiredCredits: number
		userInfo?: UserCreditInfo
	}> {
		const userCredits = await this.getUserCreditBalance(jwtToken)
		if (!userCredits) {
			return {
				sufficient: false,
				currentCredits: 0,
				requiredCredits: this.convertUSDToCredits(usdAmount),
			}
		}

		const requiredCredits = this.convertUSDToCredits(usdAmount)
		return {
			sufficient: userCredits.currentCredits >= requiredCredits,
			currentCredits: userCredits.currentCredits,
			requiredCredits,
			userInfo: userCredits,
		}
	}

	/**
	 * Get credit conversion rate
	 */
	getCreditRate(): number {
		return this.config.CREDIT_TO_USD_RATE
	}

	/**
	 * Conservative estimate of USD cost for a call based on estimated tokens
	 * Uses a buffer to ensure pre-check covers potential actual costs
	 */
	estimateUSDForCall(estimatedTokens: number, modelId?: string): number {
		// Base rate: average ~$0.0005 per token for common models (adjust based on OpenRouter averages)
		// Conservative: Multiply by 1.5 buffer for variations (e.g., reasoning tokens, model rates)
		const baseRatePerToken = 0.0005
		const buffer = 1.5
		const estimatedUSD = estimatedTokens * baseRatePerToken * buffer

		// Model-specific adjustments (e.g., higher for premium models)
		if (modelId && modelId.includes("gemini-2.5-pro")) {
			// Gemini models may have higher costs for reasoning
			return estimatedUSD * 1.2
		}

		// Minimum estimate to cover overhead
		return Math.max(estimatedUSD, 0.01) // At least $0.01
	}

	/**
	 * Deduct credits based on actual USD cost (post-call)
	 * Similar to deductCreditsFromJWT but optimized for actual usage logging
	 */
	async deductFromActual(
		jwtToken: string,
		actualUSD: number,
		description?: string,
		metadata?: CreditOperationMetadata,
		providerId?: string,
	): Promise<CreditTransaction> {
		const baseMetadata = {
			...metadata,
			isActualUsage: true, // Flag for logging
		}

		return this.deductCreditsFromJWT(
			jwtToken,
			actualUSD,
			description || "Actual API usage deduction",
			baseMetadata,
			providerId,
		)
	}

	/**
	 * Calculate cost in credits for USD amount
	 */
	calculateCreditsForUSD(usdAmount: number, providerId?: string): number {
		return this.convertUSDToCredits(usdAmount, providerId)
	}

	/**
	 * Calculate USD cost for credits
	 */
	calculateUSDForCredits(credits: number): number {
		return this.convertCreditsToUSD(credits)
	}

	/**
	 * Get cache statistics for monitoring
	 */
	getCacheStats(): {
		userCacheSize: number
		jwtCacheSize: number
		config: CreditConfig
	} {
		return {
			userCacheSize: this.userCache.size,
			jwtCacheSize: this.jwtCache.size,
			config: this.config,
		}
	}
}

/**
 * Singleton instance for easy access
 */
export const creditManager = CreditManagerService.getInstance()

/**
 * Convenience functions for common operations
 */

/**
 * Deduct credits from user based on JWT token
 */
export async function deductCreditsFromJWT(
	jwtToken: string,
	usdAmount: number,
	description?: string,
	metadata?: CreditOperationMetadata,
	providerId?: string,
): Promise<CreditTransaction> {
	return creditManager.deductCreditsFromJWT(jwtToken, usdAmount, description, metadata, providerId)
}

/**
 * Check user credit balance
 */
export async function checkUserCredits(jwtToken: string): Promise<UserCreditInfo | null> {
	return creditManager.getUserCreditBalance(jwtToken)
}

/**
 * Check if user has sufficient credits for operation
 */
export async function validateSufficientCredits(jwtToken: string, usdAmount: number): Promise<boolean> {
	const result = await creditManager.checkSufficientCredits(jwtToken, usdAmount)
	return result.sufficient
}

/**
 * Get credit conversion rate
 */
export function getCreditRate(): number {
	return creditManager.getCreditRate()
}

/**
 * Convert USD to credits
 */
export function usdToCredits(usdAmount: number, providerId?: string): number {
	return creditManager.calculateCreditsForUSD(usdAmount, providerId)
}

/**
 * Convert credits to USD
 */
export function creditsToUSD(credits: number): number {
	return creditManager.calculateUSDForCredits(credits)
}

/**
 * Export types for use in other modules
 */
export type { CreditTransaction, UserCreditInfo, CreditOperationMetadata, CreditConfig }
