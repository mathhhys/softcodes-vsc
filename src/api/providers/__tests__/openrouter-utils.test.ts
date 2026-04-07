import { describe, test, it, expect, beforeEach, afterEach, vi } from "vitest"
import { resolveOpenRouterApiKey, validateOpenRouterApiKey, getEnvironmentOverride } from "../openrouter-utils"

describe("OpenRouter Utils", () => {
	let originalEnv: typeof process.env

	beforeEach(() => {
		originalEnv = process.env
		// Clear environment variable before each test
		delete process.env.OPENROUTER_API_KEY_OVERRIDE
	})

	afterEach(() => {
		process.env = originalEnv
	})

	describe("resolveOpenRouterApiKey", () => {
		const mockUserKey = "sk-or-v1-user123456789012345678901234567890123456789012345678901234"
		const mockHardcodedKey = "sk-or-v1-hard123456789012345678901234567890123456789012345678901234"
		const mockEnvKey = "sk-or-v1-env1234567890123456789012345678901234567890123456789012345"

		it("should use environment variable override when available", () => {
			process.env.OPENROUTER_API_KEY_OVERRIDE = mockEnvKey

			const result = resolveOpenRouterApiKey(mockUserKey, mockHardcodedKey, "kilocode")

			expect(result.apiKey).toBe(mockEnvKey)
			expect(result.source).toBe("environment")
		})

		it("should use hardcoded key for kilocode provider when no environment override", () => {
			const result = resolveOpenRouterApiKey(mockUserKey, mockHardcodedKey, "kilocode")

			expect(result.apiKey).toBe(mockHardcodedKey)
			expect(result.source).toBe("hardcoded")
		})

		it("should use user-provided key for openrouter provider when no environment override", () => {
			const result = resolveOpenRouterApiKey(mockUserKey, mockHardcodedKey, "openrouter")

			expect(result.apiKey).toBe(mockUserKey)
			expect(result.source).toBe("user-config")
		})

		it("should skip hardcoded key for openrouter provider", () => {
			const result = resolveOpenRouterApiKey(mockUserKey, mockHardcodedKey, "openrouter")

			expect(result.apiKey).toBe(mockUserKey)
			expect(result.source).toBe("user-config")
		})

		it("should fall back to user key when hardcoded key is not available for kilocode", () => {
			const result = resolveOpenRouterApiKey(mockUserKey, undefined, "kilocode")

			expect(result.apiKey).toBe(mockUserKey)
			expect(result.source).toBe("user-config")
		})

		it("should throw error when no API key is available", () => {
			expect(() => {
				resolveOpenRouterApiKey(undefined, undefined, "openrouter")
			}).toThrow("No OpenRouter API key available for provider: openrouter")
		})

		it("should prefer environment override over everything for both providers", () => {
			process.env.OPENROUTER_API_KEY_OVERRIDE = mockEnvKey

			const kilocodeResult = resolveOpenRouterApiKey(mockUserKey, mockHardcodedKey, "kilocode")
			const openrouterResult = resolveOpenRouterApiKey(mockUserKey, mockHardcodedKey, "openrouter")

			expect(kilocodeResult.apiKey).toBe(mockEnvKey)
			expect(kilocodeResult.source).toBe("environment")
			expect(openrouterResult.apiKey).toBe(mockEnvKey)
			expect(openrouterResult.source).toBe("environment")
		})
	})

	describe("validateOpenRouterApiKey", () => {
		it("should validate correct OpenRouter v1 API key format", () => {
			const validKey = "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"
			expect(validateOpenRouterApiKey(validKey)).toBe(true)
		})

		it("should reject keys that do not start with sk-or-v1-", () => {
			expect(validateOpenRouterApiKey("sk-123456789012345678901234567890123456789012")).toBe(false)
			expect(validateOpenRouterApiKey("invalid-key")).toBe(false)
			expect(validateOpenRouterApiKey("sk-or-v2-123456789012345678901234567890123456789012")).toBe(false)
		})

		it("should reject keys that are too short", () => {
			expect(validateOpenRouterApiKey("sk-or-v1-short")).toBe(false)
		})

		it("should reject empty or undefined keys", () => {
			expect(validateOpenRouterApiKey("")).toBe(false)
			expect(validateOpenRouterApiKey(undefined as any)).toBe(false)
			expect(validateOpenRouterApiKey(null as any)).toBe(false)
		})

		it("should reject keys with invalid characters", () => {
			expect(validateOpenRouterApiKey("sk-or-v1-invalid!@#$%^&*()1234567890123456789012345678901234567890")).toBe(
				false,
			)
		})

		it("should accept keys with valid length and characters", () => {
			const validKey = "sk-or-v1-" + "a".repeat(40)
			expect(validateOpenRouterApiKey(validKey)).toBe(true)
		})
	})

	describe("getEnvironmentOverride", () => {
		it("should return undefined when environment variable is not set", () => {
			expect(getEnvironmentOverride()).toBeUndefined()
		})

		it("should return the environment variable value when set", () => {
			const mockKey = "sk-or-v1-env1234567890123456789012345678901234567890123456789012345"
			process.env.OPENROUTER_API_KEY_OVERRIDE = mockKey

			expect(getEnvironmentOverride()).toBe(mockKey)
		})

		it("should return empty string if environment variable is empty", () => {
			process.env.OPENROUTER_API_KEY_OVERRIDE = ""

			expect(getEnvironmentOverride()).toBe("")
		})
	})

	describe("priority system integration", () => {
		it("should demonstrate complete priority order: env > hardcoded > user", () => {
			const userKey = "sk-or-v1-user123456789012345678901234567890123456789012345678901234"
			const hardcodedKey = "sk-or-v1-hard123456789012345678901234567890123456789012345678901234"
			const envKey = "sk-or-v1-env1234567890123456789012345678901234567890123456789012345"

			// Test without environment override
			const resultWithoutEnv = resolveOpenRouterApiKey(userKey, hardcodedKey, "kilocode")
			expect(resultWithoutEnv.apiKey).toBe(hardcodedKey)
			expect(resultWithoutEnv.source).toBe("hardcoded")

			// Set environment override
			process.env.OPENROUTER_API_KEY_OVERRIDE = envKey

			// Test with environment override
			const resultWithEnv = resolveOpenRouterApiKey(userKey, hardcodedKey, "kilocode")
			expect(resultWithEnv.apiKey).toBe(envKey)
			expect(resultWithEnv.source).toBe("environment")
		})
	})
})
