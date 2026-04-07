/**
 * Visual Feedback Manager
 *
 * Provides rich visual feedback including animations, colors, and notifications
 * for the credit badge system.
 */

import * as vscode from "vscode"
import { BadgeConfiguration, BadgeConfigurationManager } from "./BadgeConfiguration"
import { StatusBarBadge } from "./StatusBarBadge"
import { SessionStats } from "./CreditAccumulator"

export interface AnimationConfig {
	duration: number
	easing: "linear" | "ease-in" | "ease-out" | "ease-in-out"
	repeat?: number
	direction?: "normal" | "reverse" | "alternate"
}

export interface NotificationStyle {
	severity: "info" | "warning" | "error" | "success"
	icon: string
	color: string
	backgroundColor?: string
	duration: number
	sound?: boolean
}

export class VisualFeedbackManager {
	private animationQueue: Array<() => Promise<void>> = []
	private isAnimating = false
	private config: BadgeConfiguration
	private statusBarBadge: StatusBarBadge
	private milestoneCache = new Set<number>()
	private disposables: vscode.Disposable[] = []

	constructor(
		statusBarBadge: StatusBarBadge,
		private configManager: BadgeConfigurationManager,
	) {
		this.statusBarBadge = statusBarBadge
		this.config = configManager.getConfiguration()

		this.setupConfigurationListener()
	}

	// Show credit consumption with visual feedback
	showCreditConsumption(creditsUsed: number, operation: string): void {
		if (this.config.showProgressAnimation) {
			this.queueAnimation(() => this.animateCreditConsumption(creditsUsed, operation))
		}

		// Check for usage warnings
		this.checkUsageWarnings(creditsUsed)
	}

	// Smooth color transitions for credit usage levels
	getColorForUsage(creditsUsed: number): string {
		const thresholds = this.config.colorThresholds

		if (creditsUsed <= thresholds.low.threshold) {
			return this.interpolateColor("#28a745", "#ffc107", creditsUsed / thresholds.low.threshold)
		} else if (creditsUsed <= thresholds.medium.threshold) {
			const ratio =
				(creditsUsed - thresholds.low.threshold) / (thresholds.medium.threshold - thresholds.low.threshold)
			return this.interpolateColor("#ffc107", "#fd7e14", ratio)
		} else if (creditsUsed <= thresholds.high.threshold) {
			const ratio =
				(creditsUsed - thresholds.medium.threshold) / (thresholds.high.threshold - thresholds.medium.threshold)
			return this.interpolateColor("#fd7e14", "#dc3545", ratio)
		} else {
			// Critical level - pulsing red
			return this.config.showProgressAnimation ? this.getPulsingColor("#dc3545") : "#dc3545"
		}
	}

	// Session progress indicator with milestone achievements
	showSessionProgress(stats: SessionStats): void {
		const milestones = [10, 25, 50, 100, 200]
		const currentMilestone = milestones.find((m) => stats.totalCreditsUsed >= m && !this.milestoneCache.has(m))

		if (currentMilestone) {
			this.celebrateMilestone(currentMilestone, stats)
			this.milestoneCache.add(currentMilestone)
		}
	}

	// Real-time efficiency indicator
	calculateEfficiency(stats: SessionStats): number {
		// Calculate efficiency based on operations per credit
		if (stats.totalCreditsUsed === 0) return 100
		return Math.min(100, (stats.operationCount / stats.totalCreditsUsed) * 10)
	}

	getEfficiencyIcon(efficiency: number): string {
		if (efficiency >= 80) return "🚀"
		if (efficiency >= 60) return "⚡"
		if (efficiency >= 40) return "📈"
		if (efficiency >= 20) return "📊"
		return "🐌"
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		this.milestoneCache.clear()
		this.animationQueue.length = 0
	}

	// Credit consumption animation with floating number effect
	private async animateCreditConsumption(creditsUsed: number, operation: string): Promise<void> {
		console.log(`[VISUAL-FEEDBACK] Animating consumption: ${creditsUsed} credits for ${operation}`)

		// Simulate animation delay
		await this.delay(800)
	}

	// Progressive warning system with escalating visual cues
	private checkUsageWarnings(creditsUsed: number): void {
		const thresholds = this.config.colorThresholds

		if (creditsUsed >= thresholds.critical.threshold) {
			this.showCriticalWarning(creditsUsed)
		} else if (creditsUsed >= thresholds.high.threshold) {
			this.showHighUsageWarning(creditsUsed)
		} else if (creditsUsed >= thresholds.medium.threshold) {
			this.showMediumUsageWarning(creditsUsed)
		}
	}

	private showCriticalWarning(creditsUsed: number): void {
		if (this.config.enableNotifications) {
			vscode.window
				.showErrorMessage(
					`🚨 High credit usage: ${creditsUsed} credits used this session`,
					"Buy Credits",
					"View Usage",
					"Set Limit",
				)
				.then((action) => {
					switch (action) {
						case "Buy Credits":
							vscode.env.openExternal(vscode.Uri.parse("https://softcodes.ai/dashboard/credits"))
							break
						case "View Usage":
							vscode.commands.executeCommand("softcodes.creditBadge.showDetails")
							break
						case "Set Limit":
							vscode.commands.executeCommand("softcodes.creditBadge.setUsageLimit")
							break
					}
				})
		}
	}

	private showHighUsageWarning(creditsUsed: number): void {
		if (this.config.enableNotifications && Math.random() < 0.5) {
			// Show 50% of the time
			vscode.window
				.showWarningMessage(`⚠️ Credits: ${creditsUsed} used this session`, "View Details", "Adjust Settings")
				.then((action) => {
					if (action === "View Details") {
						vscode.commands.executeCommand("softcodes.creditBadge.showDetails")
					} else if (action === "Adjust Settings") {
						vscode.commands.executeCommand("workbench.action.openSettings", "softcodes.creditBadge")
					}
				})
		}
	}

	private showMediumUsageWarning(creditsUsed: number): void {
		if (this.config.enableNotifications && Math.random() < 0.2) {
			// Show occasionally
			vscode.window
				.showInformationMessage(`💡 ${creditsUsed} credits used - you're actively coding!`, "View Stats")
				.then((action) => {
					if (action === "View Stats") {
						vscode.commands.executeCommand("softcodes.creditBadge.showDetails")
					}
				})
		}
	}

	private celebrateMilestone(milestone: number, stats: SessionStats): void {
		if (this.config.showProgressAnimation) {
			this.queueAnimation(() => this.showCelebrationAnimation(milestone))
		}

		if (this.config.enableNotifications) {
			vscode.window
				.showInformationMessage(
					`🎉 Milestone reached: ${milestone} credits used!`,
					"View Stats",
					"Buy More Credits",
				)
				.then((action) => {
					switch (action) {
						case "View Stats":
							vscode.commands.executeCommand("softcodes.creditBadge.showDetails")
							break
						case "Buy More Credits":
							vscode.env.openExternal(vscode.Uri.parse("https://softcodes.ai/dashboard/credits"))
							break
					}
				})
		}
	}

	private async showCelebrationAnimation(milestone: number): Promise<void> {
		console.log(`[VISUAL-FEEDBACK] Celebrating milestone: ${milestone} credits`)
		// Animation implementation would go here
		await this.delay(3000)
	}

	private interpolateColor(color1: string, color2: string, factor: number): string {
		const rgb1 = this.hexToRgb(color1)
		const rgb2 = this.hexToRgb(color2)

		if (!rgb1 || !rgb2) return color1

		const r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * factor)
		const g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * factor)
		const b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * factor)

		return this.rgbToHex(r, g, b)
	}

	private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
		const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
		return result
			? {
					r: parseInt(result[1], 16),
					g: parseInt(result[2], 16),
					b: parseInt(result[3], 16),
				}
			: null
	}

	private rgbToHex(r: number, g: number, b: number): string {
		return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
	}

	private getPulsingColor(baseColor: string): string {
		const time = Date.now() % 2000 // 2-second cycle
		const intensity = Math.sin((time / 2000) * Math.PI * 2) * 0.3 + 0.7

		const rgb = this.hexToRgb(baseColor)
		if (!rgb) return baseColor

		return this.rgbToHex(
			Math.round(rgb.r * intensity),
			Math.round(rgb.g * intensity),
			Math.round(rgb.b * intensity),
		)
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	private async queueAnimation(animation: () => Promise<void>): Promise<void> {
		this.animationQueue.push(animation)

		if (!this.isAnimating) {
			await this.processAnimationQueue()
		}
	}

	private async processAnimationQueue(): Promise<void> {
		this.isAnimating = true

		while (this.animationQueue.length > 0) {
			const animation = this.animationQueue.shift()
			if (animation) {
				try {
					await animation()
				} catch (error) {
					console.error("[VISUAL-FEEDBACK] Animation error:", error)
				}
			}
		}

		this.isAnimating = false
	}

	private setupConfigurationListener(): void {
		const disposable = this.configManager.onConfigurationChange((config) => {
			this.config = config
		})

		this.disposables.push(disposable)
	}
}
