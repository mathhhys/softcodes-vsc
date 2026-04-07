/**
 * Billing Model Badge Component
 *
 * Shows whether a provider uses credit-based or dollar-based billing
 */

import React from "react"
import { BillingModel, type ProviderName, getProviderBillingModel } from "@roo-code/types"
import { CreditCard, Key, Info, CheckCircle, AlertTriangle, XCircle, Settings } from "lucide-react"

interface BillingModelBadgeProps {
	provider: ProviderName
	className?: string
	showLabel?: boolean
	size?: "small" | "medium" | "large"
}

export function BillingModelBadge({
	provider,
	className = "",
	showLabel = true,
	size = "medium",
}: BillingModelBadgeProps) {
	const billingModel = getProviderBillingModel(provider)
	const isCreditBased = billingModel === BillingModel.CREDIT_BASED

	const baseClasses = "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium"
	const sizeClasses = {
		small: "px-1 py-0.5 text-xs",
		medium: "px-2 py-1 text-xs",
		large: "px-3 py-1.5 text-sm",
	}

	const modelClasses = isCreditBased
		? "bg-blue-100 text-blue-800 border border-blue-200"
		: "bg-gray-100 text-gray-700 border border-gray-200"

	const IconComponent = isCreditBased ? CreditCard : Key
	const labelText = isCreditBased ? "Credits" : "USD Billing"
	const title =
		provider === "openrouter"
			? "This provider uses credits with decimal precision"
			: "This provider bills in USD ($)"

	return (
		<span className={`${baseClasses} ${sizeClasses[size]} ${modelClasses} ${className}`} title={title}>
			<IconComponent className="w-3 h-3" />
			{showLabel && <span>{labelText}</span>}
		</span>
	)
}

/**
 * Billing Model Status Component
 *
 * Shows detailed billing status for a provider
 */
interface BillingModelStatusProps {
	provider: ProviderName
	isAuthenticated?: boolean
	hasCredits?: boolean
	hasApiKey?: boolean
	creditBalance?: number
	className?: string
}

export function BillingModelStatus({
	provider,
	isAuthenticated = false,
	hasCredits = false,
	hasApiKey = false,
	creditBalance,
	className = "",
}: BillingModelStatusProps) {
	const billingModel = getProviderBillingModel(provider)
	const isCreditBased = billingModel === BillingModel.CREDIT_BASED

	// Determine status
	let status: "ready" | "warning" | "error" | "setup"
	let statusMessage: string
	let actionMessage: string

	if (!isAuthenticated) {
		status = "error"
		statusMessage = "Authentication required"
		actionMessage = "Sign in to Softcodes"
	} else if (isCreditBased) {
		if (typeof creditBalance === "number") {
			const dollarBalance = (creditBalance * 0.014).toFixed(2)
			if (creditBalance > 10) {
				status = "ready"
				statusMessage = `${dollarBalance} dollars available`
				actionMessage = "Ready to use"
			} else if (creditBalance > 0) {
				status = "warning"
				statusMessage = `Low balance: $${dollarBalance} remaining`
				actionMessage = "Consider adding funds"
			} else {
				status = "error"
				statusMessage = "No balance available"
				actionMessage = "Add funds to continue"
			}
		} else {
			status = "setup"
			statusMessage = "Balance unknown"
			actionMessage = "Check account status"
		}
	} else {
		if (hasApiKey) {
			status = "ready"
			statusMessage = "API key configured"
			actionMessage = "Ready to use"
		} else {
			status = "setup"
			statusMessage = "API key required"
			actionMessage = "Configure API key"
		}
	}

	const statusClasses = {
		ready: "text-green-600 bg-green-50 border-green-200",
		warning: "text-yellow-600 bg-yellow-50 border-yellow-200",
		error: "text-red-600 bg-red-50 border-red-200",
		setup: "text-blue-600 bg-blue-50 border-blue-200",
	}

	const StatusIcon = {
		ready: CheckCircle,
		warning: AlertTriangle,
		error: XCircle,
		setup: Settings,
	}[status]

	return (
		<div className={`p-3 border rounded-lg ${statusClasses[status]} ${className}`}>
			<div className="flex items-center gap-2 mb-2">
				<StatusIcon className="w-4 h-4" />
				<BillingModelBadge provider={provider} size="small" />
			</div>

			<div className="text-sm">
				<div className="font-medium">{statusMessage}</div>
				<div className="text-xs mt-1 opacity-75">{actionMessage}</div>
			</div>

			{isCreditBased && typeof creditBalance === "number" && (
				<div className="mt-2 text-xs">
					<div className="text-gray-600">Balance shown in dollars</div>
				</div>
			)}
		</div>
	)
}

/**
 * Provider Requirements List Component
 *
 * Shows what's needed to use a specific provider
 */
interface ProviderRequirementsProps {
	provider: ProviderName
	className?: string
}

export function ProviderRequirements({ provider, className = "" }: ProviderRequirementsProps) {
	const billingModel = getProviderBillingModel(provider)
	const isCreditBased = billingModel === BillingModel.CREDIT_BASED

	const requirements = isCreditBased
		? ["Softcodes account authentication", "Sufficient credit balance", "Active internet connection"]
		: (() => {
				switch (provider) {
					case "anthropic":
						return ["Anthropic API key", "Valid Anthropic account"]
					case "openai":
						return ["OpenAI API key", "Valid OpenAI account"]
					case "bedrock":
						return ["AWS Access Key", "AWS Secret Key", "AWS Region"]
					case "vertex":
						return ["Google Cloud Project ID", "Service Account Key"]
					case "gemini":
						return ["Google AI API key"]
					case "ollama":
					case "lmstudio":
						return ["Local server running", "Model loaded"]
					case "vscode-lm":
						return ["VSCode Language Model access"]
					default:
						return ["Provider API key", "Valid provider account"]
				}
			})()

	return (
		<div className={`space-y-2 ${className}`}>
			<h4 className="text-sm font-medium text-vscode-foreground">Requirements:</h4>
			<ul className="space-y-1">
				{requirements.map((req, index) => (
					<li key={index} className="text-xs text-vscode-descriptionForeground flex items-center gap-2">
						<div className="w-1 h-1 bg-current rounded-full" />
						{req}
					</li>
				))}
			</ul>

			{isCreditBased && (
				<div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
					<Info className="w-3 h-3 inline mr-1" />
					<strong>Credit-based billing:</strong> This provider uses your Softcodes credit balance. Credits do
					not apply to other providers.
				</div>
			)}

			{!isCreditBased && (
				<div className="mt-3 p-2 bg-gray-50 border border-gray-200 rounded text-xs">
					<Info className="w-3 h-3 inline mr-1" />
					<strong>Direct billing:</strong> This provider bills you directly through their service. Softcodes
					credits do not apply.
				</div>
			)}
		</div>
	)
}
