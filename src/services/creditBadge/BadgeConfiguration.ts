/**
 * Badge Configuration Manager
 *
 * Manages user preferences and system settings for the credit badge system.
 * Integrates with VSCode settings and provides configuration persistence.
 */

import * as vscode from "vscode"
import { CREDIT_CONFIG } from "../../config/constants"

export interface ColorThreshold {
	threshold: number
	color: string
	textColor?: string
	icon?: string
}

export interface BadgeConfiguration {
	// Conversion settings
	dollarToCreditRate: number
	roundingMode: "ceil" | "floor" | "round" | "precise"
	precision: number

	// Display preferences
	displayMode: "session" | "remaining" | "total" | "rate"
	showIcon: boolean
	showTooltip: boolean
	updateInterval: number // milliseconds

	// Color and visual feedback
	colorThresholds: {
		low: ColorThreshold // 0-5 credits
		medium: ColorThreshold // 6-15 credits
		high: ColorThreshold // 16-30 credits
		critical: ColorThreshold // 31+ credits
	}

	// Notification settings
	enableNotifications: boolean
	notificationThreshold: number // Credits threshold for notifications
	showProgressAnimation: boolean
	audioFeedback: boolean

	// Advanced settings
	trackingEnabled: boolean
	sessionResetOnStartup: boolean
	debugMode: boolean
}

export class BadgeConfigurationManager {
	private static readonly CONFIG_KEY = "softcodes.creditBadge"
	private config: BadgeConfiguration
	private listeners: Array<(config: BadgeConfiguration) => void> = []
	private disposables: vscode.Disposable[] = []

	constructor(private workspaceState: vscode.Memento) {
		this.config = this.loadConfiguration()
		this.watchVSCodeSettings()
	}

	getConfiguration(): BadgeConfiguration {
		return { ...this.config }
	}

	updateConfiguration(updates: Partial<BadgeConfiguration>): void {
		this.config = { ...this.config, ...updates }
		this.saveConfiguration()
		this.notifyListeners()
	}

	onConfigurationChange(listener: (config: BadgeConfiguration) => void): vscode.Disposable {
		this.listeners.push(listener)

		return new vscode.Disposable(() => {
			const index = this.listeners.indexOf(listener)
			if (index > -1) {
				this.listeners.splice(index, 1)
			}
		})
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		this.listeners.length = 0
	}

	private loadConfiguration(): BadgeConfiguration {
		const vscodeConfig = vscode.workspace.getConfiguration(BadgeConfigurationManager.CONFIG_KEY)
		const savedConfig = this.workspaceState.get<Partial<BadgeConfiguration>>("badgeConfig", {})

		return {
			// Default configuration
			dollarToCreditRate: CREDIT_CONFIG.USD_PER_CREDIT,
			roundingMode: "precise",
			precision: 4,
			displayMode: "session",
			showIcon: true,
			showTooltip: true,
			updateInterval: 1000,
			colorThresholds: {
				low: { threshold: 5, color: "#28a745", icon: "coin" },
				medium: { threshold: 15, color: "#ffc107", icon: "warning" },
				high: { threshold: 30, color: "#fd7e14", icon: "alert" },
				critical: { threshold: 50, color: "#dc3545", icon: "error", textColor: "#ffffff" },
			},
			enableNotifications: true,
			notificationThreshold: 10,
			showProgressAnimation: true,
			audioFeedback: false,
			trackingEnabled: true,
			sessionResetOnStartup: true,
			debugMode: false,

			// Override with VSCode settings
			...this.extractVSCodeSettings(vscodeConfig),

			// Override with saved state
			...savedConfig,
		}
	}

	private saveConfiguration(): void {
		this.workspaceState.update("badgeConfig", this.config)
	}

	private extractVSCodeSettings(vscodeConfig: vscode.WorkspaceConfiguration): Partial<BadgeConfiguration> {
		const settings: Partial<BadgeConfiguration> = {}

		const rate = vscodeConfig.get<number>("dollarToCreditRate")
		if (rate !== undefined) settings.dollarToCreditRate = rate

		const roundingMode = vscodeConfig.get<"ceil" | "floor" | "round" | "precise">("roundingMode")
		if (roundingMode !== undefined) settings.roundingMode = roundingMode

		const displayMode = vscodeConfig.get<"session" | "remaining" | "total" | "rate">("displayMode")
		if (displayMode !== undefined) settings.displayMode = displayMode

		const notificationThreshold = vscodeConfig.get<number>("notificationThreshold")
		if (notificationThreshold !== undefined) settings.notificationThreshold = notificationThreshold

		const enableNotifications = vscodeConfig.get<boolean>("enableNotifications")
		if (enableNotifications !== undefined) settings.enableNotifications = enableNotifications

		const showProgressAnimation = vscodeConfig.get<boolean>("showProgressAnimation")
		if (showProgressAnimation !== undefined) settings.showProgressAnimation = showProgressAnimation

		return settings
	}

	private watchVSCodeSettings(): void {
		const disposable = vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration(BadgeConfigurationManager.CONFIG_KEY)) {
				const vscodeConfig = vscode.workspace.getConfiguration(BadgeConfigurationManager.CONFIG_KEY)
				const updates = this.extractVSCodeSettings(vscodeConfig)

				this.config = { ...this.config, ...updates }
				this.notifyListeners()
			}
		})

		this.disposables.push(disposable)
	}

	private notifyListeners(): void {
		this.listeners.forEach((listener) => {
			try {
				listener(this.config)
			} catch (error) {
				console.error("[BADGE-CONFIG] Error notifying listener:", error)
			}
		})
	}
}
