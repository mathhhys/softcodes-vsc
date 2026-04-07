import * as vscode from "vscode"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	OPENROUTER_DEFAULT_PROVIDER_NAME,
	OPEN_ROUTER_PROMPT_CACHING_MODELS,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
} from "@roo-code/types"

import { API_CONFIG } from "../../config/constants"

import type { ApiHandlerOptions, ModelRecord } from "../../shared/api"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStreamChunk } from "../transform/stream"
import { convertToR1Format } from "../transform/r1-format"
import { addCacheBreakpoints as addAnthropicCacheBreakpoints } from "../transform/caching/anthropic"
import { addCacheBreakpoints as addGeminiCacheBreakpoints } from "../transform/caching/gemini"
import type { OpenRouterReasoningParams } from "../transform/reasoning"
import { getModelParams } from "../transform/model-params"

import { getModels } from "./fetchers/modelCache"
import { getModelEndpoints } from "./fetchers/modelEndpointCache"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import { resolveOpenRouterApiKey, validateOpenRouterApiKey } from "./openrouter-utils"
import type {
	ApiHandlerCreateMessageMetadata, // kilocode_change
	SingleCompletionHandler,
} from "../index"

// Add custom interface for OpenRouter params.
type OpenRouterChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParams & {
	transforms?: string[]
	include_reasoning?: boolean
	// https://openrouter.ai/docs/use-cases/reasoning-tokens
	reasoning?: OpenRouterReasoningParams
}

// See `OpenAI.Chat.Completions.ChatCompletionChunk["usage"]`
// `CompletionsAPI.CompletionUsage`
// See also: https://openrouter.ai/docs/use-cases/usage-accounting
interface CompletionUsage {
	completion_tokens?: number
	completion_tokens_details?: {
		reasoning_tokens?: number
	}
	prompt_tokens?: number
	prompt_tokens_details?: {
		cached_tokens?: number
	}
	total_tokens?: number
	cost?: number
	cost_details?: {
		upstream_inference_cost?: number
	}
}

export class OpenRouterHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	protected models: ModelRecord = {}
	protected endpoints: ModelRecord = {}

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		console.log("🔧 [OPENROUTER] Initializing OpenRouterHandler")
		console.log("🔍 [OPENROUTER] Constructor options:", {
			hasOpenRouterBaseUrl: !!options.openRouterBaseUrl,
			openRouterBaseUrl: options.openRouterBaseUrl || "not set",
			hasOpenRouterApiKey: !!options.openRouterApiKey,
			openRouterApiKeyLength: options.openRouterApiKey?.length || 0,
			openRouterApiKeyPreview: options.openRouterApiKey
				? `${options.openRouterApiKey.substring(0, 15)}...`
				: "undefined",
			openRouterModelId: options.openRouterModelId || "not set",
			hasOpenRouterSpecificProvider: !!options.openRouterSpecificProvider,
			openRouterSpecificProvider: options.openRouterSpecificProvider || "not set",
		})

		// Resolve API key with environment variable override and proper priority
		const { apiKey, source } = resolveOpenRouterApiKey(
			options.openRouterApiKey,
			undefined, // No hardcoded key for regular OpenRouter provider
			"openrouter",
		)

		console.log("🔧 [OPENROUTER] API key resolved:", {
			source: source,
			keyLength: apiKey.length,
			keyPreview: `${apiKey.substring(0, 15)}...`,
			isValid: validateOpenRouterApiKey(apiKey),
			timestamp: new Date().toISOString(),
		})

		// Update options with resolved API key
		this.options.openRouterApiKey = apiKey

		const baseURL = this.options.openRouterBaseUrl || API_CONFIG.OPENROUTER.BASE_URL

		console.log("🔧 [OPENROUTER] Creating OpenAI client with resolved credentials:", {
			baseURL,
			hasApiKey: !!apiKey,
			apiKeyLength: apiKey.length,
			apiKeyPreview: `${apiKey.substring(0, 15)}...`,
			apiKeyStartsWith: apiKey.substring(0, 10),
			apiKeyFormatValid: validateOpenRouterApiKey(apiKey),
			apiKeySource: source,
			defaultHeaders: DEFAULT_HEADERS,
			timestamp: new Date().toISOString(),
		})

		// Log the exact configuration that will be used for HTTP requests
		console.log("🔧 [OPENROUTER] OpenAI client configuration for HTTP requests:", {
			baseURL: baseURL,
			apiKeyConfigured: true,
			authorizationHeader: `Bearer ${apiKey.substring(0, 10)}...`,
			defaultHeaders: DEFAULT_HEADERS,
			apiKeyLastFour: apiKey.slice(-4),
			apiKeySource: source,
			isExpectedKey: apiKey === "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",
		})

		console.log("🔧 [OPENROUTER] Creating OpenAI client with detailed configuration:")

		// Check for any missing environment or global configuration
		console.log("🔍 [OPENROUTER] Environment check:", {
			hasGlobalFetch: typeof globalThis.fetch === "function",
			hasGlobalHeaders: typeof globalThis.Headers === "function",
			hasGlobalRequest: typeof globalThis.Request === "function",
			nodeVersion: process.version,
			platform: process.platform,
			arch: process.arch,
		})

		// Check for any OpenAI SDK specific environment variables
		console.log("🔍 [OPENROUTER] OpenAI SDK environment:", {
			hasOpenAIKey: !!process.env.OPENAI_API_KEY,
			hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
			hasAnyOpenAIKey: !!(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY),
			openAIKeyLength: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0,
			openRouterKeyLength: process.env.OPENROUTER_API_KEY ? process.env.OPENROUTER_API_KEY.length : 0,
		})

		console.log("🔧 [OPENROUTER] OpenAI Client Config:", {
			baseURL: baseURL,
			apiKeyPresent: !!apiKey,
			apiKeyLength: apiKey ? apiKey.length : 0,
			apiKeyPrefix: apiKey ? apiKey.substring(0, 12) : "NO_KEY",
			apiKeyType: apiKey
				? apiKey.startsWith("sk-or-v1")
					? "openrouter-v1"
					: apiKey.startsWith("sk-")
						? "openai"
						: "unknown"
				: "none",
			defaultHeadersCount: Object.keys(DEFAULT_HEADERS).length,
			defaultHeaders: DEFAULT_HEADERS,
			dangerouslyAllowBrowser: false,
			maxRetries: 0, // Default for OpenAI client
		})

		// Validate API key format more thoroughly
		if (apiKey) {
			// DEBUG: Test both broken and correct regex patterns
			const correctRegex = /^sk-or-v1-[a-zA-Z0-9]{40,}$/

			const keyValidation = {
				startsWithSk: apiKey.startsWith("sk-"),
				startsWithSkOrV1: apiKey.startsWith("sk-or-v1"),
				hasCorrectLength: apiKey.length >= 50 && apiKey.length <= 200,
				containsOnlyValidChars: /^sk-or-v1-[a-zA-Z0-9_-]+$/.test(apiKey),
				noSpaces: !apiKey.includes(" "),
				noSpecialChars: !/[!@#$%^&*()+=[\]{}|;':",.<>?]/.test(apiKey),
				// Validation with correct regex pattern
				validFormat: correctRegex.test(apiKey),
			}
			console.log("🔍 [OPENROUTER] API Key validation:", keyValidation)

			if (!keyValidation.startsWithSkOrV1) {
				console.warn(
					"⚠️ [OPENROUTER] API key does not start with 'sk-or-v1' - this might cause issues with OpenRouter",
				)
			}
			if (!keyValidation.hasCorrectLength) {
				console.warn("⚠️ [OPENROUTER] API key length is unusual - expected 50-200 chars, got", apiKey.length)
			}
			if (!keyValidation.containsOnlyValidChars) {
				console.error("❌ [OPENROUTER] API key contains invalid characters")
			}
		}

		// Create the client with enhanced logging
		console.log("🔧 [OPENROUTER] Creating OpenAI client with interceptors for detailed logging")

		// Create a custom fetch function to log HTTP requests
		const originalFetch = globalThis.fetch
		const loggedFetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const requestId = Math.random().toString(36).substring(7)

			// Log the complete request details
			console.log(`🌐 [OPENROUTER] RAW HTTP REQUEST [${requestId}]:`, {
				url: url.toString(),
				method: init?.method || "GET",
				headers: init?.headers,
				hasBody: !!init?.body,
				bodyType: init?.body ? typeof init.body : "none",
				bodySize: init?.body ? (typeof init.body === "string" ? init.body.length : "binary") : 0,
				bodyPreview: init?.body && typeof init.body === "string" ? init.body.substring(0, 200) + "..." : "N/A",
				timestamp: new Date().toISOString(),
				userAgent:
					init?.headers && typeof init.headers === "object" && "User-Agent" in init.headers
						? init.headers["User-Agent" as keyof typeof init.headers]
						: "not set",
			})

			// Check for missing authentication
			let authHeaderValue = "MISSING"
			let hasAuth = false

			if (init?.headers) {
				if (init.headers instanceof Headers) {
					hasAuth = init.headers.has("authorization") || init.headers.has("Authorization")
					authHeaderValue =
						init.headers.get("authorization") || init.headers.get("Authorization") || "MISSING"
				} else if (typeof init.headers === "object") {
					const headers = init.headers as Record<string, string>
					hasAuth = !!(headers.authorization || headers.Authorization)
					authHeaderValue = headers.authorization || headers.Authorization || "MISSING"
				}
			}

			console.log(`🔐 [OPENROUTER] AUTH CHECK [${requestId}]:`, {
				hasAuthorizationHeader: hasAuth,
				authHeaderValue: authHeaderValue,
				authHeaderPreview: authHeaderValue !== "MISSING" ? `${authHeaderValue.substring(0, 20)}...` : "MISSING",
				allHeaders: init?.headers,
				timestamp: new Date().toISOString(),
			})

			try {
				console.log(`⏳ [OPENROUTER] MAKING HTTP REQUEST [${requestId}]...`)
				const startTime = Date.now()
				const response = await originalFetch(url, init)
				const duration = Date.now() - startTime

				console.log(`✅ [OPENROUTER] HTTP RESPONSE RECEIVED [${requestId}]:`, {
					status: response.status,
					statusText: response.statusText,
					headers: Object.fromEntries(response.headers.entries()),
					url: response.url,
					duration: `${duration}ms`,
					timestamp: new Date().toISOString(),
					contentType: response.headers.get("content-type"),
					contentLength: response.headers.get("content-length"),
					server: response.headers.get("server"),
					requestId: response.headers.get("x-request-id") || response.headers.get("cf-ray") || "not provided",
				})

				// If it's an error response, try to read and log the body
				if (!response.ok) {
					console.error(`❌ [OPENROUTER] HTTP ERROR RESPONSE [${requestId}]:`, {
						status: response.status,
						statusText: response.statusText,
						timestamp: new Date().toISOString(),
					})

					try {
						const errorBody = await response.clone().text()
						console.error(`📄 [OPENROUTER] ERROR RESPONSE BODY [${requestId}]:`, {
							body: errorBody,
							contentType: response.headers.get("content-type"),
							bodyLength: errorBody.length,
							timestamp: new Date().toISOString(),
						})

						// Try to parse as JSON if it's JSON
						if (response.headers.get("content-type")?.includes("application/json")) {
							try {
								const errorJson = JSON.parse(errorBody)
								console.error(`🔍 [OPENROUTER] PARSED ERROR JSON [${requestId}]:`, errorJson)
							} catch (parseError) {
								console.log(`ℹ️ [OPENROUTER] Could not parse error body as JSON [${requestId}]`)
							}
						}
					} catch (bodyError) {
						console.error(`❌ [OPENROUTER] Could not read error response body [${requestId}]:`, {
							error: bodyError instanceof Error ? bodyError.message : String(bodyError),
							timestamp: new Date().toISOString(),
						})
					}
				} else {
					console.log(`✅ [OPENROUTER] SUCCESSFUL RESPONSE [${requestId}]:`, {
						status: response.status,
						contentType: response.headers.get("content-type"),
						hasBody: !!response.body,
						timestamp: new Date().toISOString(),
					})
				}

				return response
			} catch (error) {
				console.error(`❌ [OPENROUTER] HTTP REQUEST NETWORK ERROR [${requestId}]:`, {
					url: url.toString(),
					error: error instanceof Error ? error.message : String(error),
					errorType: error instanceof Error ? error.constructor.name : typeof error,
					timestamp: new Date().toISOString(),
				})
				throw error
			}
		}

		// Temporarily replace global fetch for this client
		globalThis.fetch = loggedFetch

		this.client = new OpenAI({
			baseURL,
			apiKey,
			defaultHeaders: DEFAULT_HEADERS,
		})

		// Restore original fetch
		globalThis.fetch = originalFetch

		console.log("🔧 [OPENROUTER] OpenAI client created successfully")
		console.log("🔧 [OPENROUTER] Client properties:", {
			hasBaseURL: !!this.client.baseURL,
			baseURL: this.client.baseURL,
			hasApiKey: !!this.client.apiKey,
			apiKeyLength: this.client.apiKey ? this.client.apiKey.length : 0,
			apiKeyPreview: this.client.apiKey ? `${this.client.apiKey.substring(0, 12)}...` : "NO_KEY",
		})

		console.log("✅ [OPENROUTER] OpenRouterHandler initialized successfully")
	}

	// kilocode_change start
	customRequestOptions(_metadata?: ApiHandlerCreateMessageMetadata): OpenAI.RequestOptions | undefined {
		return undefined
	}
	// kilocode_change end

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata, // kilocode_change
	): AsyncGenerator<ApiStreamChunk> {
		const model = await this.fetchModel()

		let { id: modelId, maxTokens, temperature, topP, reasoning } = model

		// OpenRouter sends reasoning tokens by default for Gemini 2.5 Pro
		// Preview even if you don't request them. This is not the default for
		// other providers (including Gemini), so we need to explicitly disable
		// i We should generalize this using the logic in `getModelParams`, but
		// this is easier for now.
		if (
			(modelId === "google/gemini-2.5-pro-preview" || modelId === "google/gemini-2.5-pro") &&
			typeof reasoning === "undefined"
		) {
			reasoning = { exclude: true }
		}

		// Convert Anthropic messages to OpenAI format.
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// DeepSeek highly recommends using user instead of system role.
		if (modelId.startsWith("deepseek/deepseek-r1") || modelId === "perplexity/sonar-reasoning") {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		// https://openrouter.ai/docs/features/prompt-caching
		// TODO: Add a `promptCacheStratey` field to `ModelInfo`.
		if (OPEN_ROUTER_PROMPT_CACHING_MODELS.has(modelId)) {
			if (modelId.startsWith("google")) {
				addGeminiCacheBreakpoints(systemPrompt, openAiMessages)
			} else {
				addAnthropicCacheBreakpoints(systemPrompt, openAiMessages)
			}
		}

		const transforms = (this.options.openRouterUseMiddleOutTransform ?? true) ? ["middle-out"] : undefined

		// https://openrouter.ai/docs/transforms
		const completionParams: OpenRouterChatCompletionParams = {
			model: modelId,
			...(maxTokens && maxTokens > 0 && { max_tokens: maxTokens }),
			temperature,
			top_p: topP,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			// Only include provider if openRouterSpecificProvider is not "[default]".
			...(this.options.openRouterSpecificProvider &&
				this.options.openRouterSpecificProvider !== OPENROUTER_DEFAULT_PROVIDER_NAME && {
					provider: {
						order: [this.options.openRouterSpecificProvider],
						only: [this.options.openRouterSpecificProvider],
						allow_fallbacks: false,
					},
				}),
			...(transforms && { transforms }),
			...(reasoning && { reasoning }),
		}
		console.log("🚀 [OPENROUTER] Making OpenAI API request")
		console.log("🔍 [OPENROUTER] Completion parameters:", {
			model: completionParams.model,
			hasMaxTokens: !!completionParams.max_tokens,
			maxTokens: completionParams.max_tokens,
			temperature: completionParams.temperature,
			topP: completionParams.top_p,
			stream: completionParams.stream,
			messagesCount: completionParams.messages?.length || 0,
			hasProvider: "provider" in completionParams ? !!completionParams.provider : false,
			provider: "provider" in completionParams ? completionParams.provider : undefined,
			hasTransforms: !!completionParams.transforms,
			transforms: completionParams.transforms,
			hasReasoning: !!completionParams.reasoning,
			reasoning: completionParams.reasoning,
		})

		console.log("🔍 [OPENROUTER] Custom request options:", this.customRequestOptions(metadata))

		// Log the exact moment before HTTP request
		const requestId = Math.random().toString(36).substring(7)
		const requestStartTime = Date.now()
		console.log("🚀 [OPENROUTER] EXACT MOMENT: ABOUT TO MAKE HTTP REQUEST TO OPENROUTER", {
			timestamp: new Date().toISOString(),
			requestId: requestId,
			url: `${this.client.baseURL}/chat/completions`,
			method: "POST",
			userAgent: "OpenAI/JS",
			contentType: "application/json",
			authorization: this.options.openRouterApiKey
				? `Bearer ${this.options.openRouterApiKey.substring(0, 10)}...`
				: "NO_AUTH",
			tokenValidFormat: this.options.openRouterApiKey
				? /^sk-or-v1-[a-zA-Z0-9]{40,}$/.test(this.options.openRouterApiKey)
				: false,
			tokenStartsWith: this.options.openRouterApiKey
				? this.options.openRouterApiKey.substring(0, 10)
				: "NO_TOKEN",
			model: completionParams.model,
			stream: completionParams.stream,
			maxTokens: completionParams.max_tokens,
			temperature: completionParams.temperature,
		})

		// Log the raw request body that will be sent
		console.log("📤 [OPENROUTER] REQUEST PAYLOAD:", {
			requestId: requestId,
			completionParams: JSON.stringify(completionParams, null, 2),
			payloadSize: JSON.stringify(completionParams).length + " bytes",
		})

		// Log potential payload blocking factors
		console.log("🔍 [OPENROUTER] PAYLOAD ANALYSIS:", {
			requestId: requestId,
			model: completionParams.model,
			messages:
				completionParams.messages?.map((msg, index) => ({
					index,
					role: msg.role,
					contentLength: typeof msg.content === "string" ? msg.content.length : "complex",
					contentPreview:
						typeof msg.content === "string" ? msg.content.substring(0, 50) + "..." : "complex content",
				})) || [],
			temperature: completionParams.temperature,
			maxTokens: completionParams.max_tokens,
			stream: completionParams.stream,
			transforms: completionParams.transforms,
			reasoning: completionParams.reasoning,
			provider: "provider" in completionParams ? completionParams.provider : undefined,
			// Check for potentially problematic content
			hasEmptyMessages: completionParams.messages?.some((msg) => !msg.content || msg.content === "") || false,
			hasVeryLongMessages:
				completionParams.messages?.some(
					(msg) => typeof msg.content === "string" && msg.content.length > 10000,
				) || false,
			totalMessageLength:
				completionParams.messages?.reduce(
					(sum, msg) => sum + (typeof msg.content === "string" ? msg.content.length : 0),
					0,
				) || 0,
		})

		// Log network-level details before making the request
		console.log("🌐 [OPENROUTER] NETWORK REQUEST DETAILS:", {
			requestId: requestId,
			method: "POST",
			url: `${this.client.baseURL}/chat/completions`,
			headers: {
				Authorization: this.options.openRouterApiKey
					? `Bearer ${this.options.openRouterApiKey.substring(0, 10)}...`
					: "MISSING",
				"Content-Type": "application/json",
				...DEFAULT_HEADERS,
			},
			bodySize: JSON.stringify(completionParams).length,
			userAgent: "OpenAI/JS",
			timestamp: new Date().toISOString(),
			// Additional potential blocking factors
			modelRequested: completionParams.model,
			streamRequested: completionParams.stream,
			hasCustomHeaders: Object.keys(DEFAULT_HEADERS).length > 0,
			defaultHeaders: DEFAULT_HEADERS,
			requestOrigin: "vscode-extension",
			nodeVersion: process.version,
			platform: process.platform,
		})

		// Log potential blocking factors
		console.log("🔍 [OPENROUTER] POTENTIAL BLOCKING FACTORS:", {
			requestId: requestId,
			modelAccess: {
				model: completionParams.model,
				isFreeModel: completionParams.model.includes("free") || completionParams.model.includes("trial"),
				isProModel: completionParams.model.includes("pro") || completionParams.model.includes("premium"),
				modelProvider: completionParams.model.split("/")[0] || "unknown",
			},
			accountStatus: {
				apiKeyPrefix: this.options.openRouterApiKey
					? this.options.openRouterApiKey.substring(0, 10)
					: "unknown",
				apiKeyType: this.options.openRouterApiKey
					? this.options.openRouterApiKey.startsWith("sk-or-v1")
						? "v1"
						: "legacy"
					: "unknown",
				keyLength: this.options.openRouterApiKey?.length || 0,
			},
			requestCharacteristics: {
				hasStreaming: completionParams.stream,
				hasSystemPrompt: !!completionParams.messages?.find((m) => m.role === "system"),
				messageCount: completionParams.messages?.length || 0,
				totalContentLength:
					completionParams.messages?.reduce((sum, m) => sum + (m.content?.length || 0), 0) || 0,
			},
		})

		let stream
		try {
			// Make the actual request once
			stream = await this.client.chat.completions.create(
				completionParams,
				this.customRequestOptions(metadata), // kilocode_change
			)
			const requestDuration = Date.now() - requestStartTime
			console.log("✅ [OPENROUTER] HTTP REQUEST SUCCESSFUL (single request):", {
				duration: `${requestDuration}ms`,
				timestamp: new Date().toISOString(),
				hasStream: !!stream,
				streamType: typeof stream,
			})
		} catch (error) {
			const requestDuration = Date.now() - requestStartTime
			console.error("❌ [OPENROUTER] HTTP REQUEST FAILED:", {
				timestamp: new Date().toISOString(),
				duration: `${requestDuration}ms`,
				error: error instanceof Error ? error.message : String(error),
				errorType: error instanceof Error ? error.constructor.name : typeof error,
			})
			throw error
		}

		let lastUsage: CompletionUsage | undefined = undefined

		try {
			console.log("🔄 [OPENROUTER] Starting to process stream chunks")
			for await (const chunk of stream) {
				console.log("📦 [OPENROUTER] Processing chunk:", {
					hasError: "error" in chunk,
					hasChoices: !!chunk.choices,
					choicesCount: chunk.choices?.length || 0,
					hasUsage: !!chunk.usage,
					chunkKeys: Object.keys(chunk),
				})

				// OpenRouter returns an error object instead of the OpenAI SDK throwing an error.
				if ("error" in chunk) {
					const error = chunk.error as { message?: string; code?: number }
					console.error("❌ [OPENROUTER] OpenRouter API Error detected in stream:", {
						errorCode: error?.code,
						errorMessage: error?.message,
						fullError: error,
						chunk: chunk,
						timestamp: new Date().toISOString(),
					})
					throw new Error(`OpenRouter API Error ${error?.code}: ${error?.message}`)
				}

				const delta = chunk.choices[0]?.delta
				console.log("🔍 [OPENROUTER] Processing delta:", {
					hasDelta: !!delta,
					hasReasoning: "reasoning" in (delta || {}),
					hasContent: !!delta?.content,
					deltaKeys: delta ? Object.keys(delta) : [],
				})

				if (delta && "reasoning" in delta && delta.reasoning && typeof delta.reasoning === "string") {
					console.log("🧠 [OPENROUTER] Yielding reasoning chunk:", {
						reasoningLength: delta.reasoning.length,
						reasoningPreview: `${delta.reasoning.substring(0, 50)}...`,
					})
					yield { type: "reasoning", text: delta.reasoning }
				}

				if (delta?.content) {
					console.log("📝 [OPENROUTER] Yielding text chunk:", {
						contentLength: delta.content.length,
						contentPreview: `${delta.content.substring(0, 50)}...`,
					})
					yield { type: "text", text: delta.content }
				}

				if (chunk.usage) {
					console.log("📊 [OPENROUTER] Processing usage data:", {
						promptTokens: chunk.usage.prompt_tokens,
						completionTokens: chunk.usage.completion_tokens,
						totalTokens: chunk.usage.total_tokens,
						cost: "cost" in chunk.usage ? chunk.usage.cost : undefined,
						hasCostDetails: "cost_details" in chunk.usage ? !!chunk.usage.cost_details : false,
						hasDetails: !!chunk.usage.prompt_tokens_details || !!chunk.usage.completion_tokens_details,
					})
					lastUsage = chunk.usage
				}
			}
			console.log("✅ [OPENROUTER] Stream processing completed successfully")
		} catch (error) {
			console.error("❌ [OPENROUTER] Stream processing failed:", {
				error: error instanceof Error ? error.message : String(error),
				errorType: error instanceof Error ? error.constructor.name : typeof error,
				stack: error instanceof Error ? error.stack : "no stack trace",
				isOpenAIError: error instanceof Error && "status" in error,
				openAIStatus: error instanceof Error && "status" in error ? (error as any).status : undefined,
				openAIHeaders:
					error instanceof Error && "headers" in error
						? Object.fromEntries((error as any).headers?.entries?.() || [])
						: undefined,
				timestamp: new Date().toISOString(),
			})

			let errorMessage = makeOpenRouterErrorReadable(error)
			console.error("❌ [OPENROUTER] Final error message:", errorMessage)
			throw new Error(errorMessage)
		}

		if (lastUsage) {
			yield {
				type: "usage",
				inputTokens: lastUsage.prompt_tokens || 0,
				outputTokens: lastUsage.completion_tokens || 0,
				cacheReadTokens: lastUsage.prompt_tokens_details?.cached_tokens,
				reasoningTokens: lastUsage.completion_tokens_details?.reasoning_tokens,
				totalCost: (lastUsage.cost_details?.upstream_inference_cost || 0) + (lastUsage.cost || 0),
			}
		}
	}

	public async fetchModel() {
		const [models, endpoints] = await Promise.all([
			getModels({ provider: "openrouter" }),
			getModelEndpoints({
				router: "openrouter",
				modelId: this.options.openRouterModelId,
				endpoint: this.options.openRouterSpecificProvider,
			}),
		])

		this.models = models
		this.endpoints = endpoints

		return this.getModel()
	}

	override getModel() {
		const id = this.options.openRouterModelId ?? openRouterDefaultModelId
		let info = this.models[id] ?? openRouterDefaultModelInfo

		// If a specific provider is requested, use the endpoint for that provider.
		if (this.options.openRouterSpecificProvider && this.endpoints[this.options.openRouterSpecificProvider]) {
			info = this.endpoints[this.options.openRouterSpecificProvider]
		}

		const isDeepSeekR1 = id.startsWith("deepseek/deepseek-r1") || id === "perplexity/sonar-reasoning"

		const params = getModelParams({
			format: "openrouter",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: isDeepSeekR1 ? DEEP_SEEK_DEFAULT_TEMPERATURE : 0,
		})

		return { id, info, topP: isDeepSeekR1 ? 0.95 : undefined, ...params }
	}

	async completePrompt(prompt: string) {
		let { id: modelId, maxTokens, temperature, reasoning } = await this.fetchModel()

		const completionParams: OpenRouterChatCompletionParams = {
			model: modelId,
			max_tokens: maxTokens,
			temperature,
			messages: [{ role: "user", content: prompt }],
			stream: false,
			// Only include provider if openRouterSpecificProvider is not "[default]".
			...(this.options.openRouterSpecificProvider &&
				this.options.openRouterSpecificProvider !== OPENROUTER_DEFAULT_PROVIDER_NAME && {
					provider: {
						order: [this.options.openRouterSpecificProvider],
						only: [this.options.openRouterSpecificProvider],
						allow_fallbacks: false,
					},
				}),
			...(reasoning && { reasoning }),
		}

		const response = await this.client.chat.completions.create(completionParams)

		if ("error" in response) {
			const error = response.error as { message?: string; code?: number }
			throw new Error(`OpenRouter API Error ${error?.code}: ${error?.message}`)
		}

		const completion = response as OpenAI.Chat.ChatCompletion
		return completion.choices[0]?.message?.content || ""
	}
}

// kilocode_change start
function makeOpenRouterErrorReadable(error: any) {
	if (error?.code !== 429 && error?.code !== 418) {
		return `OpenRouter API Error: ${error?.message || error}`
	}

	try {
		const parsedJson = JSON.parse(error.error.metadata?.raw)
		const retryAfter = parsedJson?.error?.details.map((detail: any) => detail.retryDelay).filter((r: any) => r)[0]
		if (retryAfter) {
			return `Rate limit exceeded, try again in ${retryAfter}.`
		}
	} catch (e) {}

	return `Rate limit exceeded, try again later.\n${error?.message || error}`
}
// kilocode_change end
