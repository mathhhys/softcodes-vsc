import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { KilocodeOpenrouterHandler } from "../kilocode-openrouter"
import { creditManager } from "../../../services/creditManager"
import * as enhancedCreditSystem from "../../../services/enhancedCreditSystem"
import { ApiHandlerOptions } from "../../../shared/api"
import OpenAI from "openai"

// Mock dependencies
vi.mock("../../../services/creditManager", () => ({
	creditManager: {
		checkSufficientCredits: vi.fn(),
		deductFromActual: vi.fn(),
	},
}))

vi.mock("../../../services/enhancedCreditSystem", () => ({
	getGlobalEnhancedCreditSystem: vi.fn(),
}))

vi.mock("openai", () => {
	return {
		default: vi.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: vi.fn(),
				},
			},
		})),
	}
})

describe("KilocodeOpenrouterHandler", () => {
	let handler: KilocodeOpenrouterHandler
	let mockOptions: ApiHandlerOptions
	let mockEnhancedSystem: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockOptions = {
			apiModelId: "google/gemini-2.5-pro-preview",
			kilocodeToken: "test-token",
			openRouterApiKey: "test-api-key",
		}

		// Mock EnhancedCreditSystem
		mockEnhancedSystem = {
			deductCredits: vi.fn().mockResolvedValue({ success: true }),
		}
		vi.mocked(enhancedCreditSystem.getGlobalEnhancedCreditSystem).mockReturnValue(mockEnhancedSystem)

		// Mock creditManager
		vi.mocked(creditManager.checkSufficientCredits).mockResolvedValue({
			sufficient: true,
			currentCredits: 100,
			requiredCredits: 0.001,
		})

		handler = new KilocodeOpenrouterHandler(mockOptions)
	})

	describe("createMessage", () => {
		it("should check credits before making request", async () => {
			// Mock OpenAI response
			const mockCreate = vi.fn().mockResolvedValue({
				[Symbol.asyncIterator]: function* () {
					yield { choices: [{ delta: { content: "Hello" } }] }
				},
			})

			vi.mocked(OpenAI).mockImplementation(
				() =>
					({
						chat: {
							completions: {
								create: mockCreate,
							},
						},
					}) as any,
			)

			const stream = handler.createMessage("system prompt", [])
			for await (const chunk of stream) {
				// Consume stream
			}

			expect(creditManager.checkSufficientCredits).toHaveBeenCalledWith("test-token", 0.001)
		})

		it("should throw error if insufficient credits", async () => {
			vi.mocked(creditManager.checkSufficientCredits).mockResolvedValue({
				sufficient: false,
				currentCredits: 0,
				requiredCredits: 0.001,
			})

			const stream = handler.createMessage("system prompt", [])

			await expect(async () => {
				for await (const chunk of stream) {
					// Consume stream
				}
			}).rejects.toThrow("Insufficient credits")
		})
	})
})

// Re-define the test suite with mocked OpenRouterHandler
describe("KilocodeOpenrouterHandler with mocked parent", () => {
	let handler: KilocodeOpenrouterHandler
	let mockOptions: ApiHandlerOptions
	let mockEnhancedSystem: any

	beforeEach(async () => {
		vi.clearAllMocks()

		// Mock the OpenRouterHandler class
		const { OpenRouterHandler } = await import("../openrouter")
		vi.mock("../openrouter", () => {
			return {
				OpenRouterHandler: class {
					constructor(options: any) {
						;(this as any).options = options
					}
					async *createMessage(system: string, messages: any[], metadata: any) {
						yield { type: "text", text: "Hello" }
						yield {
							type: "usage",
							inputTokens: 10,
							outputTokens: 5,
							totalCost: 0.0005,
						}
					}
					getModel() {
						return { id: "test-model", info: {} }
					}
					fetchModel() {
						return Promise.resolve({})
					}
					customRequestOptions() {
						return undefined
					}
				},
			}
		})

		mockOptions = {
			apiModelId: "google/gemini-2.5-pro-preview",
			kilocodeToken: "test-token",
			openRouterApiKey: "test-api-key",
		}

		mockEnhancedSystem = {
			deductCredits: vi.fn().mockResolvedValue({ success: true }),
		}
		vi.mocked(enhancedCreditSystem.getGlobalEnhancedCreditSystem).mockReturnValue(mockEnhancedSystem)

		vi.mocked(creditManager.checkSufficientCredits).mockResolvedValue({
			sufficient: true,
			currentCredits: 100,
			requiredCredits: 0.001,
		})

		// Re-import handler to use mocked parent
		const { KilocodeOpenrouterHandler: ReImportedHandler } = await import("../kilocode-openrouter")
		handler = new ReImportedHandler(mockOptions)
	})

	it("should deduct credits using resilient system when usage chunk is received", async () => {
		const stream = handler.createMessage("system prompt", [])

		for await (const chunk of stream) {
			// Consume stream
		}

		// Verify resilient deduction was called
		expect(mockEnhancedSystem.deductCredits).toHaveBeenCalledWith(
			"API_USAGE",
			0.0005,
			expect.stringContaining("API Usage"),
			expect.objectContaining({
				operationType: "api_actual_usage",
				apiProvider: "kilocode-openrouter",
				inputTokens: 10,
				outputTokens: 5,
				isActualUsage: true,
			}),
		)
	})

	it("should fallback to creditManager if resilient system fails/throws", async () => {
		// Mock resilient system throwing error
		vi.mocked(enhancedCreditSystem.getGlobalEnhancedCreditSystem).mockImplementation(() => {
			throw new Error("System not initialized")
		})

		// Mock creditManager fallback
		vi.mocked(creditManager.deductFromActual).mockResolvedValue({ success: true } as any)

		const stream = handler.createMessage("system prompt", [])

		for await (const chunk of stream) {
			// Consume stream
		}

		// Verify fallback was called
		expect(creditManager.deductFromActual).toHaveBeenCalledWith(
			"test-token",
			0.0005,
			expect.stringContaining("API Usage"),
			expect.objectContaining({
				operationType: "api_actual_usage",
				apiProvider: "kilocode-openrouter",
				inputTokens: 10,
				outputTokens: 5,
			}),
		)
	})
})
