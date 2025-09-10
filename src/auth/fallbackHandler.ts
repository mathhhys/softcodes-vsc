/**
 * Fallback Handler for Clerk API Unavailability
 *
 * Provides graceful degradation strategies when Clerk API is unavailable
 * Includes extended cache, JWT-only verification, and circuit breaker patterns
 */

import { JWTVerificationService } from "./jwtVerification"
import {
	UserVerificationResult,
	UserVerificationErrorType,
	FallbackStrategy,
	CircuitBreakerConfig,
} from "./userVerificationTypes"
import { CacheStrategy } from "./userVerificationService"

/**
 * Extended cache fallback - uses cached data beyond normal TTL
 */
export class ExtendedCacheFallback implements FallbackStrategy {
	constructor(
		private cache: CacheStrategy,
		private extendedTtl: number = 3600, // 1 hour extended cache
	) {
		console.log(`[FALLBACK-DEBUG] ExtendedCacheFallback initialized`, {
			extendedTtl,
			description: this.getDescription(),
			timestamp: new Date().toISOString(),
		})
	}

	shouldActivate(error: Error): boolean {
		const shouldActivate =
			error.message.includes("API_UNAVAILABLE") ||
			error.message.includes("RATE_LIMITED") ||
			error.message.includes("TimeoutError") ||
			error.message.includes("NETWORK_ERROR")

		console.log(`[FALLBACK-DEBUG] ExtendedCacheFallback activation check`, {
			errorMessage: error.message,
			errorType: error.name,
			shouldActivate,
			activationCriteria: ["API_UNAVAILABLE", "RATE_LIMITED", "TimeoutError", "NETWORK_ERROR"],
			timestamp: new Date().toISOString(),
		})

		return shouldActivate
	}

	async verifyUser(userId: string): Promise<UserVerificationResult> {
		const startTime = Date.now()
		console.log(`[FALLBACK-DEBUG] ExtendedCacheFallback verification started`, {
			userId,
			extendedTtl: this.extendedTtl,
			timestamp: new Date().toISOString(),
		})

		// Try to get from cache with extended key
		const extendedCacheKey = `user:${userId}:extended`
		console.log(`[FALLBACK-DEBUG] Checking extended cache`, {
			userId,
			extendedCacheKey,
			timestamp: new Date().toISOString(),
		})

		const cached = await this.cache.get(extendedCacheKey)

		if (cached) {
			const responseTime = Date.now() - startTime
			console.log(`[FALLBACK-DEBUG] Extended cache hit found`, {
				userId,
				extendedCacheKey,
				responseTime,
				isValid: cached.valid,
				cacheAge: "extended_cache",
				timestamp: new Date().toISOString(),
			})

			return {
				...cached,
				fallbackMode: true,
				fallbackReason: "Extended cache due to API unavailability",
				responseTime,
			}
		}

		console.log(`[FALLBACK-DEBUG] Extended cache miss, checking regular cache`, {
			userId,
			extendedCacheKey,
			timestamp: new Date().toISOString(),
		})

		// Try regular cache key as well
		const regularCacheKey = `user:${userId}`
		const regularCached = await this.cache.get(regularCacheKey)

		if (regularCached) {
			const responseTime = Date.now() - startTime
			console.log(`[FALLBACK-DEBUG] Regular cache found, promoting to extended cache`, {
				userId,
				regularCacheKey,
				extendedCacheKey,
				responseTime,
				isValid: regularCached.valid,
				extendedTtl: this.extendedTtl,
				timestamp: new Date().toISOString(),
			})

			// Store in extended cache for future fallbacks
			await this.cache.set(extendedCacheKey, regularCached, this.extendedTtl)

			console.log(`[FALLBACK-DEBUG] Regular cache promoted to extended cache successfully`, {
				userId,
				extendedCacheKey,
				timestamp: new Date().toISOString(),
			})

			return {
				...regularCached,
				fallbackMode: true,
				fallbackReason: "Regular cache extended due to API unavailability",
				responseTime,
			}
		}

		const responseTime = Date.now() - startTime
		console.log(`[FALLBACK-DEBUG] No cache data available for fallback`, {
			userId,
			extendedCacheKey,
			regularCacheKey,
			responseTime,
			timestamp: new Date().toISOString(),
		})

		return {
			valid: false,
			error: {
				type: UserVerificationErrorType.API_UNAVAILABLE,
				message: "Unable to verify user - API unavailable and no cached data",
				userId,
			},
			responseTime,
		}
	}

	getDescription(): string {
		return "Extended cache fallback - uses cached data beyond normal TTL"
	}
}

/**
 * JWT-only fallback - basic verification when Clerk API is down
 */
export class JWTOnlyFallback implements FallbackStrategy {
	constructor(private jwtService: JWTVerificationService) {
		console.log(`[FALLBACK-DEBUG] JWTOnlyFallback initialized`, {
			description: this.getDescription(),
			jwtServiceAvailable: !!jwtService,
			timestamp: new Date().toISOString(),
		})
	}

	shouldActivate(error: Error): boolean {
		const shouldActivate = error.message.includes("API_UNAVAILABLE") || error.message.includes("NETWORK_ERROR")

		console.log(`[FALLBACK-DEBUG] JWTOnlyFallback activation check`, {
			errorMessage: error.message,
			errorType: error.name,
			shouldActivate,
			activationCriteria: ["API_UNAVAILABLE", "NETWORK_ERROR"],
			timestamp: new Date().toISOString(),
		})

		return shouldActivate
	}

	async verifyUser(userId: string): Promise<UserVerificationResult> {
		const startTime = Date.now()
		console.log(`[FALLBACK-DEBUG] JWTOnlyFallback verification started`, {
			userId,
			mode: "jwt_only_fallback",
			limitedInfo: true,
			timestamp: new Date().toISOString(),
		})

		// In JWT-only mode, we assume the user is valid if they have a valid JWT
		// This is a degraded mode of operation with limited user info
		const fallbackUser = {
			id: userId,
			email: undefined, // Limited info in fallback mode
			firstName: undefined,
			lastName: undefined,
			verified: false, // Mark as unverified to indicate fallback
			banned: false, // Assume not banned (would be caught by JWT verification)
			locked: false, // Assume not locked
		}

		const responseTime = Date.now() - startTime
		console.log(`[FALLBACK-DEBUG] JWTOnlyFallback verification completed`, {
			userId,
			responseTime,
			fallbackMode: true,
			userFields: {
				hasId: !!fallbackUser.id,
				hasEmail: !!fallbackUser.email,
				hasFirstName: !!fallbackUser.firstName,
				hasLastName: !!fallbackUser.lastName,
				verified: fallbackUser.verified,
				banned: fallbackUser.banned,
				locked: fallbackUser.locked,
			},
			timestamp: new Date().toISOString(),
		})

		return {
			valid: true,
			user: fallbackUser,
			fallbackMode: true,
			fallbackReason: "JWT-only verification due to Clerk API unavailability",
			responseTime,
		}
	}

	getDescription(): string {
		return "JWT-only fallback - allows basic verification when Clerk API is down"
	}
}

/**
 * Circuit breaker for Clerk API calls
 */
export class CircuitBreaker {
	private failures = 0
	private lastFailureTime = 0
	private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED"
	private successCount = 0

	constructor(private config: CircuitBreakerConfig) {}

	async execute<T>(operation: () => Promise<T>): Promise<T> {
		if (this.isOpen()) {
			throw new Error("Circuit breaker is open - API unavailable")
		}

		try {
			const result = await Promise.race([
				operation(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("Operation timeout")), this.config.timeout),
				),
			])

			this.onSuccess()
			return result
		} catch (error) {
			this.onFailure()
			throw error
		}
	}

	isOpen(): boolean {
		if (this.state === "OPEN") {
			if (Date.now() - this.lastFailureTime > this.config.resetTimeout) {
				this.state = "HALF_OPEN"
				this.successCount = 0
				console.log("[CircuitBreaker] Transitioning to HALF_OPEN state")
				return false
			}
			return true
		}
		return false
	}

	getState(): string {
		return this.state
	}

	getFailureCount(): number {
		return this.failures
	}

	private onSuccess(): void {
		if (this.state === "HALF_OPEN") {
			this.successCount++
			if (this.successCount >= 3) {
				// Require 3 successes to close
				this.state = "CLOSED"
				this.failures = 0
				console.log("[CircuitBreaker] Closed after successful recoveries")
			}
		} else {
			this.failures = 0
			this.state = "CLOSED"
		}
	}

	private onFailure(): void {
		this.failures++
		this.lastFailureTime = Date.now()

		if (this.failures >= this.config.failureThreshold) {
			this.state = "OPEN"
			console.warn(`[CircuitBreaker] Opened due to ${this.failures} failures`)
		}
	}

	reset(): void {
		this.failures = 0
		this.state = "CLOSED"
		this.successCount = 0
		console.log("[CircuitBreaker] Manually reset to CLOSED state")
	}
}

/**
 * Graceful degradation manager - coordinates fallback strategies
 */
export class GracefulDegradationManager {
	private fallbackStrategies: FallbackStrategy[] = []
	private circuitBreaker: CircuitBreaker

	constructor(
		cache: CacheStrategy,
		jwtService: JWTVerificationService,
		circuitBreakerConfig: CircuitBreakerConfig = {
			failureThreshold: 5,
			timeout: 30000,
			resetTimeout: 60000,
		},
	) {
		this.fallbackStrategies = [new ExtendedCacheFallback(cache), new JWTOnlyFallback(jwtService)]

		this.circuitBreaker = new CircuitBreaker(circuitBreakerConfig)

		console.log(`[FALLBACK-DEBUG] GracefulDegradationManager initialized`, {
			fallbackStrategiesCount: this.fallbackStrategies.length,
			strategies: this.fallbackStrategies.map((s) => s.getDescription()),
			circuitBreakerConfig,
			timestamp: new Date().toISOString(),
		})
	}

	/**
	 * Execute user verification with fallback handling
	 */
	async verifyUserWithFallback(
		userId: string,
		primaryVerification: () => Promise<UserVerificationResult>,
	): Promise<UserVerificationResult> {
		const startTime = Date.now()
		console.log(`[FALLBACK-DEBUG] Starting verification with fallback for user`, {
			userId,
			circuitBreakerState: this.circuitBreaker.getState(),
			circuitBreakerOpen: this.circuitBreaker.isOpen(),
			availableStrategies: this.fallbackStrategies.length,
			timestamp: new Date().toISOString(),
		})

		try {
			// Try primary verification with circuit breaker
			if (this.circuitBreaker.isOpen()) {
				const error = new Error("Circuit breaker is open - API unavailable")
				console.log(`[FALLBACK-DEBUG] Circuit breaker is open, skipping primary verification`, {
					userId,
					circuitBreakerState: this.circuitBreaker.getState(),
					failures: this.circuitBreaker.getFailureCount(),
					timestamp: new Date().toISOString(),
				})
				throw error
			}

			console.log(`[FALLBACK-DEBUG] Attempting primary verification through circuit breaker`, {
				userId,
				circuitBreakerState: this.circuitBreaker.getState(),
				timestamp: new Date().toISOString(),
			})

			const result = await this.circuitBreaker.execute(primaryVerification)
			const primaryResponseTime = Date.now() - startTime

			console.log(`[FALLBACK-DEBUG] Primary verification completed`, {
				userId,
				primaryResponseTime,
				isValid: result.valid,
				errorType: result.error?.type,
				willTryFallback: !result.valid && this.shouldTryFallback(result.error?.type),
				timestamp: new Date().toISOString(),
			})

			// If result indicates API issues, try fallbacks
			if (!result.valid && this.shouldTryFallback(result.error?.type)) {
				console.log(`[FALLBACK-DEBUG] Primary verification failed with fallback-eligible error`, {
					userId,
					errorType: result.error?.type,
					errorMessage: result.error?.message,
					timestamp: new Date().toISOString(),
				})
				return await this.executeFallbackStrategies(userId, new Error(result.error?.message || "API error"))
			}

			console.log(`[FALLBACK-DEBUG] Primary verification successful, returning result`, {
				userId,
				primaryResponseTime,
				timestamp: new Date().toISOString(),
			})

			return result
		} catch (error: any) {
			const errorResponseTime = Date.now() - startTime
			console.warn(
				`[FALLBACK-DEBUG] Primary verification failed with exception`,
				{
					userId,
					errorResponseTime,
					errorName: error.name,
					errorMessage: error.message,
					circuitBreakerState: this.circuitBreaker.getState(),
					willTryFallback: true,
					timestamp: new Date().toISOString(),
				},
				error,
			)

			return await this.executeFallbackStrategies(userId, error)
		}
	}

	/**
	 * Execute fallback strategies in priority order
	 */
	private async executeFallbackStrategies(userId: string, error: Error): Promise<UserVerificationResult> {
		const startTime = Date.now()
		console.log(`[FALLBACK-DEBUG] Executing fallback strategies`, {
			userId,
			originalError: error.message,
			availableStrategies: this.fallbackStrategies.length,
			strategies: this.fallbackStrategies.map((s) => s.getDescription()),
			timestamp: new Date().toISOString(),
		})

		for (let i = 0; i < this.fallbackStrategies.length; i++) {
			const strategy = this.fallbackStrategies[i]
			const strategyName = strategy.getDescription()

			console.log(`[FALLBACK-DEBUG] Evaluating fallback strategy`, {
				userId,
				strategyIndex: i + 1,
				strategyName,
				totalStrategies: this.fallbackStrategies.length,
				timestamp: new Date().toISOString(),
			})

			if (strategy.shouldActivate(error)) {
				console.log(`[FALLBACK-DEBUG] Fallback strategy activated`, {
					userId,
					strategyIndex: i + 1,
					strategyName,
					activationReason: "shouldActivate returned true",
					timestamp: new Date().toISOString(),
				})

				try {
					const strategyStartTime = Date.now()
					const fallbackResult = await strategy.verifyUser(userId)
					const strategyResponseTime = Date.now() - strategyStartTime

					console.log(`[FALLBACK-DEBUG] Fallback strategy completed`, {
						userId,
						strategyIndex: i + 1,
						strategyName,
						strategyResponseTime,
						isValid: fallbackResult.valid,
						fallbackMode: fallbackResult.fallbackMode,
						willReturn: fallbackResult.valid || fallbackResult.fallbackMode,
						timestamp: new Date().toISOString(),
					})

					if (fallbackResult.valid || fallbackResult.fallbackMode) {
						console.log(`[FALLBACK-DEBUG] Fallback strategy succeeded, returning result`, {
							userId,
							strategyIndex: i + 1,
							strategyName,
							strategyResponseTime,
							totalFallbackTime: Date.now() - startTime,
							timestamp: new Date().toISOString(),
						})
						return fallbackResult
					}
				} catch (fallbackError: any) {
					console.error(
						`[FALLBACK-DEBUG] Fallback strategy failed with error`,
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
				console.log(`[FALLBACK-DEBUG] Fallback strategy not activated`, {
					userId,
					strategyIndex: i + 1,
					strategyName,
					reason: "shouldActivate returned false",
					originalError: error.message,
					timestamp: new Date().toISOString(),
				})
			}
		}

		// All fallbacks failed
		const totalFallbackTime = Date.now() - startTime
		console.log(`[FALLBACK-DEBUG] All fallback strategies exhausted`, {
			userId,
			strategiesTried: this.fallbackStrategies.length,
			totalFallbackTime,
			originalError: error.message,
			timestamp: new Date().toISOString(),
		})

		return {
			valid: false,
			error: {
				type: UserVerificationErrorType.API_UNAVAILABLE,
				message: "All verification methods failed including fallbacks",
				userId,
				originalError: error,
			},
			responseTime: totalFallbackTime,
		}
	}

	/**
	 * Check if error type should trigger fallback
	 */
	private shouldTryFallback(errorType?: UserVerificationErrorType): boolean {
		if (!errorType) return false

		return [
			UserVerificationErrorType.API_UNAVAILABLE,
			UserVerificationErrorType.NETWORK_ERROR,
			UserVerificationErrorType.RATE_LIMITED,
		].includes(errorType)
	}

	/**
	 * Add custom fallback strategy
	 */
	addFallbackStrategy(strategy: FallbackStrategy): void {
		this.fallbackStrategies.push(strategy)
		console.log(`[GracefulDegradation] Added custom fallback: ${strategy.getDescription()}`)
	}

	/**
	 * Get circuit breaker status
	 */
	getCircuitBreakerStatus(): {
		state: string
		failures: number
		isOpen: boolean
	} {
		return {
			state: this.circuitBreaker.getState(),
			failures: this.circuitBreaker.getFailureCount(),
			isOpen: this.circuitBreaker.isOpen(),
		}
	}

	/**
	 * Manually reset circuit breaker
	 */
	resetCircuitBreaker(): void {
		this.circuitBreaker.reset()
	}

	/**
	 * Health check for degradation manager
	 */
	async healthCheck(): Promise<{
		healthy: boolean
		circuitBreakerOpen: boolean
		availableFallbacks: number
	}> {
		const circuitBreakerOpen = this.circuitBreaker.isOpen()

		return {
			healthy: !circuitBreakerOpen,
			circuitBreakerOpen,
			availableFallbacks: this.fallbackStrategies.length,
		}
	}
}

/**
 * Offline mode fallback - for development/testing
 */
export class OfflineModeFallback implements FallbackStrategy {
	private allowedUserIds: Set<string>

	constructor(allowedUserIds: string[] = []) {
		this.allowedUserIds = new Set(allowedUserIds)
	}

	shouldActivate(error: Error): boolean {
		// Only activate in development mode
		return process.env.NODE_ENV === "development" && error.message.includes("API_UNAVAILABLE")
	}

	async verifyUser(userId: string): Promise<UserVerificationResult> {
		console.log(`[Fallback] Offline mode verification for user: ${userId}`)

		// In offline mode, allow specific test users or any valid format user ID
		const isAllowed = this.allowedUserIds.has(userId) || /^user_[a-zA-Z0-9]+$/.test(userId)

		if (isAllowed) {
			return {
				valid: true,
				user: {
					id: userId,
					email: `${userId}@test.example.com`,
					firstName: "Test",
					lastName: "User",
					verified: true,
					banned: false,
					locked: false,
				},
				fallbackMode: true,
				fallbackReason: "Offline mode - development only",
			}
		}

		return {
			valid: false,
			error: {
				type: UserVerificationErrorType.USER_NOT_FOUND,
				message: "User not allowed in offline mode",
				userId,
			},
		}
	}

	getDescription(): string {
		return "Offline mode fallback - development environment only"
	}

	addAllowedUser(userId: string): void {
		this.allowedUserIds.add(userId)
	}

	removeAllowedUser(userId: string): void {
		this.allowedUserIds.delete(userId)
	}
}
