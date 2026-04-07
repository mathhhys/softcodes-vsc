/**
 * Credit Manager Service Tests
 *
 * Comprehensive test suite for the credit management system
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import { CreditManagerService, creditManager } from "../services/creditManager"
import { extractUserFromJWT } from "../auth/jwtVerification"
import { getSupabaseServiceClient } from "../services/supabaseConfig"

// Mock dependencies
vi.mock("../services/supabaseConfig", () => ({
	getSupabaseServiceClient: vi.fn(),
}))

vi.mock("../auth/jwtVerification", () => ({
	JWTVerificationService: {
		getInstance: () => ({
			verifyJWT: vi.fn(),
		}),
	},
	extractUserFromJWT: vi.fn(),
}))

const internalUserId = "11111111-1111-1111-1111-111111111111"

// Shared Supabase mock used by the credit manager via getSupabaseServiceClient()
const mockSupabase = {
	rpc: vi.fn(),
	from: vi.fn(),
}

// Shared query-chain mocks
let mockUsersSingle: any

beforeEach(() => {
	vi.clearAllMocks()
	creditManager.clearAllCaches()

	// Important: clearAllMocks() does NOT reset implementations/return values.
	// Reset shared mock objects so previous tests can't leak behaviour into later ones.
	mockSupabase.rpc.mockReset()
	mockSupabase.from.mockReset()

	vi.mocked(getSupabaseServiceClient).mockResolvedValue(mockSupabase as any)

	// users mapping chain: from('users').select('id').eq('clerk_id', ...).single()
	mockUsersSingle = vi.fn().mockResolvedValue({ data: { id: internalUserId }, error: null })
	const mockUsersEq = vi.fn().mockReturnValue({ single: mockUsersSingle })
	const mockUsersSelect = vi.fn().mockReturnValue({ eq: mockUsersEq })

	// credit_transactions chain (used by logCreditDeductionAttempt)
	const mockCreditTxLimit = vi.fn().mockResolvedValue({ data: [], error: null })
	const mockCreditTxOrder = vi.fn().mockReturnValue({ limit: mockCreditTxLimit })
	const mockCreditTxEq = vi.fn().mockReturnValue({ order: mockCreditTxOrder })
	const mockCreditTxSelect = vi.fn().mockReturnValue({ eq: mockCreditTxEq })

	mockSupabase.from.mockImplementation((table: string) => {
		if (table === "users") return { select: mockUsersSelect }
		if (table === "credit_transactions") return { select: mockCreditTxSelect }
		return { select: vi.fn() }
	})
})

describe("CreditManagerService", () => {
	describe("Initialization", () => {
		test("should create singleton instance", () => {
			const instance1 = CreditManagerService.getInstance()
			const instance2 = CreditManagerService.getInstance()
			expect(instance1).toBe(instance2)
		})

		test("should initialize with correct default config", () => {
			const stats = creditManager.getCacheStats()
			expect(stats.config.CREDIT_TO_USD_RATE).toBe(0.014)
			expect(stats.config.LOW_CREDIT_THRESHOLD).toBe(10)
			expect(stats.config.MIN_CREDIT_BALANCE).toBe(0)
		})
	})

	describe("Credit Conversion", () => {
		test("should convert USD to credits correctly", () => {
			// $0.014 = 1 credit
			expect(creditManager.calculateCreditsForUSD(0.014)).toBe(1)
			expect(creditManager.calculateCreditsForUSD(0.07)).toBe(5)
			// Uses 2-decimal precision (matches DB NUMERIC(10,2))
			expect(creditManager.calculateCreditsForUSD(0.044)).toBe(3.14)
		})

		test("should convert credits to USD correctly", () => {
			expect(creditManager.calculateUSDForCredits(1)).toBe(0.014)
			expect(creditManager.calculateUSDForCredits(5)).toBe(0.07)
			// Floating point can introduce tiny errors (e.g. 1.4000000000000001)
			expect(creditManager.calculateUSDForCredits(100)).toBeCloseTo(1.4, 12)
		})

		test("should get correct credit rate", () => {
			expect(creditManager.getCreditRate()).toBe(0.014)
		})
	})

	describe("Credit Deduction", () => {
		const mockJWT = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test.signature"
		const mockUserInfo = {
			userId: "user_123",
			email: "test@example.com",
		}
		const mockUserCredits = {
			userId: "internal_user_123",
			clerkId: "user_123",
			currentCredits: 100,
			creditsUsed: 50,
			totalSpent: 2.1,
		}

		beforeEach(() => {
			vi.mocked(extractUserFromJWT).mockResolvedValue(mockUserInfo as any)
		})

		test("should successfully deduct credits", async () => {
			mockSupabase.rpc.mockImplementation((fn: string, params: any) => {
				if (fn === "get_credits_auto") {
					return {
						data: {
							success: true,
							user_id: internalUserId,
							clerk_id: mockUserCredits.clerkId,
							current_credits: mockUserCredits.currentCredits,
							credits_used: mockUserCredits.creditsUsed,
							total_spent_usd: String(mockUserCredits.totalSpent),
							plan_type: "pro",
							last_credit_update: new Date().toISOString(),
						},
						error: null,
					}
				}

				if (fn === "deduct_credits_auto") {
					return {
						data: [
							{
								success: true,
								transaction_id: "txn_123",
								credits_deducted: 5,
								balance_before: 100,
								balance_after: 95,
								usd_amount: 0.07,
								user_id: params.p_user_id,
								error: null,
								message: "Success",
							},
						],
						error: null,
					}
				}

				return { data: null, error: null }
			})

			const result = await creditManager.deductCreditsFromJWT(mockJWT, 0.07, "Test deduction")

			expect(result.success).toBe(true)
			expect(result.creditsDeducted).toBe(5)
			expect(result.balanceBefore).toBe(100)
			expect(result.balanceAfter).toBe(95)
			expect(result.usdAmount).toBe(0.07)
			expect(result.transactionId).toBe("txn_123")

			// Ensure we call get_credits_auto with internal users.id (uuid), not the Clerk id
			const getCreditsCall = mockSupabase.rpc.mock.calls.find((call: any[]) => call[0] === "get_credits_auto")
			expect(getCreditsCall?.[1]).toEqual(expect.objectContaining({ p_user_id: internalUserId }))
		})

		test("should reject deduction with insufficient credits", async () => {
			mockSupabase.rpc.mockImplementation((fn: string) => {
				if (fn === "get_credits_auto") {
					return {
						data: {
							success: true,
							user_id: internalUserId,
							clerk_id: mockUserCredits.clerkId,
							current_credits: 2, // Only 2 credits
							credits_used: 98,
							total_spent_usd: "1.40",
							plan_type: "free",
							last_credit_update: new Date().toISOString(),
						},
						error: null,
					}
				}
				if (fn === "deduct_credits_auto") {
					throw new Error("deduct_credits_auto should not be called when credits are insufficient")
				}
				return { data: null, error: null }
			})

			const result = await creditManager.deductCreditsFromJWT(
				mockJWT,
				0.07, // Requires 5 credits
				"Test deduction",
			)

			expect(result.success).toBe(false)
			expect(result.error).toBe("insufficient_credits")
			expect(result.message).toContain("Required: 5, Available: 2")
		})

		test("should handle invalid JWT", async () => {
			vi.mocked(extractUserFromJWT).mockResolvedValue(null as any)

			const result = await creditManager.deductCreditsFromJWT("invalid_jwt", 0.014)

			expect(result.success).toBe(false)
			expect(result.error).toBe("invalid_jwt")
			expect(result.message).toBe("Invalid or expired JWT token")
		})

		test("should handle user not found", async () => {
			// Mapping query returns "no rows"
			mockUsersSingle.mockResolvedValueOnce({
				data: null,
				error: { code: "PGRST116", message: "No rows found" },
			})

			const result = await creditManager.deductCreditsFromJWT(mockJWT, 0.014)

			expect(result.success).toBe(false)
			expect(result.error).toBe("user_not_found")
			expect(result.message).toBe("User not found in database")
		})

		test("should handle database errors", async () => {
			mockSupabase.rpc.mockImplementation((fn: string) => {
				if (fn === "get_credits_auto") {
					return {
						data: {
							success: true,
							user_id: internalUserId,
							clerk_id: mockUserCredits.clerkId,
							current_credits: 100,
							credits_used: 0,
							total_spent_usd: "0.00",
							plan_type: "free",
							last_credit_update: new Date().toISOString(),
						},
						error: null,
					}
				}

				if (fn === "deduct_credits_auto") {
					return {
						data: null,
						error: { message: "Database connection failed" },
					}
				}

				return { data: null, error: null }
			})

			const result = await creditManager.deductCreditsFromJWT(mockJWT, 0.014)

			expect(result.success).toBe(false)
			expect(result.error).toBe("system_error")
			expect(result.message).toContain("Database connection failed")
		})
	})

	describe("Credit Balance Check", () => {
		const mockJWT = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test.signature"
		const mockUserInfo = {
			userId: "user_123",
			email: "test@example.com",
		}

		beforeEach(() => {
			vi.mocked(extractUserFromJWT).mockResolvedValue(mockUserInfo as any)
		})

		test("should get user credit balance", async () => {
			mockSupabase.rpc.mockResolvedValueOnce({
				data: {
					success: true,
					user_id: internalUserId,
					clerk_id: "user_123",
					current_credits: 75,
					credits_used: 25,
					total_spent_usd: "0.35",
					plan_type: "pro",
					last_credit_update: new Date().toISOString(),
				},
				error: null,
			})

			const result = await creditManager.getUserCreditBalance(mockJWT)

			expect(result).toEqual({
				userId: internalUserId,
				clerkId: "user_123",
				currentCredits: 75,
				creditsUsed: 25,
				totalSpent: 0.35,
				planType: "pro",
				lastUpdate: expect.any(String),
			})
		})

		test("should check sufficient credits", async () => {
			mockSupabase.rpc.mockResolvedValueOnce({
				data: {
					success: true,
					user_id: internalUserId,
					clerk_id: "user_123",
					current_credits: 50,
					credits_used: 0,
					total_spent_usd: "0.00",
					plan_type: "free",
					last_credit_update: new Date().toISOString(),
				},
				error: null,
			})

			const result = await creditManager.checkSufficientCredits(mockJWT, 0.07) // 5 credits

			expect(result.sufficient).toBe(true)
			expect(result.currentCredits).toBe(50)
			expect(result.requiredCredits).toBe(5)
		})

		test("should detect insufficient credits", async () => {
			mockSupabase.rpc.mockResolvedValueOnce({
				data: {
					success: true,
					user_id: internalUserId,
					clerk_id: "user_123",
					current_credits: 3,
					credits_used: 0,
					total_spent_usd: "0.00",
					plan_type: "free",
					last_credit_update: new Date().toISOString(),
				},
				error: null,
			})

			const result = await creditManager.checkSufficientCredits(mockJWT, 0.07) // 5 credits

			expect(result.sufficient).toBe(false)
			expect(result.currentCredits).toBe(3)
			expect(result.requiredCredits).toBe(5)
		})
	})

	describe("Caching", () => {
		test("should cache user data", async () => {
			const mockJWT = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test.signature"
			const mockUserInfo = { userId: "user_123", email: "test@example.com" }

			vi.mocked(extractUserFromJWT).mockResolvedValue(mockUserInfo as any)

			mockSupabase.rpc.mockResolvedValue({
				data: {
					success: true,
					user_id: internalUserId,
					clerk_id: "user_123",
					current_credits: 100,
					credits_used: 0,
					total_spent_usd: "0.00",
					plan_type: "free",
					last_credit_update: new Date().toISOString(),
				},
				error: null,
			})

			// First call
			await creditManager.getUserCreditBalance(mockJWT)

			// Second call should use cache
			await creditManager.getUserCreditBalance(mockJWT)

			// JWT extraction should be called once due to jwtCache
			expect(extractUserFromJWT).toHaveBeenCalledTimes(1)

			// Supabase should only be called once due to userCache
			expect(mockSupabase.rpc).toHaveBeenCalledTimes(1)
		})

		test("should clear user cache", () => {
			creditManager.clearUserCache("user_123")
			const stats = creditManager.getCacheStats()
			expect(stats.userCacheSize).toBe(0)
		})

		test("should clear all caches", () => {
			creditManager.clearAllCaches()
			const stats = creditManager.getCacheStats()
			expect(stats.userCacheSize).toBe(0)
			expect(stats.jwtCacheSize).toBe(0)
		})
	})

	describe("Cache Statistics", () => {
		test("should provide cache statistics", () => {
			const stats = creditManager.getCacheStats()

			expect(stats).toHaveProperty("userCacheSize")
			expect(stats).toHaveProperty("jwtCacheSize")
			expect(stats).toHaveProperty("config")
			expect(typeof stats.userCacheSize).toBe("number")
			expect(typeof stats.jwtCacheSize).toBe("number")
		})
	})

	describe("Error Handling", () => {
		test("should handle network errors gracefully", async () => {
			// Current behavior: if user extraction fails, we treat the token as invalid
			// (we don't expose upstream errors to the caller).
			vi.mocked(extractUserFromJWT).mockRejectedValue(new Error("Network error"))

			const result = await creditManager.deductCreditsFromJWT("valid_jwt", 0.014)

			expect(result.success).toBe(false)
			expect(result.error).toBe("invalid_jwt")
			expect(result.message).toBe("Invalid or expired JWT token")
		})

		test("should handle malformed responses", async () => {
			const mockJWT = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test.signature"
			const mockUserInfo = { userId: "user_123", email: "test@example.com" }

			vi.mocked(extractUserFromJWT).mockResolvedValue(mockUserInfo as any)

			// Return malformed response from get_credits_auto AND from legacy fallback,
			// so we deterministically end up with null.
			mockSupabase.rpc.mockImplementation((fn: string) => {
				if (fn === "get_credits_auto") return { data: null, error: null }
				if (fn === "get_user_credit_info") return { data: null, error: null }
				return { data: null, error: null }
			})

			const result = await creditManager.getUserCreditBalance(mockJWT)
			expect(result).toBeNull()
		})
	})

	afterEach(() => {
		creditManager.clearAllCaches()
	})
})

describe("Convenience Functions", () => {
	test("exported functions should work", async () => {
		const {
			deductCreditsFromJWT,
			checkUserCredits,
			validateSufficientCredits,
			getCreditRate,
			usdToCredits,
			creditsToUSD,
		} = await import("../services/creditManager")

		expect(getCreditRate()).toBe(0.014)
		expect(usdToCredits(0.07)).toBe(5)
		expect(creditsToUSD(5)).toBeCloseTo(0.07, 12)
	})
})
