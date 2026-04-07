import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import * as yaml from "yaml"
import { RemoteConfigLoader, getMcpLogger } from "./RemoteConfigLoader"
import { SimpleInstaller } from "./SimpleInstaller"
import type { MarketplaceItem, MarketplaceItemType } from "@roo-code/types"
import { GlobalFileNames } from "../../shared/globalFileNames"
import { ensureSettingsDirectoryExists } from "../../utils/globalContext"
import { t } from "../../i18n"
import { TelemetryService } from "@roo-code/telemetry"

export class MarketplaceManager {
	private configLoader: RemoteConfigLoader
	private installer: SimpleInstaller

	constructor(private readonly context: vscode.ExtensionContext) {
		this.configLoader = new RemoteConfigLoader(context)
		this.installer = new SimpleInstaller(context)
	}

	async getMarketplaceItems(): Promise<{ items: MarketplaceItem[]; errors?: string[] }> {
		try {
			getMcpLogger().appendLine(`[Softcodes MCP] MarketplaceManager.getMarketplaceItems() called`)
			const items = await this.configLoader.loadAllItems()

			getMcpLogger().appendLine(
				`[Softcodes MCP] MarketplaceManager loaded ${items.length} total items (modes + MCPs)`,
			)

			// Log breakdown of item types
			const modeCount = items.filter((item) => item.type === "mode").length
			const mcpCount = items.filter((item) => item.type === "mcp").length
			getMcpLogger().appendLine(`[Softcodes MCP] Item breakdown: ${modeCount} modes, ${mcpCount} MCPs`)

			// Provide helpful user guidance if no items found
			if (items.length === 0) {
				getMcpLogger().appendLine("[Softcodes MCP] No marketplace items available.")

				// Check if we have authentication issues
				try {
					const token = await this.context.secrets.get("softcodes.clerkToken")
					if (!token) {
						getMcpLogger().appendLine("[Softcodes MCP] No authentication token detected.")
						// Show user-friendly message with action
						if (vscode.window && vscode.window.showInformationMessage) {
							vscode.window
								.showInformationMessage(
									"Marketplace requires authentication. Please sign in to your Softcodes account to access marketplace items.",
									"Sign In",
								)
								.then((selection) => {
									if (selection === "Sign In") {
										// Open authentication settings or sign-in flow
										vscode.commands.executeCommand(
											"workbench.action.openSettings",
											"softcodes.auth",
										)
									}
								})
						}
					} else {
						// Token exists but no items - could be network or server issue
						if (vscode.window && vscode.window.showInformationMessage) {
							vscode.window
								.showInformationMessage(
									"Marketplace is currently unavailable. Please check your internet connection or try again later.",
									"Retry",
								)
								.then((selection) => {
									if (selection === "Retry") {
										// Trigger a retry by clearing cache and reloading
										this.configLoader.clearCache()
										// The UI will need to trigger a refresh
									}
								})
						}
					}
				} catch (authError) {
					getMcpLogger().appendLine(`[Softcodes MCP] Error checking authentication: ${authError}`)
				}
			}

			return { items }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			console.error("Failed to load marketplace items:", error)
			getMcpLogger().appendLine(`[Softcodes MCP] MarketplaceManager failed to load items: ${errorMessage}`)

			// Handle test environment where vscode.window might not be available
			try {
				if (vscode.window && vscode.window.showWarningMessage) {
					// Provide more specific error messages based on the error type
					if (
						errorMessage.includes("authentication") ||
						errorMessage.includes("401") ||
						errorMessage.includes("403")
					) {
						vscode.window
							.showWarningMessage(
								"Marketplace authentication failed. Please check your Softcodes account settings.",
								"Open Settings",
							)
							.then((selection) => {
								if (selection === "Open Settings") {
									vscode.commands.executeCommand("workbench.action.openSettings", "softcodes.auth")
								}
							})
					} else if (
						errorMessage.includes("network") ||
						errorMessage.includes("ENOTFOUND") ||
						errorMessage.includes("ECONNREFUSED")
					) {
						vscode.window.showWarningMessage(
							"Marketplace unavailable – please check your internet connection.",
						)
					} else {
						vscode.window.showWarningMessage(
							"Marketplace temporarily unavailable – using local configurations.",
						)
					}
				} else {
					console.warn("Marketplace unavailable – using local or cached configurations.")
				}
			} catch (windowError) {
				console.warn("Marketplace unavailable – using local or cached configurations.")
			}
			return {
				items: [],
				errors: [errorMessage],
			}
		}
	}

	async getCurrentItems(): Promise<MarketplaceItem[]> {
		const result = await this.getMarketplaceItems()
		return result.items
	}

	filterItems(
		items: MarketplaceItem[],
		filters: { type?: MarketplaceItemType; search?: string; tags?: string[] },
	): MarketplaceItem[] {
		return items.filter((item) => {
			// Type filter
			if (filters.type && item.type !== filters.type) {
				return false
			}

			// Search filter
			if (filters.search) {
				const searchTerm = filters.search.toLowerCase()
				const searchableText = `${item.name} ${item.description}`.toLowerCase()
				if (!searchableText.includes(searchTerm)) {
					return false
				}
			}

			// Tags filter
			if (filters.tags?.length) {
				if (!item.tags?.some((tag) => filters.tags!.includes(tag))) {
					return false
				}
			}

			return true
		})
	}

	async updateWithFilteredItems(filters: {
		type?: MarketplaceItemType
		search?: string
		tags?: string[]
	}): Promise<MarketplaceItem[]> {
		const allItems = await this.getCurrentItems()

		if (!filters.type && !filters.search && (!filters.tags || filters.tags.length === 0)) {
			return allItems
		}

		return this.filterItems(allItems, filters)
	}

	async installMarketplaceItem(
		item: MarketplaceItem,
		options?: { target?: "global" | "project"; parameters?: Record<string, any> },
	): Promise<string> {
		const { target = "project", parameters } = options || {}

		vscode.window.showInformationMessage(t("marketplace:installation.installing", { itemName: item.name }))

		try {
			const result = await this.installer.installItem(item, { target, parameters })
			vscode.window.showInformationMessage(t("marketplace:installation.installSuccess", { itemName: item.name }))

			// Capture telemetry for successful installation
			const telemetryProperties: Record<string, any> = {}
			if (parameters && Object.keys(parameters).length > 0) {
				telemetryProperties.hasParameters = true
				// For MCP items with multiple installation methods, track which one was used
				if (item.type === "mcp" && parameters._selectedIndex !== undefined && Array.isArray(item.content)) {
					const selectedMethod = item.content[parameters._selectedIndex]
					if (selectedMethod && selectedMethod.name) {
						telemetryProperties.installationMethodName = selectedMethod.name
					}
				}
			}

			TelemetryService.instance.captureMarketplaceItemInstalled(
				item.id,
				item.type,
				item.name,
				target,
				telemetryProperties,
			)

			// Open the config file that was modified, optionally at the specific line
			const document = await vscode.workspace.openTextDocument(result.filePath)
			const options: vscode.TextDocumentShowOptions = {}

			if (result.line !== undefined) {
				// Position cursor at the line where content was added
				options.selection = new vscode.Range(result.line - 1, 0, result.line - 1, 0)
			}

			await vscode.window.showTextDocument(document, options)

			return result.filePath
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			vscode.window.showErrorMessage(
				t("marketplace:installation.installError", { itemName: item.name, errorMessage }),
			)
			throw error
		}
	}

	async removeInstalledMarketplaceItem(
		item: MarketplaceItem,
		options?: { target?: "global" | "project" },
	): Promise<void> {
		const { target = "project" } = options || {}

		vscode.window.showInformationMessage(t("marketplace:installation.removing", { itemName: item.name }))

		try {
			await this.installer.removeItem(item, { target })
			vscode.window.showInformationMessage(t("marketplace:installation.removeSuccess", { itemName: item.name }))

			// Capture telemetry for successful removal
			TelemetryService.instance.captureMarketplaceItemRemoved(item.id, item.type, item.name, target)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			vscode.window.showErrorMessage(
				t("marketplace:installation.removeError", { itemName: item.name, errorMessage }),
			)
			throw error
		}
	}

	async cleanup(): Promise<void> {
		// Clear API cache if needed
		this.configLoader.clearCache()
	}

	/**
	 * Get installation metadata by checking config files for installed items
	 */
	async getInstallationMetadata(): Promise<{
		project: Record<string, { type: string }>
		global: Record<string, { type: string }>
	}> {
		const metadata = {
			project: {} as Record<string, { type: string }>,
			global: {} as Record<string, { type: string }>,
		}

		// Check project-level installations
		await this.checkProjectInstallations(metadata.project)

		// Check global-level installations
		await this.checkGlobalInstallations(metadata.global)

		return metadata
	}

	/**
	 * Check for project-level installed items
	 */
	private async checkProjectInstallations(metadata: Record<string, { type: string }>): Promise<void> {
		try {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
			if (!workspaceFolder) {
				return // No workspace, no project installations
			}

			// Check modes in .roomodes
			const projectModesPath = path.join(workspaceFolder.uri.fsPath, ".kilocodemodes")
			try {
				const content = await fs.readFile(projectModesPath, "utf-8")
				const data = yaml.parse(content)
				if (data?.customModes && Array.isArray(data.customModes)) {
					for (const mode of data.customModes) {
						if (mode.slug) {
							metadata[mode.slug] = {
								type: "mode",
							}
						}
					}
				}
			} catch (error) {
				// File doesn't exist or can't be read, skip
			}

			// Check MCPs in .roo/mcp.json
			const projectMcpPath = path.join(workspaceFolder.uri.fsPath, ".softcodes", "mcp.json")
			try {
				const content = await fs.readFile(projectMcpPath, "utf-8")
				const data = JSON.parse(content)
				if (data?.mcpServers && typeof data.mcpServers === "object") {
					for (const serverName of Object.keys(data.mcpServers)) {
						metadata[serverName] = {
							type: "mcp",
						}
					}
				}
			} catch (error) {
				// File doesn't exist or can't be read, skip
			}
		} catch (error) {
			console.error("Error checking project installations:", error)
		}
	}

	/**
	 * Check for global-level installed items
	 */
	private async checkGlobalInstallations(metadata: Record<string, { type: string }>): Promise<void> {
		try {
			const globalSettingsPath = await ensureSettingsDirectoryExists(this.context)

			// Check global modes
			const globalModesPath = path.join(globalSettingsPath, GlobalFileNames.customModes)
			try {
				const content = await fs.readFile(globalModesPath, "utf-8")
				const data = yaml.parse(content)
				if (data?.customModes && Array.isArray(data.customModes)) {
					for (const mode of data.customModes) {
						if (mode.slug) {
							metadata[mode.slug] = {
								type: "mode",
							}
						}
					}
				}
			} catch (error) {
				// File doesn't exist or can't be read, skip
			}

			// Check global MCPs
			const globalMcpPath = path.join(globalSettingsPath, GlobalFileNames.mcpSettings)
			try {
				const content = await fs.readFile(globalMcpPath, "utf-8")
				const data = JSON.parse(content)
				if (data?.mcpServers && typeof data.mcpServers === "object") {
					for (const serverName of Object.keys(data.mcpServers)) {
						metadata[serverName] = {
							type: "mcp",
						}
					}
				}
			} catch (error) {
				// File doesn't exist or can't be read, skip
			}
		} catch (error) {
			console.error("Error checking global installations:", error)
		}
	}
}
