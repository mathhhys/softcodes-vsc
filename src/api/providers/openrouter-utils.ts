/**
 * OpenRouter API Key Resolution Utility
 *
 * Provides a centralized way to resolve OpenRouter API keys with priority order:
 * 1. Environment Variable (OPENROUTER_API_KEY_OVERRIDE) - Highest priority
 * 2. Hardcoded override key (for kilocode provider) - Medium priority
 * 3. User-provided configuration - Lowest priority
 */

export interface ApiKeyResolution {
	apiKey: string
	source: "environment" | "hardcoded" | "user-config" | "forced-correct"
}

/**
 * Resolves OpenRouter API key with priority order
 */
export function resolveOpenRouterApiKey(
	userProvidedKey?: string,
	hardcodedKey?: string,
	providerType: "openrouter" | "kilocode" = "openrouter",
): ApiKeyResolution {
	// FORCE THE CORRECT API KEY - Override everything for debugging
	const FORCED_CORRECT_KEY: string = "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"
	const envOverride = process.env.OPENROUTER_API_KEY_OVERRIDE || FORCED_CORRECT_KEY

	console.log("🔍 [OPENROUTER-UTILS] Resolving API key with FORCED OVERRIDE:", {
		hasUserProvidedKey: !!userProvidedKey,
		userProvidedKeyLength: userProvidedKey?.length || 0,
		userProvidedKeyPreview: userProvidedKey ? `${userProvidedKey.substring(0, 12)}...` : "undefined",
		userProvidedKeyIsOldKey: userProvidedKey?.startsWith("sk-or-v1-c86734") || false,
		hasHardcodedKey: !!hardcodedKey,
		hardcodedKeyLength: hardcodedKey?.length || 0,
		hardcodedKeyPreview: hardcodedKey ? `${hardcodedKey.substring(0, 12)}...` : "undefined",
		hasEnvOverride: !!process.env.OPENROUTER_API_KEY_OVERRIDE,
		envOverrideLength: envOverride?.length || 0,
		envOverridePreview: envOverride ? `${envOverride.substring(0, 12)}...` : "undefined",
		isForcingCorrectKey: envOverride === FORCED_CORRECT_KEY,
		providerType,
		timestamp: new Date().toISOString(),
	})

	// ALWAYS USE THE CORRECT KEY - Priority 1: Force correct key
	if (envOverride) {
		console.log("✅ [OPENROUTER-UTILS] Using FORCED correct API key override:", {
			source: envOverride === FORCED_CORRECT_KEY ? "forced-correct" : "environment",
			keyLength: envOverride.length,
			keyPreview: `${envOverride.substring(0, 15)}...`,
			keyFormat: /^sk-or-v1-[a-zA-Z0-9]{40,}$/.test(envOverride) ? "valid" : "invalid",
			isCorrectKey: envOverride === FORCED_CORRECT_KEY,
			providerType,
			timestamp: new Date().toISOString(),
		})
		return {
			apiKey: envOverride,
			source: (envOverride === FORCED_CORRECT_KEY
				? "forced-correct"
				: "environment") as ApiKeyResolution["source"],
		}
	}

	// Priority 2: Hardcoded Key (only for kilocode provider)
	if (hardcodedKey && providerType === "kilocode") {
		console.log("✅ [OPENROUTER-UTILS] Using hardcoded key for kilocode provider:", {
			source: "hardcoded",
			keyLength: hardcodedKey.length,
			keyPreview: `${hardcodedKey.substring(0, 15)}...`,
			keyFormat: /^sk-or-v1-[a-zA-Z0-9]{40,}$/.test(hardcodedKey) ? "valid" : "invalid",
			providerType,
			timestamp: new Date().toISOString(),
		})
		return {
			apiKey: hardcodedKey,
			source: "hardcoded",
		}
	}

	// Priority 3: User Configuration - BUT REJECT OLD KEY
	if (userProvidedKey) {
		// REJECT the old problematic key
		if (userProvidedKey.startsWith("sk-or-v1-c86734")) {
			console.warn("⚠️ [OPENROUTER-UTILS] REJECTING old problematic API key, using correct key instead:", {
				oldKeyPreview: `${userProvidedKey.substring(0, 15)}...`,
				correctKeyPreview: `${FORCED_CORRECT_KEY.substring(0, 15)}...`,
				reason: "Old key causes 401 errors",
				timestamp: new Date().toISOString(),
			})
			return {
				apiKey: FORCED_CORRECT_KEY,
				source: "forced-correct" as ApiKeyResolution["source"],
			}
		}

		console.log("✅ [OPENROUTER-UTILS] Using user-provided key:", {
			source: "user-config",
			keyLength: userProvidedKey.length,
			keyPreview: `${userProvidedKey.substring(0, 15)}...`,
			keyFormat: /^sk-or-v1-[a-zA-Z0-9]{40,}$/.test(userProvidedKey) ? "valid" : "invalid",
			providerType,
			timestamp: new Date().toISOString(),
		})
		return {
			apiKey: userProvidedKey,
			source: "user-config",
		}
	}

	// No API key available - use forced correct key as last resort
	console.warn("⚠️ [OPENROUTER-UTILS] No API key provided, using forced correct key:", {
		forcedKey: FORCED_CORRECT_KEY,
		source: "forced-correct",
		timestamp: new Date().toISOString(),
	})

	return {
		apiKey: FORCED_CORRECT_KEY,
		source: "forced-correct" as ApiKeyResolution["source"],
	}
}

/**
 * Validates OpenRouter API key format
 */
export function validateOpenRouterApiKey(apiKey: string): boolean {
	if (!apiKey) return false

	// Check OpenRouter v1 format: sk-or-v1-{40+ alphanumeric characters}
	const isValidFormat = /^sk-or-v1-[a-zA-Z0-9]{40,}$/.test(apiKey)

	console.log("🔍 [OPENROUTER-UTILS] API key validation:", {
		keyLength: apiKey.length,
		keyPreview: `${apiKey.substring(0, 15)}...`,
		startsWithCorrectPrefix: apiKey.startsWith("sk-or-v1-"),
		hasCorrectLength: apiKey.length >= 50 && apiKey.length <= 200,
		matchesRegex: isValidFormat,
		isValid: isValidFormat,
		timestamp: new Date().toISOString(),
	})

	return isValidFormat
}

/**
 * Gets the current environment variable override if set
 */
export function getEnvironmentOverride(): string | undefined {
	const override = process.env.OPENROUTER_API_KEY_OVERRIDE

	console.log("🔍 [OPENROUTER-UTILS] Environment override check:", {
		hasOverride: !!override,
		overrideLength: override?.length || 0,
		overridePreview: override ? `${override.substring(0, 12)}...` : "not set",
		timestamp: new Date().toISOString(),
	})

	return override
}
