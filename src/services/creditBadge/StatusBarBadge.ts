/**
 * Status Bar Badge Component
 *
 * Displays credit information in the VSCode status bar with dynamic updates,
 * animations, and rich tooltips.
 */

import * as vscode from "vscode"
import { BadgeConfiguration, BadgeConfigurationManager } from "./BadgeConfiguration"
import { CreditAccumulator, SessionStats } from "./CreditAccumulator"

export interface BadgeState {
	visible: boolean
	text: string
	tooltip: string
	color?: vscode.ThemeColor | string
	command?: string
	priority?: number
}

export class StatusBarBadge {
	private statusBarItem: vscode.StatusBarItem
	private accumulator: CreditAccumulator
	private config: BadgeConfiguration
	private updateTimer?: NodeJS.Timeout
	private animationTimer?: NodeJS.Timeout
	private disposables: vscode.Disposable[] = []
	private realCreditBalance: number | null = null

	constructor(
		private configManager: BadgeConfigurationManager,
		accumulator: CreditAccumulator,
	) {
		this.accumulator = accumulator
		this.config = configManager.getConfiguration()

		// Create status bar item
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			100, // Priority
		)

		this.statusBarItem.command = "softcodes.creditBadge.showDetails"
		this.setupEventListeners()
		this.startUpdateTimer()
	}

	show(): void {
		this.statusBarItem.show()
		this.updateDisplay()
	}

	hide(): void {
		this.statusBarItem.hide()
	}

	dispose(): void {
		this.statusBarItem.dispose()
		if (this.updateTimer) {
			clearInterval(this.updateTimer)
		}
		if (this.animationTimer) {
			clearTimeout(this.animationTimer)
		}
		this.disposables.forEach((d) => d.dispose())
	}

	updateDisplay(): void {
		try {
			const stats = this.accumulator.getSessionStats()
			const state = this.calculateBadgeState(stats)

			console.log(`[STATUS-BAR-BADGE] Updating display:`, {
				text: state.text,
				realBalance: this.realCreditBalance,
				sessionCredits: stats.totalCreditsUsed,
				hasRealBalance: this.realCreditBalance !== null,
			})

			this.statusBarItem.text = state.text
			this.statusBarItem.tooltip = state.tooltip
			this.statusBarItem.color = state.color
			this.statusBarItem.command = state.command

			// Force immediate UI refresh
			this.statusBarItem.show()
		} catch (error) {
			console.error("[STATUS-BAR-BADGE] Error updating display:", error)
		}
	}

	/**
	 * Update the real user credit balance for display with immediate refresh
	 */
	updateRealCreditBalance(balance: number): void {
		console.log(`[STATUS-BAR-BADGE] Updating real credit balance: ${this.realCreditBalance} → ${balance}`)

		const previousBalance = this.realCreditBalance
		this.realCreditBalance = balance

		// Force immediate display update
		this.updateDisplay()

		// Show visual change indicator if balance decreased
		if (previousBalance !== null && balance < previousBalance) {
			const creditsUsed = previousBalance - balance
			console.log(`[STATUS-BAR-BADGE] Credits decreased by ${creditsUsed}, showing consumption animation`)
			this.showCreditConsumption(creditsUsed, "Credit Update")
		}

		console.log(`[STATUS-BAR-BADGE] Badge updated with new balance: ${balance}`)
	}

	showCreditConsumption(creditsUsed: number, operation: string): void {
		if (this.config.showProgressAnimation) {
			this.animateConsumption(creditsUsed, operation)
		}

		if (this.config.enableNotifications && creditsUsed >= this.config.notificationThreshold) {
			this.showNotification(creditsUsed, operation)
		}
	}

	private calculateBadgeState(stats: SessionStats): BadgeState {
		const icon = this.config.showIcon ? "$(coin) " : ""
		let text: string
		let tooltip: string

		// If we have real credit balance, show it instead of session data
		if (this.realCreditBalance !== null) {
			text = `${icon}${this.realCreditBalance} credits`
			tooltip = this.buildRealBalanceTooltip(stats)
			console.log(`[STATUS-BAR-BADGE] Using real balance display: ${this.realCreditBalance} credits`)
		} else {
			console.log(`[STATUS-BAR-BADGE] Using session-based display: ${stats.totalCreditsUsed} credits`)
			// Fallback to session-based display
			switch (this.config.displayMode) {
				case "session":
					text = `${icon}${stats.totalCreditsUsed} credits used`
					tooltip = this.buildSessionTooltip(stats)
					break

				case "rate":
					const rate = stats.operationsPerHour.toFixed(1)
					text = `${icon}${rate}/hr operations`
					tooltip = this.buildRateTooltip(stats)
					break

				default:
					text = `${icon}${stats.totalCreditsUsed} credits`
					tooltip = this.buildDefaultTooltip(stats)
			}
		}

		return {
			visible: true,
			text,
			tooltip,
			color: this.getColorForUsage(this.realCreditBalance ?? stats.totalCreditsUsed),
			command: "softcodes.creditBadge.showDetails",
		}
	}

	private buildSessionTooltip(stats: SessionStats): string {
		const duration = this.formatDuration(stats.duration)
		const avgCredits = stats.averageCreditsPerOperation.toFixed(1)
		const totalUSD = stats.totalUSDSpent.toFixed(3)

		return (
			`Session Credits: ${stats.totalCreditsUsed} (${stats.operationCount} operations)\n` +
			`Duration: ${duration}\n` +
			`Average: ${avgCredits} credits/operation\n` +
			`Total Cost: $${totalUSD}\n` +
			`Rate: ${stats.operationsPerHour.toFixed(1)} operations/hour\n\n` +
			`Click for detailed breakdown`
		)
	}

	private buildRateTooltip(stats: SessionStats): string {
		return (
			`Operation Rate: ${stats.operationsPerHour.toFixed(1)}/hour\n` +
			`Total Operations: ${stats.operationCount}\n` +
			`Credits Used: ${stats.totalCreditsUsed}\n` +
			`Session Duration: ${this.formatDuration(stats.duration)}`
		)
	}

	private buildDefaultTooltip(stats: SessionStats): string {
		return (
			`Credits Used: ${stats.totalCreditsUsed}\n` + `Operations: ${stats.operationCount}\n` + `Click for details`
		)
	}

	private buildRealBalanceTooltip(stats: SessionStats): string {
		const balance = this.realCreditBalance ?? 0
		const totalUSD = stats.totalUSDSpent.toFixed(3)
		const estimatedCost = balance * 0.014 // $0.014 per credit

		return (
			`💰 Account Balance: ${balance} credits\n` +
			`💸 Session Used: ${stats.totalCreditsUsed} credits\n` +
			`💵 Session Cost: $${totalUSD}\n` +
			`🔢 Operations: ${stats.operationCount}\n` +
			`⚡ Balance Value: ~$${estimatedCost.toFixed(2)}\n` +
			`🕒 Last Updated: ${new Date().toLocaleTimeString()}\n\n` +
			`Click for detailed breakdown`
		)
	}

	private getColorForUsage(creditsUsed: number): vscode.ThemeColor | string {
		const thresholds = this.config.colorThresholds

		if (creditsUsed >= thresholds.critical.threshold) {
			return thresholds.critical.color
		} else if (creditsUsed >= thresholds.high.threshold) {
			return thresholds.high.color
		} else if (creditsUsed >= thresholds.medium.threshold) {
			return thresholds.medium.color
		} else {
			return thresholds.low.color
		}
	}

	private animateConsumption(creditsUsed: number, operation: string): void {
		const originalText = this.statusBarItem.text
		const animationText = `$(sync~spin) +${creditsUsed} credits`

		// Show animation
		this.statusBarItem.text = animationText
		this.statusBarItem.color = new vscode.ThemeColor("notificationInfoForeground")

		// Reset after animation
		this.animationTimer = setTimeout(() => {
			this.updateDisplay()
		}, 2000)
	}

	private showNotification(creditsUsed: number, operation: string): void {
		const stats = this.accumulator.getSessionStats()
		const message = `${operation}: ${creditsUsed} credits used (${stats.totalCreditsUsed} total this session)`

		vscode.window
			.showInformationMessage(message, "View History", "Reset Session", "Buy Credits")
			.then((selection) => {
				switch (selection) {
					case "View History":
						vscode.commands.executeCommand("softcodes.creditBadge.showHistory")
						break
					case "Reset Session":
						this.accumulator.resetSession()
						break
					case "Buy Credits":
						vscode.env.openExternal(vscode.Uri.parse("https://softcodes.ai/dashboard/credits"))
						break
				}
			})
	}

	private setupEventListeners(): void {
		// Listen for accumulator events
		this.accumulator.on("operation_added", () => {
			this.updateDisplay()
		})

		this.accumulator.on("session_reset", () => {
			this.updateDisplay()
		})

		// Listen for configuration changes
		const configDisposable = this.configManager.onConfigurationChange((config) => {
			this.config = config
			this.updateDisplay()
			this.restartUpdateTimer()
		})

		this.disposables.push(configDisposable)
	}

	private startUpdateTimer(): void {
		if (this.config.updateInterval > 0) {
			this.updateTimer = setInterval(() => {
				this.updateDisplay()
			}, this.config.updateInterval)
		}
	}

	private restartUpdateTimer(): void {
		if (this.updateTimer) {
			clearInterval(this.updateTimer)
		}
		this.startUpdateTimer()
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
