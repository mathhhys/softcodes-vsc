import { getSupabaseServiceClient } from "./supabaseConfig"

export interface ModelUsageRanking {
	modelId: string | null
	provider: string | null
	requests: number
	credits: number
}

export interface OrgAnalyticsSummary {
	totalRequests: number
	totalCredits: number
	totalInputTokens: number
	totalOutputTokens: number
	totalTokens: number
	creditsPerRequest: number
	topModels: ModelUsageRanking[]
	topProviders: { provider: string | null; requests: number; credits: number }[]
}

export interface OrgAnalyticsResult {
	success: boolean
	data?: OrgAnalyticsSummary
	error?: string
}

const EMPTY_SUMMARY: OrgAnalyticsSummary = {
	totalRequests: 0,
	totalCredits: 0,
	totalInputTokens: 0,
	totalOutputTokens: 0,
	totalTokens: 0,
	creditsPerRequest: 0,
	topModels: [],
	topProviders: [],
}

export class OrgAnalyticsService {
	private static instance: OrgAnalyticsService

	static getInstance(): OrgAnalyticsService {
		if (!OrgAnalyticsService.instance) {
			OrgAnalyticsService.instance = new OrgAnalyticsService()
		}
		return OrgAnalyticsService.instance
	}

	async getOrgAnalyticsSummary(orgId: string, startDate: Date, endDate: Date): Promise<OrgAnalyticsResult> {
		try {
			const supabase = await getSupabaseServiceClient()

			console.log(
				"[OrgAnalytics] Fetching analytics for orgId:",
				orgId,
				"startDate:",
				startDate.toISOString(),
				"endDate:",
				endDate.toISOString(),
			)

			const { data: analyticsData, error: analyticsError } = await supabase.rpc("get_org_analytics", {
				p_org_id: orgId,
				p_start_date: startDate.toISOString(),
				p_end_date: endDate.toISOString(),
			})

			console.log("[OrgAnalytics] Raw analytics data:", analyticsData, "error:", analyticsError)

			if (analyticsError) {
				return { success: false, error: analyticsError.message }
			}

			const row = Array.isArray(analyticsData) ? analyticsData[0] : analyticsData
			console.log("[OrgAnalytics] Parsed row:", row)

			const summary = this.buildSummary(row)
			console.log("[OrgAnalytics] Built summary:", summary)

			return { success: true, data: summary }
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	private buildSummary(row?: any): OrgAnalyticsSummary {
		console.log("[OrgAnalytics] buildSummary - Raw row:", JSON.stringify(row, null, 2))

		if (!row) {
			console.log("[OrgAnalytics] buildSummary - No row data, returning empty summary")
			return { ...EMPTY_SUMMARY }
		}

		const totalRequests = this.parseNumber(row.total_requests)
		const totalCredits = this.parseNumber(row.total_credits)
		const totalInputTokens = this.parseNumber(row.total_input_tokens)
		const totalOutputTokens = this.parseNumber(row.total_output_tokens)
		const totalTokens = totalInputTokens + totalOutputTokens
		const creditsPerRequest = totalRequests > 0 ? totalCredits / totalRequests : 0

		console.log("[OrgAnalytics] buildSummary - Parsed values:", {
			totalRequests,
			totalCredits,
			totalInputTokens,
			totalOutputTokens,
			totalTokens,
			creditsPerRequest,
		})

		const topModels = this.parseModelRankings(row.top_models)
		const topProviders = this.parseProviderRankings(row.top_providers)

		console.log("[OrgAnalytics] buildSummary - Top models:", JSON.stringify(topModels, null, 2))
		console.log("[OrgAnalytics] buildSummary - Top providers:", JSON.stringify(topProviders, null, 2))

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
		console.log("[OrgAnalytics] parseModelRankings - Input value:", JSON.stringify(value, null, 2))

		if (!Array.isArray(value)) {
			console.log("[OrgAnalytics] parseModelRankings - Not an array, returning empty")
			return []
		}

		const result = value.map((entry: any) => ({
			modelId: entry?.model_id ?? entry?.modelId ?? null,
			provider: entry?.provider ?? entry?.providerId ?? null,
			requests: this.parseNumber(entry?.requests),
			credits: this.parseNumber(entry?.cost ?? entry?.credits),
		}))

		console.log("[OrgAnalytics] parseModelRankings - Result:", JSON.stringify(result, null, 2))
		return result
	}

	private parseProviderRankings(value: unknown): { provider: string | null; requests: number; credits: number }[] {
		console.log("[OrgAnalytics] parseProviderRankings - Input value:", JSON.stringify(value, null, 2))

		if (!Array.isArray(value)) {
			console.log("[OrgAnalytics] parseProviderRankings - Not an array, returning empty")
			return []
		}

		const result = value.map((entry: any) => ({
			provider: entry?.provider ?? entry?.providerId ?? null,
			requests: this.parseNumber(entry?.requests),
			credits: this.parseNumber(entry?.cost ?? entry?.credits),
		}))

		console.log("[OrgAnalytics] parseProviderRankings - Result:", JSON.stringify(result, null, 2))
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

export const orgAnalyticsService = OrgAnalyticsService.getInstance()

export async function getOrgAnalyticsSummary(
	orgId: string,
	startDate: Date,
	endDate: Date,
): Promise<OrgAnalyticsResult> {
	return orgAnalyticsService.getOrgAnalyticsSummary(orgId, startDate, endDate)
}
