# OpenRouter API Key Environment Variable Override Implementation Plan

## Problem Analysis

- Currently getting 401 "User not found" error with OpenRouter API key `sk-or-v1-c86734...`
- Need to override with new API key: `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`
- System is using regular `OpenRouterHandler` instead of `KilocodeOpenrouterHandler`
- Need universal solution that works for both "openrouter" and "kilocode" providers

## Implementation Strategy

### 1. Environment Variable Design

- Environment variable name: `OPENROUTER_API_KEY_OVERRIDE`
- Priority order: Environment Variable > Hardcoded Key > User Configuration
- Should work transparently across all OpenRouter usage

### 2. Core Implementation Points

#### A. Create Utility Function (`src/api/providers/openrouter-utils.ts`)

```typescript
/**
 * Resolves OpenRouter API key with priority order:
 * 1. Environment Variable (OPENROUTER_API_KEY_OVERRIDE)
 * 2. Hardcoded override key (for kilocode provider)
 * 3. User-provided configuration
 */
export function resolveOpenRouterApiKey(
	userProvidedKey?: string,
	hardcodedKey?: string,
	source: "openrouter" | "kilocode" = "openrouter",
): { apiKey: string; source: string } {
	const envOverride = process.env.OPENROUTER_API_KEY_OVERRIDE

	if (envOverride) {
		return { apiKey: envOverride, source: "environment" }
	}

	if (hardcodedKey && source === "kilocode") {
		return { apiKey: hardcodedKey, source: "hardcoded" }
	}

	if (userProvidedKey) {
		return { apiKey: userProvidedKey, source: "user-config" }
	}

	throw new Error("No OpenRouter API key available")
}
```

#### B. Update ContextProxy.getProviderSettings()

```typescript
public getProviderSettings(): ProviderSettings {
    const values = this.getValues()

    // Apply environment variable override for OpenRouter API key
    const envOverride = process.env.OPENROUTER_API_KEY_OVERRIDE
    if (envOverride && (values.apiProvider === 'openrouter' || values.apiProvider === 'kilocode')) {
        console.log("🔧 [CONTEXT-PROXY] Applying OPENROUTER_API_KEY_OVERRIDE environment variable")
        values.openRouterApiKey = envOverride
    }

    // ... rest of existing logic
}
```

#### C. Update OpenRouterHandler Constructor

```typescript
constructor(options: ApiHandlerOptions) {
    super()
    this.options = options

    // Resolve API key with environment variable override
    const { apiKey, source } = resolveOpenRouterApiKey(
        options.openRouterApiKey,
        undefined,
        'openrouter'
    )

    console.log(`🔧 [OPENROUTER] Using API key from: ${source}`)

    // Override the options with resolved key
    this.options.openRouterApiKey = apiKey

    // ... rest of existing logic
}
```

#### D. Update KilocodeOpenrouterHandler Constructor

```typescript
constructor(options: ApiHandlerOptions) {
    const HARDCODED_OPENROUTER_API_KEY = "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"

    // Resolve API key with environment variable override
    const { apiKey, source } = resolveOpenRouterApiKey(
        options.openRouterApiKey,
        HARDCODED_OPENROUTER_API_KEY,
        'kilocode'
    )

    console.log(`🔧 [KILOCODE-OPENROUTER] Using API key from: ${source}`)

    const finalOptions = {
        ...options,
        openRouterBaseUrl: "https://openrouter.ai/api/v1",
        openRouterApiKey: apiKey,
    }

    super(finalOptions)
}
```

### 3. Implementation Order

1. Create utility function for API key resolution
2. Update ContextProxy to apply environment variable override
3. Update OpenRouterHandler to use utility function
4. Update KilocodeOpenrouterHandler to use utility function
5. Add comprehensive logging
6. Test with environment variable set

### 4. Testing Plan

1. Set environment variable: `export OPENROUTER_API_KEY_OVERRIDE=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`
2. Test with "openrouter" provider
3. Test with "kilocode" provider
4. Verify logs show correct API key source
5. Confirm 401 error is resolved

### 5. Logging Strategy

- Log which API key source is being used (environment, hardcoded, user-config)
- Log API key preview for debugging
- Log environment variable presence check
- Maintain existing extensive logging in handlers

## Files to Modify

1. `src/api/providers/openrouter-utils.ts` (new file)
2. `src/core/config/ContextProxy.ts`
3. `src/api/providers/openrouter.ts`
4. `src/api/providers/kilocode-openrouter.ts`

## Environment Variable Usage

```bash
# Set the override key
export OPENROUTER_API_KEY_OVERRIDE=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

# Start VSCode/extension with the override
code .
```

This ensures the correct API key is used universally across all OpenRouter configurations.
