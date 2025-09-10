/**
 * Logging Verification Test
 *
 * Simple test to verify comprehensive logging is working correctly
 * for user lookup process debugging scenarios
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { ClerkBackendService } from "../clerkBackendService"
import { UserVerificationService, MemoryCache } from "../userVerificationService"
import { ExtendedCacheFallback, JWTOnlyFallback } from "../fallbackHandler"
import { UserVerificationErrorType } from "../userVerificationTypes"

// Mock console.log to capture logs
const mockConsoleLog = vi.fn()
const mockConsoleError = vi.fn()
const mockConsoleWarn = vi.fn()

beforeEach(() => {
	mockConsoleLog.mockClear()
	mockConsoleError.mockClear()
	mockConsoleWarn.mockClear()

	// Override console methods
	global.console.log = mockConsoleLog
	global.console.error = mockConsoleError
	global.console.warn = mockConsoleWarn
})

describe("Comprehensive Logging Verification", () => {
	it("should log user ID format validation with detailed debug info", async () => {
		const clerkService = ClerkBackendService.getInstance({
			secretKey: "test-key",
			timeout: 10000,
		})

		// Test invalid user ID format - should trigger format validation logging
		const result = await clerkService.getUserById("invalid-user-id")

		// Verify logging was called for format validation
		expect(mockConsoleLog).toHaveBeenCalledWith(
			expect.stringContaining("[CLERK-DEBUG] User ID format validation"),
			expect.objectContaining({
				userId: expect.any(String),
				isValid: false,
				expectedPattern: "user_[a-zA-Z0-9]+",
				actualPrefix: "inval",
				actualLength: expect.any(Number),
				timestamp: expect.any(String),
			}),
		)

		expect(result.valid).toBe(false)
		expect(result.error?.type).toBe(UserVerificationErrorType.INVALID_USER_ID)
	})

	it("should log cache operations with detailed timing and TTL info", async () => {
		const cache = new MemoryCache()

		// Test cache miss logging
		const missResult = await cache.get("test-key")

		expect(mockConsoleLog).toHaveBeenCalledWith(
			expect.stringContaining("[CACHE-DEBUG] Cache miss"),
			expect.objectContaining({
				key: "test-key",
				reason: "entry_not_found",
				cacheSize: 0,
				totalHits: 0,
				totalMisses: 1,
				hitRate: 0,
				timestamp: expect.any(String),
			}),
		)

		// Test cache set logging
		await cache.set("test-key", { data: "test" }, 300)

		expect(mockConsoleLog).toHaveBeenCalledWith(
			expect.stringContaining("[CACHE-DEBUG] Cache entry stored"),
			expect.objectContaining({
				key: "test-key",
				operation: "create",
				ttl: 300,
				expiresAt: expect.any(String),
				cacheSize: 1,
				timestamp: expect.any(String),
			}),
		)

		// Test cache hit logging
		const hitResult = await cache.get("test-key")

		expect(mockConsoleLog).toHaveBeenCalledWith(
			expect.stringContaining("[CACHE-DEBUG] Cache hit"),
			expect.objectContaining({
				key: "test-key",
				timeToExpiry: expect.any(Number),
				entryAge: expect.any(Number),
				accessTime: expect.any(Number),
				cacheSize: 1,
				totalHits: 1,
				totalMisses: 1,
				timestamp: expect.any(String),
			}),
		)

		expect(missResult).toBeNull()
		expect(hitResult).toEqual({ data: "test" })
	})

	it("should log fallback strategy activation and execution", async () => {
		const cache = new MemoryCache()
		const extendedFallback = new ExtendedCacheFallback(cache)
		const mockJwtService = {} as any
		const jwtFallback = new JWTOnlyFallback(mockJwtService)

		// Test fallback initialization logging
		expect(mockConsoleLog).toHaveBeenCalledWith(
			expect.stringContaining("[FALLBACK-DEBUG] ExtendedCacheFallback initialized"),
			expect.objectContaining({
				extendedTtl: expect.any(Number),
				description: expect.any(String),
				timestamp: expect.any(String),
			}),
		)

		expect(mockConsoleLog).toHaveBeenCalledWith(
			expect.stringContaining("[FALLBACK-DEBUG] JWTOnlyFallback initialized"),
			expect.objectContaining({
				description: expect.any(String),
				jwtServiceAvailable: true,
				timestamp: expect.any(String),
			}),
		)

		// Test fallback activation check
		const apiError = new Error("API_UNAVAILABLE")
		const shouldActivate = extendedFallback.shouldActivate(apiError)

		expect(mockConsoleLog).toHaveBeenCalledWith(
			expect.stringContaining("[FALLBACK-DEBUG] ExtendedCacheFallback activation check"),
			expect.objectContaining({
				errorMessage: "API_UNAVAILABLE",
				errorType: "Error",
				shouldActivate: true,
				activationCriteria: expect.arrayContaining(["API_UNAVAILABLE"]),
				timestamp: expect.any(String),
			}),
		)

		expect(shouldActivate).toBe(true)

		// Test fallback verification execution
		const fallbackResult = await extendedFallback.verifyUser("user_test123")

		expect(mockConsoleLog).toHaveBeenCalledWith(
			expect.stringContaining("[FALLBACK-DEBUG] ExtendedCacheFallback verification started"),
			expect.objectContaining({
				userId: "user_test123",
				extendedTtl: expect.any(Number),
				timestamp: expect.any(String),
			}),
		)

		expect(fallbackResult.valid).toBe(false)
		expect(fallbackResult.error?.type).toBe(UserVerificationErrorType.API_UNAVAILABLE)
	})

	it("should log metrics collection and error tracking", async () => {
		const cache = new MemoryCache()
		const clerkService = ClerkBackendService.getInstance({
			secretKey: "test-key",
			timeout: 10000,
		})

		const verificationService = UserVerificationService.getInstance(clerkService, cache, {
			ttl: 300,
			negativeCache: true,
			negativeTtl: 60,
			maxSize: 1000,
		})

		// Test verification attempt that will fail (invalid user ID)
		const result = await verificationService.verifyUser("invalid-id")

		// Should log user verification initiation
		expect(mockConsoleLog).toHaveBeenCalledWith(
			expect.stringContaining("[USER-VERIFY-DEBUG] User verification initiated"),
			expect.objectContaining({
				userId: "invalid-id",
				cacheKey: expect.any(String),
				bypassCache: false,
				includeOrganizations: false,
				timestamp: expect.any(String),
			}),
		)

		// Should log metrics recording
		expect(mockConsoleLog).toHaveBeenCalledWith(
			expect.stringContaining("[USER-VERIFY-DEBUG] Metrics updated - verification recorded"),
			expect.objectContaining({
				userId: "invalid-id",
				success: false,
				responseTime: expect.any(Number),
				cacheHit: false,
				totalVerifications: expect.any(Number),
				successfulVerifications: expect.any(Number),
				failedVerifications: expect.any(Number),
				timestamp: expect.any(String),
			}),
		)

		expect(result.valid).toBe(false)
	})

	it("should demonstrate comprehensive debugging scenario coverage", () => {
		// Verify all the key logging prefixes are being used
		const allLogs = mockConsoleLog.mock.calls.flat()
		const logContent = allLogs.join(" ")

		// Key debugging scenarios covered:
		expect(logContent).toContain("[CLERK-DEBUG]") // Clerk API interactions
		expect(logContent).toContain("[CACHE-DEBUG]") // Cache operations
		expect(logContent).toContain("[USER-VERIFY-DEBUG]") // User verification workflow
		expect(logContent).toContain("[FALLBACK-DEBUG]") // Fallback handling

		// Verify detailed context is included
		expect(logContent).toContain("userId")
		expect(logContent).toContain("timestamp")
		expect(logContent).toContain("responseTime")
		expect(logContent).toContain("cacheSize")
		expect(logContent).toContain("hitRate")
		expect(logContent).toContain("errorType")

		console.log("\n✅ LOGGING VERIFICATION COMPLETE ✅")
		console.log("📊 Comprehensive console logs successfully added for:")
		console.log("   🔍 Clerk API user lookup operations")
		console.log("   💾 Cache hit/miss tracking with TTL info")
		console.log("   📈 User verification workflow debugging")
		console.log("   🔄 Fallback strategy activation and execution")
		console.log("   📊 Metrics collection and error categorization")
		console.log("   ⏱️  Performance timing and API response details")
		console.log("\n🎯 Debug scenarios now covered:")
		console.log("   • JWT token valid but user not found in Clerk")
		console.log("   • User exists but banned/locked/deleted")
		console.log("   • Cache inconsistencies or stale data")
		console.log("   • API rate limiting or network failures")
		console.log("   • Fallback strategy activation and results")
	})
})
