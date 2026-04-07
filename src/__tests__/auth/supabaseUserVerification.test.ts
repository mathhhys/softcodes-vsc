import { describe, it, expect, vi, beforeEach } from "vitest"
import { verifyJWTUserInSupabase, testUserIdInSupabase } from "../../auth/supabaseUserVerification"
import { parseJWTUnsafe } from "../../auth/jwtUtils"

// Mock the Supabase client
// NOTE: vi.mock() is hoisted by Vitest, so any values referenced inside the factory
// must also be hoisted to avoid "Cannot access before initialization" errors.
const { mockSupabase } = vi.hoisted(() => ({
	mockSupabase: {
		from: vi.fn().mockReturnThis(),
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		single: vi.fn(),
		rpc: vi.fn(),
		limit: vi.fn().mockReturnThis(),
	},
}))

vi.mock("../../services/supabaseConfig", () => ({
	getSupabaseServiceClient: vi.fn().mockResolvedValue(mockSupabase),
}))

vi.mock("../../auth/jwtUtils", () => ({
	parseJWTUnsafe: vi.fn(),
}))

describe("supabaseUserVerification", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("verifyJWTUserInSupabase", () => {
		it("should successfully verify user when found in Supabase", async () => {
			const orgId = "11111111-1111-1111-1111-111111111111"
			const internalUserId = "22222222-2222-2222-2222-222222222222"

			// Mock JWT parsing
			;(parseJWTUnsafe as any).mockReturnValue({
				success: true,
				parts: {
					payload: {
						sub: "user_123",
						org_id: orgId,
						email: "test@example.com",
					},
				},
			})

			// 1) Map clerk_id -> users.id
			mockSupabase.eq.mockReturnValue(mockSupabase)
			mockSupabase.single.mockResolvedValueOnce({
				data: { id: internalUserId },
				error: null,
			})

			// 2) Call get_credits_auto with UUID args
			mockSupabase.rpc.mockResolvedValueOnce({
				data: {
					success: true,
					user_id: internalUserId,
					org_id: orgId,
					current_credits: 20100,
					plan_type: "starter",
					is_organization: false,
				},
				error: null,
			})

			const result = await verifyJWTUserInSupabase("mock.jwt.token")

			expect(result.success).toBe(true)
			expect(result.userIdExtracted).toBe("user_123")
			expect(result.userExistsInSupabase).toBe(true)
			expect(result.userDetails).toMatchObject({
				success: true,
				user_id: internalUserId,
				org_id: orgId,
				current_credits: 20100,
				credits: 20100,
				id: internalUserId,
				plan_type: "starter",
			})

			expect(parseJWTUnsafe).toHaveBeenCalledWith("mock.jwt.token")
			expect(mockSupabase.from).toHaveBeenCalledWith("users")
			expect(mockSupabase.select).toHaveBeenCalledWith("id")
			expect(mockSupabase.eq).toHaveBeenCalledWith("clerk_id", "user_123")
			expect(mockSupabase.rpc).toHaveBeenCalledWith("get_credits_auto", {
				p_user_id: internalUserId,
				p_org_id: orgId,
			})
		})

		it("should handle user not found in Supabase", async () => {
			// Mock JWT parsing
			;(parseJWTUnsafe as any).mockReturnValue({
				success: true,
				parts: {
					payload: {
						sub: "user_456",
					},
				},
			})

			// Mapping query returns "no rows"
			mockSupabase.eq.mockReturnValue(mockSupabase)
			mockSupabase.single.mockResolvedValueOnce({
				data: null,
				error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
			})

			const result = await verifyJWTUserInSupabase("mock.jwt.token")

			expect(result).toEqual({
				success: true,
				userIdExtracted: "user_456",
				userExistsInSupabase: false,
				error: "User not found in Supabase database",
			})
			expect(mockSupabase.rpc).not.toHaveBeenCalled()
		})

		it("should handle invalid JWT parsing", async () => {
			// Mock JWT parsing failure
			;(parseJWTUnsafe as any).mockReturnValue({
				success: false,
				error: "Invalid token format",
			})

			const result = await verifyJWTUserInSupabase("invalid.token")

			expect(result).toEqual({
				success: false,
				error: "Failed to parse JWT: Invalid token format",
			})

			expect(mockSupabase.from).not.toHaveBeenCalled()
		})

		it("should handle Supabase query error", async () => {
			// Mock JWT parsing
			;(parseJWTUnsafe as any).mockReturnValue({
				success: true,
				parts: {
					payload: {
						sub: "user_789",
					},
				},
			})

			// Mapping query throws (e.g. connection failure)
			mockSupabase.eq.mockReturnValue(mockSupabase)
			mockSupabase.single.mockRejectedValueOnce({
				code: "P0001",
				message: "Database connection failed",
			})

			const result = await verifyJWTUserInSupabase("mock.jwt.token")

			expect(result).toEqual({
				success: false,
				userIdExtracted: "user_789",
				error: "Database query failed: Database connection failed",
			})
			expect(mockSupabase.rpc).not.toHaveBeenCalled()
		})
	})

	describe("testUserIdInSupabase", () => {
		it("should find user with clerk_id column", async () => {
			mockSupabase.eq
				.mockReturnValueOnce(mockSupabase) // clerk_id
				.mockReturnValueOnce(mockSupabase) // clerkId
				.mockReturnValue(mockSupabase)
			mockSupabase.single
				.mockResolvedValueOnce({
					data: { id: "1", clerk_id: "user_123", email: "test@example.com" },
					error: null,
				})
				.mockResolvedValueOnce({ data: null, error: { code: "PGRST116" } })
				.mockResolvedValue({ data: null, error: { code: "PGRST116" } })

			const result = await testUserIdInSupabase("user_123")

			expect(result).toEqual({
				success: true,
				userIdExtracted: "user_123",
				userExistsInSupabase: true,
				userDetails: { id: "1", clerk_id: "user_123", email: "test@example.com" },
			})

			expect(mockSupabase.eq).toHaveBeenNthCalledWith(1, "clerk_id", "user_123")
		})

		it("should handle user not found with any column", async () => {
			mockSupabase.eq.mockReturnValue(mockSupabase)
			mockSupabase.single.mockResolvedValue({ data: null, error: { code: "PGRST116" } })

			const result = await testUserIdInSupabase("nonexistent_user")

			expect(result).toEqual({
				success: true,
				userIdExtracted: "nonexistent_user",
				userExistsInSupabase: false,
				error: "User not found in Supabase with any column name",
			})
		})
	})
})
