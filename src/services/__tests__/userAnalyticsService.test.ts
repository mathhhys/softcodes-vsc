import { describe, it, expect, vi, beforeEach } from "vitest"
import { UserAnalyticsService } from "../userAnalyticsService"
import { getSupabaseServiceClient } from "../supabaseConfig"

vi.mock("../supabaseConfig", () => ({
	getSupabaseServiceClient: vi.fn(),
}))

describe("UserAnalyticsService", () => {
	const internalUserId = "11111111-1111-1111-1111-111111111111"
	const clerkUserId = "clerk-user-123"
	const startDate = new Date("2024-01-01T00:00:00.000Z")
	const endDate = new Date("2024-01-31T23:59:59.999Z")
	const mockSupabase = {
		from: vi.fn(),
		rpc: vi.fn(),
	}

	beforeEach(() => {
		vi.clearAllMocks()
		;(getSupabaseServiceClient as any).mockResolvedValue(mockSupabase)
	})

	const mockUserMapping = (result: { data: any; error: any }) => {
		const mockUsersSingle = vi.fn().mockResolvedValue(result)
		const mockUsersEq = vi.fn().mockReturnValue({ single: mockUsersSingle })
		const mockUsersSelect = vi.fn().mockReturnValue({ eq: mockUsersEq })

		mockSupabase.from.mockImplementation((table: string) => {
			if (table === "users") {
				return { select: mockUsersSelect }
			}
			return { select: vi.fn() }
		})
	}

	it("returns user_not_found when the user mapping returns no rows", async () => {
		mockUserMapping({
			data: null,
			error: { code: "PGRST116", message: "No rows" },
		})

		const service = UserAnalyticsService.getInstance()
		const result = await service.getUserAnalyticsSummary(clerkUserId, startDate, endDate)

		expect(result.success).toBe(false)
		expect(result.error).toBe("user_not_found")
	})

	it("returns mapping error when the user lookup fails", async () => {
		mockUserMapping({
			data: null,
			error: { code: "PGRST999", message: "Lookup failed" },
		})

		const service = UserAnalyticsService.getInstance()
		const result = await service.getUserAnalyticsSummary(clerkUserId, startDate, endDate)

		expect(result.success).toBe(false)
		expect(result.error).toBe("Lookup failed")
	})

	it("returns rpc error when analytics query fails", async () => {
		mockUserMapping({
			data: { id: internalUserId },
			error: null,
		})

		mockSupabase.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: "RPC failed" },
		})

		const service = UserAnalyticsService.getInstance()
		const result = await service.getUserAnalyticsSummary(clerkUserId, startDate, endDate)

		expect(result.success).toBe(false)
		expect(result.error).toBe("RPC failed")
	})

	it("builds analytics summary from object rpc response", async () => {
		mockUserMapping({
			data: { id: internalUserId },
			error: null,
		})

		mockSupabase.rpc.mockResolvedValueOnce({
			data: {
				total_requests: 2,
				total_credits: "4.5",
				total_input_tokens: 120,
				total_output_tokens: "80",
				top_models: [{ model_id: "gpt-4", requests: 2, cost: "4.5" }],
				top_providers: [{ provider: "openrouter", requests: 2, cost: 4.5 }],
			},
			error: null,
		})

		const service = UserAnalyticsService.getInstance()
		const result = await service.getUserAnalyticsSummary(clerkUserId, startDate, endDate)

		expect(result.success).toBe(true)
		expect(result.data).toEqual(
			expect.objectContaining({
				totalRequests: 2,
				totalCredits: 4.5,
				totalInputTokens: 120,
				totalOutputTokens: 80,
				totalTokens: 200,
				creditsPerRequest: 2.25,
			}),
		)
		expect(result.data?.topModels[0]).toEqual({
			modelId: "gpt-4",
			requests: 2,
			credits: 4.5,
		})
		expect(result.data?.topProviders[0]).toEqual({
			provider: "openrouter",
			requests: 2,
			credits: 4.5,
		})

		expect(mockSupabase.rpc).toHaveBeenCalledWith("get_user_analytics", {
			p_user_id: internalUserId,
			p_start_date: startDate.toISOString(),
			p_end_date: endDate.toISOString(),
		})
	})

	it("builds analytics summary from array rpc response", async () => {
		mockUserMapping({
			data: { id: internalUserId },
			error: null,
		})

		mockSupabase.rpc.mockResolvedValueOnce({
			data: [
				{
					total_requests: 1,
					total_credits: "1.25",
					total_input_tokens: 10,
					total_output_tokens: 5,
					top_models: [{ model_id: "gpt-3.5", requests: 1, cost: "1.25" }],
					top_providers: [{ provider: "openrouter", requests: 1, cost: 1.25 }],
				},
			],
			error: null,
		})

		const service = UserAnalyticsService.getInstance()
		const result = await service.getUserAnalyticsSummary(clerkUserId, startDate, endDate)

		expect(result.success).toBe(true)
		expect(result.data).toEqual(
			expect.objectContaining({
				totalRequests: 1,
				totalCredits: 1.25,
				totalInputTokens: 10,
				totalOutputTokens: 5,
				totalTokens: 15,
				creditsPerRequest: 1.25,
			}),
		)
		expect(result.data?.topModels[0]).toEqual({
			modelId: "gpt-3.5",
			requests: 1,
			credits: 1.25,
		})
		expect(result.data?.topProviders[0]).toEqual({
			provider: "openrouter",
			requests: 1,
			credits: 1.25,
		})
	})
})
