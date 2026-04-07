// kilocode_change - new file
import { ContextProxy } from "../../../core/config/ContextProxy"
import { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"
import { ProviderSettings } from "@roo-code/types"

export async function getAutocompleteConfiguration(
	providerSettingsManager: ProviderSettingsManager,
): Promise<ProviderSettings | undefined> {
	// Bypass user config; autocomplete uses fixed OpenRouter setup in provider
	console.log("🚀 Autocomplete config bypassed for fixed OpenRouter setup")
	return undefined
}
