/**
 * Billing strategy pattern for handling different provider billing models
 */

import * as vscode from "vscode"
import type { ProviderSettings, ProviderName } from "@roo-code/types"
import { UnifiedAuthService } from "../../auth/unifiedAuthService"
import { creditManager, type UserCreditInfo } from "../../services/creditManager"
import {
	BillingError,
	AuthenticationRequiredError,
	InsufficientCreditsError,
	ApiKeyRequiredError,
	CreditEstimationError,
	BillingValidationError,
} from "./BillingError"

/**
 * Billing model enumeration
 */
export enum BillingModel {
	CREDIT_BASED = "credit",
	DOLLAR_BASED = "dollar",
}

/**
 * Result of billing validation before API request
 */
export interface BillingValidationResult {
	canProceed: boolean
	error?: BillingError
	estimatedCost?: number
	availableCredits?: number
	userInfo?: UserCreditInfo
	metadata?: Record<string, any>
}

/**
 * Abstract billing strategy interface
 */
export interface BillingStrategy {
	readonly model: BillingModel
	readonly supportedProviders: ProviderName[]

	/**
	 * Validate billing requirements before making an API request
	 */
	validatePreFlight(
		apiConfiguration: ProviderSettings,
		context: vscode.ExtensionContext,
		estimatedTokens?: number,
		simpleCheck?: boolean,
	): Promise<BillingValidationResult>

	/**
	 * Get provider-specific requirements for billing
	 */
	getProviderRequirements(provider: ProviderName): string[]

	/**
	 * Get user guidance message for this billing model
	 */
	getUserGuidanceMessage(provider: ProviderName): string

	/**
	 * Estimate cost for a request (if applicable)
	 */
	estimateCost?(estimatedTokens: number, provider: ProviderName): Promise<number>
}

/**
 * Credit-based billing strategy for kilocode and openrouter providers
 */
export class CreditBasedBillingStrategy implements BillingStrategy {
	readonly model = BillingModel.CREDIT_BASED
	readonly supportedProviders: ProviderName[] = ["kilocode", "openrouter"]

	async validatePreFlight(
		apiConfiguration: ProviderSettings,
		context: vscode.ExtensionContext,
		estimatedTokens: number = 1000,
		simpleCheck: boolean = false,
	): Promise<BillingValidationResult> {
		try {
			// 1. Check authentication first
			const authService = UnifiedAuthService.getInstance(context)
			const authState = await authService.getAuthenticationState()

			if (!authState.isAuthenticated) {
				return {
					canProceed: false,
					error: new AuthenticationRequiredError(
						"Authentication required for credit-based providers",
						apiConfiguration.apiProvider,
					),
				}
			}

			// 2. Get JWT token for credit checks
			const accessToken = await authService.getAccessToken()
			if (!accessToken) {
				return {
					canProceed: false,
					error: new AuthenticationRequiredError(
						"Valid authentication token required for credit-based providers",
						apiConfiguration.apiProvider,
					),
				}
			}

			// 3. Check credit balance
			const userCredits = await creditManager.getUserCreditBalance(accessToken)
			if (!userCredits) {
				return {
					canProceed: false,
					error: new BillingValidationError(
						"Unable to retrieve credit balance",
						apiConfiguration.apiProvider,
					),
				}
			}

			if (simpleCheck) {
				// Simple check: only verify balance > margin (e.g., > 1 credit)
				const margin = 1
				if (userCredits.currentCredits <= margin) {
					return {
						canProceed: false,
						error: new InsufficientCreditsError(
							"Low credit balance. Please add credits to continue.",
							userCredits.currentCredits,
							0, // No specific required amount
							apiConfiguration.apiProvider,
						),
						availableCredits: userCredits.currentCredits,
						userInfo: userCredits,
						metadata: { simpleCheck: true },
					}
				}

				// All checks passed for simple mode
				return {
					canProceed: true,
					availableCredits: userCredits.currentCredits,
					userInfo: userCredits,
					metadata: {
						simpleCheck: true,
						authState,
					},
				}
			}

			// Full estimation check (original logic)
			// 4. Estimate cost for this request
			let estimatedCost: number
			try {
				estimatedCost = await this.estimateCost(estimatedTokens, apiConfiguration.apiProvider!)
			} catch (error) {
				return {
					canProceed: false,
					error: new CreditEstimationError(
						`Failed to estimate cost: ${error instanceof Error ? error.message : String(error)}`,
						apiConfiguration.apiProvider,
						error instanceof Error ? error : undefined,
					),
				}
			}

			// 5. Check if user has sufficient credits (with buffer)
			const requiredCredits = Math.ceil(estimatedCost / creditManager.getCreditRate())
			const bufferCredits = Math.max(1, Math.ceil(requiredCredits * 0.1)) // 10% buffer
			const totalRequiredCredits = requiredCredits + bufferCredits

			if (userCredits.currentCredits < totalRequiredCredits) {
				return {
					canProceed: false,
					error: new InsufficientCreditsError(
						`Insufficient credits for request`,
						userCredits.currentCredits,
						totalRequiredCredits,
						apiConfiguration.apiProvider,
					),
					availableCredits: userCredits.currentCredits,
					estimatedCost,
					userInfo: userCredits,
				}
			}

			// 6. All checks passed
			return {
				canProceed: true,
				availableCredits: userCredits.currentCredits,
				estimatedCost,
				userInfo: userCredits,
				metadata: {
					requiredCredits,
					bufferCredits,
					authState,
				},
			}
		} catch (error) {
			return {
				canProceed: false,
				error: new BillingValidationError(
					`Credit validation failed: ${error instanceof Error ? error.message : String(error)}`,
					apiConfiguration.apiProvider,
					error instanceof Error ? error : undefined,
				),
			}
		}
	}

	async estimateCost(estimatedTokens: number, provider: ProviderName): Promise<number> {
		// This is a simplified estimation - in reality, you'd want to:
		// 1. Use actual model pricing tables
		// 2. Account for input vs output tokens
		// 3. Consider model-specific pricing

		const baseRate = provider === "kilocode" ? 0.002 : 0.003 // Per 1K tokens
		return (estimatedTokens / 1000) * baseRate
	}

	getProviderRequirements(provider: ProviderName): string[] {
		return ["Softcodes Authentication", "Sufficient Credit Balance"]
	}

	getUserGuidanceMessage(provider: ProviderName): string {
		return `This provider uses your Softcodes credit balance. Ensure you are authenticated and have sufficient credits.`
	}
}

/**
 * Dollar-based billing strategy for providers that require API keys
 */
export class DollarBasedBillingStrategy implements BillingStrategy {
	readonly model = BillingModel.DOLLAR_BASED
	readonly supportedProviders: ProviderName[] = [
		"anthropic",
		"openai",
		"bedrock",
		"vertex",
		"ollama",
		"vscode-lm",
		"lmstudio",
		"gemini",
		"gemini-cli",
		"openai-native",
		"mistral",
		"deepseek",
		"unbound",
		"requesty",
		"human-relay",
		"fake-ai",
		"xai",
		"groq",
		"chutes",
		"litellm",
		"fireworks",
		"cerebras",
		"claude-code",
		"glama",
	]

	async estimateCost(estimatedTokens: number, provider: ProviderName): Promise<number> {
		// Dollar-based providers don't use our credit system for cost estimation
		// This is just for interface compliance - return 0 since cost is handled by provider
		return 0
	}

	async validatePreFlight(
		apiConfiguration: ProviderSettings,
		context: vscode.ExtensionContext,
		estimatedTokens?: number,
		simpleCheck: boolean = false,
	): Promise<BillingValidationResult> {
		try {
			// 1. Check authentication first
			const authService = UnifiedAuthService.getInstance(context)
			const authState = await authService.getAuthenticationState()

			if (!authState.isAuthenticated) {
				return {
					canProceed: false,
					error: new AuthenticationRequiredError(
						"Authentication required for all API requests",
						apiConfiguration.apiProvider,
					),
				}
			}

			// 2. Check provider-specific API key requirements
			const missingKeys = this.getMissingApiKeys(apiConfiguration)
			if (missingKeys.length > 0) {
				return {
					canProceed: false,
					error: new ApiKeyRequiredError(
						`Missing required API configuration for ${apiConfiguration.apiProvider}`,
						apiConfiguration.apiProvider!,
						missingKeys,
					),
				}
			}

			// For simple check in dollar-based, just confirm auth and keys (no credit check needed)
			if (simpleCheck) {
				return {
					canProceed: true,
					metadata: {
						authState,
						configuredKeys: this.getConfiguredKeys(apiConfiguration),
						simpleCheck: true,
					},
				}
			}

			// 3. All checks passed for dollar-based provider (full check same as simple for now)
			return {
				canProceed: true,
				metadata: {
					authState,
					configuredKeys: this.getConfiguredKeys(apiConfiguration),
				},
			}
		} catch (error) {
			return {
				canProceed: false,
				error: new BillingValidationError(
					`API key validation failed: ${error instanceof Error ? error.message : String(error)}`,
					apiConfiguration.apiProvider,
					error instanceof Error ? error : undefined,
				),
			}
		}
	}

	private getMissingApiKeys(config: ProviderSettings): string[] {
		const missingKeys: string[] = []
		const provider = config.apiProvider

		switch (provider) {
			case "anthropic":
				if (!config.apiKey) missingKeys.push("apiKey")
				break
			case "openai":
				if (!config.openAiApiKey) missingKeys.push("openAiApiKey")
				break
			case "bedrock":
				if (!config.awsAccessKey || !config.awsSecretKey || !config.awsRegion) {
					missingKeys.push("AWS credentials (awsAccessKey, awsSecretKey, awsRegion)")
				}
				break
			case "vertex":
				if (!config.vertexProjectId || (!config.vertexKeyFile && !config.vertexJsonCredentials)) {
					missingKeys.push("Vertex AI credentials (vertexProjectId and keyFile or jsonCredentials)")
				}
				break
			case "gemini":
				if (!config.geminiApiKey) missingKeys.push("geminiApiKey")
				break
			case "mistral":
				if (!config.mistralApiKey) missingKeys.push("mistralApiKey")
				break
			case "deepseek":
				if (!config.deepSeekApiKey) missingKeys.push("deepSeekApiKey")
				break
			case "groq":
				if (!config.groqApiKey) missingKeys.push("groqApiKey")
				break
			case "xai":
				if (!config.xaiApiKey) missingKeys.push("xaiApiKey")
				break
			case "fireworks":
				if (!config.fireworksApiKey) missingKeys.push("fireworksApiKey")
				break
			case "cerebras":
				if (!config.cerebrasApiKey) missingKeys.push("cerebrasApiKey")
				break
			case "litellm":
				if (!config.litellmApiKey || !config.litellmBaseUrl) {
					missingKeys.push("litellmApiKey", "litellmBaseUrl")
				}
				break
			case "ollama":
			case "lmstudio":
			case "vscode-lm":
			case "human-relay":
			case "fake-ai":
				// These providers don't require API keys
				break
			default:
				// For any other providers, assume they need some form of API key
				console.warn(`Unknown provider ${provider} - assuming API key required`)
		}

		return missingKeys
	}

	private getConfiguredKeys(config: ProviderSettings): string[] {
		const configuredKeys: string[] = []
		const provider = config.apiProvider

		switch (provider) {
			case "anthropic":
				if (config.apiKey) configuredKeys.push("apiKey")
				break
			case "openai":
				if (config.openAiApiKey) configuredKeys.push("openAiApiKey")
				break
			case "bedrock":
				if (config.awsAccessKey) configuredKeys.push("awsAccessKey")
				if (config.awsSecretKey) configuredKeys.push("awsSecretKey")
				if (config.awsRegion) configuredKeys.push("awsRegion")
				break
			case "vertex":
				if (config.vertexProjectId) configuredKeys.push("vertexProjectId")
				if (config.vertexKeyFile) configuredKeys.push("vertexKeyFile")
				if (config.vertexJsonCredentials) configuredKeys.push("vertexJsonCredentials")
				break
			// Add more providers as needed
		}

		return configuredKeys
	}

	getProviderRequirements(provider: ProviderName): string[] {
		switch (provider) {
			case "anthropic":
				return ["Anthropic API Key"]
			case "openai":
				return ["OpenAI API Key"]
			case "bedrock":
				return ["AWS Access Key", "AWS Secret Key", "AWS Region"]
			case "vertex":
				return ["Google Cloud Project ID", "Service Account Key"]
			case "gemini":
				return ["Google AI API Key"]
			case "ollama":
			case "lmstudio":
				return ["Local Server Running"]
			case "vscode-lm":
				return ["VSCode Language Model Access"]
			default:
				return ["Provider API Key"]
		}
	}

	getUserGuidanceMessage(provider: ProviderName): string {
		return `This provider requires a valid API key and will bill you directly through their service. Ensure you have configured the necessary credentials.`
	}
}

/**
 * Factory to create billing strategies
 */
export class BillingStrategyFactory {
	private static creditStrategy = new CreditBasedBillingStrategy()
	private static dollarStrategy = new DollarBasedBillingStrategy()

	static getStrategy(model: BillingModel): BillingStrategy {
		switch (model) {
			case BillingModel.CREDIT_BASED:
				return this.creditStrategy
			case BillingModel.DOLLAR_BASED:
				return this.dollarStrategy
			default:
				throw new Error(`No billing strategy found for model: ${model}`)
		}
	}

	static getStrategyForProvider(provider: ProviderName): BillingStrategy {
		// Check credit-based providers first
		if (this.creditStrategy.supportedProviders.includes(provider)) {
			return this.creditStrategy
		}

		// Check dollar-based providers
		if (this.dollarStrategy.supportedProviders.includes(provider)) {
			return this.dollarStrategy
		}

		// Default to dollar-based for unknown providers
		return this.dollarStrategy
	}

	static getAllStrategies(): BillingStrategy[] {
		return [this.creditStrategy, this.dollarStrategy]
	}

	static getBillingModelForProvider(provider: ProviderName): BillingModel {
		const strategy = this.getStrategyForProvider(provider)
		return strategy.model
	}

	static isCreditBasedProvider(provider: ProviderName): boolean {
		return this.getBillingModelForProvider(provider) === BillingModel.CREDIT_BASED
	}
}
