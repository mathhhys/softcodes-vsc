/**
 * User Verification Service
 *
 * Intelligent caching layer for user verification with fallback mechanisms
 * Provides high-performance user verification with comprehensive error handling
 */

import { ClerkBackendService } from "./clerkBackendService"
import {
	UserVerificationResult,
	UserVerificationErrorType,
	VerifiedUser,
	CacheConfig,
	CacheEntry,
	CacheStats,
	VerificationOptions,
	VerificationMetrics,
	FallbackStrategy,
} from "./userVerificationTypes"

/**
 * Cache strategy interface for different storage backends
 */
export interface CacheStrategy {
	get(key: string): Promise<any | null>
	set(key: string, value: any, ttl: number): Promise<void>
	delete(key: string): Promise<void>
	clear(): Promise<void>
	getStats(): Promise<CacheStats>
}

/**
 * In-memory cache implementation
 */
export class MemoryCache implements CacheStrategy {
	private cache: Map<string, CacheEntry> = new Map()
	private stats = { hits: 0, misses: 0 }

	async get(key: string): Promise<any | null> {
		const startTime = Date.now()
		const entry = this.cache.get(key)

		if (!entry) {
			this.stats.misses++
			console.log(`[CACHE-DEBUG] Cache miss`, {
				key,
				reason: "entry_not_found",
				cacheSize: this.cache.size,
				totalHits: this.stats.hits,
				totalMisses: this.stats.misses,
				hitRate: this.stats.hits / (this.stats.hits + this.stats.misses),
				timestamp: new Date().toISOString(),
			})
			return null
		}

		const now = Date.now()
		const timeToExpiry = entry.expiresAt - now

		// Check expiration
		if (now > entry.expiresAt) {
			this.cache.delete(key)
			this.stats.misses++
			console.log(`[CACHE-DEBUG] Cache miss due to expiration`, {
				key,
				reason: "expired",
				expiredAgo: now - entry.expiresAt,
				originalTtl: (entry.expiresAt - entry.createdAt) / 1000,
				cacheSize: this.cache.size,
				totalHits: this.stats.hits,
				totalMisses: this.stats.misses,
				hitRate: this.stats.hits / (this.stats.hits + this.stats.misses),
				timestamp: new Date().toISOString(),
			})
			return null
		}

		this.stats.hits++
		const accessTime = Date.now() - startTime
		console.log(`[CACHE-DEBUG] Cache hit`, {
			key,
			timeToExpiry: Math.round(timeToExpiry / 1000),
			entryAge: Math.round((now - entry.createdAt) / 1000),
			accessTime,
			isPositiveResult: entry.data?.valid === true,
			cacheSize: this.cache.size,
			totalHits: this.stats.hits,
			totalMisses: this.stats.misses,
			hitRate: this.stats.hits / (this.stats.hits + this.stats.misses),
			timestamp: new Date().toISOString(),
		})
		return entry.data
	}

	async set(key: string, value: any, ttl: number): Promise<void> {
		const now = Date.now()
		const entry: CacheEntry = {
			data: value,
			expiresAt: now + ttl * 1000,
			createdAt: now,
		}

		const wasExisting = this.cache.has(key)
		this.cache.set(key, entry)

		console.log(`[CACHE-DEBUG] Cache entry stored`, {
			key,
			operation: wasExisting ? "update" : "create",
			ttl,
			expiresAt: new Date(entry.expiresAt).toISOString(),
			isPositiveResult: value?.valid === true,
			cacheSize: this.cache.size,
			memoryUsage: this.getMemoryUsage(),
			timestamp: new Date().toISOString(),
		})
	}

	async delete(key: string): Promise<void> {
		this.cache.delete(key)
	}

	async clear(): Promise<void> {
		this.cache.clear()
		this.stats = { hits: 0, misses: 0 }
	}

	async getStats(): Promise<CacheStats> {
		const now = Date.now()
		const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
			key,
			expiresIn: Math.max(0, entry.expiresAt - now),
		}))

		const total = this.stats.hits + this.stats.misses
		return {
			size: this.cache.size,
			maxSize: 0, // No limit for memory cache
			hits: this.stats.hits,
			misses: this.stats.misses,
			hitRate: total > 0 ? this.stats.hits / total : 0,
			memoryUsage: this.getMemoryUsage(),
			entries,
		}
	}

	private getMemoryUsage(): number {
		// Rough estimation of memory usage
		return this.cache.size * 1024 // Assume 1KB per entry
	}
}

/**
 * Metrics collector for user verification monitoring
 */
export class VerificationMetricsCollector {
	private metrics: VerificationMetrics = {
		totalVerifications: 0,
		successfulVerifications: 0,
		failedVerifications: 0,
		averageResponseTime: 0,
		cacheHitRate: 0,
		errorsByType: {} as Record<UserVerificationErrorType, number>,
		recentErrors: [],
	}

	private responseTimes: number[] = []

	recordVerification(userId: string, success: boolean, responseTime: number, cacheHit: boolean): void {
		const previousTotal = this.metrics.totalVerifications
		this.metrics.totalVerifications++
		this.responseTimes.push(responseTime)

		// Keep only last 1000 response times
		if (this.responseTimes.length > 1000) {
			this.responseTimes = this.responseTimes.slice(-1000)
		}

		const previousAvgResponseTime = this.metrics.averageResponseTime
		this.metrics.averageResponseTime = this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length

		if (success) {
			this.metrics.successfulVerifications++
		} else {
			this.metrics.failedVerifications++
		}

		const successRate =
			this.metrics.totalVerifications > 0
				? (this.metrics.successfulVerifications / this.metrics.totalVerifications) * 100
				: 0

		console.log(`[USER-VERIFY-DEBUG] Metrics updated - verification recorded`, {
			userId,
			success,
			responseTime,
			cacheHit,
			totalVerifications: this.metrics.totalVerifications,
			successfulVerifications: this.metrics.successfulVerifications,
			failedVerifications: this.metrics.failedVerifications,
			successRate: Math.round(successRate * 100) / 100,
			averageResponseTime: Math.round(this.metrics.averageResponseTime * 100) / 100,
			responseTimeChange: Math.round((this.metrics.averageResponseTime - previousAvgResponseTime) * 100) / 100,
			cacheHitRate: this.metrics.cacheHitRate,
			recentErrorCount: this.metrics.recentErrors.length,
			timestamp: new Date().toISOString(),
		})
	}

	recordError(error: UserVerificationErrorType, userId: string, message: string): void {
		const previousCount = this.metrics.errorsByType[error] || 0
		this.metrics.errorsByType[error] = previousCount + 1

		const errorEntry = {
			timestamp: new Date(),
			userId,
			error: message,
			type: error,
		}

		this.metrics.recentErrors.push(errorEntry)

		// Keep only last 100 errors
		if (this.metrics.recentErrors.length > 100) {
			this.metrics.recentErrors = this.metrics.recentErrors.slice(-100)
		}

		const totalErrors = Object.values(this.metrics.errorsByType).reduce((a, b) => a + b, 0)
		const errorFrequency =
			this.metrics.totalVerifications > 0 ? (totalErrors / this.metrics.totalVerifications) * 100 : 0

		console.log(`[USER-VERIFY-DEBUG] Error recorded and metrics updated`, {
			userId,
			errorType: error,
			errorMessage: message,
			errorCount: this.metrics.errorsByType[error],
			totalErrors,
			errorFrequency: Math.round(errorFrequency * 100) / 100,
			recentErrorsCount: this.metrics.recentErrors.length,
			errorsByType: Object.entries(this.metrics.errorsByType).map(([type, count]) => ({ type, count })),
			timestamp: new Date().toISOString(),
		})
	}

	updateCacheHitRate(hitRate: number): void {
		const previousHitRate = this.metrics.cacheHitRate
		this.metrics.cacheHitRate = hitRate

		console.log(`[USER-VERIFY-DEBUG] Cache hit rate updated`, {
			previousHitRate: Math.round(previousHitRate * 10000) / 100,
			newHitRate: Math.round(hitRate * 10000) / 100,
			hitRateChange: Math.round((hitRate - previousHitRate) * 10000) / 100,
			performanceIndicator:
				hitRate > 0.8 ? "excellent" : hitRate > 0.6 ? "good" : hitRate > 0.4 ? "fair" : "poor",
			timestamp: new Date().toISOString(),
		})
	}

	getMetrics(): VerificationMetrics {
		return { ...this.metrics }
	}
}

/**
 * Main User Verification Service
 */
export class UserVerificationService {
	private static instance: UserVerificationService
	private clerkService: ClerkBackendService
	private cache: CacheStrategy
	private config: CacheConfig
	private metrics: VerificationMetricsCollector
	private fallbackStrategies: FallbackStrategy[] = []

	private constructor(clerkService: ClerkBackendService, cache: CacheStrategy, config: CacheConfig) {
		this.clerkService = clerkService
		this.cache = cache
		this.config = config
		this.metrics = new VerificationMetricsCollector()

		// Clean up expired cache entries every 5 minutes
		setInterval(() => this.cleanupExpiredEntries(), 5 * 60 * 1000)

		console.log("[UserVerification] Service initialized with caching configuration:", config)
	}

	/**
	 * Get singleton instance
	 */
	static getInstance(
		clerkService?: ClerkBackendService,
		cache?: CacheStrategy,
		config?: CacheConfig,
	): UserVerificationService {
		if (!UserVerificationService.instance) {
			if (!clerkService || !cache || !config) {
				throw new Error("UserVerificationService requires clerkService, cache, and config on first call")
			}
			UserVerificationService.instance = new UserVerificationService(clerkService, cache, config)
		}
		return UserVerificationService.instance
	}

	/**
	 * Verify user with intelligent caching
	 */
	async verifyUser(userId: string, options: VerificationOptions = {}): Promise<UserVerificationResult> {
		const startTime = Date.now()
		const cacheKey = this.buildCacheKey(userId, options)
		let cacheHit = false

		console.log(`[USER-VERIFY-DEBUG] User verification initiated`, {
			userId,
			cacheKey,
			bypassCache: options.bypassCache || false,
			includeOrganizations: options.includeOrganizations || false,
			timeout: options.timeout,
			timestamp: new Date().toISOString(),
		})

		try {
			// Check cache first (unless bypassed)
			if (!options.bypassCache) {
				console.log(`[USER-VERIFY-DEBUG] Checking cache for user`, {
					userId,
					cacheKey,
					timestamp: new Date().toISOString(),
				})

				const cached = await this.cache.get(cacheKey)
				if (cached) {
					cacheHit = true
					const responseTime = Date.now() - startTime

					console.log(`[USER-VERIFY-DEBUG] Cache hit - returning cached result`, {
						userId,
						responseTime,
						cacheKey,
						isValid: cached.valid,
						errorType: cached.error?.type,
						cacheAge: cached.cacheAge || "unknown",
						timestamp: new Date().toISOString(),
					})

					this.metrics.recordVerification(userId, cached.valid, responseTime, true)

					return {
						...cached,
						cacheHit: true,
						responseTime,
					}
				}

				console.log(`[USER-VERIFY-DEBUG] Cache miss - proceeding to Clerk API`, {
					userId,
					cacheKey,
					timestamp: new Date().toISOString(),
				})
			} else {
				console.log(`[USER-VERIFY-DEBUG] Cache bypassed - proceeding directly to Clerk API`, {
					userId,
					reason: "bypassCache option enabled",
					timestamp: new Date().toISOString(),
				})
			}

			// Cache miss - fetch from Clerk
			console.log(`[USER-VERIFY-DEBUG] Initiating Clerk API lookup`, {
				userId,
				options: {
					includeOrganizations: options.includeOrganizations || false,
					timeout: options.timeout,
				},
				timestamp: new Date().toISOString(),
			})

			const result = await this.clerkService.getUserById(userId, options)
			const responseTime = Date.now() - startTime

			console.log(`[USER-VERIFY-DEBUG] Clerk API lookup completed`, {
				userId,
				responseTime,
				isValid: result.valid,
				errorType: result.error?.type,
				userFound: !!result.user,
				email: result.user?.email,
				timestamp: new Date().toISOString(),
			})

			// Record metrics
			this.metrics.recordVerification(userId, result.valid, responseTime, false)
			if (!result.valid && result.error) {
				console.log(`[USER-VERIFY-DEBUG] Recording verification error`, {
					userId,
					errorType: result.error.type,
					errorMessage: result.error.message,
					timestamp: new Date().toISOString(),
				})
				this.metrics.recordError(result.error.type, userId, result.error.message)
			}

			// Cache the result
			console.log(`[USER-VERIFY-DEBUG] Caching verification result`, {
				userId,
				cacheKey,
				isValid: result.valid,
				willCache: true,
				timestamp: new Date().toISOString(),
			})
			await this.cacheResult(cacheKey, result)

			// Update cache hit rate in metrics
			const cacheStats = await this.cache.getStats()
			this.metrics.updateCacheHitRate(cacheStats.hitRate)

			console.log(`[USER-VERIFY-DEBUG] User verification completed successfully`, {
				userId,
				responseTime,
				isValid: result.valid,
				cacheHit: false,
				currentCacheHitRate: cacheStats.hitRate,
				timestamp: new Date().toISOString(),
			})

			return {
				...result,
				cacheHit: false,
				responseTime,
			}
		} catch (error: any) {
			const responseTime = Date.now() - startTime
			console.error(
				`[USER-VERIFY-DEBUG] User verification failed with error`,
				{
					userId,
					responseTime,
					errorName: error.name,
					errorMessage: error.message,
					stack: error.stack,
					willTryFallback: this.fallbackStrategies.length > 0,
					timestamp: new Date().toISOString(),
				},
				error,
			)

			// Try fallback strategies
			if (this.fallbackStrategies.length > 0) {
				console.log(`[USER-VERIFY-DEBUG] Attempting fallback strategies`, {
					userId,
					availableStrategies: this.fallbackStrategies.length,
					timestamp: new Date().toISOString(),
				})

				const fallbackResult = await this.tryFallbackStrategies(userId, error)
				if (fallbackResult) {
					console.log(`[USER-VERIFY-DEBUG] Fallback strategy succeeded`, {
						userId,
						responseTime,
						isValid: fallbackResult.valid,
						fallbackMode: true,
						timestamp: new Date().toISOString(),
					})

					this.metrics.recordVerification(userId, fallbackResult.valid, responseTime, false)
					return {
						...fallbackResult,
						responseTime,
						fallbackMode: true,
					}
				}

				console.log(`[USER-VERIFY-DEBUG] All fallback strategies failed`, {
					userId,
					timestamp: new Date().toISOString(),
				})
			}

			// Record error and return failure
			this.metrics.recordError(UserVerificationErrorType.VERIFICATION_FAILED, userId, error.message)
			this.metrics.recordVerification(userId, false, responseTime, false)

			console.log(`[USER-VERIFY-DEBUG] User verification failed - returning error result`, {
				userId,
				responseTime,
				finalErrorType: "VERIFICATION_FAILED",
				timestamp: new Date().toISOString(),
			})

			return {
				valid: false,
				error: {
					type: UserVerificationErrorType.VERIFICATION_FAILED,
					message: `Verification failed: ${error.message}`,
					userId,
					originalError: error,
				},
				responseTime,
			}
		}
	}

	/**
	 * Verify multiple users efficiently
	 */
	async verifyUsers(
		userIds: string[],
		options: VerificationOptions = {},
	): Promise<Map<string, UserVerificationResult>> {
		const startTime = Date.now()
		const results = new Map<string, UserVerificationResult>()
		const uncachedIds: string[] = []

		console.log(`[USER-VERIFY-DEBUG] Bulk user verification initiated`, {
			userCount: userIds.length,
			userIds: userIds.length <= 10 ? userIds : [...userIds.slice(0, 10), `...and ${userIds.length - 10} more`],
			bypassCache: options.bypassCache || false,
			includeOrganizations: options.includeOrganizations || false,
			timestamp: new Date().toISOString(),
		})

		// Check cache for all users first
		if (!options.bypassCache) {
			console.log(`[USER-VERIFY-DEBUG] Checking cache for batch users`, {
				userCount: userIds.length,
				timestamp: new Date().toISOString(),
			})

			for (const userId of userIds) {
				const cacheKey = this.buildCacheKey(userId, options)
				const cached = await this.cache.get(cacheKey)
				if (cached) {
					results.set(userId, { ...cached, cacheHit: true })
				} else {
					uncachedIds.push(userId)
				}
			}

			const cacheHits = results.size
			const cacheMisses = uncachedIds.length
			const batchCacheHitRate = userIds.length > 0 ? cacheHits / userIds.length : 0

			console.log(`[USER-VERIFY-DEBUG] Batch cache check completed`, {
				totalUsers: userIds.length,
				cacheHits,
				cacheMisses,
				batchCacheHitRate: Math.round(batchCacheHitRate * 100),
				uncachedUserIds:
					uncachedIds.length <= 10
						? uncachedIds
						: [...uncachedIds.slice(0, 10), `...and ${uncachedIds.length - 10} more`],
				timestamp: new Date().toISOString(),
			})
		} else {
			uncachedIds.push(...userIds)
			console.log(`[USER-VERIFY-DEBUG] Cache bypassed for batch verification`, {
				userCount: userIds.length,
				reason: "bypassCache option enabled",
				timestamp: new Date().toISOString(),
			})
		}

		// Fetch uncached users in batches
		if (uncachedIds.length > 0) {
			console.log(`[USER-VERIFY-DEBUG] Fetching uncached users from Clerk API`, {
				uncachedCount: uncachedIds.length,
				timestamp: new Date().toISOString(),
			})

			const clerkStartTime = Date.now()
			const clerkResults = await this.clerkService.getUsersById(uncachedIds, options)
			const clerkResponseTime = Date.now() - clerkStartTime

			console.log(`[USER-VERIFY-DEBUG] Clerk batch API completed`, {
				requestedCount: uncachedIds.length,
				resultCount: clerkResults.size,
				clerkResponseTime,
				timestamp: new Date().toISOString(),
			})

			for (const [userId, result] of clerkResults) {
				results.set(userId, { ...result, cacheHit: false })

				// Cache the result
				const cacheKey = this.buildCacheKey(userId, options)
				await this.cacheResult(cacheKey, result)

				// Record metrics for each user
				this.metrics.recordVerification(userId, result.valid, result.responseTime || 0, false)
				if (!result.valid && result.error) {
					this.metrics.recordError(result.error.type, userId, result.error.message)
				}
			}
		}

		const totalResponseTime = Date.now() - startTime
		const successCount = Array.from(results.values()).filter((r) => r.valid).length
		const errorCount = results.size - successCount
		const cacheHitCount = Array.from(results.values()).filter((r) => r.cacheHit).length

		console.log(`[USER-VERIFY-DEBUG] Bulk verification completed`, {
			totalUsers: userIds.length,
			successfulVerifications: successCount,
			failedVerifications: errorCount,
			cacheHits: cacheHitCount,
			clerkApiCalls: uncachedIds.length,
			totalResponseTime,
			avgResponseTimePerUser: Math.round(totalResponseTime / userIds.length),
			batchEfficiency: Math.round((cacheHitCount / userIds.length) * 100),
			timestamp: new Date().toISOString(),
		})

		return results
	}

	/**
	 * Add fallback strategy
	 */
	addFallbackStrategy(strategy: FallbackStrategy): void {
		this.fallbackStrategies.push(strategy)
		console.log(`[UserVerification] Added fallback strategy: ${strategy.getDescription()}`)
	}

	/**
	 * Invalidate cache for specific user
	 */
	async invalidateUser(userId: string): Promise<void> {
		// Delete all cache entries for this user (different option combinations)
		const patterns = [`user:${userId}`, `user:${userId}:orgs`, `user:${userId}:full`]

		for (const pattern of patterns) {
			await this.cache.delete(pattern)
		}

		console.log(`[UserVerification] Invalidated cache for user: ${userId}`)
	}

	/**
	 * Clear all cache
	 */
	async clearCache(): Promise<void> {
		await this.cache.clear()
		console.log("[UserVerification] Cleared all cache")
	}

	/**
	 * Get verification metrics
	 */
	getMetrics(): VerificationMetrics {
		return this.metrics.getMetrics()
	}

	/**
	 * Get cache statistics
	 */
	async getCacheStats(): Promise<CacheStats> {
		return await this.cache.getStats()
	}

	/**
	 * Health check for the verification service
	 */
	async healthCheck(): Promise<{
		healthy: boolean
		clerkHealth: boolean
		cacheHealth: boolean
		metrics: VerificationMetrics
	}> {
		const clerkHealth = await this.clerkService.healthCheck()

		let cacheHealth = true
		try {
			await this.cache.getStats()
		} catch (error) {
			cacheHealth = false
			console.error("[UserVerification] Cache health check failed:", error)
		}

		return {
			healthy: clerkHealth && cacheHealth,
			clerkHealth,
			cacheHealth,
			metrics: this.getMetrics(),
		}
	}

	/**
	 * Build cache key for user verification
	 */
	private buildCacheKey(userId: string, options: VerificationOptions): string {
		let key = `user:${userId}`

		if (options.includeOrganizations) {
			key += ":orgs"
		}

		return key
	}

	/**
	 * Cache verification result with appropriate TTL
	 */
	private async cacheResult(key: string, result: UserVerificationResult): Promise<void> {
		// Determine TTL based on result type
		let ttl = this.config.ttl

		if (!result.valid && this.config.negativeCache) {
			ttl = this.config.negativeTtl
		} else if (!result.valid && !this.config.negativeCache) {
			return // Don't cache negative results
		}

		try {
			await this.cache.set(key, result, ttl)
			console.log(`[UserVerification] Cached result for ${key}, TTL: ${ttl}s`)
		} catch (error) {
			console.warn(`[UserVerification] Failed to cache result for ${key}:`, error)
		}
	}

	/**
	 * Try fallback strategies when primary verification fails
	 */
	private async tryFallbackStrategies(userId: string, error: Error): Promise<UserVerificationResult | null> {
		if (this.fallbackStrategies.length === 0) {
			console.log(`[USER-VERIFY-DEBUG] No fallback strategies available`, {
				userId,
				originalError: error.message,
				timestamp: new Date().toISOString(),
			})
			return null
		}

		console.log(`[USER-VERIFY-DEBUG] Evaluating fallback strategies`, {
			userId,
			totalStrategies: this.fallbackStrategies.length,
			originalError: error.message,
			errorType: error.name,
			timestamp: new Date().toISOString(),
		})

		for (let i = 0; i < this.fallbackStrategies.length; i++) {
			const strategy = this.fallbackStrategies[i]
			const strategyName = strategy.getDescription()

			console.log(`[USER-VERIFY-DEBUG] Checking fallback strategy activation`, {
				userId,
				strategyIndex: i + 1,
				strategyName,
				totalStrategies: this.fallbackStrategies.length,
				timestamp: new Date().toISOString(),
			})

			if (strategy.shouldActivate(error)) {
				console.log(`[USER-VERIFY-DEBUG] Fallback strategy activated - attempting verification`, {
					userId,
					strategyIndex: i + 1,
					strategyName,
					activationReason: "shouldActivate returned true",
					timestamp: new Date().toISOString(),
				})

				try {
					const startTime = Date.now()
					const result = await strategy.verifyUser(userId)
					const fallbackResponseTime = Date.now() - startTime

					console.log(`[USER-VERIFY-DEBUG] Fallback strategy completed`, {
						userId,
						strategyIndex: i + 1,
						strategyName,
						responseTime: fallbackResponseTime,
						isValid: result.valid,
						fallbackMode: result.fallbackMode,
						errorType: result.error?.type,
						timestamp: new Date().toISOString(),
					})

					if (result.valid || result.fallbackMode) {
						console.log(`[USER-VERIFY-DEBUG] Fallback strategy succeeded`, {
							userId,
							strategyIndex: i + 1,
							strategyName,
							responseTime: fallbackResponseTime,
							result: result.valid ? "valid_user" : "fallback_mode",
							timestamp: new Date().toISOString(),
						})
						return result
					} else {
						console.log(`[USER-VERIFY-DEBUG] Fallback strategy returned invalid result`, {
							userId,
							strategyIndex: i + 1,
							strategyName,
							responseTime: fallbackResponseTime,
							errorType: result.error?.type,
							errorMessage: result.error?.message,
							timestamp: new Date().toISOString(),
						})
					}
				} catch (fallbackError: any) {
					console.error(
						`[USER-VERIFY-DEBUG] Fallback strategy failed with error`,
						{
							userId,
							strategyIndex: i + 1,
							strategyName,
							fallbackErrorName: fallbackError.name,
							fallbackErrorMessage: fallbackError.message,
							originalError: error.message,
							timestamp: new Date().toISOString(),
						},
						fallbackError,
					)
				}
			} else {
				console.log(`[USER-VERIFY-DEBUG] Fallback strategy not activated`, {
					userId,
					strategyIndex: i + 1,
					strategyName,
					reason: "shouldActivate returned false",
					originalError: error.message,
					timestamp: new Date().toISOString(),
				})
			}
		}

		console.log(`[USER-VERIFY-DEBUG] All fallback strategies exhausted`, {
			userId,
			totalStrategiesTried: this.fallbackStrategies.length,
			originalError: error.message,
			timestamp: new Date().toISOString(),
		})

		return null
	}

	/**
	 * Clean up expired cache entries
	 */
	private async cleanupExpiredEntries(): Promise<void> {
		try {
			const stats = await this.cache.getStats()
			const expiredCount = stats.entries.filter((entry) => entry.expiresIn <= 0).length

			if (expiredCount > 0) {
				console.log(`[UserVerification] Found ${expiredCount} expired cache entries`)
				// Implementation depends on cache strategy
				// For memory cache, expired entries are cleaned on access
			}
		} catch (error) {
			console.warn("[UserVerification] Cache cleanup failed:", error)
		}
	}
}
