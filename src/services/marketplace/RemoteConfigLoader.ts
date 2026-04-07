import axios from "axios"
import * as yaml from "yaml"
import { z } from "zod"
import * as vscode from "vscode"
import type { MarketplaceItem, MarketplaceItemType } from "@roo-code/types"
import { modeMarketplaceItemSchema, mcpMarketplaceItemSchema } from "@roo-code/types"
import { getKiloBaseUriFromToken } from "./utils/getKiloBaseUriFromToken"

// Response schemas for YAML/JSON API responses
const modeMarketplaceResponse = z.object({
	items: z.array(modeMarketplaceItemSchema),
})

const mcpMarketplaceResponse = z.object({
	items: z.array(mcpMarketplaceItemSchema),
})

type McpMarketplaceItem = z.infer<typeof mcpMarketplaceItemSchema>
type McpMarketplaceParameters = McpMarketplaceItem["parameters"]
type McpMarketplaceContent = McpMarketplaceItem["content"]

export let mcpOutputChannel: vscode.OutputChannel | undefined

export function getMcpLogger(): vscode.OutputChannel {
	if (!mcpOutputChannel) {
		try {
			// Check if we're in a test environment
			if (typeof vscode.window === "undefined" || !vscode.window.createOutputChannel) {
				// Return a mock logger for test environment
				return {
					appendLine: (value: string) => console.log(`[MCP TEST] ${value}`),
					append: (value: string) => console.log(`[MCP TEST] ${value}`),
					clear: () => {},
					show: () => {},
					hide: () => {},
					dispose: () => {},
				} as any
			}
			mcpOutputChannel = vscode.window.createOutputChannel("Softcodes MCP")
		} catch (error) {
			// Fallback to console logging if VSCode API fails
			return {
				appendLine: (value: string) => console.log(`[MCP FALLBACK] ${value}`),
				append: (value: string) => console.log(`[MCP FALLBACK] ${value}`),
				clear: () => {},
				show: () => {},
				hide: () => {},
				dispose: () => {},
			} as any
		}
	}
	return mcpOutputChannel
}

export class RemoteConfigLoader {
	private context: vscode.ExtensionContext
	private _apiBaseUrlPromise: Promise<string> | null = null
	private cache: Map<string, { data: MarketplaceItem[]; timestamp: number }> = new Map()
	private cacheDuration = 5 * 60 * 1000 // 5 minutes

	constructor(context: vscode.ExtensionContext) {
		this.context = context
		getMcpLogger().appendLine(`[Softcodes MCP] Initialized (using Kilocode backend with lazy token-based URL)`)
	}

	private async getApiBaseUrl(): Promise<string> {
		if (!this._apiBaseUrlPromise) {
			this._apiBaseUrlPromise = (async () => {
				try {
					const token = await this.context.secrets.get("softcodes.clerkToken")
					getMcpLogger().appendLine(`[Softcodes MCP] Retrieved token: ${token ? "present" : "missing"}`)

					const baseUrl = getKiloBaseUriFromToken(token)
					getMcpLogger().appendLine(`[Softcodes MCP] Loaded base URL: ${baseUrl} (from token: ${!!token})`)

					// Validate the base URL
					if (!baseUrl || !baseUrl.startsWith("http")) {
						getMcpLogger().appendLine(`[Softcodes MCP] WARNING: Invalid base URL generated: ${baseUrl}`)
					}

					return baseUrl
				} catch (error) {
					getMcpLogger().appendLine(
						`[Softcodes MCP] ERROR in getApiBaseUrl: ${error instanceof Error ? error.message : String(error)}`,
					)
					throw error
				}
			})()
		}
		return this._apiBaseUrlPromise
	}

	private async fetchMarketplaceData<T>(endpoints: string[], schema: z.ZodType<T>): Promise<T> {
		let lastError: unknown

		getMcpLogger().appendLine(`[Softcodes MCP] fetchMarketplaceData called with ${endpoints.length} endpoints`)

		for (const endpoint of endpoints) {
			try {
				getMcpLogger().appendLine(`[Softcodes MCP] Attempting to fetch from endpoint: ${endpoint}`)
				const response = await this.fetchWithRetry<unknown>(endpoint)

				getMcpLogger().appendLine(`[Softcodes MCP] Raw response type: ${typeof response}`)
				getMcpLogger().appendLine(
					`[Softcodes MCP] Raw response preview: ${typeof response === "string" ? response.substring(0, 200) : JSON.stringify(response).substring(0, 200)}`,
				)

				const parsedData =
					typeof response === "string"
						? yaml.parse(response)
						: response && typeof response === "object"
							? response
							: null

				if (!parsedData) {
					throw new Error("Marketplace response format not supported")
				}

				getMcpLogger().appendLine(`[Softcodes MCP] Parsed data successfully, attempting schema validation`)
				const result = schema.parse(parsedData)
				getMcpLogger().appendLine(`[Softcodes MCP] Schema validation successful`)
				return result
			} catch (error) {
				lastError = error
				getMcpLogger().appendLine(
					`[Softcodes MCP] Fetch failed for ${endpoint}: ${error instanceof Error ? error.message : String(error)}`,
				)
				if (error instanceof z.ZodError) {
					getMcpLogger().appendLine(
						`[Softcodes MCP] Schema validation errors: ${JSON.stringify(error.errors)}`,
					)
				}
			}
		}

		throw lastError instanceof Error ? lastError : new Error("Failed to fetch marketplace data")
	}

	async loadAllItems(): Promise<MarketplaceItem[]> {
		const items: MarketplaceItem[] = []

		getMcpLogger().appendLine("[Softcodes MCP] Starting loadAllItems...")

		try {
			// Check if we have a valid token first
			const token = await this.context.secrets.get("softcodes.clerkToken")
			if (!token) {
				getMcpLogger().appendLine(
					"[Softcodes MCP] WARNING: No authentication token found. Marketplace may be limited.",
				)
				// Still try to load items with default URL
			}

			const [modes, mcps] = await Promise.all([this.fetchModes(), this.fetchMcps()])
			items.push(...modes, ...mcps)

			getMcpLogger().appendLine(`[Softcodes MCP] Successfully loaded ${items.length} total items`)

			// Provide user feedback if no items were found
			if (items.length === 0) {
				getMcpLogger().appendLine("[Softcodes MCP] No marketplace items found. This could indicate:")
				getMcpLogger().appendLine("  - Authentication issues (check your Softcodes account)")
				getMcpLogger().appendLine("  - Network connectivity problems")
				getMcpLogger().appendLine("  - Marketplace server temporarily unavailable")
				getMcpLogger().appendLine("  - No items currently available in the marketplace")
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			getMcpLogger().appendLine(`[Softcodes MCP] CRITICAL: Failed to load marketplace items: ${errorMessage}`)

			// Provide specific guidance based on error type
			if (errorMessage.includes("401") || errorMessage.includes("403")) {
				getMcpLogger().appendLine(
					"[Softcodes MCP] AUTHENTICATION ERROR: Please check your Softcodes account settings.",
				)
				// Show user-friendly message
				vscode.window
					.showWarningMessage(
						"Marketplace authentication failed. Please check your Softcodes account settings.",
						"Open Settings",
					)
					.then((selection) => {
						if (selection === "Open Settings") {
							vscode.commands.executeCommand("workbench.action.openSettings", "softcodes")
						}
					})
			} else if (errorMessage.includes("ENOTFOUND") || errorMessage.includes("ECONNREFUSED")) {
				getMcpLogger().appendLine("[Softcodes MCP] NETWORK ERROR: Please check your internet connection.")
				vscode.window.showWarningMessage("Marketplace unavailable – please check your internet connection.")
			} else if (errorMessage.includes("timeout")) {
				getMcpLogger().appendLine("[Softcodes MCP] TIMEOUT ERROR: The marketplace server is not responding.")
				vscode.window.showWarningMessage("Marketplace server is not responding – please try again later.")
			} else {
				getMcpLogger().appendLine("[Softcodes MCP] UNKNOWN ERROR: An unexpected error occurred.")
				vscode.window.showWarningMessage("Marketplace temporarily unavailable – using local configurations.")
			}

			// Return empty array to prevent UI errors
			return []
		}

		return items
	}

	private async fetchModes(): Promise<MarketplaceItem[]> {
		const cacheKey = "modes"
		const cached = this.getFromCache(cacheKey)
		if (cached) {
			getMcpLogger().appendLine(`[Softcodes MCP] Using cached modes (${cached.length} items)`)
			return cached
		}

		try {
			getMcpLogger().appendLine("[Softcodes MCP] Fetching modes from remote marketplace...")
			const baseUrl = await this.getApiBaseUrl()
			getMcpLogger().appendLine(`[Softcodes MCP] Using base URL: ${baseUrl} for modes fetch`)

			const validated = await this.fetchMarketplaceData(
				[
					`${baseUrl}/api/marketplace/modes`,
					"/api/marketplace/modes", // Fallback for relative paths
				],
				modeMarketplaceResponse,
			)

			const items: MarketplaceItem[] = validated.items.map((item) => ({
				type: "mode" as const,
				...item,
			}))

			getMcpLogger().appendLine(`[Softcodes MCP] Successfully loaded ${items.length} modes`)
			this.setCache(cacheKey, items)
			return items
		} catch (error) {
			getMcpLogger().appendLine(
				`[Softcodes MCP] Failed to fetch modes: ${error instanceof Error ? error.message : String(error)}. Using fallback (empty).`,
			)
			vscode.window.showWarningMessage(
				"Softcodes marketplace unavailable – modes loaded from cache or local config.",
			)
			return []
		}
	}

	private async fetchMcps(): Promise<MarketplaceItem[]> {
		const cacheKey = "mcps"
		const cached = this.getFromCache(cacheKey)
		if (cached) {
			getMcpLogger().appendLine(`[Softcodes MCP] Using cached MCPs (${cached.length} items)`)
			return cached
		}

		try {
			getMcpLogger().appendLine("[Softcodes MCP] Fetching MCPs from remote marketplace...")
			const baseUrl = await this.getApiBaseUrl()
			getMcpLogger().appendLine(`[Softcodes MCP] Using base URL: ${baseUrl} for MCPs fetch`)

			const validated = await this.fetchMarketplaceData(
				[
					`${baseUrl}/api/marketplace/mcps`,
					"/api/marketplace/mcps", // Fallback for relative paths
				],
				mcpMarketplaceResponse,
			)

			const items: MarketplaceItem[] = validated.items.map((item) => {
				const normalizedParameters = item.parameters
					? (item.parameters.map((parameter) => ({
							...parameter,
							optional: parameter.optional ?? false,
						})) as McpMarketplaceParameters)
					: undefined

				const normalizedContent = Array.isArray(item.content)
					? (item.content.map((entry) => {
							if (typeof entry !== "object" || entry === null) {
								return entry
							}
							return {
								...entry,
								parameters: entry.parameters
									? entry.parameters.map((parameter) => ({
											...parameter,
											optional: parameter.optional ?? false,
										}))
									: undefined,
							}
						}) as McpMarketplaceContent)
					: item.content

				return {
					type: "mcp" as const,
					...item,
					parameters: normalizedParameters,
					content: normalizedContent,
				}
			})

			getMcpLogger().appendLine(`[Softcodes MCP] Successfully loaded ${items.length} MCPs`)
			this.setCache(cacheKey, items)
			return items
		} catch (error) {
			getMcpLogger().appendLine(
				`[Softcodes MCP] Failed to fetch MCPs: ${error instanceof Error ? error.message : String(error)}. Using fallback (empty).`,
			)
			vscode.window.showWarningMessage("Softcodes marketplace unavailable – using local config.")
			return []
		}
	}

	private async fetchWithRetry<T>(url: string, maxRetries = 3): Promise<T> {
		let lastError: any // Use any to access AxiosError properties

		getMcpLogger().appendLine(`[Softcodes MCP] Starting fetchWithRetry for URL: ${url}`)

		for (let i = 0; i < maxRetries; i++) {
			try {
				getMcpLogger().appendLine(`[Softcodes MCP] Attempt ${i + 1}/${maxRetries} for ${url}`)
				const response = await axios.get(url, {
					timeout: 10000, // 10 second timeout
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
					},
					transformResponse: [
						(data) => data, // Preserve raw response for YAML parsing
					],
				})
				getMcpLogger().appendLine(`[Softcodes MCP] Success on attempt ${i + 1} for ${url}`)
				return response.data as T
			} catch (error) {
				lastError = error
				const errorMsg = error instanceof Error ? error.message : String(error)
				getMcpLogger().appendLine(`[Softcodes MCP] Retry ${i + 1}/${maxRetries} failed for ${url}: ${errorMsg}`)

				if (error instanceof axios.AxiosError) {
					getMcpLogger().appendLine(
						`[Softcodes MCP] AxiosError details - Code: ${error.code}, Status: ${error.response?.status}, StatusText: ${error.response?.statusText}`,
					)

					if (error.code === "ENOTFOUND") {
						getMcpLogger().appendLine(
							`[Softcodes MCP] DNS resolution failed for ${url} - likely invalid domain.`,
						)
						throw new Error(
							`Network error: Unable to resolve host (ENOTFOUND) for marketplace endpoint. Check configuration.`,
						)
					}
					if (error.code === "ECONNREFUSED") {
						getMcpLogger().appendLine(`[Softcodes MCP] Connection refused to ${url} - server may be down.`)
						throw new Error(`Network error: Connection refused to marketplace server.`)
					}
					if (error.response?.status === 401) {
						getMcpLogger().appendLine(
							`[Softcodes MCP] Authentication failed for ${url} - token may be invalid or expired.`,
						)
						throw new Error(`Authentication error: Invalid or expired token for marketplace access.`)
					}
					if (error.response?.status === 404) {
						getMcpLogger().appendLine(
							`[Softcodes MCP] Endpoint not found for ${url} - API structure may have changed.`,
						)
						throw new Error(`API error: Marketplace endpoint not found (404).`)
					}
				}

				if (i < maxRetries - 1) {
					// Exponential backoff: 1s, 2s, 4s
					const delay = Math.pow(2, i) * 1000
					getMcpLogger().appendLine(`[Softcodes MCP] Waiting ${delay}ms before next retry...`)
					await new Promise((resolve) => setTimeout(resolve, delay))
				}
			}
		}

		const finalError = lastError instanceof Error ? lastError : new Error("Unknown fetch error")
		getMcpLogger().appendLine(`[Softcodes MCP] All retries exhausted for ${url}: ${finalError.message}`)
		throw finalError
	}

	async getItem(id: string, type: MarketplaceItemType): Promise<MarketplaceItem | null> {
		const items = await this.loadAllItems()
		return items.find((item) => item.id === id && item.type === type) || null
	}

	private getFromCache(key: string): MarketplaceItem[] | null {
		const cached = this.cache.get(key)
		if (!cached) return null

		const now = Date.now()
		if (now - cached.timestamp > this.cacheDuration) {
			this.cache.delete(key)
			return null
		}

		return cached.data
	}

	private setCache(key: string, data: MarketplaceItem[]): void {
		this.cache.set(key, {
			data,
			timestamp: Date.now(),
		})
	}

	clearCache(): void {
		this.cache.clear()
	}
}
