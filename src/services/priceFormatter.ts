import { CREDIT_CONFIG } from "../config/constants"

export function formatPrice(providerId: string, cost: number): string {
	// Providers that should display costs in credits instead of dollars
	const creditBasedProviders = new Set([
		"openrouter",
		"softcodes/openrouter", // Backward compatibility
	])

	if (creditBasedProviders.has(providerId)) {
		const credits = cost / CREDIT_CONFIG.USD_PER_CREDIT
		const formattedCredits = credits.toFixed(2)
		return `${formattedCredits} credits`
	} else {
		return `$${cost.toFixed(2)}`
	}
}
