/**
 * Credit Badge Manager
 *
 * Main controller that orchestrates the credit badge system.
 * Integrates all components and manages the lifecycle.
 */

import * as vscode from "vscode"
import { CreditConverter, ConversionConfig } from "./CreditConverter"
import { CreditAccumulator } from "./CreditAccumulator"
import { BadgeConfiguration, BadgeConfigurationManager } from "./BadgeConfiguration"
import { StatusBarBadge } from "./StatusBarBadge"
import { VisualFeedbackManager } from "./VisualFeedback"
import { CreditUpdateEvent } from "../realtimeCreditUpdates"
import { creditManager, UserCreditInfo } from "../creditManager"
import { realtimeCreditService } from "../realtimeCreditUpdates"
import { UnifiedAuthService } from "../../auth/unifiedAuthService"

export class CreditBadgeManager {
	private static instance: CreditBadgeManager
	private converter: CreditConverter
	private accumulator: CreditAccumulator
	private configManager: BadgeConfigurationManager
	private statusBarBadge: StatusBarBadge
	private visualFeedback: VisualFeedbackManager
	private disposables: vscode.Disposable[] = []
	private initialized = false
	private authService: UnifiedAuthService
	private currentUserCredits: UserCreditInfo | null = null
	private realtimeSubscriptionId: string | null = null

	private constructor(private context: vscode.ExtensionContext) {
		// Initialize auth service
		this.authService = UnifiedAuthService.getInstance(context)

		// Initialize configuration manager
		this.configManager = new BadgeConfigurationManager(context.workspaceState)

		// Initialize converter with current config
		const config = this.configManager.getConfiguration()
		this.converter = new CreditConverter({
			dollarToCreditRate: config.dollarToCreditRate,
			roundingMode: config.roundingMode,
			precision: config.precision,
		})

		// Initialize accumulator
		this.accumulator = new CreditAccumulator(this.converter)

		// Initialize status bar badge
		this.statusBarBadge = new StatusBarBadge(this.configManager, this.accumulator)

		// Initialize visual feedback
		this.visualFeedback = new VisualFeedbackManager(this.statusBarBadge, this.configManager)

		this.setupConfigurationSync()
		this.registerCommands()

		// Subscribe to realtime credit updates so badge refreshes instantly
		realtimeCreditService.on("creditUpdate", (update: CreditUpdateEvent) => {
			console.log("[CREDIT-BADGE] Direct realtime credit update received", update)
			this.handleRealtimeCreditUpdate(update)
		})
	}

	static getInstance(context?: vscode.ExtensionContext): CreditBadgeManager {
		if (!CreditBadgeManager.instance && context) {
			CreditBadgeManager.instance = new CreditBadgeManager(context)
		}
		return CreditBadgeManager.instance
	}

	async initialize(): Promise<void> {
		if (this.initialized) return

		try {
			console.log("[CREDIT-BADGE] Initializing credit badge system")

			// Reset session if configured
			if (this.configManager.getConfiguration().sessionResetOnStartup) {
				this.accumulator.resetSession()
			}

			// Show the badge
			this.statusBarBadge.show()

			// Setup real credit balance monitoring
			await this.setupRealCreditMonitoring()

			// Setup integration with existing credit system
			this.setupCreditSystemIntegration()

			this.initialized = true
			console.log("[CREDIT-BADGE] Credit badge system initialized successfully")
		} catch (error) {
			console.error("[CREDIT-BADGE] Failed to initialize:", error)
			throw error
		}
	}

	/**
	 * Add operation to tracking and update badge
	 */
	addOperation(operation: string, usdCost: number, metadata?: Record<string, any>): void {
		const sessionOperation = this.accumulator.addOperation(operation, usdCost, metadata)

		console.log("[CREDIT-BADGE] Operation added - triggering immediate updates:", {
			operation,
			usdCost,
			creditsUsed: sessionOperation.creditsUsed,
			sessionTotal: this.accumulator.getSessionStats().totalCreditsUsed,
		})

		// CRITICAL: Immediately invalidate cache when operation is added
		if (this.currentUserCredits) {
			console.log("[CREDIT-BADGE] Invalidating user cache due to operation")
			creditManager.clearUserCache(this.currentUserCredits.clerkId)

			// Trigger immediate balance refresh
			this.refreshUserCreditBalance().catch((error) => {
				console.warn("[CREDIT-BADGE] Failed to refresh balance after operation:", error)
			})
		}

		// Show visual feedback
		this.visualFeedback.showCreditConsumption(sessionOperation.creditsUsed, operation)

		// Update badge display immediately
		this.statusBarBadge.updateDisplay()
	}

	/**
	 * Show credit consumption with animation
	 */
	showCreditConsumption(creditsUsed: number, operation: string): void {
		this.statusBarBadge.showCreditConsumption(creditsUsed, operation)
		this.visualFeedback.showCreditConsumption(creditsUsed, operation)
	}

	/**
	 * Reset current session
	 */
	resetSession(): void {
		this.accumulator.resetSession()
		this.statusBarBadge.updateDisplay()

		vscode.window.showInformationMessage("Credit session reset")
	}

	/**
	 * Get current session statistics
	 */
	getSessionStats(): any {
		return this.accumulator.getSessionStats()
	}

	/**
	 * Show detailed credit breakdown
	 */
	showDetails(): void {
		const stats = this.accumulator.getSessionStats()
		const recentOps = this.accumulator.getRecentOperations(10)

		const details = [
			`Session Statistics:`,
			`• Credits Used: ${stats.totalCreditsUsed.toFixed(1)} credits`,
			`• Operations: ${stats.operationCount}`,
			`• Duration: ${this.formatDuration(stats.duration)}`,
			`• Average: ${stats.averageCreditsPerOperation.toFixed(1)} credits/operation`,
			`• Rate: ${stats.operationsPerHour.toFixed(1)} operations/hour`,
			`• Total Cost: $${stats.totalUSDSpent.toFixed(3)}`,
			``,
			`Recent Operations:`,
		]

		recentOps.forEach((op) => {
			const time = op.timestamp.toLocaleTimeString()
			details.push(`• ${time}: ${op.operation} (${op.creditsUsed.toFixed(1)} credits)`)
		})

		const detailsText = details.join("\n")

		vscode.window
			.showInformationMessage(
				"Credit Usage Details",
				{ detail: detailsText, modal: true },
				"Reset Session",
				"Buy Credits",
				"Settings",
			)
			.then((selection) => {
				switch (selection) {
					case "Reset Session":
						this.resetSession()
						break
					case "Buy Credits":
						vscode.env.openExternal(vscode.Uri.parse("https://softcodes.ai/dashboard/credits"))
						break
					case "Settings":
						vscode.commands.executeCommand("workbench.action.openSettings", "softcodes.creditBadge")
						break
				}
			})
	}

	/**
	 * Update configuration
	 */
	updateConfiguration(updates: Partial<BadgeConfiguration>): void {
		this.configManager.updateConfiguration(updates)
	}

	dispose(): void {
		this.statusBarBadge.dispose()
		this.configManager.dispose()
		this.visualFeedback.dispose()
		this.disposables.forEach((d) => d.dispose())
	}

	private async setupRealCreditMonitoring(): Promise<void> {
		try {
			console.log("[CREDIT-BADGE] Setting up real credit monitoring...")

			// Get initial credit balance
			await this.refreshUserCreditBalance()

			// Setup realtime monitoring with immediate cache integration
			await this.setupRealtimeSubscription()

			// Setup periodic cache refresh as backup (every 30 seconds)
			this.setupPeriodicCacheRefresh()

			console.log("[CREDIT-BADGE] Real credit monitoring initialized with cache integration")
		} catch (error) {
			console.error("[CREDIT-BADGE] Failed to setup real credit monitoring:", error)
		}
	}

	/**
	 * Setup periodic cache refresh as backup for realtime updates
	 */
	private setupPeriodicCacheRefresh(): void {
		setInterval(async () => {
			try {
				if (this.currentUserCredits) {
					console.log("[CREDIT-BADGE] Performing periodic cache refresh...")

					// Clear cache and refresh balance
					creditManager.clearUserCache(this.currentUserCredits.clerkId)
					await this.refreshUserCreditBalance()

					console.log("[CREDIT-BADGE] Periodic cache refresh completed")
				}
			} catch (error) {
				console.warn("[CREDIT-BADGE] Periodic cache refresh failed:", error)
			}
		}, 30000) // Every 30 seconds as backup
	}

	private async refreshUserCreditBalance(): Promise<void> {
		try {
			const accessToken = await this.authService.ensureValidAccessToken()
			if (accessToken) {
				console.log("[CREDIT-BADGE] Refreshing user credit balance...")

				// Force fresh fetch by clearing cache first
				const userInfo = await this.getClerkIdFromToken(accessToken)
				if (userInfo) {
					creditManager.clearUserCache(userInfo)
				}

				this.currentUserCredits = await creditManager.getUserCreditBalance(accessToken)
				if (this.currentUserCredits) {
					console.log(
						`[CREDIT-BADGE] User credit balance refreshed: ${this.currentUserCredits.currentCredits} credits`,
					)
					console.log(`[CREDIT-BADGE] Total spent: $${this.currentUserCredits.totalSpent}`)
					console.log(`[CREDIT-BADGE] Credits used: ${this.currentUserCredits.creditsUsed}`)

					// Update badge to show real balance - IMMEDIATE UPDATE
					this.statusBarBadge.updateRealCreditBalance(this.currentUserCredits.currentCredits)

					// Force display update
					this.statusBarBadge.updateDisplay()
				} else {
					console.warn("[CREDIT-BADGE] No credit information received from credit manager")
				}
			} else {
				console.warn("[CREDIT-BADGE] No access token available for credit balance refresh")
			}
		} catch (error) {
			console.error("[CREDIT-BADGE] Failed to refresh user credit balance:", error)
		}
	}

	private async setupRealtimeSubscription(): Promise<void> {
		try {
			console.log("[CREDIT-BADGE] Setting up realtime subscription...")

			const accessToken = await this.authService.ensureValidAccessToken()
			if (!accessToken) {
				console.warn("[CREDIT-BADGE] No access token available for realtime subscription")
				return
			}

			// Extract clerk ID for realtime subscription
			const clerkId = await this.getClerkIdFromToken(accessToken)
			if (clerkId) {
				console.log(`[CREDIT-BADGE] Setting up realtime subscription for user: ${clerkId}`)

				this.realtimeSubscriptionId = await realtimeCreditService.subscribeToUserCredits(clerkId, (update) => {
					console.log(`[CREDIT-BADGE] Realtime credit update received: ${update.creditsChanged} credits`)
					this.handleRealtimeCreditUpdate(update)
				})

				if (this.realtimeSubscriptionId) {
					console.log(`[CREDIT-BADGE] Realtime subscription established: ${this.realtimeSubscriptionId}`)

					// Setup subscription health monitoring
					this.setupRealtimeHealthMonitoring(clerkId)
				} else {
					console.error("[CREDIT-BADGE] Failed to establish realtime subscription")
					this.setupFallbackPolling()
				}
			} else {
				console.error("[CREDIT-BADGE] Could not extract Clerk ID from token for realtime subscription")
				this.setupFallbackPolling()
			}
		} catch (error) {
			console.error("[CREDIT-BADGE] Failed to setup realtime subscription:", error)
			// Setup fallback polling as backup
			this.setupFallbackPolling()
		}
	}

	/**
	 * Setup health monitoring for realtime subscription
	 */
	private setupRealtimeHealthMonitoring(clerkId: string): void {
		// Monitor realtime connection health
		realtimeCreditService.on("connected", () => {
			console.log("[CREDIT-BADGE] Realtime connection established")
		})

		realtimeCreditService.on("disconnected", () => {
			console.warn("[CREDIT-BADGE] Realtime connection lost, setting up fallback")
			this.setupFallbackPolling()
		})

		realtimeCreditService.on("error", (error) => {
			console.error("[CREDIT-BADGE] Realtime connection error:", error)
			this.setupFallbackPolling()
		})
	}

	/**
	 * Setup fallback polling when realtime fails
	 */
	private setupFallbackPolling(): void {
		console.log("[CREDIT-BADGE] Setting up fallback polling for credit updates")

		// Poll every 10 seconds as fallback
		setInterval(async () => {
			try {
				await this.refreshUserCreditBalance()
			} catch (error) {
				console.warn("[CREDIT-BADGE] Fallback polling failed:", error)
			}
		}, 10000) // 10 seconds
	}

	private async getClerkIdFromToken(accessToken: string): Promise<string | null> {
		try {
			// First try full JWT verification
			const { extractUserFromJWT, getJWTVerificationService } = await import("../../auth/jwtVerification")
			const userInfo = await extractUserFromJWT(accessToken)
			if (userInfo?.userId) {
				return userInfo.userId
			}

			console.warn("[CREDIT-BADGE] Full JWT verification failed, trying structure validation...")

			// Fallback: Use structure validation without signature verification
			const jwtService = getJWTVerificationService()
			const structureResult = await jwtService.validateTokenStructure(accessToken)

			if (structureResult.valid && structureResult.payload) {
				const fallbackUserInfo = jwtService.extractUserInfo(structureResult.payload)
				if (fallbackUserInfo?.userId) {
					console.log("[CREDIT-BADGE] Clerk ID extracted using structure validation")
					return fallbackUserInfo.userId
				}
			}

			console.error("[CREDIT-BADGE] All JWT validation methods failed for Clerk ID extraction")
			return null
		} catch (error) {
			console.error("[CREDIT-BADGE] Failed to extract Clerk ID:", error)
			return null
		}
	}

	private handleRealtimeCreditUpdate(update: CreditUpdateEvent): void {
		console.log(`[CREDIT-BADGE] Realtime credit update received:`, {
			clerkId: update.clerkId,
			creditsChanged: update.creditsChanged,
			newBalance: update.newBalance,
			operation: update.operation,
		})

		// CRITICAL: Immediately invalidate credit manager cache for this user
		creditManager.clearUserCache(update.clerkId)
		console.log(`[CREDIT-BADGE] Cache invalidated for user: ${update.clerkId}`)

		// Update our cached credit balance
		if (this.currentUserCredits) {
			this.currentUserCredits.currentCredits = update.newBalance
			this.currentUserCredits.creditsUsed += Math.abs(update.creditsChanged)
			if (update.usdAmount) {
				this.currentUserCredits.totalSpent += update.usdAmount
			}
			console.log(`[CREDIT-BADGE] Local credit cache updated:`, {
				currentCredits: this.currentUserCredits.currentCredits,
				creditsUsed: this.currentUserCredits.creditsUsed,
				totalSpent: this.currentUserCredits.totalSpent,
			})
		}

		// Update the badge with real credit balance - IMMEDIATE UPDATE
		this.statusBarBadge.updateRealCreditBalance(update.newBalance)
		console.log(`[CREDIT-BADGE] Status bar badge updated with balance: ${update.newBalance}`)

		// Show visual feedback for credit changes
		if (update.creditsChanged < 0) {
			this.visualFeedback.showCreditConsumption(Math.abs(update.creditsChanged), "API Usage")
			console.log(`[CREDIT-BADGE] Visual feedback shown for ${Math.abs(update.creditsChanged)} credits consumed`)
		}

		// Force badge display update to ensure UI reflects changes immediately
		this.statusBarBadge.updateDisplay()
	}

	private setupConfigurationSync(): void {
		// Sync converter config when badge config changes
		const disposable = this.configManager.onConfigurationChange((config) => {
			this.converter.updateConfig({
				dollarToCreditRate: config.dollarToCreditRate,
				roundingMode: config.roundingMode,
				precision: config.precision,
			})
		})

		this.disposables.push(disposable)
	}

	private setupCreditSystemIntegration(): void {
		// This would integrate with the existing credit system
		// For now, we'll set up the command handlers
		console.log("[CREDIT-BADGE] Setting up credit system integration")
	}

	private registerCommands(): void {
		// Register badge-specific commands
		const commands = [
			vscode.commands.registerCommand("softcodes.creditBadge.showDetails", () => {
				this.showDetails()
			}),

			vscode.commands.registerCommand("softcodes.creditBadge.resetSession", () => {
				this.resetSession()
			}),

			vscode.commands.registerCommand("softcodes.creditBadge.showHistory", () => {
				// This would show credit history in a webview
				vscode.window.showInformationMessage("Credit history feature coming soon")
			}),

			vscode.commands.registerCommand("softcodes.creditBadge.setUsageLimit", async () => {
				const limit = await vscode.window.showInputBox({
					prompt: "Set session credit limit",
					placeHolder: "Enter maximum credits per session (e.g., 50)",
					validateInput: (value) => {
						const num = parseInt(value)
						if (isNaN(num) || num <= 0) {
							return "Please enter a valid positive number"
						}
						return null
					},
				})

				if (limit) {
					this.updateConfiguration({ notificationThreshold: parseInt(limit) })
					vscode.window.showInformationMessage(`Credit limit set to ${limit} credits`)
				}
			}),
		]

		this.disposables.push(...commands)
	}

	private formatDuration(milliseconds: number): string {
		const seconds = Math.floor(milliseconds / 1000)
		const minutes = Math.floor(seconds / 60)
		const hours = Math.floor(minutes / 60)

		if (hours > 0) {
			return `${hours}h ${minutes % 60}m`
		} else if (minutes > 0) {
			return `${minutes}m ${seconds % 60}s`
		} else {
			return `${seconds}s`
		}
	}
}

/**
 * Export singleton instance
 */
export const creditBadgeManager = (context: vscode.ExtensionContext) => CreditBadgeManager.getInstance(context)
