import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { CreditManagerService } from "../creditManager"
import { getSupabaseServiceClient } from "../supabaseConfig"
import { extractUserFromJWT } from "../../auth/jwtVerification"
import { parseJWTUnsafe } from "../../auth/jwtUtils"

// Mock dependencies
vi.mock("../supabaseConfig", () => ({
	getSupabaseServiceClient: vi.fn(),
}))

vi.mock("../../auth/jwtVerification", () => ({
	extractUserFromJWT: vi.fn(),
	JWTVerificationService: {
		getInstance: () => ({
			validateTokenStructure: vi.fn(),
			extractUserInfo: vi.fn(),
		}),
	},
}))

vi.mock("../../auth/jwtUtils", () => ({
	parseJWTUnsafe: vi.fn(),
}))

// Mock console to reduce noise
const originalConsole = { ...console }
beforeEach(() => {
	global.console = {
		...originalConsole,
		log: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	} as any
})

afterEach(() => {
	global.console = originalConsole
})

describe("CreditManagerService", () => {
	let creditManager: CreditManagerService

	const internalUserId = "11111111-1111-1111-1111-111111111111"
	const mockSupabase = {
		rpc: vi.fn(),
		from: vi.fn(),
	}

	beforeEach(() => {
		vi.clearAllMocks()
		creditManager = CreditManagerService.getInstance()
		creditManager.clearAllCaches()
		;(getSupabaseServiceClient as any).mockResolvedValue(mockSupabase)

		// users mapping chain: from('users').select('id').eq('clerk_id', ...).single()
		const mockUsersSingle = vi.fn().mockResolvedValue({ data: { id: internalUserId }, error: null })
		const mockUsersEq = vi.fn().mockReturnValue({ single: mockUsersSingle })
		const mockUsersSelect = vi.fn().mockReturnValue({ eq: mockUsersEq })

		// credit_transactions chain (used by logCreditDeductionAttempt)
		const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null })
		const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
		const mockEq = vi.fn().mockReturnValue({ order: mockOrder })
		const mockSelectCreditTx = vi.fn().mockReturnValue({ eq: mockEq })

		mockSupabase.from.mockImplementation((table: string) => {
			if (table === "users") return { select: mockUsersSelect }
			if (table === "credit_transactions") return { select: mockSelectCreditTx }
			return { select: vi.fn() }
		})
	})

	describe("extractOrgIdFromJWT", () => {
		it("should extract org_id from JWT token when present", () => {
			const mockJwt = "header.payload.signature"
			const mockOrgId = "org_123456789"

			;(parseJWTUnsafe as any).mockReturnValue({
				success: true,
				parts: {
					payload: {
						org_id: mockOrgId,
						sub: "user-123",
					},
				},
			})

			const orgId = creditManager.extractOrgIdFromJWT(mockJwt)
			expect(orgId).toBe(mockOrgId)
			expect(parseJWTUnsafe).toHaveBeenCalledWith(mockJwt)
		})

		it("should return undefined when org_id is not present in JWT", () => {
			const mockJwt = "header.payload.signature"

			;(parseJWTUnsafe as any).mockReturnValue({
				success: true,
				parts: {
					payload: {
						sub: "user-123",
						email: "user@example.com",
					},
				},
			})

			const orgId = creditManager.extractOrgIdFromJWT(mockJwt)
			expect(orgId).toBeUndefined()
		})

		it("should return undefined when JWT parsing fails", () => {
			const mockJwt = "invalid-jwt"

			;(parseJWTUnsafe as any).mockReturnValue({
				success: false,
				error: "Invalid JWT format",
			})

			const orgId = creditManager.extractOrgIdFromJWT(mockJwt)
			expect(orgId).toBeUndefined()
		})

		it("should return undefined on parsing exception", () => {
			const mockJwt = "malformed-token"

			;(parseJWTUnsafe as any).mockImplementation(() => {
				throw new Error("Parse error")
			})

			const orgId = creditManager.extractOrgIdFromJWT(mockJwt)
			expect(orgId).toBeUndefined()
		})
	})

	describe("organization credit routing", () => {
		it("should route to organization credits when org_id is present in JWT", async () => {
			const mockOrgId = "org_123456789"
			const mockJwt = "header.payload.signature"
			const clerkUserId = "clerk-123"
			const mockUser = { userId: clerkUserId }
			const usdAmount = 0.05
			const creditsToDeduct = 3.57

			// Mock user extraction
			;(extractUserFromJWT as any).mockResolvedValue(mockUser)

			// Mock org_id extraction
			;(parseJWTUnsafe as any).mockReturnValue({
				success: true,
				parts: {
					payload: {
						org_id: mockOrgId,
						sub: clerkUserId,
					},
				},
			})

			// Mock get_credits_auto RPC call (first call)
			mockSupabase.rpc.mockResolvedValueOnce({
				data: {
					success: true,
					user_id: internalUserId,
					clerk_id: clerkUserId,
					current_credits: 100,
					credits_used: 10,
					total_spent_usd: "1.00",
					plan_type: "free",
					last_credit_update: new Date().toISOString(),
				},
				error: null,
			})

			// Mock deduct_credits_auto RPC call (second call)
			mockSupabase.rpc.mockResolvedValueOnce({
				data: [
					{
						success: true,
						credits_deducted: creditsToDeduct,
						balance_before: 100,
						balance_after: 100 - creditsToDeduct,
						usd_amount: usdAmount,
						transaction_id: "trans-123",
						user_id: internalUserId,
						error: null,
						message: "Success",
					},
				],
				error: null,
			})

			const result = await creditManager.deductCreditsFromJWT(mockJwt, usdAmount, "Test deduction")

			expect(result.success).toBe(true)

			// Verify org_id was passed to get_credits_auto
			const getCreditsCall = mockSupabase.rpc.mock.calls.find((call: any[]) => call[0] === "get_credits_auto")
			expect(getCreditsCall?.[1]).toEqual(
				expect.objectContaining({
					p_user_id: internalUserId,
					p_org_id: mockOrgId,
				}),
			)

			// Verify org_id was passed to deduct_credits_auto
			const deductionCall = mockSupabase.rpc.mock.calls.find((call: any[]) => call[0] === "deduct_credits_auto")
			expect(deductionCall).toBeDefined()
			expect(deductionCall?.[1]).toEqual(
				expect.objectContaining({
					p_user_id: internalUserId,
					p_org_id: mockOrgId,
				}),
			)
		})

		it("should fallback to user credits when org_id is not present in JWT", async () => {
			const mockJwt = "header.payload.signature"
			const clerkUserId = "clerk-123"
			const mockUser = { userId: clerkUserId }
			const usdAmount = 0.05
			const creditsToDeduct = 3.57

			// Mock user extraction
			;(extractUserFromJWT as any).mockResolvedValue(mockUser)

			// Mock org_id extraction (no org_id in payload)
			;(parseJWTUnsafe as any).mockReturnValue({
				success: true,
				parts: {
					payload: {
						sub: clerkUserId,
						email: "user@example.com",
					},
				},
			})

			// Mock get_credits_auto RPC call (first call)
			mockSupabase.rpc.mockResolvedValueOnce({
				data: {
					success: true,
					user_id: internalUserId,
					clerk_id: clerkUserId,
					current_credits: 100,
					credits_used: 10,
					total_spent_usd: "1.00",
					plan_type: "free",
					last_credit_update: new Date().toISOString(),
				},
				error: null,
			})

			// Mock deduct_credits_auto RPC call (second call)
			mockSupabase.rpc.mockResolvedValueOnce({
				data: [
					{
						success: true,
						credits_deducted: creditsToDeduct,
						balance_before: 100,
						balance_after: 100 - creditsToDeduct,
						usd_amount: usdAmount,
						transaction_id: "trans-123",
						user_id: internalUserId,
						error: null,
						message: "Success",
					},
				],
				error: null,
			})

			const result = await creditManager.deductCreditsFromJWT(mockJwt, usdAmount, "Test deduction")

			expect(result.success).toBe(true)

			// Verify null was passed for p_org_id when no org_id in JWT
			const getCreditsCall = mockSupabase.rpc.mock.calls.find((call: any[]) => call[0] === "get_credits_auto")
			expect(getCreditsCall?.[1]).toEqual(
				expect.objectContaining({
					p_user_id: internalUserId,
					p_org_id: null,
				}),
			)

			const deductionCall = mockSupabase.rpc.mock.calls.find((call: any[]) => call[0] === "deduct_credits_auto")
			expect(deductionCall).toBeDefined()
			expect(deductionCall?.[1]).toEqual(
				expect.objectContaining({
					p_user_id: internalUserId,
					p_org_id: null,
				}),
			)
		})
	})

	it("should map Clerk userId to users.id before calling get_credits_auto and deduct_credits_auto", async () => {
		const mockJwt = "header.payload.signature"
		const clerkUserId = "clerk-123"
		const mockUser = { userId: clerkUserId }
		const usdAmount = 0.05
		const creditsToDeduct = 3.57 // 0.05 / 0.014 = 3.5714... -> 3.57

		// Mock user extraction
		;(extractUserFromJWT as any).mockResolvedValue(mockUser)

		// Mock org_id extraction (no org_id in payload)
		;(parseJWTUnsafe as any).mockReturnValue({
			success: true,
			parts: {
				payload: {
					sub: clerkUserId,
				},
			},
		})

		// Mock get_credits_auto RPC call (first call)
		mockSupabase.rpc.mockResolvedValueOnce({
			data: {
				success: true,
				user_id: internalUserId,
				clerk_id: clerkUserId,
				current_credits: 100,
				credits_used: 10,
				total_spent_usd: "1.00",
				plan_type: "free",
				last_credit_update: new Date().toISOString(),
			},
			error: null,
		})

		// Mock deduct_credits_auto RPC call (second call)
		mockSupabase.rpc.mockResolvedValueOnce({
			data: [
				{
					success: true,
					credits_deducted: creditsToDeduct,
					balance_before: 100,
					balance_after: 100 - creditsToDeduct,
					usd_amount: usdAmount,
					transaction_id: "trans-123",
					user_id: internalUserId,
					error: null,
					message: "Success",
				},
			],
			error: null,
		})

		const result = await creditManager.deductCreditsFromJWT(mockJwt, usdAmount, "Test deduction")

		expect(result.success).toBe(true)

		// Mapping query executed
		expect(mockSupabase.from).toHaveBeenCalledWith("users")

		// get_credits_auto should be called with internal uuid, not the Clerk id
		const getCreditsCall = mockSupabase.rpc.mock.calls.find((call: any[]) => call[0] === "get_credits_auto")
		expect(getCreditsCall?.[1]).toEqual(expect.objectContaining({ p_user_id: internalUserId }))

		// deduct_credits_auto should receive the same internal uuid and USD amount
		const deductionCall = mockSupabase.rpc.mock.calls.find((call: any[]) => call[0] === "deduct_credits_auto")
		expect(deductionCall).toBeDefined()

		if (deductionCall) {
			const params = deductionCall[1]
			expect(params).toEqual(
				expect.objectContaining({
					p_user_id: internalUserId,
					p_usd_amount: usdAmount,
				}),
			)
			expect(params.p_usd_amount).toBe(usdAmount)
		}
	})

	it("should handle insufficient credits correctly", async () => {
		const mockJwt = "header.payload.signature"
		const clerkUserId = "clerk-123"
		const mockUser = { userId: clerkUserId }
		const usdAmount = 100.0 // Large amount

		// Mock user extraction
		;(extractUserFromJWT as any).mockResolvedValue(mockUser)

		// Mock org_id extraction (no org_id in payload)
		;(parseJWTUnsafe as any).mockReturnValue({
			success: true,
			parts: {
				payload: {
					sub: clerkUserId,
				},
			},
		})

		// Mock get_credits_auto RPC call
		mockSupabase.rpc.mockResolvedValueOnce({
			data: {
				success: true,
				user_id: internalUserId,
				clerk_id: clerkUserId,
				current_credits: 10, // Only 10 credits
				credits_used: 10,
				total_spent_usd: "1.00",
				plan_type: "free",
				last_credit_update: new Date().toISOString(),
			},
			error: null,
		})

		const result = await creditManager.deductCreditsFromJWT(mockJwt, usdAmount, "Test deduction")

		expect(result.success).toBe(false)
		expect(result.error).toBe("insufficient_credits")

		// Should NOT call deduct_credits_auto
		const deductionCall = mockSupabase.rpc.mock.calls.find((call: any[]) => call[0] === "deduct_credits_auto")
		expect(deductionCall).toBeUndefined()
	})
})
