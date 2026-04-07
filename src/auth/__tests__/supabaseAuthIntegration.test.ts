/**
 * Supabase Auth Integration Tests
 *
 * Comprehensive tests to verify JWT decoding, user verification,
 * and Supabase database connectivity with your existing implementation
 */

import { describe, test, expect, beforeAll } from "vitest"
import { verifyJWTUserInSupabase, testUserIdInSupabase } from "../supabaseUserVerification"
import { parseJWTUnsafe } from "../jwtUtils"

// Test configuration
const TEST_CONFIG = {
	supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://test.supabase.co",
	supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key",
	testUserIds: [
		"user_31vdw7c9BAYCHGHIggfTbJuURIS", // From your logs
		"user_test123",
		"user_nonexistent",
	],
}

// Sample JWT tokens for testing (you'll need to provide real ones)
const SAMPLE_JWT_TOKENS = {
	// Valid token structure for testing JWT parsing
	validStructure:
		"eyJhbGciOiJSUzI1NiIsImtpZCI6Imluc18yV2ZOcTN4V01tVUNTS0RXM2wwdTVVNXQ2aDciLCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwczovL3NvZnRjb2Rlcy5haSIsImV4cCI6MTczNTgyMDMwMCwiaWF0IjoxNzM1ODIwMjQwLCJpc3MiOiJodHRwczovL2NsZXJrLnNvZnRjb2Rlcy5haSIsIm5iZiI6MTczNTgyMDIzMCwic2lkIjoic2Vzc181MDA2ZWE0ODM4MjZkNGI1ZGU3OWI1ZDg0YTY2ZDNlZiIsInN1YiI6InVzZXJfMzF2ZHc3YzlCQVlDSEdISWdnZlRiSnVVUklTIiwidXNlcm5hbWUiOiJtYXRoeXNndWlsbG91IiwiZW1haWwiOiJtYXRoeXNAc29mdGNvZGVzLmlvIn0.signature",

	// Add more test tokens as needed
	invalidFormat: "invalid.token",
	malformed: "eyJhbGciOiJSUzI1NiJ9.invalidpayload",
}

describe("Supabase Auth Integration Tests", () => {
	beforeAll(() => {
		console.log("🧪 Starting Supabase Auth Integration Tests")
		console.log("📊 Test Configuration:", {
			supabaseUrl: TEST_CONFIG.supabaseUrl,
			hasSupabaseKey: !!TEST_CONFIG.supabaseKey,
			testUserCount: TEST_CONFIG.testUserIds.length,
		})
	})

	describe("1. Environment Configuration", () => {
		test("should have required environment variables", () => {
			expect(TEST_CONFIG.supabaseUrl).toBeDefined()
			expect(TEST_CONFIG.supabaseUrl).toMatch(/^https:\/\//)

			expect(TEST_CONFIG.supabaseKey).toBeDefined()
			expect(TEST_CONFIG.supabaseKey.length).toBeGreaterThan(100)
		})

		test("should have valid Supabase URL format", () => {
			expect(TEST_CONFIG.supabaseUrl).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/)
		})
	})

	describe("2. JWT Token Processing", () => {
		test("should parse valid JWT token structure", () => {
			const result = parseJWTUnsafe(SAMPLE_JWT_TOKENS.validStructure)

			expect(result.success).toBe(true)
			expect(result.parts).toBeDefined()
			expect(result.parts?.header).toBeDefined()
			expect(result.parts?.payload).toBeDefined()
			expect(result.parts?.signature).toBeDefined()
		})

		test("should extract clerk_id from JWT payload", () => {
			const result = parseJWTUnsafe(SAMPLE_JWT_TOKENS.validStructure)

			expect(result.success).toBe(true)
			expect(result.parts?.payload.sub).toBeDefined()
			expect(result.parts?.payload.sub).toBe("user_31vdw7c9BAYCHGHIggfTbJuURIS")
		})

		test("should extract email from JWT payload", () => {
			const result = parseJWTUnsafe(SAMPLE_JWT_TOKENS.validStructure)

			expect(result.success).toBe(true)
			expect(result.parts?.payload.email).toBeDefined()
			expect(result.parts?.payload.email).toBe("mathys@softcodes.io")
		})

		test("should handle invalid JWT format gracefully", () => {
			const result = parseJWTUnsafe(SAMPLE_JWT_TOKENS.invalidFormat)

			expect(result.success).toBe(false)
			expect(result.error).toContain("JWT format")
		})

		test("should handle malformed JWT payload", () => {
			const result = parseJWTUnsafe(SAMPLE_JWT_TOKENS.malformed)

			expect(result.success).toBe(false)
			expect(result.error).toBeDefined()
		})
	})

	describe("3. Supabase Database Connection", () => {
		test("should connect to Supabase with service role key", async () => {
			// Test connection by attempting to query a user that doesn't exist
			const result = await testUserIdInSupabase("test_connection_user")

			// Even if user doesn't exist, a successful connection should return success: true
			expect(result.success).toBe(true)
			expect(result.userIdExtracted).toBe("test_connection_user")
		})

		test("should handle database query errors gracefully", async () => {
			// Test with empty user ID to trigger error handling
			const result = await testUserIdInSupabase("")

			// Should handle gracefully and return appropriate error
			expect(result.success).toBeDefined()
			expect(typeof result.success).toBe("boolean")
		})
	})

	describe("4. User Verification in Supabase", () => {
		test("should verify known user exists in database", async () => {
			const knownUserId = TEST_CONFIG.testUserIds[0] // user_31vdw7c9BAYCHGHIggfTbJuURIS
			const result = await testUserIdInSupabase(knownUserId)

			console.log("🔍 User lookup result:", result)

			expect(result.success).toBe(true)
			expect(result.userIdExtracted).toBe(knownUserId)

			if (result.userExistsInSupabase) {
				expect(result.userDetails).toBeDefined()
				expect(result.userDetails.clerk_id).toBe(knownUserId)
				expect(result.userDetails.email).toBeDefined()
			}
		})

		test("should handle non-existent user appropriately", async () => {
			const nonExistentUserId = "user_definitely_does_not_exist_12345"
			const result = await testUserIdInSupabase(nonExistentUserId)

			expect(result.success).toBe(true)
			expect(result.userIdExtracted).toBe(nonExistentUserId)
			expect(result.userExistsInSupabase).toBe(false)
		})

		test("should return user details when user exists", async () => {
			const knownUserId = TEST_CONFIG.testUserIds[0]
			const result = await testUserIdInSupabase(knownUserId)

			if (result.userExistsInSupabase && result.userDetails) {
				// Verify required fields from your schema
				expect(result.userDetails.id).toBeDefined()
				expect(result.userDetails.clerk_id).toBe(knownUserId)
				expect(result.userDetails.email).toBeDefined()
				expect(result.userDetails.created_at).toBeDefined()

				// Optional fields that might be present
				if (result.userDetails.first_name) {
					expect(typeof result.userDetails.first_name).toBe("string")
				}
				if (result.userDetails.plan_type) {
					expect(["starter", "pro", "teams", "enterprise"]).toContain(result.userDetails.plan_type)
				}
				if (result.userDetails.credits) {
					expect(typeof result.userDetails.credits).toBe("number")
				}
			}
		})
	})

	describe("5. Complete JWT to Supabase Flow", () => {
		test("should verify user from JWT token end-to-end", async () => {
			const result = await verifyJWTUserInSupabase(SAMPLE_JWT_TOKENS.validStructure)

			console.log("🔄 Complete flow result:", result)

			expect(result.success).toBe(true)
			expect(result.userIdExtracted).toBe("user_31vdw7c9BAYCHGHIggfTbJuURIS")

			if (result.userExistsInSupabase) {
				expect(result.userDetails).toBeDefined()
				expect(result.userDetails.clerk_id).toBe("user_31vdw7c9BAYCHGHIggfTbJuURIS")
				expect(result.userDetails.email).toBe("mathys@softcodes.io")
			}
		})

		test("should handle invalid JWT in complete flow", async () => {
			const result = await verifyJWTUserInSupabase(SAMPLE_JWT_TOKENS.invalidFormat)

			expect(result.success).toBe(false)
			expect(result.error).toContain("JWT")
		})

		test("should measure performance of complete flow", async () => {
			const startTime = Date.now()
			const result = await verifyJWTUserInSupabase(SAMPLE_JWT_TOKENS.validStructure)
			const endTime = Date.now()

			const responseTime = endTime - startTime

			console.log("⏱️ Performance metrics:", {
				responseTime: `${responseTime}ms`,
				success: result.success,
				userExists: result.userExistsInSupabase,
			})

			// Should complete within reasonable time (adjust threshold as needed)
			expect(responseTime).toBeLessThan(5000) // 5 seconds max
		})
	})

	describe("6. Error Handling and Edge Cases", () => {
		test("should handle empty token gracefully", async () => {
			const result = await verifyJWTUserInSupabase("")

			expect(result.success).toBe(false)
			expect(result.error).toBeDefined()
		})

		test("should handle null/undefined token", async () => {
			// @ts-ignore - Testing edge case
			const result = await verifyJWTUserInSupabase(null)

			expect(result.success).toBe(false)
			expect(result.error).toBeDefined()
		})

		test("should handle very long token", async () => {
			const longToken = "a".repeat(10000)
			const result = await verifyJWTUserInSupabase(longToken)

			expect(result.success).toBe(false)
			expect(result.error).toBeDefined()
		})
	})

	describe("7. Database Schema Validation", () => {
		test("should verify users table has expected structure", async () => {
			// Test with a known user to verify schema
			const knownUserId = TEST_CONFIG.testUserIds[0]
			const result = await testUserIdInSupabase(knownUserId)

			if (result.userExistsInSupabase && result.userDetails) {
				const user = result.userDetails

				// Required fields
				expect(user).toHaveProperty("id")
				expect(user).toHaveProperty("clerk_id")
				expect(user).toHaveProperty("email")
				expect(user).toHaveProperty("created_at")
				expect(user).toHaveProperty("updated_at")

				// Optional fields should be properly typed if present
				if (user.plan_type) {
					expect(["starter", "pro", "teams", "enterprise"]).toContain(user.plan_type)
				}

				if (user.credits !== null) {
					expect(typeof user.credits).toBe("number")
				}

				// Verify UUID format for id field
				expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

				// Verify clerk_id format
				expect(user.clerk_id).toMatch(/^user_[a-zA-Z0-9]+$/)

				// Verify email format
				expect(user.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
			}
		})
	})
})

/**
 * Manual Test Helper Functions
 * Call these functions directly for interactive testing
 */

export async function runManualConnectionTest(): Promise<void> {
	console.log("🔧 Running manual Supabase connection test...")

	const result = await testUserIdInSupabase("test_manual_connection")

	console.log("📊 Connection test result:", {
		success: result.success,
		error: result.error,
		connectionWorking: result.success,
		timestamp: new Date().toISOString(),
	})
}

export async function runManualUserLookup(clerkId: string): Promise<void> {
	console.log(`🔍 Running manual user lookup for: ${clerkId}`)

	const result = await testUserIdInSupabase(clerkId)

	console.log("👤 User lookup result:", {
		userFound: result.userExistsInSupabase,
		userDetails: result.userDetails,
		error: result.error,
		timestamp: new Date().toISOString(),
	})
}

export async function runManualJWTTest(jwtToken: string): Promise<void> {
	console.log("🎫 Running manual JWT verification test...")

	// First test JWT parsing
	const parseResult = parseJWTUnsafe(jwtToken)
	console.log("📝 JWT parsing result:", {
		success: parseResult.success,
		userId: parseResult.parts?.payload.sub,
		email: parseResult.parts?.payload.email,
		error: parseResult.error,
	})

	// Then test complete flow
	if (parseResult.success) {
		const verifyResult = await verifyJWTUserInSupabase(jwtToken)
		console.log("✅ Complete verification result:", {
			success: verifyResult.success,
			userExists: verifyResult.userExistsInSupabase,
			userDetails: verifyResult.userDetails,
			error: verifyResult.error,
		})
	}
}
