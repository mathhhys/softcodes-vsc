import { randomUUID } from "crypto"
import { ApiHandlerOptions, ModelRecord } from "../../shared/api"
import { OpenRouterHandler } from "./openrouter"
import { getModelParams } from "../transform/model-params"
import { getModels } from "./fetchers/modelCache"
import { DEEP_SEEK_DEFAULT_TEMPERATURE } from "@roo-code/types"
import { ApiHandlerCreateMessageMetadata } from ".."
import { resolveOpenRouterApiKey, validateOpenRouterApiKey } from "./openrouter-utils"
import OpenAI from "openai"
import { API_CONFIG } from "../../config/constants"
import { creditManager } from "../../services/creditManager"
import { getGlobalEnhancedCreditSystem } from "../../services/enhancedCreditSystem"
import { extractUserFromJWT } from "../../auth/jwtVerification"
import { type UserInfoFromJWT } from "../../auth/jwtTypes"

/**
 * A custom OpenRouter handler that overrides the getModel function
 * to provide custom model information and fetches models from the KiloCode OpenRouter endpoint.
 */
export class KilocodeOpenrouterHandler extends OpenRouterHandler {
	protected override models: ModelRecord = {}

	// User info cache for attribution headers
	private userInfoCache: Map<
		string,
		{
			userInfo: UserInfoFromJWT
			expires: number
		}
	> = new Map()
	private readonly USER_INFO_CACHE_TTL_MS = 300000 // 5 minutes

	constructor(options: ApiHandlerOptions) {
		console.log("🔧 [KILOCODE-OPENROUTER] Initializing KilocodeOpenrouterHandler")

		// DEBUG: Log original options before any modifications
		console.log("🔍 [KILOCODE-OPENROUTER] Original options received:", {
			hasOpenRouterApiKey: !!options.openRouterApiKey,
			openRouterApiKeyLength: options.openRouterApiKey?.length || 0,
			openRouterApiKeyPreview: options.openRouterApiKey
				? `${options.openRouterApiKey.substring(0, 15)}...`
				: "undefined",
			openRouterApiKeyStart: options.openRouterApiKey ? options.openRouterApiKey.substring(0, 12) : "undefined",
			hasKilocodeToken: !!options.kilocodeToken,
			kilocodeTokenLength: options.kilocodeToken?.length || 0,
			kilocodeTokenPreview: options.kilocodeToken ? `${options.kilocodeToken.substring(0, 15)}...` : "undefined",
			timestamp: new Date().toISOString(),
		})

		// Resolve API key with proper priority: Environment > User Config
		const { apiKey, source } = resolveOpenRouterApiKey(
			options.openRouterApiKey,
			undefined, // No hardcoded fallback - use environment variables only
			"kilocode",
		)

		console.log("🔧 [KILOCODE-OPENROUTER] API key resolved with priority system:", {
			source: source,
			keyLength: apiKey.length,
			keyPreview: `${apiKey.substring(0, 15)}...`,
			isValid: validateOpenRouterApiKey(apiKey),
			timestamp: new Date().toISOString(),
		})

		// FORCE OVERRIDE: Ensure the resolved API key is always used
		const finalOptions = {
			...options,
			openRouterBaseUrl: API_CONFIG.OPENROUTER.BASE_URL,
			openRouterApiKey: apiKey, // Use the resolved key (Environment > Hardcoded > User)
		}

		console.log("🔧 [KILOCODE-OPENROUTER] Final options for OpenRouter with resolved key:", {
			openRouterBaseUrl: finalOptions.openRouterBaseUrl,
			hasOpenRouterApiKey: !!finalOptions.openRouterApiKey,
			openRouterApiKeyLength: finalOptions.openRouterApiKey?.length || 0,
			openRouterApiKeyPreview: finalOptions.openRouterApiKey
				? `${finalOptions.openRouterApiKey.substring(0, 15)}...`
				: "undefined",
			openRouterApiKeyStart: finalOptions.openRouterApiKey
				? finalOptions.openRouterApiKey.substring(0, 12)
				: "undefined",
			apiKeySource: source,
			timestamp: new Date().toISOString(),
		})

		console.log("🔧 [KILOCODE-OPENROUTER] About to call super() with resolved OpenRouter options")
		super(finalOptions)
		console.log("✅ [KILOCODE-OPENROUTER] KilocodeOpenrouterHandler initialized successfully with resolved API key")
	}

	/**
	 * Override createMessage to skip authentication checks
	 */
	override async *createMessage(systemPrompt: string, messages: any[], metadata?: ApiHandlerCreateMessageMetadata) {
		console.log("🚀 [KILOCODE-OPENROUTER] Starting createMessage request")
		console.log("🔍 [KILOCODE-OPENROUTER] Request details:", {
			systemPromptLength: systemPrompt?.length || 0,
			systemPromptPreview: systemPrompt ? `${systemPrompt.substring(0, 50)}...` : "undefined",
			messagesCount: messages?.length || 0,
			hasMetadata: !!metadata,
			taskId: metadata?.taskId || "not set",
			mode: metadata?.mode || "not set",
		})

		// VALIDATION: Ensure a valid API key is being used during API calls
		const isValidKey = validateOpenRouterApiKey(this.options.openRouterApiKey || "")

		console.log("🔍 [KILOCODE-OPENROUTER] API key validation before request:", {
			currentKeyPreview: this.options.openRouterApiKey
				? `${this.options.openRouterApiKey.substring(0, 15)}...`
				: "undefined",
			isValidKey: isValidKey,
			keyLength: this.options.openRouterApiKey?.length || 0,
			timestamp: new Date().toISOString(),
		})

		if (!isValidKey) {
			console.error("❌ [KILOCODE-OPENROUTER] CRITICAL: Invalid API key format detected during API call!", {
				currentKeyPreview: this.options.openRouterApiKey
					? `${this.options.openRouterApiKey.substring(0, 12)}...`
					: "undefined",
				isValidKey: isValidKey,
				timestamp: new Date().toISOString(),
			})
		}

		// Check current token state before making request
		console.log("🔍 [KILOCODE-OPENROUTER] Current token state:", {
			hasKilocodeToken: !!this.options.kilocodeToken,
			kilocodeTokenLength: this.options.kilocodeToken?.length || 0,
			kilocodeTokenPreview: this.options.kilocodeToken
				? `${this.options.kilocodeToken.substring(0, 15)}...`
				: "undefined",
			openRouterApiKeyLength: this.options.openRouterApiKey?.length || 0,
			openRouterApiKeyPreview: this.options.openRouterApiKey
				? `${this.options.openRouterApiKey.substring(0, 15)}...`
				: "undefined",
			isValidKey: isValidKey,
			timestamp: new Date().toISOString(),
		})

		// Pre-warm user info cache for attribution headers
		// This ensures the cache is populated before customRequestOptions is called
		console.log("🔄 [KILOCODE-OPENROUTER] Pre-warming user info cache for attribution headers")
		try {
			await this.extractUserInfoFromToken()
		} catch (error) {
			console.warn("⚠️ [KILOCODE-OPENROUTER] Failed to pre-warm user info cache (non-critical):", error)
		}

		// Skip authentication check - use OpenRouter directly
		console.log("🔄 [KILOCODE-OPENROUTER] Skipping authentication check for API request")

		// Check if we have a KiloCode token to use for credit tracking
		const creditToken = this.options.kilocodeToken

		if (creditToken) {
			console.log("💰 [KILOCODE-OPENROUTER] Checking credits before request...")
			try {
				// Check if user has ANY credits (using a minimal amount like $0.001)
				// We don't know the exact cost yet, but we want to prevent usage if balance is 0
				const hasCredits = await creditManager.checkSufficientCredits(creditToken, 0.001)

				if (!hasCredits.sufficient) {
					console.error("❌ [KILOCODE-OPENROUTER] Insufficient credits:", {
						current: hasCredits.currentCredits,
						required: hasCredits.requiredCredits,
					})
					throw new Error(
						`Insufficient credits. You have ${hasCredits.currentCredits} credits but need at least a positive balance to start.`,
					)
				}
				console.log("✅ [KILOCODE-OPENROUTER] Credit check passed, proceeding with request")
			} catch (error) {
				console.error("❌ [KILOCODE-OPENROUTER] Credit check failed:", error)
				throw error
			}
		} else {
			console.warn(
				"⚠️ [KILOCODE-OPENROUTER] No KiloCode token found, skipping credit check (this may allow free usage!)",
			)
		}

		try {
			// Call parent implementation
			const generator = super.createMessage(systemPrompt, messages, metadata)

			// Intercept the stream to capture usage data
			for await (const chunk of generator) {
				// Check for usage chunk
				if (chunk.type === "usage" && creditToken) {
					console.log("📊 [KILOCODE-OPENROUTER] Captured usage chunk:", chunk)

					if (chunk.totalCost && chunk.totalCost > 0) {
						console.log(`💰 [KILOCODE-OPENROUTER] Deducting $${chunk.totalCost} from user credits...`)

						// Deduct credits asynchronously (don't block the stream)
						// Use resilient system for 100% success rate (queuing/offline tracking)
						try {
							const enhancedSystem = getGlobalEnhancedCreditSystem()

							enhancedSystem
								.deductCredits(
									"API_USAGE",
									chunk.totalCost,
									`API Usage: ${this.options.openRouterModelId || "unknown model"}`,
									{
										operationType: "api_actual_usage",
										requestId: metadata?.taskId || randomUUID(),
										apiProvider: "kilocode-openrouter",
										modelId: this.options.openRouterModelId,
										taskId: metadata?.taskId,
										mode: metadata?.mode,
										inputTokens: chunk.inputTokens,
										outputTokens: chunk.outputTokens,
										model: this.options.openRouterModelId,
										isActualUsage: true,
									},
								)
								.then((transaction) => {
									if (transaction.success) {
										console.log(
											"✅ [KILOCODE-OPENROUTER] Credits deducted successfully (resilient):",
											transaction,
										)
									} else {
										console.error(
											"❌ [KILOCODE-OPENROUTER] Failed to deduct credits (resilient):",
											transaction,
										)
									}
								})
								.catch((err) => {
									console.error("❌ [KILOCODE-OPENROUTER] Error deducting credits (resilient):", err)
								})
						} catch (error) {
							// Fallback to direct manager if enhanced system is not available (should not happen if initialized)
							console.warn(
								"⚠️ [KILOCODE-OPENROUTER] Enhanced credit system not available, falling back to direct manager:",
								error,
							)

							creditManager
								.deductFromActual(
									creditToken,
									chunk.totalCost,
									`API Usage: ${this.options.openRouterModelId || "unknown model"}`,
									{
										operationType: "api_actual_usage",
										requestId: metadata?.taskId || randomUUID(),
										apiProvider: "kilocode-openrouter",
										modelId: this.options.openRouterModelId,
										taskId: metadata?.taskId,
										mode: metadata?.mode,
										inputTokens: chunk.inputTokens,
										outputTokens: chunk.outputTokens,
										model: this.options.openRouterModelId,
									},
								)
								.then((transaction) => {
									if (transaction.success) {
										console.log(
											"✅ [KILOCODE-OPENROUTER] Credits deducted successfully (fallback):",
											transaction,
										)
									} else {
										console.error(
											"❌ [KILOCODE-OPENROUTER] Failed to deduct credits (fallback):",
											transaction,
										)
									}
								})
								.catch((err) => {
									console.error("❌ [KILOCODE-OPENROUTER] Error deducting credits (fallback):", err)
								})
						}
					}
				}

				yield chunk
			}

			console.log("✅ [KILOCODE-OPENROUTER] createMessage completed successfully")
		} catch (error) {
			console.error("❌ [KILOCODE-OPENROUTER] createMessage failed:", {
				error: error instanceof Error ? error.message : String(error),
				errorType: error instanceof Error ? error.constructor.name : typeof error,
				stack: error instanceof Error ? error.stack : "no stack trace",
				timestamp: new Date().toISOString(),
			})
			throw error
		}
	}

	/**
	 * Create a safe cache key from JWT token
	 */
	private createTokenCacheKey(token: string): string {
		if (token.length < 20) return token
		// Use first 10 and last 10 characters for caching
		return token.substring(0, 10) + token.substring(token.length - 10)
	}

	/**
	 * Extract user info from JWT token with caching
	 * Returns null if token is invalid or missing
	 */
	private async extractUserInfoFromToken(): Promise<UserInfoFromJWT | null> {
		const token = this.options.kilocodeToken
		if (!token) {
			console.log("[KILOCODE-OPENROUTER] No JWT token available for attribution headers")
			return null
		}

		// Check cache first
		const cacheKey = this.createTokenCacheKey(token)
		const cached = this.userInfoCache.get(cacheKey)
		if (cached && cached.expires > Date.now()) {
			console.log("[KILOCODE-OPENROUTER] Using cached user info for attribution headers")
			return cached.userInfo
		}

		// Extract fresh user info
		try {
			console.log("[KILOCODE-OPENROUTER] Extracting user info from JWT for attribution headers")
			const userInfo = await extractUserFromJWT(token)
			if (userInfo) {
				// Cache for 5 minutes
				this.userInfoCache.set(cacheKey, {
					userInfo,
					expires: Date.now() + this.USER_INFO_CACHE_TTL_MS,
				})
				console.log("[KILOCODE-OPENROUTER] User info extracted and cached successfully")
			}
			return userInfo
		} catch (error) {
			console.warn("[KILOCODE-OPENROUTER] Failed to extract user from JWT for attribution headers:", error)
			return null
		}
	}

	/**
	 * Build X-Title header value with fallback priority:
	 * org_slug → org_id → email → username → userId
	 */
	private buildXTitleHeader(userInfo: UserInfoFromJWT): string {
		return (
			userInfo.organizationSlug ||
			userInfo.organizationId ||
			userInfo.email ||
			userInfo.username ||
			userInfo.userId ||
			"unknown-user"
		)
	}

	/**
	 * Get cached user info synchronously (returns null if not cached)
	 */
	private getCachedUserInfo(): UserInfoFromJWT | null {
		const token = this.options.kilocodeToken
		if (!token) return null

		const cacheKey = this.createTokenCacheKey(token)
		const cached = this.userInfoCache.get(cacheKey)

		if (cached && cached.expires > Date.now()) {
			return cached.userInfo
		}

		return null
	}

	override customRequestOptions(metadata?: ApiHandlerCreateMessageMetadata): OpenAI.RequestOptions | undefined {
		const headers: Record<string, string> = {}

		// Add existing task ID header
		if (metadata?.taskId) {
			headers["X-KiloCode-TaskId"] = metadata.taskId
		}

		// Add OpenRouter attribution headers for enterprise filtering
		// These headers enable manual filtering by enterprise/user in OpenRouter's activity feed
		const userInfo = this.getCachedUserInfo()
		if (userInfo) {
			headers["X-Title"] = this.buildXTitleHeader(userInfo)
			headers["X-User-ID"] = userInfo.userId
			console.log("[KILOCODE-OPENROUTER] Added attribution headers:", {
				"X-Title": headers["X-Title"],
				"X-User-ID": headers["X-User-ID"],
			})
		} else {
			console.log("[KILOCODE-OPENROUTER] No cached user info available for attribution headers")
		}

		return Object.keys(headers).length > 0 ? { headers } : undefined
	}

	override getModel() {
		let id
		let info
		let defaultTemperature = 0

		const selectedModel = this.options.kilocodeModel ?? "gemini25"

		// Map the selected model to the corresponding OpenRouter model ID
		// legacy mapping
		const modelMapping = {
			gemini25: "google/gemini-2.5-pro-preview",
			gpt41: "openai/gpt-4.1",
			gemini25flashpreview: "google/gemini-2.5-flash-preview",
			claude37: "anthropic/claude-3.7-sonnet",
		}

		// check if the selected model is in the mapping for backwards compatibility
		id = selectedModel
		if (Object.keys(modelMapping).includes(selectedModel)) {
			id = modelMapping[selectedModel as keyof typeof modelMapping]
		}

		if (Object.keys(this.models).length === 0) {
			throw new Error("Failed to load Softcodes provider model list.")
		} else if (this.models[id]) {
			info = this.models[id]
		} else {
			throw new Error(`Unsupported model: ${selectedModel}`)
		}

		const isDeepSeekR1 = id.startsWith("deepseek/deepseek-r1") || id === "perplexity/sonar-reasoning"

		const params = getModelParams({
			format: "openrouter",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: isDeepSeekR1 ? DEEP_SEEK_DEFAULT_TEMPERATURE : defaultTemperature,
		})

		return { id, info, topP: isDeepSeekR1 ? 0.95 : undefined, ...params }
	}

	public override async fetchModel() {
		console.log("🔍 [KILOCODE-OPENROUTER] Starting fetchModel")

		if (!this.options.kilocodeToken || this.options.kilocodeToken.trim() === "") {
			console.error("❌ [KILOCODE-OPENROUTER] KiloCode token validation failed:", {
				hasToken: !!this.options.kilocodeToken,
				tokenLength: this.options.kilocodeToken?.length || 0,
				tokenTrimmed: this.options.kilocodeToken?.trim() || "",
				isEmptyAfterTrim: !this.options.kilocodeToken?.trim(),
			})
			throw new Error("KiloCode token is required to fetch models")
		}

		console.log("✅ [KILOCODE-OPENROUTER] KiloCode token validation passed:", {
			tokenLength: this.options.kilocodeToken.length,
			tokenPreview: `${this.options.kilocodeToken.substring(0, 15)}...`,
		})

		// Skip authentication check - use OpenRouter directly
		console.log("🔄 [KILOCODE-OPENROUTER] Skipping authentication check for model fetching")

		try {
			console.log("🔄 [KILOCODE-OPENROUTER] Calling getModels with provider: kilocode-openrouter")
			this.models = await getModels({
				provider: "kilocode-openrouter",
				kilocodeToken: this.options.kilocodeToken,
			})
			console.log("✅ [KILOCODE-OPENROUTER] getModels completed successfully:", {
				modelsCount: Object.keys(this.models).length,
				modelKeys: Object.keys(this.models),
			})

			console.log("🔄 [KILOCODE-OPENROUTER] Calling getModel() to return selected model")
			const model = this.getModel()
			console.log("✅ [KILOCODE-OPENROUTER] fetchModel completed successfully:", {
				selectedModelId: model.id,
				selectedModelInfo: model.info,
			})
			return model
		} catch (error) {
			console.error("❌ [KILOCODE-OPENROUTER] fetchModel failed:", {
				error: error instanceof Error ? error.message : String(error),
				errorType: error instanceof Error ? error.constructor.name : typeof error,
				stack: error instanceof Error ? error.stack : "no stack trace",
				timestamp: new Date().toISOString(),
			})
			throw error
		}
	}
}
