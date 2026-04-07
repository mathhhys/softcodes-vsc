// npx vitest services/marketplace/__tests__/RemoteConfigLoader.spec.ts

import * as vscode from "vscode"
import axios from "axios"
import { RemoteConfigLoader } from "../RemoteConfigLoader"
import { getKiloBaseUriFromToken } from "../utils/getKiloBaseUriFromToken"
import type { MarketplaceItemType } from "@roo-code/types"

// Mock axios
vi.mock("axios")
const mockedAxios = axios as any

// Mock vscode for warnings, output channel, and ExtensionContext
vi.mock("vscode")
const mockedVSCode = vscode as any
const mockedWindow = {
	showWarningMessage: vi.fn(),
	createOutputChannel: vi.fn(() => ({
		appendLine: vi.fn(),
	})),
}
mockedVSCode.window = mockedWindow

const mockContext = {
	secrets: {
		get: vi.fn(),
	},
} as any

// Mock getKiloBaseUriFromToken
vi.mock("../utils/getKiloBaseUriFromToken", () => ({
	getKiloBaseUriFromToken: vi.fn(),
}))

// Mock the cloud config
vi.mock("@roo-code/cloud", () => ({
	getRooCodeApiUrl: () => "https://test.api.com",
}))

describe("RemoteConfigLoader", () => {
	let loader: RemoteConfigLoader
	let mockToken: string | undefined

	beforeEach(() => {
		// Clear all mocks first
		vi.clearAllMocks()

		mockToken = "mock.clerk.token"
		mockContext.secrets.get.mockResolvedValue(mockToken)
		;(getKiloBaseUriFromToken as any).mockReturnValue("https://api.kilocode.ai")

		// Create loader after mocks are set up
		loader = new RemoteConfigLoader(mockContext)

		// Clear any existing cache
		loader.clearCache()

		// Reset specific mocks
		mockedWindow.createOutputChannel.mockClear()
		mockedWindow.showWarningMessage.mockClear()
		mockContext.secrets.get.mockClear()
		;(getKiloBaseUriFromToken as any).mockClear()
	})

	describe("loadAllItems", () => {
		it("should fetch and combine modes and MCPs from Kilocode API base URL", async () => {
			const mockModesYaml = `items:
	 - id: "test-mode"
	   name: "Test Mode"
	   description: "A test mode"
	   content: "customModes:\\n  - slug: test\\n    name: Test"`

			const mockMcpsYaml = `items:
	 - id: "test-mcp"
	   name: "Test MCP"
	   description: "A test MCP"
	   url: "https://github.com/test/test-mcp"
	   content: '{"command": "test"}'`

			mockedAxios.get.mockImplementation((url: string) => {
				if (url.includes("/modes")) {
					return Promise.resolve({ data: mockModesYaml })
				}
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			const items = await loader.loadAllItems()

			expect(mockedAxios.get).toHaveBeenCalledTimes(2)
			expect(mockedAxios.get).toHaveBeenCalledWith(
				"https://api.kilocode.ai/api/marketplace/modes",
				expect.objectContaining({
					timeout: 10000,
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
					},
				}),
			)
			expect(mockedAxios.get).toHaveBeenCalledWith(
				"https://api.kilocode.ai/api/marketplace/mcps",
				expect.objectContaining({
					timeout: 10000,
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
					},
				}),
			)

			expect(items).toHaveLength(2)
			expect(items[0]).toEqual({
				type: "mode",
				id: "test-mode",
				name: "Test Mode",
				description: "A test mode",
				content: "customModes:\n  - slug: test\n    name: Test",
			})
			expect(items[1]).toEqual({
				type: "mcp",
				id: "test-mcp",
				name: "Test MCP",
				description: "A test MCP",
				url: "https://github.com/test/test-mcp",
				content: '{"command": "test"}',
			})

			// Verify logging
			const outputChannel = mockedWindow.createOutputChannel.mock.results[0].value
			expect(outputChannel.appendLine).toHaveBeenCalledWith(
				"[Softcodes MCP] Initialized (using Kilocode backend with lazy token-based URL)",
			)
			expect(outputChannel.appendLine).toHaveBeenCalledWith(
				"[Softcodes MCP] Loaded base URL: https://api.kilocode.ai (from token: true)",
			)
			expect(outputChannel.appendLine).toHaveBeenCalledWith(
				"[Softcodes MCP] Fetching modes from remote marketplace...",
			)
			expect(outputChannel.appendLine).toHaveBeenCalledWith("[Softcodes MCP] Successfully loaded 1 modes")
			expect(outputChannel.appendLine).toHaveBeenCalledWith(
				"[Softcodes MCP] Fetching MCPs from remote marketplace...",
			)
			expect(outputChannel.appendLine).toHaveBeenCalledWith("[Softcodes MCP] Successfully loaded 1 MCPs")
		})

		it("should use cache on subsequent calls", async () => {
			const mockModesYaml = `items:
		- id: "test-mode"
		  name: "Test Mode"
		  description: "A test mode"
		  content: "test content"`

			const mockMcpsYaml = `items:
		- id: "test-mcp"
		  name: "Test MCP"
		  description: "A test MCP"
		  url: "https://github.com/test/test-mcp"
		  content: "test content"`

			mockedAxios.get.mockImplementation((url: string) => {
				if (url.includes("/modes")) {
					return Promise.resolve({ data: mockModesYaml })
				}
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			// First call - should hit API
			const items1 = await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(2)

			// Second call - should use cache
			const items2 = await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(2) // Still 2, not 4

			expect(items1).toEqual(items2)
		})

		it("should fallback to empty array on ENOTFOUND error and show warning", async () => {
			const axiosError = new axios.AxiosError("Request failed", "ENOTFOUND")
			axiosError.code = "ENOTFOUND"
			mockedAxios.get.mockRejectedValue(axiosError)

			const items = await loader.loadAllItems()

			expect(items).toEqual([]) // Empty fallback
			expect(mockedWindow.showWarningMessage).toHaveBeenCalledWith(
				"Softcodes marketplace unavailable – using local config.",
			)
			expect(mockedAxios.get).toHaveBeenCalledWith(
				"https://api.kilocode.ai/api/marketplace/modes",
				expect.any(Object),
			)
			expect(mockedAxios.get).toHaveBeenCalledWith(
				"https://api.kilocode.ai/api/marketplace/mcps",
				expect.any(Object),
			)

			// Check logging
			const outputChannel = mockedWindow.createOutputChannel.mock.results[0].value
			expect(outputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("[Softcodes MCP] Failed to fetch MCPs"),
			)
			expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining("ENOTFOUND"))
			expect(outputChannel.appendLine).toHaveBeenCalledWith("[Softcodes MCP] DNS resolution failed")
		})

		it("should handle retry logic on transient errors", async () => {
			let callCount = 0
			mockedAxios.get.mockImplementation(() => {
				callCount++
				if (callCount <= 3) {
					// Fail first 3 calls (across endpoints)
					return Promise.reject(new Error("Transient error"))
				}
				return Promise.resolve({ data: "items: []" })
			})

			const items = await loader.loadAllItems()

			// Expect multiple calls due to retries
			expect(callCount).toBeGreaterThan(3)
			expect(items).toEqual([]) // Since mock returns empty

			// Verify retry logs
			const outputChannel = mockedWindow.createOutputChannel.mock.results[0].value
			expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining("[Softcodes MCP] Retry"))
		})

		it("should use default URL when no token", async () => {
			mockContext.secrets.get
				.mockResolvedValue(undefined)(getKiloBaseUriFromToken as any)
				.mockReturnValue("https://api.kilocode.ai/default")

			const items = await loader.loadAllItems()

			expect(mockedAxios.get).toHaveBeenCalledWith(
				"https://api.kilocode.ai/default/api/marketplace/modes",
				expect.any(Object),
			)

			// Verify log shows no token
			const outputChannel = mockedWindow.createOutputChannel.mock.results[0].value
			expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining("from token: false"))
		})

		it("should retry on network failures", async () => {
			const mockModesYaml = `items:
  - id: "test-mode"
    name: "Test Mode"
    description: "A test mode"
    content: "test content"`

			const mockMcpsYaml = `items: []`

			// Mock modes endpoint to fail twice then succeed
			let modesCallCount = 0
			mockedAxios.get.mockImplementation((url: string) => {
				if (url.includes("/modes")) {
					modesCallCount++
					if (modesCallCount <= 2) {
						return Promise.reject(new Error("Network error"))
					}
					return Promise.resolve({ data: mockModesYaml })
				}
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			const items = await loader.loadAllItems()

			// Should have retried modes endpoint 3 times (2 failures + 1 success)
			expect(modesCallCount).toBe(3)
			expect(items).toHaveLength(1)
			expect(items[0].type).toBe("mode")
		})

		it("should throw error after max retries", async () => {
			mockedAxios.get.mockRejectedValue(new Error("Persistent network error"))

			await expect(loader.loadAllItems()).rejects.toThrow("Persistent network error")

			// Both endpoints will be called with retries
			expect(mockedAxios.get).toHaveBeenCalledWith(
				expect.stringContaining("https://test.softcodes.com/api/marketplace/"),
				expect.any(Object),
			)
			// Verify retry attempts
			expect(mockedAxios.get.mock.calls.length).toBeGreaterThanOrEqual(2)
		})

		it("should handle invalid data gracefully", async () => {
			const invalidModesYaml = `items:
		- id: "invalid-mode"
		  # Missing required fields like name and description`

			const validMcpsYaml = `items:
		- id: "valid-mcp"
		  name: "Valid MCP"
		  description: "A valid MCP"
		  url: "https://github.com/test/test-mcp"
		  content: "test content"`

			mockedAxios.get.mockImplementation((url: string) => {
				if (url.includes("/modes")) {
					return Promise.resolve({ data: invalidModesYaml })
				}
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: validMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			// Should throw validation error for invalid modes (Zod parse error)
			await expect(loader.loadAllItems()).rejects.toThrow()
		})
	})

	describe("getItem", () => {
		it("should find specific item by id and type", async () => {
			const mockModesYaml = `items:
	 - id: "target-mode"
	   name: "Target Mode"
	   description: "The mode we want"
	   content: "test content"`

			const mockMcpsYaml = `items:
	 - id: "target-mcp"
	   name: "Target MCP"
	   description: "The MCP we want"
	   url: "https://github.com/test/test-mcp"
	   content: "test content"`

			mockedAxios.get.mockImplementation((url: string) => {
				if (url.includes("/modes")) {
					return Promise.resolve({ data: mockModesYaml })
				}
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			const modeItem = await loader.getItem("target-mode", "mode" as MarketplaceItemType)
			const mcpItem = await loader.getItem("target-mcp", "mcp" as MarketplaceItemType)
			const notFound = await loader.getItem("nonexistent", "mode" as MarketplaceItemType)

			expect(modeItem).toEqual({
				type: "mode",
				id: "target-mode",
				name: "Target Mode",
				description: "The mode we want",
				content: "test content",
			})

			expect(mcpItem).toEqual({
				type: "mcp",
				id: "target-mcp",
				name: "Target MCP",
				description: "The MCP we want",
				url: "https://github.com/test/test-mcp",
				content: "test content",
			})

			expect(notFound).toBeNull()
		})

		it("should return null if loadAllItems fails due to error", async () => {
			mockedAxios.get.mockRejectedValue(new Error("Load error"))

			const item = await loader.getItem("test", "mode" as MarketplaceItemType)

			expect(item).toBeNull()
		})
	})

	describe("clearCache", () => {
		it("should clear cache and force fresh API calls", async () => {
			const mockModesYaml = `items:
  - id: "test-mode"
    name: "Test Mode"
    description: "A test mode"
    content: "test content"`

			const mockMcpsYaml = `items: []`

			mockedAxios.get.mockImplementation((url: string) => {
				if (url.includes("/modes")) {
					return Promise.resolve({ data: mockModesYaml })
				}
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			// First call
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(2)

			// Second call - should use cache
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(2)

			// Clear cache
			loader.clearCache()

			// Third call - should hit API again
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(4)
		})
	})

	describe("cache expiration", () => {
		it("should expire cache after 5 minutes", async () => {
			const mockModesYaml = `items:
  - id: "test-mode"
    name: "Test Mode"
    description: "A test mode"
    content: "test content"`

			const mockMcpsYaml = `items: []`

			mockedAxios.get.mockImplementation((url: string) => {
				if (url.includes("/modes")) {
					return Promise.resolve({ data: mockModesYaml })
				}
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			// Mock Date.now to control time
			const originalDateNow = Date.now
			let currentTime = 1000000

			Date.now = vi.fn(() => currentTime)

			// First call
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(2)

			// Second call immediately - should use cache
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(2)

			// Advance time by 6 minutes (360,000 ms)
			currentTime += 6 * 60 * 1000

			// Third call - cache should be expired
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(4)

			// Restore original Date.now
			Date.now = originalDateNow
		})
	})
})
