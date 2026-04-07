/**
 * Credit conversion utilities for webview UI components
 *
 * Converts USD amounts to credit units for display in the UI.
 */

export interface CreditDisplayConfig {
	dollarToCreditRate: number // Default: 0.014 (same as backend)
	roundingMode: "ceil" | "floor" | "round" | "none"
	showIcon: boolean
	showUSD: boolean // Whether to show USD in parentheses
}

const DEFAULT_CONFIG: CreditDisplayConfig = {
	// IMPORTANT: must match backend + OpenRouter billing
	// Use fixed constant for now to avoid env mismatch
	dollarToCreditRate: 0.014, // 1 credit = $0.014
	roundingMode: "none",
	showIcon: true,
	showUSD: false,
}

/**
 * Convert USD amount to credits using the same logic as the backend
 */
export function usdToCredits(usdAmount: number, config: Partial<CreditDisplayConfig> = {}): number {
	const finalConfig = { ...DEFAULT_CONFIG, ...config }
	const credits = usdAmount / finalConfig.dollarToCreditRate

	let result: number
	switch (finalConfig.roundingMode) {
		case "ceil":
			result = Math.ceil(credits)
			break
		case "floor":
			result = Math.floor(credits)
			break
		case "round":
			result = Math.round(credits)
			break
		case "none":
		default:
			result = parseFloat(credits.toFixed(3))
			break
	}

	console.log("[DEBUG] usdToCredits", {
		usdAmount,
		rate: finalConfig.dollarToCreditRate,
		creditsRaw: credits,
		creditsFinal: result,
		roundingMode: finalConfig.roundingMode,
	})
	return result
}

/**
 * Format USD amount as credit display text
 */
export function formatCredits(usdAmount: number, config: Partial<CreditDisplayConfig> = {}): string {
	const finalConfig = { ...DEFAULT_CONFIG, ...config }

	if (usdAmount === 0) {
		return finalConfig.showIcon ? "0 credits" : "0"
	}

	const credits = usdToCredits(usdAmount, finalConfig)
	const creditText = `${credits} credit${credits === 1 ? "" : "s"}`

	let result = finalConfig.showIcon ? creditText : credits.toString()

	if (finalConfig.showUSD) {
		result += ` ($${usdAmount.toFixed(3)})`
	}

	return result
}

/**
 * Format credits for display in badges
 */
export function formatCreditsBadge(usdAmount: number): string {
	if (usdAmount === 0) return "0"

	const credits = usdToCredits(usdAmount, { roundingMode: "none" })
	const formatted = credits.toFixed(3).replace(/\.?0+$/, "")
	console.log("[DEBUG] formatCreditsBadge input:", usdAmount, "→ credits:", formatted)
	return formatted
}

/**
 * Format credits with icon for general display
 */
export function formatCreditsWithIcon(usdAmount: number): string {
	return formatCredits(usdAmount, { showIcon: true, showUSD: false })
}

/**
 * Format credits with USD fallback for detailed views
 */
export function formatCreditsDetailed(usdAmount: number): string {
	return formatCredits(usdAmount, { showIcon: true, showUSD: true })
}
