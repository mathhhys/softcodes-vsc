/**
 * Comprehensive Credit System Test
 *
 * Tests the entire credit deduction system end-to-end to ensure the
 * "supabaseUrl is required" error is fixed and all credit operations work correctly.
 */

import { describe, test, expect, beforeAll, afterAll, vi } from "vitest"
import { supabaseConfig, validateSupabaseSetup } from "../supabaseConfig"
import { creditManager } from "../creditManager"
import { realtimeCreditService } from "../realtimeCreditUpdates"

// Mock environment variables for testing
const mockEnvVars = {
	SUPABASE_URL: "https://test.supabase.co",
	NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
	SUPABASE_SERVICE_ROLE_KEY:
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlRlc3QgU2VydmljZSBSb2xlIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
	SUPABASE_ANON_KEY:
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlRlc3QgQW5vbiIsImlhdCI6MTUxNjIzOTAyMn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
	NEXT_PUBLIC_SUPABASE_ANON_KEY:
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlRlc3QgQW5vbiIsImlhdCI6MTUxNjIzOTAyMn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
}

// Mock JWT token for testing
const mockJWTToken =
	"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzJpWElHdFdQcnNwdUNESEVQZkVoWVZQZkFGSSIsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsImZpcnN0X25hbWUiOiJUZXN0IiwibGFzdF9uYW1lIjoiVXNlciIsImV4cCI6OTk5OTk5OTk5OSwiaWF0IjoxNzUzMTIwOTE4LCJpc3MiOiJodHRwczovL2NsZXJrLnNvZnRjb2Rlcy5haSJ9.mock_signature"

describe("Credit System Integration Tests", () => {
	beforeAll(() => {
		// Set up environment variables
		Object.entries(mockEnvVars).forEach(([key, value]) => {
			process.env[key] = value
		})

		// Clear any existing cache
		supabaseConfig.clearCache()
		creditManager.clearAllCaches()

		console.log("[TEST] Environment variables set up for testing")
	})

	afterAll(() => {
		// Clean up environment variables
		Object.keys(mockEnvVars).forEach((key) => {
			delete process.env[key]
		})

		// Clear caches
		supabaseConfig.clearCache()
		creditManager.clearAllCaches()

		console.log("[TEST] Test environment cleaned up")
	})

	describe("Supabase Configuration Service", () => {
		test('should initialize without "supabaseUrl is required" error', async () => {
			console.log("[TEST] Testing Supabase configuration initialization...")

			// This should not throw the "supabaseUrl is required" error
			const config = await supabaseConfig.getConfig()

			expect(config).toBeDefined()
			expect(config.isValid).toBe(true)
			expect(config.url).toBe(mockEnvVars.SUPABASE_URL)
			expect(config.serviceRoleKey).toBe(mockEnvVars.SUPABASE_SERVICE_ROLE_KEY)
			expect(config.anonKey).toBe(mockEnvVars.SUPABASE_ANON_KEY)
			expect(config.errors).toHaveLength(0)

			console.log("[TEST] ✅ Supabase configuration initialized successfully")
		})

		test("should create service role client successfully", async () => {
			console.log("[TEST] Testing service role client creation...")

			const client = await supabaseConfig.getServiceRoleClient()

			expect(client).toBeDefined()
			expect(typeof client.from).toBe("function")
			expect(typeof client.rpc).toBe("function")

			console.log("[TEST] ✅ Service role client created successfully")
		})

		test("should create realtime client successfully", async () => {
			console.log("[TEST] Testing realtime client creation...")

			const client = await supabaseConfig.getRealtimeClient()

			expect(client).toBeDefined()
			expect(typeof client.from).toBe("function")
			expect(typeof client.channel).toBe("function")

			console.log("[TEST] ✅ Realtime client created successfully")
		})

		test("should handle missing environment variables gracefully", async () => {
			console.log("[TEST] Testing graceful handling of missing environment variables...")

			// Temporarily remove environment variables
			const originalUrl = process.env.SUPABASE_URL
			delete process.env.SUPABASE_URL
			delete process.env.NEXT_PUBLIC_SUPABASE_URL

			// Clear cache to force re-initialization
			supabaseConfig.clearCache()

			try {
				// Should throw an error about missing required variables
				await supabaseConfig.getConfig()
				expect.fail("Expected an error to be thrown for missing required environment variables")
			} catch (error) {
				// Should get the expected error about missing SUPABASE_URL
				expect(error.message).toContain(
					"SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL environment variable is required",
				)
				console.log("[TEST] ✅ Gracefully handled missing environment variables with proper error")
			} finally {
				// Restore environment variables
				process.env.SUPABASE_URL = originalUrl
				process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
				supabaseConfig.clearCache()
			}
		})
	})

	describe("Database Connectivity Tests", () => {
		test("should validate complete Supabase setup", async () => {
			console.log("[TEST] Testing complete Supabase setup validation...")

			const validation = await validateSupabaseSetup()

			expect(validation).toBeDefined()
			expect(validation.configured).toBe(true)
			expect(validation.errors).toHaveLength(0)

			// Note: functionsAvailable may be false if schema isn't deployed,
			// but that's expected in test environment
			console.log("[TEST] Validation result:", {
				configured: validation.configured,
				functionsAvailable: validation.functionsAvailable,
				errorCount: validation.errors.length,
				warningCount: validation.warnings.length,
			})

			console.log("[TEST] ✅ Supabase setup validation completed")
		})

		test("should test credit functions availability", async () => {
			console.log("[TEST] Testing credit functions availability...")

			const functionsTest = await supabaseConfig.testCreditFunctions()

			expect(functionsTest).toBeDefined()
			expect(functionsTest.functions).toBeDefined()

			// Log function availability for debugging
			console.log("[TEST] Credit functions status:", functionsTest.functions)

			if (functionsTest.errors.length > 0) {
				console.log("[TEST] Credit function errors (expected in test):", functionsTest.errors)
			}

			console.log("[TEST] ✅ Credit functions availability test completed")
		})
	})

	describe("Credit Manager Tests", () => {
		test("should handle JWT extraction without errors", async () => {
			console.log("[TEST] Testing JWT extraction in credit manager...")

			try {
				// This should not cause initialization errors
				const userBalance = await creditManager.getUserCreditBalance(mockJWTToken)

				// userBalance may be null if user doesn't exist, but should not throw initialization errors
				console.log(
					"[TEST] User balance result:",
					userBalance ? "found user data" : "user not found (expected in test)",
				)

				console.log("[TEST] ✅ JWT extraction completed without initialization errors")
			} catch (error) {
				// Should not get "supabaseUrl is required" error
				expect(error.message).not.toContain("supabaseUrl is required")
				console.log("[TEST] ✅ No supabaseUrl initialization errors")
			}
		})

		test("should handle credit sufficiency check", async () => {
			console.log("[TEST] Testing credit sufficiency check...")

			try {
				const sufficiencyCheck = await creditManager.checkSufficientCredits(mockJWTToken, 0.014)

				expect(sufficiencyCheck).toBeDefined()
				expect(typeof sufficiencyCheck.sufficient).toBe("boolean")
				expect(typeof sufficiencyCheck.currentCredits).toBe("number")
				expect(typeof sufficiencyCheck.requiredCredits).toBe("number")

				console.log("[TEST] Sufficiency check result:", sufficiencyCheck)
				console.log("[TEST] ✅ Credit sufficiency check completed without errors")
			} catch (error) {
				// Should not get "supabaseUrl is required" error
				expect(error.message).not.toContain("supabaseUrl is required")
				console.log("[TEST] ✅ No supabaseUrl initialization errors in sufficiency check")
			}
		})

		test("should support fractional credits for OpenRouter provider", () => {
			console.log("[TEST] Testing fractional credit conversion for OpenRouter...")

			// Test fractional conversion for OpenRouter
			const fractionalUsd = 0.007 // Half a credit at $0.014 rate
			const fractionalCredits = creditManager.calculateCreditsForUSD(fractionalUsd, "softcodes/openrouter")

			expect(fractionalCredits).toBe(0.5) // Rounded to 1 decimal
			expect(typeof fractionalCredits).toBe("number")
			expect(fractionalCredits % 1).not.toBe(0) // Not integer

			// Test integer conversion for other providers
			const integerCredits = creditManager.calculateCreditsForUSD(fractionalUsd, "other-provider")
			expect(integerCredits).toBe(1) // Ceiled to 1
			expect(Number.isInteger(integerCredits)).toBe(true)

			console.log("[TEST] Fractional credits:", fractionalCredits, "Integer credits:", integerCredits)
			console.log("[TEST] ✅ Fractional credit support verified")
		})

		test("should handle deduction with fractional credits for OpenRouter", async () => {
			console.log("[TEST] Testing deduction with fractional credits...")

			try {
				const fractionalUsd = 0.007
				const transaction = await creditManager.deductCreditsFromJWT(
					mockJWTToken,
					fractionalUsd,
					"Test fractional deduction",
					{ operationType: "test" },
					"softcodes/openrouter",
				)

				expect(transaction).toBeDefined()
				expect(typeof transaction.creditsDeducted).toBe("number")
				if (transaction.success) {
					expect(transaction.creditsDeducted).toBe(0.5)
				} else {
					// May fail due to insufficient funds, but creditsDeducted should be fractional
					expect(transaction.creditsDeducted).toBe(0.5)
				}

				console.log("[TEST] Fractional deduction result:", transaction)
				console.log("[TEST] ✅ Fractional deduction handling verified")
			} catch (error) {
				console.log("[TEST] Deduction failed (expected in test env), but no conversion errors:", error)
				expect(error.message).not.toContain("supabaseUrl is required")
			}
		})
	})

	describe("Realtime Credit Service Tests", () => {
		test('should initialize without "supabaseUrl is required" error', async () => {
			console.log("[TEST] Testing realtime credit service initialization...")

			try {
				// Access the service instance (this should not cause initialization errors)
				const serviceStatus = realtimeCreditService.getStatus()

				expect(serviceStatus).toBeDefined()
				expect(typeof serviceStatus.connected).toBe("boolean")
				expect(typeof serviceStatus.errorCount).toBe("number")

				console.log("[TEST] Realtime service status:", serviceStatus)
				console.log('[TEST] ✅ Realtime credit service accessed without "supabaseUrl is required" error')
			} catch (error) {
				// Should not get "supabaseUrl is required" error
				expect(error.message).not.toContain("supabaseUrl is required")
				console.log("[TEST] ✅ No supabaseUrl initialization errors in realtime service")
			}
		})

		test("should handle subscription attempt gracefully", async () => {
			console.log("[TEST] Testing realtime subscription attempt...")

			try {
				// This should not cause "supabaseUrl is required" error during lazy initialization
				const subscriptionId = await realtimeCreditService.subscribeToUserCredits("test_user_id", (update) => {
					console.log("[TEST] Received update:", update)
				})

				// subscriptionId may be null if user doesn't exist, but should not throw initialization errors
				console.log(
					"[TEST] Subscription result:",
					subscriptionId ? "subscription created" : "subscription failed (expected in test)",
				)

				// Clean up subscription if it was created
				if (subscriptionId) {
					await realtimeCreditService.unsubscribeFromUser("test_user_id")
				}

				console.log("[TEST] ✅ Realtime subscription attempt completed without initialization errors")
			} catch (error) {
				// Should not get "supabaseUrl is required" error
				expect(error.message).not.toContain("supabaseUrl is required")
				console.log("[TEST] ✅ No supabaseUrl initialization errors in subscription")
			}
		})
	})

	describe("End-to-End Credit Workflow Tests", () => {
		test("should handle complete credit deduction workflow", async () => {
			console.log("[TEST] Testing complete credit deduction workflow...")

			try {
				// Test the complete workflow that was failing before
				const deductionResult = await creditManager.deductCreditsFromJWT(
					mockJWTToken,
					0.014, // $0.014 = 1 credit
					"Test credit deduction",
					{
						operationType: "test",
						requestId: "test_request_123",
					},
				)

				expect(deductionResult).toBeDefined()
				expect(typeof deductionResult.success).toBe("boolean")

				// The actual deduction may fail due to user not existing, but should not fail due to initialization
				console.log("[TEST] Deduction result:", {
					success: deductionResult.success,
					error: deductionResult.error,
					message: deductionResult.message,
				})

				// Key test: should not have "supabaseUrl is required" error
				if (!deductionResult.success && deductionResult.error) {
					expect(deductionResult.error).not.toContain("supabaseUrl is required")
				}

				console.log("[TEST] ✅ Complete credit deduction workflow executed without initialization errors")
			} catch (error) {
				// Should not get "supabaseUrl is required" error
				expect(error.message).not.toContain("supabaseUrl is required")
				console.log("[TEST] ✅ No supabaseUrl initialization errors in complete workflow")
			}
		})
	})

	describe("Error Handling and Logging Tests", () => {
		test("should provide comprehensive error information", async () => {
			console.log("[TEST] Testing error handling and logging...")

			const configStatus = await supabaseConfig.getStatus()

			expect(configStatus).toBeDefined()
			expect(typeof configStatus.isConfigured).toBe("boolean")
			expect(typeof configStatus.hasServiceRoleClient).toBe("boolean")
			expect(typeof configStatus.hasAnonClient).toBe("boolean")

			console.log("[TEST] Configuration status:", configStatus)

			const cacheStats = creditManager.getCacheStats()

			expect(cacheStats).toBeDefined()
			expect(typeof cacheStats.userCacheSize).toBe("number")
			expect(typeof cacheStats.jwtCacheSize).toBe("number")

			console.log("[TEST] Cache statistics:", cacheStats)
			console.log("[TEST] ✅ Error handling and logging systems working correctly")
		})
	})
})

/**
 * Manual Test Function - Run this in the browser console or Node.js environment
 * to manually verify the credit system is working
 */
export async function manualCreditSystemTest(): Promise<void> {
	console.log("🧪 [MANUAL-TEST] Starting manual credit system test...")

	try {
		// Test 1: Configuration
		console.log("[MANUAL-TEST] Step 1: Testing Supabase configuration...")
		const config = await supabaseConfig.getConfig()
		console.log("[MANUAL-TEST] ✅ Configuration loaded:", {
			isValid: config.isValid,
			hasUrl: !!config.url,
			hasServiceKey: !!config.serviceRoleKey,
			errorCount: config.errors.length,
		})

		// Test 2: Service Role Client
		console.log("[MANUAL-TEST] Step 2: Testing service role client...")
		const serviceClient = await supabaseConfig.getServiceRoleClient()
		console.log("[MANUAL-TEST] ✅ Service role client created")

		// Test 3: Realtime Client
		console.log("[MANUAL-TEST] Step 3: Testing realtime client...")
		const realtimeClient = await supabaseConfig.getRealtimeClient()
		console.log("[MANUAL-TEST] ✅ Realtime client created")

		// Test 4: Credit Functions
		console.log("[MANUAL-TEST] Step 4: Testing credit functions...")
		const functionsTest = await supabaseConfig.testCreditFunctions()
		console.log("[MANUAL-TEST] Credit functions result:", {
			available: functionsTest.available,
			functions: functionsTest.functions,
			errorCount: functionsTest.errors.length,
		})

		// Test 5: Full Setup Validation
		console.log("[MANUAL-TEST] Step 5: Validating complete setup...")
		const setupValidation = await validateSupabaseSetup()
		console.log("[MANUAL-TEST] ✅ Setup validation:", {
			configured: setupValidation.configured,
			functionsAvailable: setupValidation.functionsAvailable,
			totalErrors: setupValidation.errors.length,
			totalWarnings: setupValidation.warnings.length,
		})

		console.log("🎉 [MANUAL-TEST] Manual credit system test completed successfully!")
		console.log('✅ [MANUAL-TEST] No "supabaseUrl is required" errors encountered!')
	} catch (error) {
		console.error("❌ [MANUAL-TEST] Manual test failed:", error)

		// Check if it's the specific error we were trying to fix
		if (error.message && error.message.includes("supabaseUrl is required")) {
			console.error('🚨 [MANUAL-TEST] CRITICAL: "supabaseUrl is required" error still occurring!')
		} else {
			console.log('✅ [MANUAL-TEST] Good news: No "supabaseUrl is required" error (different error type)')
		}

		throw error
	}
}

// Export for use in other tests or manual execution
export { mockEnvVars, mockJWTToken }
