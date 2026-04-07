import { getSupabaseServiceClient } from "./supabaseConfig"

export interface ModelUsageRanking {
	modelId: string | null
	requests: number
	credits: number
}

export interface ProviderUsageRanking {
	provider: string | null
	requests: number
	credits: number
}

export interface UserAnalyticsSummary {
	totalRequests: number
	totalCredits: number
	totalInputTokens: number
	totalOutputTokens: number
	totalTokens: number
	creditsPerRequest: number
	topModels: ModelUsageRanking[]
	topProviders: ProviderUsageRanking[]
}

export interface UserAnalyticsResult {
	success: boolean
	data?: UserAnalyticsSummary
	error?: string
}

const EMPTY_SUMMARY: UserAnalyticsSummary = {
	totalRequests: 0,
	totalCredits: 0,
	totalInputTokens: 0,
	totalOutputTokens: 0,
	totalTokens: 0,
	creditsPerRequest: 0,
	topModels: [],
	topProviders: [],
}

export class UserAnalyticsService {
	private static instance: UserAnalyticsService

	static getInstance(): UserAnalyticsService {
		if (!UserAnalyticsService.instance) {
			UserAnalyticsService.instance = new UserAnalyticsService()
		}
		return UserAnalyticsService.instance
	}

	async getUserAnalyticsSummary(clerkUserId: string, startDate: Date, endDate: Date): Promise<UserAnalyticsResult> {
		try {
			const supabase = await getSupabaseServiceClient()

			console.log("[UserAnalytics] Fetching user mapping for clerkUserId:", clerkUserId)

			const { data: mappedUser, error: mappedUserError } = await supabase
				.from("users")
				.select("id")
				.eq("clerk_id", clerkUserId)
				.single()

			console.log("[UserAnalytics] Mapped user result:", { mappedUser, mappedUserError })

			if (mappedUserError) {
				if (mappedUserError.code === "PGRST116") {
					return { success: false, error: "user_not_found" }
				}
				return { success: false, error: mappedUserError.message }
			}

			if (!mappedUser?.id) {
				return { success: false, error: "user_not_found" }
			}

			console.log(
				"[UserAnalytics] Fetching analytics for userId:",
				mappedUser.id,
				"startDate:",
				startDate.toISOString(),
				"endDate:",
				endDate.toISOString(),
			)

			const { data: analyticsData, error: analyticsError } = await supabase.rpc("get_user_analytics", {
				p_user_id: mappedUser.id,
				p_start_date: startDate.toISOString(),
				p_end_date: endDate.toISOString(),
			})

			console.log("[UserAnalytics] Raw analytics data:", analyticsData, "error:", analyticsError)

			if (analyticsError) {
				return { success: false, error: analyticsError.message }
			}

			const row = Array.isArray(analyticsData) ? analyticsData[0] : analyticsData
			console.log("[UserAnalytics] Parsed row:", row)

			const summary = this.buildSummary(row)
			console.log("[UserAnalytics] Built summary:", summary)

			return { success: true, data: summary }
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	private buildSummary(row?: any): UserAnalyticsSummary {
		console.log("[UserAnalytics] buildSummary - Raw row:", JSON.stringify(row, null, 2))

		if (!row) {
			console.log("[UserAnalytics] buildSummary - No row data, returning empty summary")
			return { ...EMPTY_SUMMARY }
		}

		const totalRequests = this.parseNumber(row.total_requests)
		const totalCredits = this.parseNumber(row.total_credits)
		const totalInputTokens = this.parseNumber(row.total_input_tokens)
		const totalOutputTokens = this.parseNumber(row.total_output_tokens)
		const totalTokens = totalInputTokens + totalOutputTokens
		const creditsPerRequest = totalRequests > 0 ? totalCredits / totalRequests : 0

		console.log("[UserAnalytics] buildSummary - Parsed values:", {
			totalRequests,
			totalCredits,
			totalInputTokens,
			totalOutputTokens,
			totalTokens,
			creditsPerRequest,
		})

		const topModels = this.parseModelRankings(row.top_models)
		const topProviders = this.parseProviderRankings(row.top_providers)

		console.log("[UserAnalytics] buildSummary - Top models:", JSON.stringify(topModels, null, 2))
		console.log("[UserAnalytics] buildSummary - Top providers:", JSON.stringify(topProviders, null, 2))

		return {
			totalRequests,
			totalCredits,
			totalInputTokens,
			totalOutputTokens,
			totalTokens,
			creditsPerRequest,
			topModels,
			topProviders,
		}
	}

	private parseModelRankings(value: unknown): ModelUsageRanking[] {
		console.log("[UserAnalytics] parseModelRankings - Input value:", JSON.stringify(value, null, 2))

		if (!Array.isArray(value)) {
			console.log("[UserAnalytics] parseModelRankings - Not an array, returning empty")
			return []
		}

		const result = value.map((entry: any) => ({
			modelId: entry?.model_id ?? entry?.modelId ?? null,
			requests: this.parseNumber(entry?.requests),
			credits: this.parseNumber(entry?.cost ?? entry?.credits),
		}))

		console.log("[UserAnalytics] parseModelRankings - Result:", JSON.stringify(result, null, 2))
		return result
	}

	private parseProviderRankings(value: unknown): ProviderUsageRanking[] {
		console.log("[UserAnalytics] parseProviderRankings - Input value:", JSON.stringify(value, null, 2))

		if (!Array.isArray(value)) {
			console.log("[UserAnalytics] parseProviderRankings - Not an array, returning empty")
			return []
		}

		const result = value.map((entry: any) => ({
			provider: entry?.provider ?? entry?.providerId ?? null,
			requests: this.parseNumber(entry?.requests),
			credits: this.parseNumber(entry?.cost ?? entry?.credits),
		}))

		console.log("[UserAnalytics] parseProviderRankings - Result:", JSON.stringify(result, null, 2))
		return result
	}

	private parseNumber(value: unknown): number {
		if (value === null || value === undefined) {
			return 0
		}

		const parsed = Number(value)
		return Number.isNaN(parsed) ? 0 : parsed
	}
}

export const userAnalyticsService = UserAnalyticsService.getInstance()

export async function getUserAnalyticsSummary(
	clerkUserId: string,
	startDate: Date,
	endDate: Date,
): Promise<UserAnalyticsResult> {
	return userAnalyticsService.getUserAnalyticsSummary(clerkUserId, startDate, endDate)
}
