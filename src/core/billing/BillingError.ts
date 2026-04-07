/**
 * Billing-specific error types for authentication and payment validation
 */

import type { ProviderName } from "@roo-code/types"

export abstract class BillingError extends Error {
	abstract readonly type: string
	abstract readonly userAction: string
	abstract readonly actionUrl?: string

	constructor(
		message: string,
		public readonly provider?: ProviderName,
		public readonly metadata?: Record<string, any>,
	) {
		super(message)
		this.name = this.constructor.name
	}
}

/**
 * Error thrown when user authentication is required
 */
export class AuthenticationRequiredError extends BillingError {
	readonly type = "authentication_required"
	readonly userAction = "Please sign in to Softcodes to continue"
	readonly actionUrl = undefined // Triggers in-app auth flow

	constructor(message: string = "User authentication required for all API requests", provider?: ProviderName) {
		super(message, provider)
	}
}

/**
 * Error thrown when user has insufficient credits for credit-based providers
 */
export class InsufficientCreditsError extends BillingError {
	readonly type = "insufficient_credits"
	readonly userAction = "Purchase more credits to continue"
	readonly actionUrl = "https://softcodes.ai/credits"

	constructor(
		message: string,
		public readonly availableCredits: number,
		public readonly requiredCredits: number,
		provider?: ProviderName,
	) {
		super(message, provider, {
			availableCredits,
			requiredCredits,
		})
	}
}

/**
 * Error thrown when API key is required for dollar-based providers
 */
export class ApiKeyRequiredError extends BillingError {
	readonly type = "api_key_required"
	readonly userAction = "Configure API key for this provider"
	readonly actionUrl = undefined // Triggers provider settings

	constructor(
		message: string,
		provider: ProviderName,
		public readonly missingKeys: string[] = [],
	) {
		super(message, provider, { missingKeys })
	}
}

/**
 * Error thrown when provider is not supported by the billing system
 */
export class UnsupportedProviderError extends BillingError {
	readonly type = "unsupported_provider"
	readonly userAction = "Please contact support or try a different provider"
	readonly actionUrl = "mailto:support@softcodes.ai"

	constructor(message: string, provider?: ProviderName) {
		super(message, provider)
	}
}

/**
 * Error thrown when credit estimation fails
 */
export class CreditEstimationError extends BillingError {
	readonly type = "credit_estimation_failed"
	readonly userAction = "Please try again or contact support"
	readonly actionUrl = undefined

	constructor(message: string, provider?: ProviderName, cause?: Error) {
		super(message, provider, { cause: cause?.message })
	}
}

/**
 * Error thrown when billing validation fails for unknown reasons
 */
export class BillingValidationError extends BillingError {
	readonly type = "billing_validation_failed"
	readonly userAction = "Please check your configuration and try again"
	readonly actionUrl = undefined

	constructor(message: string, provider?: ProviderName, cause?: Error) {
		super(message, provider, { cause: cause?.message })
	}
}

/**
 * Type guard to check if error is a billing error
 */
export function isBillingError(error: unknown): error is BillingError {
	return error instanceof BillingError
}

/**
 * User-facing error messages and actions
 */
export const ERROR_MESSAGES = {
	AUTHENTICATION_REQUIRED: {
		title: "Authentication Required",
		message: "You must be signed in to Softcodes to use AI features.",
		actions: ["Sign In", "Learn More"],
	},
	INSUFFICIENT_CREDITS: {
		title: "Insufficient Credits",
		message: "You don't have enough credits for this request. This provider uses Softcodes credits.",
		actions: ["Buy Credits", "Check Balance", "Switch Provider"],
	},
	API_KEY_REQUIRED: {
		title: "API Key Required",
		message: "This provider requires a valid API key and bills you directly.",
		actions: ["Configure API Key", "Learn More", "Switch Provider"],
	},
	UNSUPPORTED_PROVIDER: {
		title: "Provider Not Supported",
		message: "This provider is not supported by the current billing system.",
		actions: ["Contact Support", "Switch Provider"],
	},
	CREDIT_ESTIMATION_FAILED: {
		title: "Credit Estimation Failed",
		message: "Unable to estimate credit usage for this request.",
		actions: ["Try Again", "Contact Support"],
	},
	BILLING_VALIDATION_FAILED: {
		title: "Billing Validation Failed",
		message: "Unable to validate billing requirements for this request.",
		actions: ["Check Configuration", "Try Again", "Contact Support"],
	},
} as const

/**
 * Get user-friendly error information for a billing error
 */
export function getBillingErrorInfo(error: BillingError) {
	const baseInfo = ERROR_MESSAGES[error.type.toUpperCase() as keyof typeof ERROR_MESSAGES]

	if (!baseInfo) {
		return {
			title: "Billing Error",
			message: error.message,
			actions: ["Try Again", "Contact Support"] as const,
			provider: error.provider,
			actionUrl: error.actionUrl,
			userAction: error.userAction,
		}
	}

	// Customize message based on error type and metadata
	let customMessage: string = baseInfo.message
	if (error instanceof InsufficientCreditsError) {
		customMessage = `You need ${error.requiredCredits} credits but only have ${error.availableCredits} available. ${baseInfo.message}`
	} else if (error instanceof ApiKeyRequiredError && error.missingKeys.length > 0) {
		customMessage = `Missing required configuration: ${error.missingKeys.join(", ")}. ${baseInfo.message}`
	}

	return {
		title: baseInfo.title,
		message: customMessage,
		actions: baseInfo.actions,
		provider: error.provider,
		actionUrl: error.actionUrl,
		userAction: error.userAction,
	}
}
