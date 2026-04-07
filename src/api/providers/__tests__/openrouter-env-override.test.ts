import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import { OpenRouterHandler } from "../openrouter"
import { KilocodeOpenrouterHandler } from "../kilocode-openrouter"
import { ContextProxy } from "../../../core/config/ContextProxy"

describe("OpenRouter Environment Variable Override Integration", () => {
	let originalEnv: typeof process.env

	beforeEach(() => {
		originalEnv = process.env
		// Clear environment variable before each test
		delete process.env.OPENROUTER_API_KEY_OVERRIDE
	})

	afterEach(() => {
		process.env = originalEnv
	})

	describe("OpenRouterHandler with environment override", () => {
		test("should construct successfully with environment override", () => {
			const envKey = "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"
			const userKey = "sk-or-v1-user123456789012345678901234567890123456789012345678901234"

			// Set environment override
			process.env.OPENROUTER_API_KEY_OVERRIDE = envKey

			expect(() => {
				new OpenRouterHandler({
					openRouterApiKey: userKey,
					openRouterModelId: "anthropic/claude-sonnet-4",
				})
			}).not.toThrow()
		})

		test("should construct successfully with user key when no environment override", () => {
			const userKey = "sk-or-v1-user123456789012345678901234567890123456789012345678901234"

			expect(() => {
				new OpenRouterHandler({
					openRouterApiKey: userKey,
					openRouterModelId: "anthropic/claude-sonnet-4",
				})
			}).not.toThrow()
		})

		test("should fail construction when no valid API key is available", () => {
			expect(() => {
				new OpenRouterHandler({
					openRouterModelId: "anthropic/claude-sonnet-4",
				})
			}).toThrow("No OpenRouter API key available for provider: openrouter")
		})
	})

	describe("KilocodeOpenrouterHandler with environment override", () => {
		test("should construct successfully with environment override", () => {
			const envKey = "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"
			const userKey = "sk-or-v1-user123456789012345678901234567890123456789012345678901234"

			// Set environment override
			process.env.OPENROUTER_API_KEY_OVERRIDE = envKey

			expect(() => {
				new KilocodeOpenrouterHandler({
					openRouterApiKey: userKey,
					kilocodeToken: "mock-token",
					kilocodeModel: "gemini25",
				})
			}).not.toThrow()
		})

		test("should construct successfully with hardcoded key when no environment override", () => {
			const userKey = "sk-or-v1-user123456789012345678901234567890123456789012345678901234"

			expect(() => {
				new KilocodeOpenrouterHandler({
					openRouterApiKey: userKey,
					kilocodeToken: "mock-token",
					kilocodeModel: "gemini25",
				})
			}).not.toThrow()
		})
	})

	describe("ContextProxy integration", () => {
		test("should apply environment override in getProviderSettings", () => {
			const envKey = "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"
			const userKey = "sk-or-v1-user123456789012345678901234567890123456789012345678901234"

			// Set environment override
			process.env.OPENROUTER_API_KEY_OVERRIDE = envKey

			// Mock VSCode context
			const mockContext = {
				globalState: {
					get: vi.fn().mockReturnValue(undefined),
					update: vi.fn(),
				},
				secrets: {
					get: vi.fn().mockResolvedValue(undefined),
					store: vi.fn(),
					delete: vi.fn(),
				},
			} as any

			const contextProxy = new ContextProxy(mockContext)

			// Mock the values to simulate user having openrouter provider configured
			vi.spyOn(contextProxy, "getValues").mockReturnValue({
				apiProvider: "openrouter",
				openRouterApiKey: userKey,
			})

			const settings = contextProxy.getProviderSettings()

			// Should have the environment override applied
			expect(settings.openRouterApiKey).toBe(envKey)
		})

		test("should apply environment override for kilocode provider", () => {
			const envKey = "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"
			const userKey = "sk-or-v1-user123456789012345678901234567890123456789012345678901234"

			// Set environment override
			process.env.OPENROUTER_API_KEY_OVERRIDE = envKey

			// Mock VSCode context
			const mockContext = {
				globalState: {
					get: vi.fn().mockReturnValue(undefined),
					update: vi.fn(),
				},
				secrets: {
					get: vi.fn().mockResolvedValue(undefined),
					store: vi.fn(),
					delete: vi.fn(),
				},
			} as any

			const contextProxy = new ContextProxy(mockContext)

			// Mock the values to simulate user having kilocode provider configured
			vi.spyOn(contextProxy, "getValues").mockReturnValue({
				apiProvider: "kilocode",
				openRouterApiKey: userKey,
				kilocodeToken: "mock-token",
			})

			const settings = contextProxy.getProviderSettings()

			// Should have the environment override applied
			expect(settings.openRouterApiKey).toBe(envKey)
		})

		test("should not apply environment override for other providers", () => {
			const envKey = "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"
			const userKey = "sk-test-key"

			// Set environment override
			process.env.OPENROUTER_API_KEY_OVERRIDE = envKey

			// Mock VSCode context
			const mockContext = {
				globalState: {
					get: vi.fn().mockReturnValue(undefined),
					update: vi.fn(),
				},
				secrets: {
					get: vi.fn().mockResolvedValue(undefined),
					store: vi.fn(),
					delete: vi.fn(),
				},
			} as any

			const contextProxy = new ContextProxy(mockContext)

			// Mock the values for anthropic provider (should not be affected)
			vi.spyOn(contextProxy, "getValues").mockReturnValue({
				apiProvider: "anthropic",
				apiKey: userKey,
			})

			const settings = contextProxy.getProviderSettings()

			// Should NOT have the environment override applied
			expect(settings.apiKey).toBe(userKey)
			expect(settings.openRouterApiKey).toBeUndefined()
		})
	})
})
