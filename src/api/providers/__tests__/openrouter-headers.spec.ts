import { vitest, describe, it, expect, beforeEach } from "vitest"
import OpenAI from "openai"
import { OpenRouterHandler } from "../openrouter"
import { ApiHandlerOptions } from "../../../shared/api"

// Mock vscode
vitest.mock("vscode", () => ({
	window: {
		showErrorMessage: vitest.fn(),
	},
}))

// Mock dependencies
vitest.mock("openai")
vitest.mock("../fetchers/modelCache", () => ({
	getModels: vitest.fn().mockImplementation(() => {
		return Promise.resolve({
			"anthropic/claude-sonnet-4": {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3,
				outputPrice: 15,
				description: "Claude 3.7 Sonnet",
			},
		})
	}),
}))

describe("OpenRouterHandler Headers", () => {
	const mockOptions: ApiHandlerOptions = {
		openRouterApiKey: "test-key",
		openRouterModelId: "anthropic/claude-sonnet-4",
	}

	beforeEach(() => {
		vitest.clearAllMocks()
	})

	it("captures and yields response headers", async () => {
		const handler = new OpenRouterHandler(mockOptions)

		const mockHeaders = new Map([
			["x-ratelimit-limit-requests", "100"],
			["x-ratelimit-remaining-requests", "99"],
			["x-openrouter-caching", "enabled"],
		])

		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield {
					choices: [{ delta: { content: "test response" } }],
				}
			},
		}

		const mockResponse = {
			status: 200,
			headers: mockHeaders,
		}

		const mockApiPromise = Promise.resolve(mockStream) as any
		mockApiPromise.asResponse = vitest.fn().mockResolvedValue(mockResponse)

		const mockCreate = vitest.fn().mockReturnValue(mockApiPromise)

		;(OpenAI as any).prototype.chat = {
			completions: { create: mockCreate },
		} as any

		const generator = handler.createMessage("test system", [])
		const chunks = []

		for await (const chunk of generator) {
			chunks.push(chunk)
		}

		// Verify headers chunk is yielded first
		expect(chunks[0]).toEqual({
			type: "headers",
			headers: {
				"x-ratelimit-limit-requests": "100",
				"x-ratelimit-remaining-requests": "99",
				"x-openrouter-caching": "enabled",
			},
		})

		// Verify subsequent chunks
		expect(chunks[1]).toEqual({ type: "text", text: "test response" })

		// Verify asResponse was called
		expect(mockApiPromise.asResponse).toHaveBeenCalled()
	})
})
