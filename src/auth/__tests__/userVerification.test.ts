/**
 * Comprehensive tests for User Verification System
 *
 * Tests all components: ClerkBackendService, UserVerificationService,
 * fallback mechanisms, and integration with UnifiedAuthService
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import { ClerkBackendService } from "../clerkBackendService"
import { UserVerificationService, MemoryCache } from "../userVerificationService"
import { GracefulDegradationManager, ExtendedCacheFallback, JWTOnlyFallback } from "../fallbackHandler"
import {
	UserVerificationErrorType,
	UserVerificationResult,
	ClerkBackendConfig,
	CacheConfig,
} from "../userVerificationTypes"

// Mock Clerk client
const mockClerkClient = {
	users: {
		getUser: vi.fn(),
		getUserList: vi.fn(),
		getOrganizationMembershipList: vi.fn(),
	},
	sessions: {
		getSessionList: vi.fn(),
	},
}

// Mock createClerkClient
vi.mock("@clerk/backend", () => ({
	createClerkClient: () => mockClerkClient,
}))

describe("User Verification System", () => {
	let clerkService: ClerkBackendService
	let verificationService: UserVerificationService
	let cache: MemoryCache
	let fallbackManager: GracefulDegradationManager

	const testConfig: ClerkBackendConfig = {
		secretKey: "sk_test_123456789",
		timeout: 5000,
	}

	const cacheConfig: CacheConfig = {
		ttl: 300,
		negativeTtl: 60,
		maxSize: 100,
		negativeCache: true,
	}

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks()

		// Initialize services
		cache = new MemoryCache()
		clerkService = ClerkBackendService.getInstance(testConfig)
		verificationService = UserVerificationService.getInstance(clerkService, cache, cacheConfig)

		// Mock JWT service for fallback
		const mockJwtService = {
			verifyJWT: vi.fn(),
			getInstance: vi.fn(() => mockJwtService),
		} as any

		fallbackManager = new GracefulDegradationManager(cache, mockJwtService)
	})

	afterEach(async () => {
		await cache.clear()
	})

	describe("ClerkBackendService", () => {
		test("should verify existing user successfully", async () => {
			const mockUser = {
				id: "user_test123",
				primaryEmailAddress: { emailAddress: "test@example.com" },
				firstName: "Test",
				lastName: "User",
				banned: false,
				locked: false,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}

			mockClerkClient.users.getUser.mockResolvedValue(mockUser)

			const result = await clerkService.getUserById("user_test123")

			expect(result.valid).toBe(true)
			expect(result.user?.id).toBe("user_test123")
			expect(result.user?.email).toBe("test@example.com")
			expect(result.user?.banned).toBe(false)
			expect(result.user?.locked).toBe(false)
			expect(mockClerkClient.users.getUser).toHaveBeenCalledWith("user_test123")
		})

		test("should handle user not found error", async () => {
			const notFoundError = { status: 404 }
			mockClerkClient.users.getUser.mockRejectedValue(notFoundError)

			const result = await clerkService.getUserById("user_nonexistent")

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(UserVerificationErrorType.USER_NOT_FOUND)
			expect(result.error?.userId).toBe("user_nonexistent")
		})

		test("should handle banned user", async () => {
			const bannedUser = {
				id: "user_banned",
				banned: true,
				locked: false,
				primaryEmailAddress: { emailAddress: "banned@example.com" },
			}

			mockClerkClient.users.getUser.mockResolvedValue(bannedUser)

			const result = await clerkService.getUserById("user_banned")

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(UserVerificationErrorType.USER_BANNED)
			expect(result.error?.message).toContain("banned")
		})

		test("should handle locked user", async () => {
			const lockedUser = {
				id: "user_locked",
				banned: false,
				locked: true,
				primaryEmailAddress: { emailAddress: "locked@example.com" },
			}

			mockClerkClient.users.getUser.mockResolvedValue(lockedUser)

			const result = await clerkService.getUserById("user_locked")

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(UserVerificationErrorType.USER_LOCKED)
			expect(result.error?.message).toContain("locked")
		})

		test("should handle rate limiting", async () => {
			const rateLimitError = {
				status: 429,
				headers: { "retry-after": "60" },
			}
			mockClerkClient.users.getUser.mockRejectedValue(rateLimitError)

			const result = await clerkService.getUserById("user_test")

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(UserVerificationErrorType.RATE_LIMITED)
			expect(result.error?.retryAfter).toBe(60)
		})

		test("should handle API unavailable", async () => {
			const apiError = { status: 503 }
			mockClerkClient.users.getUser.mockRejectedValue(apiError)

			const result = await clerkService.getUserById("user_test")

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(UserVerificationErrorType.API_UNAVAILABLE)
		})

		test("should include organization data when requested", async () => {
			const mockUser = {
				id: "user_with_org",
				primaryEmailAddress: { emailAddress: "org@example.com" },
				banned: false,
				locked: false,
			}

			const mockMemberships = {
				data: [
					{
						organization: { id: "org_123", name: "Test Org" },
						role: "admin",
					},
				],
			}

			mockClerkClient.users.getUser.mockResolvedValue(mockUser)
			mockClerkClient.users.getOrganizationMembershipList.mockResolvedValue(mockMemberships)

			const result = await clerkService.getUserById("user_with_org", {
				includeOrganizations: true,
			})

			expect(result.valid).toBe(true)
			expect(result.user?.organizations).toHaveLength(1)
			expect(result.user?.organizations?.[0].id).toBe("org_123")
			expect(result.user?.organizations?.[0].role).toBe("admin")
		})

		test("should validate user ID format", async () => {
			const result = await clerkService.getUserById("invalid_format")

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(UserVerificationErrorType.INVALID_USER_ID)
			expect(mockClerkClient.users.getUser).not.toHaveBeenCalled()
		})

		test("should verify multiple users efficiently", async () => {
			const userIds = ["user_1", "user_2", "user_3"]

			mockClerkClient.users.getUser
				.mockResolvedValueOnce({ id: "user_1", banned: false, locked: false })
				.mockResolvedValueOnce({ id: "user_2", banned: false, locked: false })
				.mockResolvedValueOnce({ id: "user_3", banned: false, locked: false })

			const results = await clerkService.getUsersById(userIds)

			expect(results.size).toBe(3)
			expect(results.get("user_1")?.valid).toBe(true)
			expect(results.get("user_2")?.valid).toBe(true)
			expect(results.get("user_3")?.valid).toBe(true)
		})

		test("should perform health check", async () => {
			mockClerkClient.users.getUserList.mockResolvedValue({ data: [] })

			const isHealthy = await clerkService.healthCheck()

			expect(isHealthy).toBe(true)
			expect(mockClerkClient.users.getUserList).toHaveBeenCalledWith({ limit: 1 })
		})
	})

	describe("UserVerificationService with Caching", () => {
		test("should cache verification results", async () => {
			const mockUser = {
				id: "user_cache_test",
				banned: false,
				locked: false,
				primaryEmailAddress: { emailAddress: "cache@example.com" },
			}

			mockClerkClient.users.getUser.mockResolvedValue(mockUser)

			// First call - should hit Clerk API
			const result1 = await verificationService.verifyUser("user_cache_test")
			expect(result1.valid).toBe(true)
			expect(result1.cacheHit).toBe(false)

			// Second call - should hit cache
			const result2 = await verificationService.verifyUser("user_cache_test")
			expect(result2.valid).toBe(true)
			expect(result2.cacheHit).toBe(true)

			// Clerk API should only be called once
			expect(mockClerkClient.users.getUser).toHaveBeenCalledTimes(1)
		})

		test("should respect cache bypass option", async () => {
			const mockUser = {
				id: "user_bypass_test",
				banned: false,
				locked: false,
			}

			mockClerkClient.users.getUser.mockResolvedValue(mockUser)

			// First call to populate cache
			await verificationService.verifyUser("user_bypass_test")

			// Second call with bypass cache
			const result = await verificationService.verifyUser("user_bypass_test", {
				bypassCache: true,
			})

			expect(result.valid).toBe(true)
			expect(result.cacheHit).toBe(false)
			expect(mockClerkClient.users.getUser).toHaveBeenCalledTimes(2)
		})

		test("should cache negative results when enabled", async () => {
			const notFoundError = { status: 404 }
			mockClerkClient.users.getUser.mockRejectedValue(notFoundError)

			// First call - should hit Clerk API
			const result1 = await verificationService.verifyUser("user_not_found")
			expect(result1.valid).toBe(false)
			expect(result1.cacheHit).toBe(false)

			// Second call - should hit cache
			const result2 = await verificationService.verifyUser("user_not_found")
			expect(result2.valid).toBe(false)
			expect(result2.cacheHit).toBe(true)

			expect(mockClerkClient.users.getUser).toHaveBeenCalledTimes(1)
		})

		test("should invalidate user cache", async () => {
			const mockUser = { id: "user_invalidate", banned: false, locked: false }
			mockClerkClient.users.getUser.mockResolvedValue(mockUser)

			// Populate cache
			await verificationService.verifyUser("user_invalidate")

			// Invalidate cache
			await verificationService.invalidateUser("user_invalidate")

			// Next call should hit API again
			const result = await verificationService.verifyUser("user_invalidate")
			expect(result.cacheHit).toBe(false)
			expect(mockClerkClient.users.getUser).toHaveBeenCalledTimes(2)
		})

		test("should verify multiple users with mixed cache states", async () => {
			const userIds = ["user_cached", "user_new"]

			// Pre-populate cache for one user
			mockClerkClient.users.getUser.mockResolvedValueOnce({
				id: "user_cached",
				banned: false,
				locked: false,
			})
			await verificationService.verifyUser("user_cached")

			// Mock response for new user
			mockClerkClient.users.getUser.mockResolvedValueOnce({
				id: "user_new",
				banned: false,
				locked: false,
			})

			const results = await verificationService.verifyUsers(userIds)

			expect(results.size).toBe(2)
			expect(results.get("user_cached")?.cacheHit).toBe(true)
			expect(results.get("user_new")?.cacheHit).toBe(false)
		})

		test("should provide cache statistics", async () => {
			const stats = await verificationService.getCacheStats()

			expect(stats).toHaveProperty("size")
			expect(stats).toHaveProperty("hits")
			expect(stats).toHaveProperty("misses")
			expect(stats).toHaveProperty("hitRate")
			expect(stats).toHaveProperty("entries")
		})

		test("should provide verification metrics", () => {
			const metrics = verificationService.getMetrics()

			expect(metrics).toHaveProperty("totalVerifications")
			expect(metrics).toHaveProperty("successfulVerifications")
			expect(metrics).toHaveProperty("failedVerifications")
			expect(metrics).toHaveProperty("averageResponseTime")
			expect(metrics).toHaveProperty("cacheHitRate")
			expect(metrics).toHaveProperty("errorsByType")
			expect(metrics).toHaveProperty("recentErrors")
		})

		test("should perform health check", async () => {
			mockClerkClient.users.getUserList.mockResolvedValue({ data: [] })

			const health = await verificationService.healthCheck()

			expect(health).toHaveProperty("healthy")
			expect(health).toHaveProperty("clerkHealth")
			expect(health).toHaveProperty("cacheHealth")
			expect(health).toHaveProperty("metrics")
		})
	})

	describe("Fallback Mechanisms", () => {
		test("should use extended cache fallback when API is unavailable", async () => {
			const mockUser = { id: "user_fallback", banned: false, locked: false }

			// First, populate cache
			mockClerkClient.users.getUser.mockResolvedValueOnce(mockUser)
			await verificationService.verifyUser("user_fallback")

			// Then simulate API failure
			const apiError = new Error("API_UNAVAILABLE")
			mockClerkClient.users.getUser.mockRejectedValue(apiError)

			const extendedFallback = new ExtendedCacheFallback(cache)
			const result = await fallbackManager.verifyUserWithFallback("user_fallback", () => {
				throw apiError
			})

			expect(result.fallbackMode).toBe(true)
			expect(result.fallbackReason).toContain("Extended cache")
		})

		test("should use JWT-only fallback when cache is empty", async () => {
			const mockJwtService = {
				verifyJWT: vi.fn().mockResolvedValue({ valid: true }),
			} as any

			const jwtFallback = new JWTOnlyFallback(mockJwtService)
			const result = await jwtFallback.verifyUser("user_jwt_only")

			expect(result.valid).toBe(true)
			expect(result.fallbackMode).toBe(true)
			expect(result.fallbackReason).toContain("JWT-only verification")
		})

		test("should open circuit breaker after repeated failures", async () => {
			const apiError = new Error("Network error")

			// Cause multiple failures to open circuit breaker
			for (let i = 0; i < 6; i++) {
				try {
					await fallbackManager.verifyUserWithFallback("user_test", () => {
						throw apiError
					})
				} catch (error) {
					// Expected failures
				}
			}

			const status = fallbackManager.getCircuitBreakerStatus()
			expect(status.isOpen).toBe(true)
			expect(status.failures).toBeGreaterThanOrEqual(5)
		})

		test("should provide fallback health status", async () => {
			const health = await fallbackManager.healthCheck()

			expect(health).toHaveProperty("healthy")
			expect(health).toHaveProperty("circuitBreakerOpen")
			expect(health).toHaveProperty("availableFallbacks")
			expect(health.availableFallbacks).toBeGreaterThan(0)
		})
	})

	describe("Integration Scenarios", () => {
		test("should handle complete authentication flow", async () => {
			const mockUser = {
				id: "user_complete_flow",
				primaryEmailAddress: { emailAddress: "complete@example.com" },
				firstName: "Complete",
				lastName: "User",
				banned: false,
				locked: false,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}

			mockClerkClient.users.getUser.mockResolvedValue(mockUser)

			// Simulate JWT verification followed by backend verification
			const result = await fallbackManager.verifyUserWithFallback("user_complete_flow", () =>
				verificationService.verifyUser("user_complete_flow", {
					includeOrganizations: true,
				}),
			)

			expect(result.valid).toBe(true)
			expect(result.user?.id).toBe("user_complete_flow")
			expect(result.user?.email).toBe("complete@example.com")
			expect(result.fallbackMode).toBeFalsy()
		})

		test("should handle banned user in complete flow", async () => {
			const bannedUser = {
				id: "user_banned_flow",
				banned: true,
				locked: false,
			}

			mockClerkClient.users.getUser.mockResolvedValue(bannedUser)

			const result = await fallbackManager.verifyUserWithFallback("user_banned_flow", () =>
				verificationService.verifyUser("user_banned_flow"),
			)

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(UserVerificationErrorType.USER_BANNED)
		})

		test("should gracefully degrade when API is completely down", async () => {
			const apiError = new Error("NETWORK_ERROR")

			// Simulate complete API failure with fallback to JWT-only
			const result = await fallbackManager.verifyUserWithFallback("user_api_down", () => {
				throw apiError
			})

			// Should fall back to JWT-only verification
			expect(result.valid).toBe(true)
			expect(result.fallbackMode).toBe(true)
			expect(result.user?.verified).toBe(false) // Indicates fallback mode
		})

		test("should record comprehensive metrics during operation", async () => {
			const mockUser = { id: "user_metrics", banned: false, locked: false }
			mockClerkClient.users.getUser.mockResolvedValue(mockUser)

			// Perform multiple operations
			await verificationService.verifyUser("user_metrics")
			await verificationService.verifyUser("user_metrics") // Cache hit

			const metrics = verificationService.getMetrics()

			expect(metrics.totalVerifications).toBeGreaterThan(0)
			expect(metrics.successfulVerifications).toBeGreaterThan(0)
			expect(metrics.averageResponseTime).toBeGreaterThan(0)
			expect(metrics.cacheHitRate).toBeGreaterThan(0)
		})
	})

	describe("Error Handling Edge Cases", () => {
		test("should handle malformed responses gracefully", async () => {
			mockClerkClient.users.getUser.mockResolvedValue(null)

			const result = await clerkService.getUserById("user_malformed")

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(UserVerificationErrorType.USER_NOT_FOUND)
		})

		test("should handle timeout errors", async () => {
			const timeoutError = new Error("TimeoutError")
			mockClerkClient.users.getUser.mockRejectedValue(timeoutError)

			const result = await clerkService.getUserById("user_timeout")

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(UserVerificationErrorType.NETWORK_ERROR)
			expect(result.error?.message).toContain("timeout")
		})

		test("should handle partial organization data failure", async () => {
			const mockUser = { id: "user_org_fail", banned: false, locked: false }
			mockClerkClient.users.getUser.mockResolvedValue(mockUser)
			mockClerkClient.users.getOrganizationMembershipList.mockRejectedValue(new Error("Org API failed"))

			const result = await clerkService.getUserById("user_org_fail", {
				includeOrganizations: true,
			})

			expect(result.valid).toBe(true)
			expect(result.user?.organizations).toEqual([])
		})
	})
})
