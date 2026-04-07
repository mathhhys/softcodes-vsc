import axios, { type RawAxiosRequestHeaders /*kilocode_change*/ } from "axios"
import { z } from "zod"

import {
	type ModelInfo,
	isModelParameter,
	OPEN_ROUTER_COMPUTER_USE_MODELS,
	OPEN_ROUTER_REASONING_BUDGET_MODELS,
	OPEN_ROUTER_REQUIRED_REASONING_BUDGET_MODELS,
	anthropicModels,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../../shared/api"
import { parseApiPrice } from "../../../shared/cost"
import { API_CONFIG } from "../../../config/constants"

/**
 * OpenRouterBaseModel
 */

const openRouterArchitectureSchema = z.object({
	modality: z.string().nullish(),
	tokenizer: z.string().nullish(),
})

const openRouterPricingSchema = z.object({
	prompt: z.string().nullish(),
	completion: z.string().nullish(),
	input_cache_write: z.string().nullish(),
	input_cache_read: z.string().nullish(),
})

const modelRouterBaseModelSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	context_length: z.number(),
	max_completion_tokens: z.number().nullish(),
	preferredIndex: z.number().nullish(), // kilocode_change
	pricing: openRouterPricingSchema.optional(),
})

export type OpenRouterBaseModel = z.infer<typeof modelRouterBaseModelSchema>

/**
 * OpenRouterModel
 */

export const openRouterModelSchema = modelRouterBaseModelSchema.extend({
	id: z.string(),
	architecture: openRouterArchitectureSchema.optional(),
	top_provider: z.object({ max_completion_tokens: z.number().nullish() }).optional(),
	supported_parameters: z.array(z.string()).optional(),
})

export type OpenRouterModel = z.infer<typeof openRouterModelSchema>

/**
 * OpenRouterModelEndpoint
 */

export const openRouterModelEndpointSchema = modelRouterBaseModelSchema.extend({
	provider_name: z.string(),
})

export type OpenRouterModelEndpoint = z.infer<typeof openRouterModelEndpointSchema>

/**
 * OpenRouterModelsResponse
 */

const openRouterModelsResponseSchema = z.object({
	data: z.array(openRouterModelSchema),
})

type OpenRouterModelsResponse = z.infer<typeof openRouterModelsResponseSchema>

/**
 * OpenRouterModelEndpointsResponse
 */

const openRouterModelEndpointsResponseSchema = z.object({
	data: z.object({
		id: z.string(),
		name: z.string(),
		description: z.string().optional(),
		architecture: openRouterArchitectureSchema.optional(),
		supported_parameters: z.array(z.string()).optional(),
		endpoints: z.array(openRouterModelEndpointSchema),
	}),
})

type OpenRouterModelEndpointsResponse = z.infer<typeof openRouterModelEndpointsResponseSchema>

/**
 * getOpenRouterModels
 */

export async function getOpenRouterModels(
	options?: ApiHandlerOptions & { headers?: RawAxiosRequestHeaders }, // kilocode_change: added headers
): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}
	const baseURL = options?.openRouterBaseUrl || API_CONFIG.OPENROUTER.BASE_URL

	// Check if this is a kilocode request and validate authentication
	if (baseURL.includes("kilocode.ai") || baseURL.includes("localhost:3000")) {
		try {
			const { UnifiedAuthService } = await import("../../../auth/unifiedAuthService")
			// Import vscode to access the extension context
			const vscode = require("vscode")

			// Get the extension context from global state
			const extension = vscode.extensions.getExtension("softcodes.softcodes")
			if (!extension) {
				console.warn("⚠️ [AUTH-CHECK] Could not find Softcodes extension, skipping auth check")
			} else {
				const authService = UnifiedAuthService.getInstance(extension.extensionContext || {})
				const authState = await authService.getAuthenticationState()

				console.log("🔍 [AUTH-CHECK] OpenRouter kilocode authentication state:", {
					isAuthenticated: authState.isAuthenticated,
					isConnected: authState.isConnected,
					hasError: !!authState.error,
					error: authState.error,
					baseURL,
					timestamp: new Date().toISOString(),
				})

				if (!authState.isAuthenticated) {
					throw new Error("User is not authenticated. Please sign in first.")
				}

				if (!authState.isConnected) {
					const errorMsg =
						authState.error ||
						"User account not found in database. Please contact support or try signing in again."
					console.error("🚫 [AUTH-CHECK] User not connected for kilocode API:", {
						errorMsg,
						isAuthenticated: authState.isAuthenticated,
						clerkId: authState.clerkId,
						supabaseVerified: authState.supabaseVerified,
						baseURL,
						timestamp: new Date().toISOString(),
						recommendation: "User exists in Clerk but not synced to Supabase. Check webhook configuration.",
					})
					throw new Error(`Authentication failed: ${errorMsg}`)
				}

				console.log("✅ [AUTH-CHECK] User is properly authenticated for kilocode API")
			}
		} catch (authError) {
			console.error("❌ [AUTH-CHECK] Authentication check failed in getOpenRouterModels:", authError)
			throw authError
		}
	}

	try {
		console.log("🔍 [DEBUG] Making API request to fetch models:", {
			url: `${baseURL}/models`,
			headers: options?.headers
				? {
						...options.headers,
						Authorization:
							options.headers.Authorization && typeof options.headers.Authorization === "string"
								? `${options.headers.Authorization.substring(0, 20)}...`
								: options.headers.Authorization,
					}
				: undefined,
			timestamp: new Date().toISOString(),
		})

		const response = await axios.get<OpenRouterModelsResponse>(`${baseURL}/models`, {
			headers: options?.headers, // kilocode_change: added headers
		})

		console.log("✅ [DEBUG] API response received:", {
			status: response.status,
			statusText: response.statusText,
			headers: Object.keys(response.headers).reduce(
				(acc, key) => {
					acc[key] = response.headers[key]
					return acc
				},
				{} as Record<string, any>,
			),
			dataLength: JSON.stringify(response.data).length,
			timestamp: new Date().toISOString(),
		})

		const result = openRouterModelsResponseSchema.safeParse(response.data)
		const data = result.success ? result.data.data : response.data.data

		if (!result.success) {
			console.error("❌ [DEBUG] OpenRouter models response validation failed:", {
				error: result.error.format(),
				responseData: response.data,
				timestamp: new Date().toISOString(),
			})
			throw new Error("OpenRouter models response is invalid: " + result.error.format()) // kilocode_change
		}

		for (const model of data) {
			const { id, architecture, top_provider, supported_parameters = [] } = model

			models[id] = parseOpenRouterModel({
				id,
				model,
				modality: architecture?.modality,
				maxTokens: top_provider?.max_completion_tokens,
				supportedParameters: supported_parameters,
			})
		}
	} catch (error: any) {
		console.error("❌ [DEBUG] Error fetching OpenRouter models:", {
			error: {
				name: error?.name,
				message: error?.message,
				status: error?.response?.status,
				statusText: error?.response?.statusText,
				data: error?.response?.data,
				url: `${baseURL}/models`,
				headers: options?.headers,
			},
			timestamp: new Date().toISOString(),
		})

		// Check if it's a 401 error specifically
		if (error?.response?.status === 401) {
			console.error("🚫 [DEBUG] 401 Unauthorized error detected:", {
				responseData: error?.response?.data,
				requestHeaders: options?.headers,
				url: `${baseURL}/models`,
				timestamp: new Date().toISOString(),
			})
		}

		throw error // kilocode_change
	}

	return models
}

/**
 * getOpenRouterModelEndpoints
 */

export async function getOpenRouterModelEndpoints(
	modelId: string,
	options?: ApiHandlerOptions,
): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}
	const baseURL = options?.openRouterBaseUrl || API_CONFIG.OPENROUTER.BASE_URL

	try {
		const response = await axios.get<OpenRouterModelEndpointsResponse>(`${baseURL}/models/${modelId}/endpoints`)
		const result = openRouterModelEndpointsResponseSchema.safeParse(response.data)
		const data = result.success ? result.data.data : response.data.data

		if (!result.success) {
			console.error("OpenRouter model endpoints response is invalid", result.error.format())
		}

		const { id, architecture, endpoints } = data

		for (const endpoint of endpoints) {
			models[endpoint.provider_name] = parseOpenRouterModel({
				id,
				model: endpoint,
				modality: architecture?.modality,
				maxTokens: endpoint.max_completion_tokens,
			})
		}
	} catch (error) {
		console.error(
			`Error fetching OpenRouter model endpoints: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
		)
	}

	return models
}

/**
 * parseOpenRouterModel
 */

export const parseOpenRouterModel = ({
	id,
	model,
	modality,
	maxTokens,
	supportedParameters,
}: {
	id: string
	model: OpenRouterBaseModel
	modality: string | null | undefined
	maxTokens: number | null | undefined
	supportedParameters?: string[]
}): ModelInfo => {
	const cacheWritesPrice = model.pricing?.input_cache_write
		? parseApiPrice(model.pricing?.input_cache_write)
		: undefined

	const cacheReadsPrice = model.pricing?.input_cache_read ? parseApiPrice(model.pricing?.input_cache_read) : undefined

	const supportsPromptCache = typeof cacheWritesPrice !== "undefined" && typeof cacheReadsPrice !== "undefined"

	const modelInfo: ModelInfo = {
		maxTokens: maxTokens || Math.ceil(model.context_length * 0.2),
		contextWindow: model.context_length,
		supportsImages: modality?.includes("image") ?? false,
		supportsPromptCache,
		inputPrice: parseApiPrice(model.pricing?.prompt),
		outputPrice: parseApiPrice(model.pricing?.completion),
		cacheWritesPrice,
		cacheReadsPrice,
		description: model.description,
		supportsReasoningEffort: supportedParameters ? supportedParameters.includes("reasoning") : undefined,
		supportedParameters: supportedParameters ? supportedParameters.filter(isModelParameter) : undefined,
		preferredIndex: model.preferredIndex, // kilocode_change
	}

	// The OpenRouter model definition doesn't give us any hints about
	// computer use, so we need to set that manually.
	if (OPEN_ROUTER_COMPUTER_USE_MODELS.has(id)) {
		modelInfo.supportsComputerUse = true
	}

	if (OPEN_ROUTER_REASONING_BUDGET_MODELS.has(id)) {
		modelInfo.supportsReasoningBudget = true
	}

	if (OPEN_ROUTER_REQUIRED_REASONING_BUDGET_MODELS.has(id)) {
		modelInfo.requiredReasoningBudget = true
	}

	// For backwards compatibility with the old model definitions we will
	// continue to disable extending thinking for anthropic/claude-3.7-sonnet
	// and force it for anthropic/claude-3.7-sonnet:thinking.

	if (id === "anthropic/claude-3.7-sonnet") {
		modelInfo.maxTokens = anthropicModels["claude-3-7-sonnet-20250219"].maxTokens
		modelInfo.supportsReasoningBudget = false
		modelInfo.supportsReasoningEffort = false
	}

	if (id === "anthropic/claude-3.7-sonnet:thinking") {
		modelInfo.maxTokens = anthropicModels["claude-3-7-sonnet-20250219:thinking"].maxTokens
	}

	return modelInfo
}
