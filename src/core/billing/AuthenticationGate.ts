/**
 * Authentication Gate Service
 *
 * Central service that validates authentication and billing requirements before API requests.
 * Enforces authentication for all requests and applies appropriate billing models.
 */

import * as vscode from "vscode"
import type { ProviderSettings, ProviderName } from "@roo-code/types"
import { UnifiedAuthService } from "../../auth/unifiedAuthService"
import { BillingStrategy, BillingValidationResult, BillingStrategyFactory, BillingModel } from "./BillingStrategy"
import { BillingError, AuthenticationRequiredError, UnsupportedProviderError, isBillingError } from "./BillingError"

/**
 * Configuration for the authentication gate
 */
export interface AuthenticationGateConfig {
	enableStrictAuth?: boolean // If false, allows bypass in development
	requireAuthForAllProviders?: boolean // If false, only credit-based providers require auth
	enableCreditPreflightChecks?: boolean // If false, skips credit balance checks
	debugMode?: boolean
}

/**
 * Result of authentication gate validation
 */
export interface AuthGateValidationResult extends BillingValidationResult {
	authenticationState?: any
	billingModel: BillingModel
	strategy: BillingStrategy
}

/**
 * Main authentication gate service
 */
export class AuthenticationGate {
	private static instance: AuthenticationGate
	private authService: UnifiedAuthService
	private config: AuthenticationGateConfig

	private constructor(
		private context: vscode.ExtensionContext,
		config: AuthenticationGateConfig = {},
	) {
		this.authService = UnifiedAuthService.getInstance(context)
		this.config = {
			enableStrictAuth: true,
			requireAuthForAllProviders: true,
			enableCreditPreflightChecks: true,
			debugMode: false,
			...config,
		}
	}

	/**
	 * Get singleton instance of AuthenticationGate
	 */
	static getInstance(context: vscode.ExtensionContext, config?: AuthenticationGateConfig): AuthenticationGate {
		if (!AuthenticationGate.instance) {
			AuthenticationGate.instance = new AuthenticationGate(context, config)
		}
		return AuthenticationGate.instance
	}

	/**
	 * Main validation method - validates authentication and billing requirements
	 */
	async validateRequest(
		apiConfiguration: ProviderSettings,
		estimatedTokens?: number,
		simpleCheck?: boolean,
	): Promise<AuthGateValidationResult> {
		const startTime = Date.now()
		const provider = apiConfiguration.apiProvider

		if (this.config.debugMode) {
			console.log(`[AUTH-GATE] Starting validation for provider: ${provider}`, {
				estimatedTokens,
				simpleCheck,
				config: this.config,
			})
		}

		try {
			// 1. Validate provider is supported
			if (!provider) {
				return this.createFailureResult(
					new UnsupportedProviderError("No API provider specified in configuration"),
					BillingModel.DOLLAR_BASED,
				)
			}

			// 2. Get billing strategy for this provider
			const strategy = BillingStrategyFactory.getStrategyForProvider(provider)
			const billingModel = strategy.model

			if (this.config.debugMode) {
				console.log(`[AUTH-GATE] Using ${billingModel} billing strategy for ${provider}`)
			}

			// 3. Check authentication requirements
			if (this.config.requireAuthForAllProviders) {
				const authState = await this.authService.getAuthenticationState()

				if (!authState.isAuthenticated) {
					return this.createFailureResult(
						new AuthenticationRequiredError(
							`Authentication required for all API requests (provider: ${provider})`,
							provider,
						),
						billingModel,
						strategy,
					)
				}

				if (this.config.debugMode) {
					console.log(`[AUTH-GATE] Authentication check passed`, {
						isAuthenticated: authState.isAuthenticated,
						isConnected: authState.isConnected,
					})
				}
			}

			// 4. Delegate to billing strategy for provider-specific validation
			const billingValidation = await strategy.validatePreFlight(
				apiConfiguration,
				this.context,
				estimatedTokens,
				simpleCheck,
			)

			// 5. Create final result
			const result: AuthGateValidationResult = {
				...billingValidation,
				billingModel,
				strategy,
				authenticationState: await this.authService.getAuthenticationState(),
			}

			const duration = Date.now() - startTime
			if (this.config.debugMode) {
				console.log(`[AUTH-GATE] Validation completed in ${duration}ms`, {
					canProceed: result.canProceed,
					hasError: !!result.error,
					billingModel,
					provider,
					simpleCheck,
				})
			}

			return result
		} catch (error) {
			const duration = Date.now() - startTime
			console.error(`[AUTH-GATE] Validation failed after ${duration}ms:`, error)

			return this.createFailureResult(
				new UnsupportedProviderError(
					`Authentication gate validation failed: ${error instanceof Error ? error.message : String(error)}`,
					provider,
				),
				BillingModel.DOLLAR_BASED,
			)
		}
	}

	/**
	 * Quick authentication check without full billing validation
	 */
	async isUserAuthenticated(): Promise<boolean> {
		try {
			const authState = await this.authService.getAuthenticationState()
			return authState.isAuthenticated
		} catch (error) {
			console.error("[AUTH-GATE] Error checking authentication:", error)
			return false
		}
	}

	/**
	 * Get current user authentication state
	 */
	async getAuthenticationState() {
		return await this.authService.getAuthenticationState()
	}

	/**
	 * Get billing model for a specific provider
	 */
	getBillingModelForProvider(provider: ProviderName): BillingModel {
		return BillingStrategyFactory.getBillingModelForProvider(provider)
	}

	/**
	 * Check if provider uses credit-based billing
	 */
	isCreditBasedProvider(provider: ProviderName): boolean {
		return BillingStrategyFactory.isCreditBasedProvider(provider)
	}

	/**
	 * Get provider requirements for UI display
	 */
	getProviderRequirements(provider: ProviderName): string[] {
		try {
			const strategy = BillingStrategyFactory.getStrategyForProvider(provider)
			return strategy.getProviderRequirements(provider)
		} catch (error) {
			console.warn(`[AUTH-GATE] Could not get requirements for provider ${provider}:`, error)
			return ["Provider Configuration Required"]
		}
	}

	/**
	 * Get user guidance message for provider
	 */
	getUserGuidanceMessage(provider: ProviderName): string {
		try {
			const strategy = BillingStrategyFactory.getStrategyForProvider(provider)
			return strategy.getUserGuidanceMessage(provider)
		} catch (error) {
			console.warn(`[AUTH-GATE] Could not get guidance for provider ${provider}:`, error)
			return "Please configure this provider according to its requirements."
		}
	}

	/**
	 * Update gate configuration
	 */
	updateConfig(newConfig: Partial<AuthenticationGateConfig>): void {
		this.config = { ...this.config, ...newConfig }

		if (this.config.debugMode) {
			console.log("[AUTH-GATE] Configuration updated:", this.config)
		}
	}

	/**
	 * Helper to create failure result with consistent structure
	 */
	private createFailureResult(
		error: BillingError,
		billingModel: BillingModel,
		strategy?: BillingStrategy,
	): AuthGateValidationResult {
		return {
			canProceed: false,
			error,
			billingModel,
			strategy: strategy || BillingStrategyFactory.getStrategy(billingModel),
		}
	}

	/**
	 * Helper to get provider-specific error context
	 */
	async getProviderErrorContext(provider: ProviderName): Promise<Record<string, any>> {
		try {
			const authState = await this.authService.getAuthenticationState()
			const strategy = BillingStrategyFactory.getStrategyForProvider(provider)

			return {
				provider,
				billingModel: strategy.model,
				isAuthenticated: authState.isAuthenticated,
				isConnected: authState.isConnected,
				requirements: strategy.getProviderRequirements(provider),
				guidance: strategy.getUserGuidanceMessage(provider),
			}
		} catch (error) {
			return {
				provider,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}
}

/**
 * Singleton getter for convenience
 */
export function getAuthenticationGate(context: vscode.ExtensionContext): AuthenticationGate {
	return AuthenticationGate.getInstance(context)
}

/**
 * Quick check if provider requires authentication (convenience function)
 */
export function requiresAuthentication(provider: ProviderName): boolean {
	// All providers require authentication according to requirements
	return true
}

/**
 * Quick check if provider uses credit billing (convenience function)
 */
export function usesCreditBilling(provider: ProviderName): boolean {
	return BillingStrategyFactory.isCreditBasedProvider(provider)
}
