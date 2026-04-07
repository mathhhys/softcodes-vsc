// kilocode_change new file

import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import type { Mock } from "vitest"
import { GeminiCliHandler } from "../gemini-cli"
import { BaseProvider } from "../base-provider"
import { geminiCliDefaultModelId, geminiCliModels } from "@roo-code/types"
import * as fs from "fs/promises"
import axios from "axios"

vi.mock("fs/promises")
vi.mock("axios")
vi.mock("google-auth-library", () => ({
	OAuth2Client: vi.fn().mockImplementation(() => ({
		setCredentials: vi.fn(),
		request: vi.fn(),
	})),
	CodeChallengeMethod: { S256: "S256" },
}))

type MockSecretStorage = {
	get: Mock
	store: Mock
	delete: Mock
}

describe("GeminiCliHandler", () => {
	let handler: GeminiCliHandler
	let mockSecretStorage: MockSecretStorage
	const mockCredentials = {
		access_token: "test-access-token",
		refresh_token: "test-refresh-token",
		token_type: "Bearer",
		expiry_date: Date.now() + 3600 * 1000,
	}

	beforeEach(() => {
		vi.clearAllMocks()

		const mockWorkspaceConfiguration = {
			get: vi.fn().mockReturnValue("test-client-id"),
			has: vi.fn().mockReturnValue(true),
			inspect: vi.fn(),
			update: vi.fn(),
		}

		;(vscode.workspace as any).getConfiguration = vi.fn().mockReturnValue(mockWorkspaceConfiguration)

		mockSecretStorage = {
			get: vi.fn(),
			store: vi.fn(),
			delete: vi.fn(),
		} as MockSecretStorage
		;(vscode as any).secretStorage = mockSecretStorage

		vi.mocked(mockSecretStorage.get).mockResolvedValue(JSON.stringify(mockCredentials))

		// Set up default mock
		vi.mocked(axios.post).mockResolvedValue({
			data: {},
		})

		handler = new GeminiCliHandler({
			apiModelId: geminiCliDefaultModelId,
		})

		// Set up default mock for OAuth2Client request
		handler["authClient"].request = vi.fn().mockResolvedValue({
			data: {},
		})

		// Mock the discoverProjectId to avoid real API calls in tests
		handler["projectId"] = "test-project-123"
		vi.spyOn(handler as any, "discoverProjectId").mockResolvedValue("test-project-123")
	})

	describe("constructor", () => {
		it("should initialize with provided config", () => {
			expect(handler["options"].apiModelId).toBe(geminiCliDefaultModelId)
		})
	})

	describe("getModel", () => {
		it("should return correct model info", () => {
			const modelInfo = handler.getModel()
			expect(modelInfo.id).toBe(geminiCliDefaultModelId)
			expect(modelInfo.info).toBeDefined()
			expect(modelInfo.info.inputPrice).toBe(0)
			expect(modelInfo.info.outputPrice).toBe(0)
		})

		it("should return default model if invalid model specified", () => {
			const invalidHandler = new GeminiCliHandler({
				apiModelId: "invalid-model",
			})
			const modelInfo = invalidHandler.getModel()
			expect(modelInfo.id).toBe(geminiCliDefaultModelId)
		})

		it("should handle :thinking suffix", () => {
			const thinkingHandler = new GeminiCliHandler({
				apiModelId: "gemini-2.5-pro:thinking",
			})
			const modelInfo = thinkingHandler.getModel()
			// The :thinking suffix should be removed from the ID
			expect(modelInfo.id).toBe("gemini-2.5-pro")
			// But the model should still have reasoning support
			expect(modelInfo.info.supportsReasoningBudget).toBe(true)
			expect(modelInfo.info.requiredReasoningBudget).toBe(true)
		})
	})

	describe("OAuth authentication", () => {
		it("should load OAuth credentials from default path", async () => {
			vi.mocked(mockSecretStorage.get).mockResolvedValueOnce(JSON.stringify(mockCredentials))
			await (handler as any).loadOAuthCredentials()
			expect(vi.mocked(mockSecretStorage.get)).toHaveBeenCalledWith("gemini.oauth")
		})

		it("should refresh expired tokens", async () => {
			const expiredCredentials: typeof mockCredentials = {
				...mockCredentials,
				expiry_date: Date.now() - 1000, // Expired
			}
			vi.mocked(mockSecretStorage.get).mockResolvedValueOnce(JSON.stringify(expiredCredentials))

			const mockRefreshResponse = {
				access_token: "refreshed-access-token",
				token_type: "Bearer",
				expires_in: 3600,
			}
			vi.mocked(axios.post).mockResolvedValueOnce({ data: mockRefreshResponse })

			await (handler as any).ensureAuthenticated()

			expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
				"https://oauth2.googleapis.com/token",
				expect.any(URLSearchParams),
				expect.any(Object),
			)
			const calledParams = vi.mocked(axios.post).mock.calls[0][1] as URLSearchParams
			expect(calledParams.get("refresh_token")).toBe("test-refresh-token")
			expect(vi.mocked(mockSecretStorage.store)).toHaveBeenCalledWith(
				"gemini.oauth",
				expect.stringContaining("refreshed-access-token"),
			)
		})

		it("should return null if no credentials found", async () => {
			vi.mocked(mockSecretStorage.get).mockResolvedValueOnce(undefined)

			const result = await (handler as any).loadOAuthCredentials()
			expect(result).toBeNull()
		})
	})

	describe("project ID discovery", () => {
		it("should use provided project ID", async () => {
			const customHandler = new GeminiCliHandler({
				apiModelId: geminiCliDefaultModelId,
				geminiCliProjectId: "custom-project",
			})

			const projectId = await customHandler["discoverProjectId"]()
			expect(projectId).toBe("custom-project")
			expect(customHandler["projectId"]).toBe("custom-project")
		})

		it("should discover project ID through API", async () => {
			// Create a new handler without the mocked discoverProjectId
			const testHandler = new GeminiCliHandler({
				apiModelId: geminiCliDefaultModelId,
			})
			testHandler["authClient"].request = vi.fn().mockResolvedValue({
				data: {},
			})

			// Mock the callEndpoint method
			testHandler["callEndpoint"] = vi.fn().mockResolvedValueOnce({
				cloudaicompanionProject: "discovered-project-123",
			})

			const projectId = await testHandler["discoverProjectId"]()
			expect(projectId).toBe("discovered-project-123")
			expect(testHandler["projectId"]).toBe("discovered-project-123")
		})

		it("should onboard user if no existing project", async () => {
			// Create a new handler without the mocked discoverProjectId
			const testHandler = new GeminiCliHandler({
				apiModelId: geminiCliDefaultModelId,
			})
			testHandler["authClient"].request = vi.fn().mockResolvedValue({
				data: {},
			})

			// Mock the callEndpoint method
			testHandler["callEndpoint"] = vi
				.fn()
				.mockResolvedValueOnce({
					allowedTiers: [{ id: "free-tier", isDefault: true }],
				})
				.mockResolvedValueOnce({
					done: false,
				})
				.mockResolvedValueOnce({
					done: true,
					response: {
						cloudaicompanionProject: {
							id: "onboarded-project-456",
						},
					},
				})

			const projectId = await testHandler["discoverProjectId"]()
			expect(projectId).toBe("onboarded-project-456")
			expect(testHandler["projectId"]).toBe("onboarded-project-456")
			expect(testHandler["callEndpoint"]).toHaveBeenCalledTimes(3)
		})
	})

	describe("completePrompt", () => {
		it("should complete prompt successfully", async () => {
			handler["authClient"].request = vi.fn().mockResolvedValue({
				data: {
					candidates: [
						{
							content: {
								parts: [{ text: "Test response" }],
							},
						},
					],
				},
			})

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")
		})

		it("should handle empty response", async () => {
			handler["authClient"].request = vi.fn().mockResolvedValue({
				data: {
					candidates: [],
				},
			})

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})

		it("should filter out thinking parts", async () => {
			handler["authClient"].request = vi.fn().mockResolvedValue({
				data: {
					candidates: [
						{
							content: {
								parts: [{ text: "Thinking...", thought: true }, { text: "Actual response" }],
							},
						},
					],
				},
			})

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Actual response")
		})

		it("should handle API errors", async () => {
			;(handler as any).ensureAuthenticated = vi.fn().mockResolvedValue(undefined)
			handler["authClient"].request = vi.fn().mockRejectedValue(new Error("API Error"))

			await expect(handler.completePrompt("Test prompt")).rejects.toThrow(/completionError/)
		})
	})

	describe("createMessage streaming", () => {
		it("should handle streaming response with reasoning", async () => {
			;(handler as any).ensureAuthenticated = vi.fn().mockResolvedValue(undefined)
			;(handler as any).discoverProjectId = vi.fn().mockResolvedValue("test-project")

			// Create a mock Node.js readable stream
			const { Readable } = require("stream")
			const mockStream = new Readable({
				read() {
					this.push('data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}}\n\n')
					this.push(
						'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"thinking..."}]}}]}}\n\n',
					)
					this.push(
						'data: {"response":{"candidates":[{"content":{"parts":[{"text":" world"}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}}\n\n',
					)
					this.push("data: [DONE]\n\n")
					this.push(null) // End the stream
				},
			})

			handler["authClient"].request = vi.fn().mockResolvedValue({
				data: mockStream,
			})

			const stream = handler.createMessage("System", [])
			const chunks: any[] = []

			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Check we got the expected chunks
			expect(chunks).toHaveLength(4) // 2 text chunks, 1 reasoning chunk, 1 usage chunk

			// Filter out only text chunks (not reasoning chunks)
			const textChunks = chunks.filter((c) => c.type === "text").map((c) => c.text)
			expect(textChunks).toEqual(["Hello", " world"])

			// Check reasoning chunk
			const reasoningChunks = chunks.filter((c) => c.type === "reasoning")
			expect(reasoningChunks).toHaveLength(1)
			expect(reasoningChunks[0].text).toBe("thinking...")

			// Check usage chunk
			const usageChunks = chunks.filter((c) => c.type === "usage")
			expect(usageChunks).toHaveLength(1)
			expect(usageChunks[0]).toMatchObject({
				type: "usage",
				inputTokens: 10,
				outputTokens: 5,
				totalCost: 0,
			})
		})

		it("should handle rate limit errors", async () => {
			;(handler as any).ensureAuthenticated = vi.fn().mockResolvedValue(undefined)
			handler["authClient"].request = vi.fn().mockRejectedValue({
				response: {
					status: 429,
					data: { error: { message: "Rate limit exceeded" } },
				},
			})

			const stream = handler.createMessage("System", [])

			await expect(async () => {
				for await (const _chunk of stream) {
					// Should throw before yielding
				}
			}).rejects.toThrow(/rateLimitExceeded/)
		})
	})

	describe("countTokens", () => {
		it("should fall back to base provider implementation", async () => {
			// Mock the base provider's countTokens method
			vi.spyOn(BaseProvider.prototype, "countTokens").mockResolvedValue(4)

			const content = [{ type: "text", text: "Hello world" }] as any
			const tokenCount = await handler.countTokens(content)

			// Should return a number (tiktoken fallback)
			expect(typeof tokenCount).toBe("number")
			expect(tokenCount).toBe(4)
		})
	})
})
