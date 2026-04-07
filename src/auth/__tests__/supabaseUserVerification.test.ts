import { describe, it, expect, vi, beforeEach } from "vitest"
import { verifyJWTUserInSupabase, testUserIdInSupabase } from "../supabaseUserVerification"
import { parseJWTUnsafe } from "../jwtUtils"
import { getSupabaseServiceClient } from "../../services/supabaseConfig"

// Shared mock Supabase client for this test suite
const mockSupabase = {
	from: vi.fn().mockReturnThis(),
	select: vi.fn().mockReturnThis(),
	eq: vi.fn().mockReturnThis(),
	single: vi.fn(),
	rpc: vi.fn(),
	limit: vi.fn().mockReturnThis(),
}

vi.mock("../../services/supabaseConfig", () => ({
	getSupabaseServiceClient: vi.fn(),
}))

vi.mock("../jwtUtils", () => ({
	parseJWTUnsafe: vi.fn(),
}))

describe("Supabase User Verification", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		;(getSupabaseServiceClient as any).mockResolvedValue(mockSupabase)
	})

	describe("verifyJWTUserInSupabase", () => {
		it("should verify user exists in Supabase (maps clerk_id -> users.id then calls get_credits_auto)", async () => {
			const clerkId = "user_31vdw7c9BAYCHGHIggfTbJuURIS"
			const orgId = "11111111-1111-1111-1111-111111111111"
			const internalUserId = "22222222-2222-2222-2222-222222222222"

			;(parseJWTUnsafe as any).mockReturnValue({
				success: true,
				parts: { payload: { sub: clerkId, org_id: orgId, email: "test@example.com" } },
			})

			// 1) Mapping query: users.id by clerk_id
			mockSupabase.single.mockResolvedValueOnce({
				data: { id: internalUserId },
				error: null,
			})

			// 2) Context-aware credit lookup: uuid, uuid
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
			expect(result.userIdExtracted).toBe(clerkId)
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
			expect(mockSupabase.eq).toHaveBeenCalledWith("clerk_id", clerkId)
			expect(mockSupabase.rpc).toHaveBeenCalledWith("get_credits_auto", {
				p_user_id: internalUserId,
				p_org_id: orgId,
			})
		})

		it("should handle user not found in Supabase (no mapping row)", async () => {
			const clerkId = "user_notfound"

			;(parseJWTUnsafe as any).mockReturnValue({
				success: true,
				parts: { payload: { sub: clerkId } },
			})

			// Mapping query returns 0 rows
			mockSupabase.single.mockResolvedValueOnce({
				data: null,
				error: { code: "PGRST116", message: "The result contains 0 rows" },
			})

			const result = await verifyJWTUserInSupabase("mock.jwt.token")

			expect(result).toEqual({
				success: true,
				userIdExtracted: clerkId,
				userExistsInSupabase: false,
				error: "User not found in Supabase database",
			})
			expect(mockSupabase.rpc).not.toHaveBeenCalled()
		})

		it("should handle invalid JWT tokens", async () => {
			;(parseJWTUnsafe as any).mockReturnValue({
				success: false,
				error: "Invalid token format",
			})

			const result = await verifyJWTUserInSupabase("invalid.jwt.token")

			expect(result.success).toBe(false)
			expect(result.error).toContain("Failed to parse JWT")
			expect(mockSupabase.from).not.toHaveBeenCalled()
		})

		it("should handle Supabase configuration/client initialization errors", async () => {
			;(getSupabaseServiceClient as any).mockRejectedValueOnce(new Error("Supabase configuration missing"))
			;(parseJWTUnsafe as any).mockReturnValue({
				success: true,
				parts: { payload: { sub: "user_123" } },
			})

			const result = await verifyJWTUserInSupabase("mock.jwt.token")

			expect(result.success).toBe(false)
			expect(result.error).toContain("Verification failed:")
		})

		it("should handle RPC errors", async () => {
			const clerkId = "user_123"
			const orgId = "11111111-1111-1111-1111-111111111111"
			const internalUserId = "22222222-2222-2222-2222-222222222222"

			;(parseJWTUnsafe as any).mockReturnValue({
				success: true,
				parts: { payload: { sub: clerkId, org_id: orgId } },
			})

			// Mapping succeeds
			mockSupabase.single.mockResolvedValueOnce({
				data: { id: internalUserId },
				error: null,
			})

			// RPC returns error
			mockSupabase.rpc.mockResolvedValueOnce({
				data: null,
				error: { code: "P0001", message: "Database connection failed" },
			})

			const result = await verifyJWTUserInSupabase("mock.jwt.token")

			expect(result.success).toBe(false)
			expect(result.userIdExtracted).toBe(clerkId)
			expect(result.error).toBe("Database query failed: Database connection failed")
		})
	})
})

describe("Direct User ID Testing", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		;(getSupabaseServiceClient as any).mockResolvedValue(mockSupabase)
	})

	it("should test user ID directly in Supabase", async () => {
		const testUserId = "user_31vdw7c9BAYCHGHIggfTbJuURIS"

		const mockUserData = {
			id: "22222222-2222-2222-2222-222222222222",
			clerk_id: testUserId,
			email: "test@example.com",
			first_name: "John",
			last_name: "Doe",
		}

		mockSupabase.single.mockResolvedValueOnce({
			data: mockUserData,
			error: null,
		})

		const result = await testUserIdInSupabase(testUserId)

		expect(result.success).toBe(true)
		expect(result.userExistsInSupabase).toBe(true)
		expect(result.userDetails).toEqual(mockUserData)
	})

	it("should return not found when user ID does not match any column", async () => {
		mockSupabase.single.mockResolvedValue({ data: null, error: { code: "PGRST116" } })
		mockSupabase.eq.mockReturnValue(mockSupabase)

		const result = await testUserIdInSupabase("nonexistent_user")

		expect(result.success).toBe(true)
		expect(result.userExistsInSupabase).toBe(false)
		expect(result.error).toBe("User not found in Supabase with any column name")
	})
})
