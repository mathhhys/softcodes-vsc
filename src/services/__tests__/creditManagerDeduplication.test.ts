import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { CreditManagerService, deductCreditsFromJWT, CreditTransaction } from "../creditManager"
import { getSupabaseServiceClient } from "../supabaseConfig"
import { JWTVerificationService } from "../../auth/jwtVerification"
import * as creditDiagnosticLogger from "../creditDiagnosticLogger"

// Mock Supabase
vi.mock("../supabaseConfig", () => ({
	getSupabaseServiceClient: vi.fn(),
}))

const mockSupabase = {
	rpc: vi.fn(),
	from: vi.fn(),
}

const mockGetSupabase = vi.mocked(getSupabaseServiceClient).mockResolvedValue(mockSupabase as any)

// Mock JWT service
vi.mock("../../auth/jwtVerification", () => ({
	JWTVerificationService: {
		getInstance: vi.fn(() => ({
			validateTokenStructure: vi.fn(),
			extractUserInfo: vi.fn(),
		})),
	},
	extractUserFromJWT: vi.fn(),
}))

// Mock VSCode for broadcast
const mockVSCode = {
	commands: {
		executeCommand: vi.fn(),
	},
}
vi.mock("vscode", () => mockVSCode)

vi.mock("../creditDiagnosticLogger", async () => {
	const actual = await vi.importActual<typeof import("../creditDiagnosticLogger")>("../creditDiagnosticLogger")
	return {
		...actual,
		logCreditDeductionAttempt: vi.fn(actual.logCreditDeductionAttempt),
		diagnoseDatabaseSchema: vi.fn().mockResolvedValue({} as any),
	}
})

// Mock Decimal for precision

// Mock CREDIT_CONFIG
vi.doMock("../../config/constants", () => ({
	CREDIT_CONFIG: {
		USD_PER_CREDIT: 0.005,
		LOW_CREDIT_THRESHOLD: 10,
	},
}))

describe("CreditManager Deduplication", () => {
	let creditManager: CreditManagerService
	let mockExtractUserFromJWT: any
	let mockRpc: any
	let mockSelect: any
	let mockEq: any
	let mockOrder: any
	let mockLimit: any
	let transactionCounter: number

	const mockUserId = "test-user-123"
	const internalUserId = "11111111-1111-1111-1111-111111111111"
	const mockJwtToken =
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXItMTIzIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
	const usdAmount = 0.14
	const expectedCredits = 28 // 0.14 / 0.005 = 28 credits (uses mocked CREDIT_CONFIG.USD_PER_CREDIT)
	const description = "Test deduction"

	beforeEach(async () => {
		creditManager = CreditManagerService.getInstance()
		creditManager.clearAllCaches()

		// Reset mocks
		vi.clearAllMocks()

		// credit_transactions chain (used by creditDiagnosticLogger)
		mockLimit = vi.fn().mockResolvedValue({ data: [], error: null })
		mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
		mockEq = vi.fn().mockReturnValue({ order: mockOrder })
		mockSelect = vi.fn().mockReturnValue({ eq: mockEq })

		// users mapping chain: from('users').select('id').eq('clerk_id', ...).single()
		const mockUsersSingle = vi.fn().mockResolvedValue({ data: { id: internalUserId }, error: null })
		const mockUsersEq = vi.fn().mockReturnValue({ single: mockUsersSingle })
		const mockUsersSelect = vi.fn().mockReturnValue({ eq: mockUsersEq })

		mockSupabase.rpc.mockReset()
		transactionCounter = 0
		mockSupabase.from.mockReset()
		mockSupabase.from.mockImplementation((table: string) => {
			if (table === "users") {
				return { select: mockUsersSelect }
			}

			return { select: mockSelect }
		})

		vi.mocked(creditDiagnosticLogger.logCreditDeductionAttempt).mockClear()

		// Mock JWT extraction to return user info
		const { extractUserFromJWT } = await import("../../auth/jwtVerification")
		const mockExtractUserFromJWT = vi.mocked(extractUserFromJWT)
		mockExtractUserFromJWT.mockResolvedValue({
			userId: mockUserId,
			email: "test@example.com",
			emailVerified: true,
			sessionId: "test-session",
		} as any)

		// Mock JWT structure validation
		const { JWTVerificationService } = await import("../../auth/jwtVerification")
		const mockGetInstance = vi.mocked(JWTVerificationService.getInstance)
		const mockInstance = {
			validateTokenStructure: vi.fn(),
			extractUserInfo: vi.fn(),
		}
		mockGetInstance.mockReturnValue(mockInstance as any)
		mockInstance.validateTokenStructure.mockResolvedValue({
			valid: true,
			payload: { sub: mockUserId },
		})
		mockInstance.extractUserInfo.mockReturnValue({
			userId: mockUserId,
			email: "test@example.com",
			emailVerified: true,
			sessionId: "test-session",
		} as any)

		// Mock Supabase RPC for get_credits_auto + deduct_credits_auto
		mockRpc = mockSupabase.rpc
		mockRpc.mockImplementation((functionName: string, params: any) => {
			if (functionName === "get_credits_auto") {
				return {
					data: {
						success: true,
						user_id: internalUserId,
						clerk_id: mockUserId,
						current_credits: 100,
						credits_used: 0,
						total_spent_usd: "0.00",
						plan_type: "free",
						last_credit_update: new Date().toISOString(),
					},
					error: null,
				}
			}

			if (functionName === "deduct_credits_auto") {
				transactionCounter += 1
				return {
					data: [
						{
							success: true,
							credits_deducted: expectedCredits,
							balance_before: 100,
							balance_after: 100 - expectedCredits,
							usd_amount: params.p_usd_amount,
							transaction_id: `tx_${transactionCounter}`,
							user_id: params.p_user_id,
							error: null,
							message: "Success",
						},
					],
					error: null,
				}
			}

			// Default: no-op for unexpected RPCs (avoid failing unrelated diagnostic code paths)
			return { data: null, error: null }
		})
	})

	afterEach(() => {
		creditManager.clearAllCaches()
	})

	describe("deductCreditsFromJWT", () => {
		it("should perform successful deduction", async () => {
			const result = await deductCreditsFromJWT(mockJwtToken, usdAmount, description)

			expect(result.success).toBe(true)
			expect(result.creditsDeducted).toBe(expectedCredits)
			expect(result.balanceAfter).toBe(100 - expectedCredits)

			const getCreditsCall = mockRpc.mock.calls.find(
				(call: [string, ...unknown[]]) => call[0] === "get_credits_auto",
			)
			expect(getCreditsCall?.[1]).toEqual(
				expect.objectContaining({
					p_user_id: internalUserId,
					p_org_id: undefined,
				}),
			)

			const deductCalls = mockRpc.mock.calls.filter(
				(call: [string, ...unknown[]]) => call[0] === "deduct_credits_auto",
			)
			expect(deductCalls).toHaveLength(1)
			expect(mockRpc).toHaveBeenCalledTimes(2) // get_credits_auto + deduct_credits_auto

			expect(mockSupabase.from).toHaveBeenCalledWith("users")
			expect(mockSupabase.from).toHaveBeenCalledWith("credit_transactions")
			expect(mockSelect).toHaveBeenCalledWith("id, created_at, credits_amount, usd_amount, balance_after")
			// creditDiagnosticLogger should query credit_transactions using internal users.id (uuid)
			expect(mockEq).toHaveBeenCalledWith("user_id", internalUserId)
			expect(mockOrder).toHaveBeenCalledWith("created_at", { ascending: false })
			expect(mockLimit).toHaveBeenCalledWith(1)

			expect(creditDiagnosticLogger.logCreditDeductionAttempt).toHaveBeenCalledTimes(1)
		})

		it("should prevent duplicate deductions using operation locks", async () => {
			const requestId = "fixed-req-id-locks"
			// First call - should succeed
			const firstResult = await deductCreditsFromJWT(mockJwtToken, usdAmount, description, { requestId })
			expect(firstResult.success).toBe(true)
			expect(mockRpc).toHaveBeenCalledTimes(2) // get_credits_auto + deduct_credits_auto

			// Reset RPC call count for second call
			mockRpc.mockClear()

			// Second call with same params - should detect duplicate via lock/fingerprint
			const secondResult = await deductCreditsFromJWT(mockJwtToken, usdAmount, description, { requestId })
			expect(secondResult.success).toBe(true) // Returns the cached successful result
			expect(secondResult.transactionId).toBe(firstResult.transactionId) // Same transaction

			// Should NOT call database again
			expect(mockRpc).toHaveBeenCalledTimes(0) // No new RPC calls
		})

		it("should handle concurrent duplicate requests", async () => {
			const requestId = "fixed-req-id-concurrent"
			const promise1 = deductCreditsFromJWT(mockJwtToken, usdAmount, description, { requestId })
			const promise2 = deductCreditsFromJWT(mockJwtToken, usdAmount, description, { requestId })

			const [result1, result2] = await Promise.all([promise1, promise2])

			expect(result1.success).toBe(true)
			expect(result2.success).toBe(true)
			expect(result1.transactionId).toBe(result2.transactionId) // Same transaction

			// Only one database deduction call
			expect(mockRpc).toHaveBeenCalledTimes(2) // get + deduct, not doubled
		})

		it("should use processed operations cache to prevent duplicates after completion", async () => {
			const requestId = "fixed-req-id-cache"
			// First deduction
			await deductCreditsFromJWT(mockJwtToken, usdAmount, description, { requestId })
			expect(mockRpc).toHaveBeenCalledTimes(2)

			mockRpc.mockClear()

			// Wait a bit for cache to be set
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Second deduction - should hit cache
			const secondResult = await deductCreditsFromJWT(mockJwtToken, usdAmount, description, { requestId })
			expect(secondResult.success).toBe(true)

			// No database calls
			expect(mockRpc).toHaveBeenCalledTimes(0)
		})

		it("should generate unique fingerprints for different operations", async () => {
			const differentUsd = 0.07
			const differentDesc = "Different operation"

			// First operation
			const result1 = await deductCreditsFromJWT(mockJwtToken, usdAmount, description, { requestId: "req1" })

			// Reset and change params
			creditManager.clearAllCaches()
			mockRpc.mockClear()

			// Second operation with different params
			const result2 = await deductCreditsFromJWT(mockJwtToken, differentUsd, differentDesc, { requestId: "req2" })

			expect(result1.success).toBe(true)
			expect(result2.success).toBe(true)
			expect(result1.transactionId).not.toBe(result2.transactionId) // Different transactions

			// Database called twice (once per unique operation)
			expect(mockRpc).toHaveBeenCalledTimes(2) // 2 for second (first cleared)
		})

		it("should NOT deduplicate identical operations with different requestIds", async () => {
			// First operation
			const result1 = await deductCreditsFromJWT(mockJwtToken, usdAmount, description, {
				requestId: "req-unique-1",
			})
			expect(result1.success).toBe(true)

			// Second operation - identical content but different requestId
			const result2 = await deductCreditsFromJWT(mockJwtToken, usdAmount, description, {
				requestId: "req-unique-2",
			})
			expect(result2.success).toBe(true)

			// Should be different transactions
			expect(result1.transactionId).not.toBe(result2.transactionId)

			// Verify deduct_user_credits was called twice
			const deductCalls = mockRpc.mock.calls.filter(
				(call: [string, ...unknown[]]) => call[0] === "deduct_credits_auto",
			)
			// We expect at least 2 calls (one for each operation)
			// Note: previous tests might have added calls if not cleared properly, but we clear in beforeEach/afterEach
			// Actually, we are in a single 'it' block, so we count from start of this block.
			// But wait, mockRpc accumulates calls? No, mockClear() clears it.
			// But I didn't call mockClear() inside this test.
			// So I should check if it was called at least twice relative to this test execution?
			// Ah, `deductCalls` filters ALL calls since last clear.
			// Since this is a new test, `beforeEach` cleared mocks.
			expect(deductCalls.length).toBe(2)
		})

		it("should fail duplicate if first fails", async () => {
			const originalImplementation = mockRpc.mockImplementation

			const insufficientCreditsResponse = {
				data: {
					success: true,
					user_id: "11111111-1111-1111-1111-111111111111",
					clerk_id: mockUserId,
					current_credits: 1,
					credits_used: 0,
					total_spent_usd: "0.00",
					plan_type: "free",
					last_credit_update: new Date().toISOString(),
				},
				error: null,
			}

			mockRpc.mockImplementation((fn: string) => {
				if (fn === "get_credits_auto") {
					return insufficientCreditsResponse
				}
				if (fn === "deduct_credits_auto") {
					throw new Error("deduct_credits_auto should not be called when credits are insufficient")
				}
				return { data: null, error: null }
			})

			const promise1 = deductCreditsFromJWT(mockJwtToken, usdAmount, description)
			const promise2 = deductCreditsFromJWT(mockJwtToken, usdAmount, description)

			const [result1, result2] = await Promise.all([promise1, promise2])

			expect(result1.success).toBe(false)
			expect(result2.success).toBe(false)
			expect(result1.error).toBe("insufficient_credits")
			expect(result2.error).toBe("insufficient_credits")
			expect(mockRpc).not.toHaveBeenCalledWith("deduct_credits_auto", expect.anything())

			mockRpc.mockImplementation(originalImplementation as any)
		})
	})
})
