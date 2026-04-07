/**
 * Credit and Authentication Monitoring Service
 *
 * Provides comprehensive monitoring, diagnostics, and reporting for the enhanced credit system
 * Tracks authentication health, credit operation success rates, and system performance
 */

import * as vscode from "vscode"
import { EventEmitter } from "events"
import { UnifiedAuthService } from "../auth/unifiedAuthService"
import { creditManager } from "./creditManager"
import { getEnhancedCreditSystem } from "./enhancedCreditSystem"

/**
 * Authentication health metrics
 */
interface AuthHealthMetrics {
	totalAuthAttempts: number
	successfulAuths: number
	failedAuths: number
	tokenRefreshAttempts: number
	successfulRefreshes: number
	averageTokenLifetime: number // in minutes
	tokenLifetimeEvents: Array<{
		timestamp: number
		lifetimeMinutes: number
		refreshTrigger: "expiration" | "proactive" | "manual"
	}>
	prematureDisconnections: number
	lastAuthFailure?: {
		timestamp: number
		error: string
		errorType: string
	}
	sessionDurations: number[] // Track actual session lengths
	averageSessionDuration: number // in minutes
}

/**
 * Credit operation metrics
 */
interface CreditMetrics {
	totalOperations: number
	successfulOperations: number
	queuedOperations: number
	offlineOperations: number
	failedOperations: number
	averageProcessingTime: number // in milliseconds
	lastOperationFailure?: {
		timestamp: number
		operation: string
		error: string
	}
}

/**
 * System performance metrics
 */
interface PerformanceMetrics {
	averageResponseTime: number
	cacheHitRate: number
	queueProcessingRate: number
	syncSuccessRate: number
	uptime: number // in milliseconds since initialization
}

/**
 * Complete system health report
 */
interface SystemHealthReport {
	timestamp: number
	overallHealth: "healthy" | "degraded" | "unhealthy"
	authHealth: AuthHealthMetrics
	creditHealth: CreditMetrics
	performance: PerformanceMetrics
	recommendations: string[]
	alerts: string[]
}

/**
 * Monitoring event for tracking
 */
interface MonitoringEvent {
	type: "auth" | "credit" | "performance" | "error"
	subtype: string
	timestamp: number
	data: any
	duration?: number
	success: boolean
}

/**
 * Credit and Authentication Monitor
 */
export class CreditAuthMonitor extends EventEmitter {
	private static instance: CreditAuthMonitor
	private authService: UnifiedAuthService
	private enhancedCreditSystem: any
	private events: MonitoringEvent[] = []
	private metrics: {
		auth: AuthHealthMetrics
		credit: CreditMetrics
		performance: PerformanceMetrics
	}
	private startTime: number
	private monitoringInterval?: NodeJS.Timeout

	private constructor(private context: vscode.ExtensionContext) {
		super()
		this.authService = UnifiedAuthService.getInstance(context)
		this.enhancedCreditSystem = getEnhancedCreditSystem(context)
		this.startTime = Date.now()

		// Initialize metrics
		this.metrics = {
			auth: {
				totalAuthAttempts: 0,
				successfulAuths: 0,
				failedAuths: 0,
				tokenRefreshAttempts: 0,
				successfulRefreshes: 0,
				averageTokenLifetime: 0,
				tokenLifetimeEvents: [],
				prematureDisconnections: 0,
				sessionDurations: [],
				averageSessionDuration: 0,
			},
			credit: {
				totalOperations: 0,
				successfulOperations: 0,
				queuedOperations: 0,
				offlineOperations: 0,
				failedOperations: 0,
				averageProcessingTime: 0,
			},
			performance: {
				averageResponseTime: 0,
				cacheHitRate: 0,
				queueProcessingRate: 0,
				syncSuccessRate: 0,
				uptime: 0,
			},
		}

		this.initializeMonitoring()
	}

	static getInstance(context: vscode.ExtensionContext): CreditAuthMonitor {
		if (!CreditAuthMonitor.instance) {
			CreditAuthMonitor.instance = new CreditAuthMonitor(context)
		}
		return CreditAuthMonitor.instance
	}

	/**
	 * Initialize monitoring systems
	 */
	private initializeMonitoring(): void {
		console.log("[MONITOR] Initializing credit and authentication monitoring...")

		// Setup event listeners for authentication events
		this.setupAuthenticationMonitoring()

		// Setup event listeners for credit events
		this.setupCreditMonitoring()

		// Start periodic health checks
		this.startPeriodicHealthChecks()

		console.log("[MONITOR] Monitoring system initialized successfully")
	}

	/**
	 * Setup authentication monitoring
	 */
	private setupAuthenticationMonitoring(): void {
		console.log("[MONITOR] Setting up enhanced authentication monitoring with token lifecycle tracking...")

		// Monitor authentication attempts with session tracking
		const originalSigninWithToken = this.authService.signinWithToken.bind(this.authService)
		this.authService.signinWithToken = async () => {
			const startTime = Date.now()
			const sessionId = `session_${Date.now()}`
			this.metrics.auth.totalAuthAttempts++

			console.log(`[MONITOR] [${sessionId}] Authentication attempt started`)

			try {
				const result = await originalSigninWithToken()
				if (result) {
					this.metrics.auth.successfulAuths++

					// Track session start for duration monitoring
					this.trackSessionStart(sessionId, startTime)

					this.recordEvent({
						type: "auth",
						subtype: "signin_success",
						timestamp: Date.now(),
						data: {
							method: "manual_token",
							sessionId,
							sessionStart: startTime,
						},
						duration: Date.now() - startTime,
						success: true,
					})

					console.log(`[MONITOR] [${sessionId}] Authentication successful`)
				} else {
					console.log(`[MONITOR] [${sessionId}] Authentication returned false (partial failure)`)
				}
				return result
			} catch (error) {
				this.metrics.auth.failedAuths++
				this.metrics.auth.lastAuthFailure = {
					timestamp: Date.now(),
					error: error instanceof Error ? error.message : String(error),
					errorType: "signin_failure",
				}

				this.recordEvent({
					type: "auth",
					subtype: "signin_failure",
					timestamp: Date.now(),
					data: {
						error: error instanceof Error ? error.message : String(error),
						sessionId,
					},
					duration: Date.now() - startTime,
					success: false,
				})

				console.error(`[MONITOR] [${sessionId}] Authentication failed:`, error)
				return false
			}
		}

		// Enhanced token refresh monitoring with lifecycle tracking
		const originalRefreshToken = this.authService.refreshCurrentAccessToken.bind(this.authService)
		this.authService.refreshCurrentAccessToken = async () => {
			const startTime = Date.now()
			const refreshId = `refresh_${Date.now()}`
			this.metrics.auth.tokenRefreshAttempts++

			console.log(`[MONITOR] [${refreshId}] Token refresh attempt started`)

			try {
				const result = await originalRefreshToken()
				if (result) {
					this.metrics.auth.successfulRefreshes++

					// Track token lifetime if we can parse the old token
					await this.trackTokenLifetime(refreshId, "proactive")

					this.recordEvent({
						type: "auth",
						subtype: "token_refresh_success",
						timestamp: Date.now(),
						data: {
							hasNewToken: !!result,
							refreshId,
							refreshTrigger: "proactive",
						},
						duration: Date.now() - startTime,
						success: true,
					})

					console.log(`[MONITOR] [${refreshId}] Token refresh successful`)
				}
				return result
			} catch (error) {
				this.recordEvent({
					type: "auth",
					subtype: "token_refresh_failure",
					timestamp: Date.now(),
					data: {
						error: error instanceof Error ? error.message : String(error),
						refreshId,
					},
					duration: Date.now() - startTime,
					success: false,
				})

				console.error(`[MONITOR] [${refreshId}] Token refresh failed:`, error)
				throw error
			}
		}

		// Monitor getAccessToken calls to detect token usage patterns
		const originalGetAccessToken = this.authService.getAccessToken.bind(this.authService)
		this.authService.getAccessToken = async () => {
			const accessTime = Date.now()
			const token = await originalGetAccessToken()

			// Log token access patterns for debugging
			if (token) {
				console.log(`[MONITOR] Token accessed at ${new Date(accessTime).toISOString()}`)
				this.recordEvent({
					type: "auth",
					subtype: "token_accessed",
					timestamp: accessTime,
					data: { hasToken: true },
					success: true,
				})
			} else {
				console.log(
					`[MONITOR] Token access failed - no token available at ${new Date(accessTime).toISOString()}`,
				)
				this.recordEvent({
					type: "auth",
					subtype: "token_access_failed",
					timestamp: accessTime,
					data: { hasToken: false },
					success: false,
				})
			}

			return token
		}

		console.log("[MONITOR] Enhanced authentication monitoring setup completed")
	}

	/**
	 * Track session start for duration monitoring
	 */
	private trackSessionStart(sessionId: string, startTime: number): void {
		// Store session start time for later duration calculation
		this.context.workspaceState.update(`session_${sessionId}`, startTime)
	}

	/**
	 * Track token lifetime when refresh occurs
	 */
	private async trackTokenLifetime(refreshId: string, trigger: "expiration" | "proactive" | "manual"): Promise<void> {
		try {
			// This would require access to the previous token's issue time
			// For now, we'll estimate based on typical JWT lifetimes
			const estimatedLifetime = 60 // minutes - typical JWT lifetime

			const lifetimeEvent = {
				timestamp: Date.now(),
				lifetimeMinutes: estimatedLifetime,
				refreshTrigger: trigger,
			}

			this.metrics.auth.tokenLifetimeEvents.push(lifetimeEvent)

			// Keep only last 50 events to prevent memory issues
			if (this.metrics.auth.tokenLifetimeEvents.length > 50) {
				this.metrics.auth.tokenLifetimeEvents = this.metrics.auth.tokenLifetimeEvents.slice(-50)
			}

			// Update average lifetime
			const totalLifetime = this.metrics.auth.tokenLifetimeEvents.reduce(
				(sum, event) => sum + event.lifetimeMinutes,
				0,
			)
			this.metrics.auth.averageTokenLifetime = totalLifetime / this.metrics.auth.tokenLifetimeEvents.length

			console.log(`[MONITOR] [${refreshId}] Token lifetime tracked: ${estimatedLifetime} minutes (${trigger})`)
		} catch (error) {
			console.warn(`[MONITOR] Failed to track token lifetime:`, error)
		}
	}

	/**
	 * Detect and track premature disconnections
	 */
	private detectPrematureDisconnection(sessionDuration: number): void {
		// Consider disconnection "premature" if it happens within 10 minutes
		const PREMATURE_THRESHOLD = 10 * 60 * 1000 // 10 minutes

		if (sessionDuration < PREMATURE_THRESHOLD) {
			this.metrics.auth.prematureDisconnections++
			console.warn(
				`[MONITOR] Premature disconnection detected: session lasted only ${Math.floor(sessionDuration / 1000)}s`,
			)

			this.recordEvent({
				type: "auth",
				subtype: "premature_disconnection",
				timestamp: Date.now(),
				data: {
					sessionDurationSeconds: Math.floor(sessionDuration / 1000),
					isPremature: true,
				},
				success: false,
			})
		}
	}

	/**
	 * Setup credit operation monitoring
	 */
	private setupCreditMonitoring(): void {
		// Monitor enhanced credit system events
		this.enhancedCreditSystem.on("authenticationRecovered", () => {
			this.recordEvent({
				type: "auth",
				subtype: "authentication_recovered",
				timestamp: Date.now(),
				data: {},
				success: true,
			})
		})

		this.enhancedCreditSystem.on("authenticationLost", () => {
			this.recordEvent({
				type: "auth",
				subtype: "authentication_lost",
				timestamp: Date.now(),
				data: {},
				success: false,
			})
		})

		this.enhancedCreditSystem.on("operationProcessed", (event: any) => {
			this.metrics.credit.successfulOperations++
			this.recordEvent({
				type: "credit",
				subtype: "queued_operation_processed",
				timestamp: Date.now(),
				data: { operationId: event.operationId },
				success: true,
			})
		})

		this.enhancedCreditSystem.on("operationFailed", (event: any) => {
			this.metrics.credit.failedOperations++
			this.metrics.credit.lastOperationFailure = {
				timestamp: Date.now(),
				operation: event.operationId,
				error: event.error,
			}
			this.recordEvent({
				type: "credit",
				subtype: "queued_operation_failed",
				timestamp: Date.now(),
				data: { operationId: event.operationId, error: event.error },
				success: false,
			})
		})

		this.enhancedCreditSystem.on("transactionSynced", (event: any) => {
			this.recordEvent({
				type: "credit",
				subtype: "offline_transaction_synced",
				timestamp: Date.now(),
				data: { transactionId: event.transactionId },
				success: true,
			})
		})
	}

	/**
	 * Start periodic health checks
	 */
	private startPeriodicHealthChecks(): void {
		// Run health check every 5 minutes
		this.monitoringInterval = setInterval(
			async () => {
				try {
					await this.performHealthCheck()
				} catch (error) {
					console.error("[MONITOR] Health check failed:", error)
				}
			},
			5 * 60 * 1000,
		) // 5 minutes

		console.log("[MONITOR] Periodic health checks started (5-minute interval)")
	}

	/**
	 * Perform comprehensive health check
	 */
	private async performHealthCheck(): Promise<void> {
		const startTime = Date.now()
		console.log("[MONITOR] Performing system health check...")

		try {
			// Check authentication status
			const authState = await this.authService.getAuthenticationState()
			const accessToken = await this.authService.getAccessToken()

			// Check enhanced credit system status
			const creditSystemStatus = this.enhancedCreditSystem.getStatus()

			// Update performance metrics
			this.metrics.performance.uptime = Date.now() - this.startTime

			// Calculate cache hit rate
			const cacheStats = creditManager.getCacheStats()
			this.metrics.performance.cacheHitRate = this.calculateCacheHitRate()

			// Calculate queue processing rate
			this.metrics.performance.queueProcessingRate = this.calculateQueueProcessingRate()

			// Record health check event
			this.recordEvent({
				type: "performance",
				subtype: "health_check",
				timestamp: Date.now(),
				data: {
					authStatus: authState,
					creditSystemStatus,
					cacheStats,
					hasAccessToken: !!accessToken,
				},
				duration: Date.now() - startTime,
				success: true,
			})

			console.log("[MONITOR] Health check completed:", {
				isAuthenticated: authState.isAuthenticated,
				hasValidToken: !!accessToken,
				queuedOps: creditSystemStatus.queuedOperations,
				offlineOps: creditSystemStatus.offlineTransactions,
			})
		} catch (error) {
			console.error("[MONITOR] Health check failed:", error)
			this.recordEvent({
				type: "performance",
				subtype: "health_check_failed",
				timestamp: Date.now(),
				data: { error: error instanceof Error ? error.message : String(error) },
				duration: Date.now() - startTime,
				success: false,
			})
		}
	}

	/**
	 * Record a monitoring event
	 */
	private recordEvent(event: MonitoringEvent): void {
		this.events.push(event)

		// Keep only last 1000 events to prevent memory issues
		if (this.events.length > 1000) {
			this.events = this.events.slice(-1000)
		}

		// Update relevant metrics
		this.updateMetricsFromEvent(event)

		// Emit event for external listeners
		this.emit("monitoringEvent", event)
	}

	/**
	 * Update metrics based on recorded event
	 */
	private updateMetricsFromEvent(event: MonitoringEvent): void {
		// Update average response times
		if (event.duration && event.success) {
			if (event.type === "credit") {
				this.metrics.credit.averageProcessingTime = this.calculateNewAverage(
					this.metrics.credit.averageProcessingTime,
					event.duration,
					this.metrics.credit.totalOperations,
				)
			} else if (event.type === "performance") {
				this.metrics.performance.averageResponseTime = this.calculateNewAverage(
					this.metrics.performance.averageResponseTime,
					event.duration,
					this.getHealthCheckCount(),
				)
			}
		}

		// Update credit operation counts
		if (event.type === "credit") {
			this.metrics.credit.totalOperations++

			if (event.subtype.includes("queued")) {
				this.metrics.credit.queuedOperations++
			} else if (event.subtype.includes("offline")) {
				this.metrics.credit.offlineOperations++
			}
		}
	}

	/**
	 * Calculate new running average
	 */
	private calculateNewAverage(currentAvg: number, newValue: number, count: number): number {
		return (currentAvg * count + newValue) / (count + 1)
	}

	/**
	 * Calculate cache hit rate
	 */
	private calculateCacheHitRate(): number {
		// This would need to be implemented based on cache statistics
		// For now, return a placeholder
		return 0.85 // 85% hit rate as example
	}

	/**
	 * Calculate queue processing rate
	 */
	private calculateQueueProcessingRate(): number {
		const processedEvents = this.events.filter(
			(e) => e.type === "credit" && e.subtype === "queued_operation_processed" && e.success,
		).length

		const queuedEvents = this.events.filter((e) => e.type === "credit" && e.subtype.includes("queued")).length

		return queuedEvents > 0 ? processedEvents / queuedEvents : 1.0
	}

	/**
	 * Get health check count
	 */
	private getHealthCheckCount(): number {
		return this.events.filter((e) => e.subtype === "health_check").length
	}

	/**
	 * Generate comprehensive system health report
	 */
	async generateHealthReport(): Promise<SystemHealthReport> {
		console.log("[MONITOR] Generating comprehensive health report...")

		const timestamp = Date.now()

		// Get current system status
		const authState = await this.authService.getAuthenticationState()
		const creditSystemStatus = this.enhancedCreditSystem.getStatus()

		// Calculate overall health score
		const healthScore = this.calculateOverallHealth()
		const overallHealth = healthScore >= 0.8 ? "healthy" : healthScore >= 0.5 ? "degraded" : "unhealthy"

		// Generate recommendations
		const recommendations = this.generateRecommendations(healthScore, authState, creditSystemStatus)

		// Generate alerts
		const alerts = this.generateAlerts(authState, creditSystemStatus)

		const report: SystemHealthReport = {
			timestamp,
			overallHealth,
			authHealth: { ...this.metrics.auth },
			creditHealth: { ...this.metrics.credit },
			performance: {
				...this.metrics.performance,
				uptime: timestamp - this.startTime,
			},
			recommendations,
			alerts,
		}

		console.log("[MONITOR] Health report generated:", {
			overallHealth: report.overallHealth,
			authSuccessRate:
				this.metrics.auth.totalAuthAttempts > 0
					? ((this.metrics.auth.successfulAuths / this.metrics.auth.totalAuthAttempts) * 100).toFixed(1) + "%"
					: "N/A",
			creditSuccessRate:
				this.metrics.credit.totalOperations > 0
					? ((this.metrics.credit.successfulOperations / this.metrics.credit.totalOperations) * 100).toFixed(
							1,
						) + "%"
					: "N/A",
			queuedOps: this.metrics.credit.queuedOperations,
			offlineOps: this.metrics.credit.offlineOperations,
		})

		return report
	}

	/**
	 * Calculate overall system health score (0-1)
	 */
	private calculateOverallHealth(): number {
		let score = 1.0

		// Authentication health weight: 40%
		const authSuccessRate =
			this.metrics.auth.totalAuthAttempts > 0
				? this.metrics.auth.successfulAuths / this.metrics.auth.totalAuthAttempts
				: 1.0
		score *= 0.4 * authSuccessRate + 0.6 // Weighted score

		// Credit operation health weight: 40%
		const creditSuccessRate =
			this.metrics.credit.totalOperations > 0
				? this.metrics.credit.successfulOperations / this.metrics.credit.totalOperations
				: 1.0
		score *= 0.4 * creditSuccessRate + 0.6 // Weighted score

		// Performance health weight: 20%
		const performanceScore = this.calculatePerformanceScore()
		score *= 0.2 * performanceScore + 0.8 // Weighted score

		return Math.max(0, Math.min(1, score))
	}

	/**
	 * Calculate performance score
	 */
	private calculatePerformanceScore(): number {
		let score = 1.0

		// Penalize for high queue processing rates (indicates auth issues)
		if (this.metrics.performance.queueProcessingRate < 0.8) {
			score *= 0.7
		}

		// Penalize for low sync success rates
		if (this.metrics.performance.syncSuccessRate < 0.9) {
			score *= 0.8
		}

		return score
	}

	/**
	 * Generate system recommendations
	 */
	private generateRecommendations(healthScore: number, authState: any, creditStatus: any): string[] {
		const recommendations: string[] = []

		// Authentication recommendations
		if (!authState.isAuthenticated) {
			recommendations.push("User needs to authenticate to enable full functionality")
		} else if (!authState.isConnected) {
			recommendations.push("User is authenticated but not connected to Supabase - check webhook sync")
		}

		// Credit system recommendations
		if (creditStatus.queuedOperations > 10) {
			recommendations.push("High number of queued operations - check authentication stability")
		}

		if (creditStatus.offlineTransactions > 5) {
			recommendations.push("Multiple offline transactions pending - sync when possible")
		}

		// Performance recommendations
		if (this.metrics.auth.failedAuths > this.metrics.auth.successfulAuths) {
			recommendations.push("High authentication failure rate - check token validity and network")
		}

		if (this.metrics.performance.averageResponseTime > 5000) {
			recommendations.push("High average response time - check network connectivity")
		}

		// Health-based recommendations
		if (healthScore < 0.5) {
			recommendations.push("System health is poor - consider restarting VSCode or re-authenticating")
		} else if (healthScore < 0.8) {
			recommendations.push("System health is degraded - monitor for recurring issues")
		}

		return recommendations
	}

	/**
	 * Generate system alerts
	 */
	private generateAlerts(authState: any, creditStatus: any): string[] {
		const alerts: string[] = []

		// Critical alerts
		if (creditStatus.queuedOperations > 20) {
			alerts.push("CRITICAL: Large number of queued credit operations")
		}

		if (this.metrics.auth.failedAuths > 5) {
			alerts.push("WARNING: Multiple authentication failures detected")
		}

		if (creditStatus.offlineTransactions > 10) {
			alerts.push("WARNING: High number of offline transactions pending sync")
		}

		// Recent failure alerts
		const recentFailures = this.getRecentFailures(5 * 60 * 1000) // Last 5 minutes
		if (recentFailures.length > 3) {
			alerts.push("ALERT: Multiple recent failures detected")
		}

		return alerts
	}

	/**
	 * Get recent failure events
	 */
	private getRecentFailures(timeWindowMs: number): MonitoringEvent[] {
		const cutoff = Date.now() - timeWindowMs
		return this.events.filter((e) => e.timestamp > cutoff && !e.success)
	}

	/**
	 * Get system diagnostics for troubleshooting
	 */
	async getSystemDiagnostics(): Promise<{
		health: SystemHealthReport
		recentEvents: MonitoringEvent[]
		authDiagnostics: any
		creditDiagnostics: any
	}> {
		console.log("[MONITOR] Generating system diagnostics...")

		const health = await this.generateHealthReport()
		const recentEvents = this.events.slice(-20) // Last 20 events

		// Get authentication diagnostics
		const authDiagnostics = {
			currentState: await this.authService.getAuthenticationState(),
			hasAccessToken: !!(await this.authService.getAccessToken()),
			hasRefreshToken: !!(await this.authService.getRefreshToken()),
			cacheStats: creditManager.getCacheStats(),
		}

		// Get credit system diagnostics
		const creditDiagnostics = this.enhancedCreditSystem.getDiagnostics()

		return {
			health,
			recentEvents,
			authDiagnostics,
			creditDiagnostics,
		}
	}

	/**
	 * Export monitoring data for analysis
	 */
	exportMonitoringData(): {
		metrics: {
			auth: AuthHealthMetrics
			credit: CreditMetrics
			performance: PerformanceMetrics
		}
		events: MonitoringEvent[]
		summary: {
			totalEvents: number
			eventsByType: Record<string, number>
			successRate: number
			uptimeHours: number
		}
	} {
		const eventsByType: Record<string, number> = {}
		let successfulEvents = 0

		for (const event of this.events) {
			eventsByType[event.type] = (eventsByType[event.type] || 0) + 1
			if (event.success) successfulEvents++
		}

		return {
			metrics: this.metrics,
			events: [...this.events],
			summary: {
				totalEvents: this.events.length,
				eventsByType,
				successRate: this.events.length > 0 ? successfulEvents / this.events.length : 1.0,
				uptimeHours: (Date.now() - this.startTime) / (1000 * 60 * 60),
			},
		}
	}

	/**
	 * Clear monitoring history
	 */
	clearHistory(): void {
		this.events = []
		console.log("[MONITOR] Monitoring history cleared")
	}

	/**
	 * Show user-friendly system status
	 */
	async showSystemStatus(): Promise<void> {
		const health = await this.generateHealthReport()

		let statusMessage = `System Health: ${health.overallHealth.toUpperCase()}`

		if (health.alerts.length > 0) {
			statusMessage += `\n⚠️ Alerts: ${health.alerts.length}`
		}

		if (health.creditHealth.queuedOperations > 0) {
			statusMessage += `\n📋 Queued Operations: ${health.creditHealth.queuedOperations}`
		}

		if (health.creditHealth.offlineOperations > 0) {
			statusMessage += `\n💾 Offline Transactions: ${health.creditHealth.offlineOperations}`
		}

		const actions: string[] = []

		if (health.overallHealth === "unhealthy") {
			actions.push("View Diagnostics", "Restart System")
		} else if (health.alerts.length > 0) {
			actions.push("View Details")
		}

		if (health.creditHealth.queuedOperations > 0 || health.creditHealth.offlineOperations > 0) {
			actions.push("Force Sync")
		}

		const choice = await vscode.window.showInformationMessage(statusMessage, ...actions)

		if (choice === "View Diagnostics" || choice === "View Details") {
			await this.showDetailedDiagnostics()
		} else if (choice === "Force Sync") {
			await this.performForceSync()
		} else if (choice === "Restart System") {
			await this.restartSystem()
		}
	}

	/**
	 * Show detailed diagnostics in output channel
	 */
	private async showDetailedDiagnostics(): Promise<void> {
		const diagnostics = await this.getSystemDiagnostics()

		const output = vscode.window.createOutputChannel("Softcodes Diagnostics")
		output.clear()

		output.appendLine("=== SOFTCODES SYSTEM DIAGNOSTICS ===")
		output.appendLine(`Generated: ${new Date().toISOString()}`)
		output.appendLine("")

		output.appendLine("=== SYSTEM HEALTH ===")
		output.appendLine(`Overall Health: ${diagnostics.health.overallHealth.toUpperCase()}`)
		output.appendLine(
			`Auth Success Rate: ${((diagnostics.health.authHealth.successfulAuths / Math.max(1, diagnostics.health.authHealth.totalAuthAttempts)) * 100).toFixed(1)}%`,
		)
		output.appendLine(
			`Credit Success Rate: ${((diagnostics.health.creditHealth.successfulOperations / Math.max(1, diagnostics.health.creditHealth.totalOperations)) * 100).toFixed(1)}%`,
		)
		output.appendLine("")

		if (diagnostics.health.alerts.length > 0) {
			output.appendLine("=== ALERTS ===")
			diagnostics.health.alerts.forEach((alert) => output.appendLine(`⚠️ ${alert}`))
			output.appendLine("")
		}

		if (diagnostics.health.recommendations.length > 0) {
			output.appendLine("=== RECOMMENDATIONS ===")
			diagnostics.health.recommendations.forEach((rec) => output.appendLine(`💡 ${rec}`))
			output.appendLine("")
		}

		output.appendLine("=== RECENT EVENTS ===")
		diagnostics.recentEvents.forEach((event) => {
			const status = event.success ? "✅" : "❌"
			output.appendLine(`${status} ${new Date(event.timestamp).toISOString()} - ${event.type}:${event.subtype}`)
		})

		output.show()
		vscode.window.showInformationMessage("Detailed diagnostics opened in output panel")
	}

	/**
	 * Perform force sync of all pending operations
	 */
	private async performForceSync(): Promise<void> {
		try {
			vscode.window.showInformationMessage("Starting force sync of pending operations...")

			const result = await this.enhancedCreditSystem.forceSyncAll()

			vscode.window.showInformationMessage(`Sync completed: ${result.synced} synced, ${result.failed} failed`)
		} catch (error) {
			vscode.window.showErrorMessage(
				`Force sync failed: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * Restart the monitoring system
	 */
	private async restartSystem(): Promise<void> {
		try {
			console.log("[MONITOR] Restarting system...")

			// Clear all caches
			creditManager.clearAllCaches()
			await this.enhancedCreditSystem.clearAllPendingOperations()

			// Reset metrics
			this.metrics.auth = {
				totalAuthAttempts: 0,
				successfulAuths: 0,
				failedAuths: 0,
				tokenRefreshAttempts: 0,
				successfulRefreshes: 0,
				averageTokenLifetime: 0,
				tokenLifetimeEvents: [],
				prematureDisconnections: 0,
				sessionDurations: [],
				averageSessionDuration: 0,
			}

			this.metrics.credit = {
				totalOperations: 0,
				successfulOperations: 0,
				queuedOperations: 0,
				offlineOperations: 0,
				failedOperations: 0,
				averageProcessingTime: 0,
			}

			this.clearHistory()

			vscode.window.showInformationMessage("System restarted successfully")
		} catch (error) {
			vscode.window.showErrorMessage(
				`System restart failed: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * Get monitoring metrics
	 */
	getMetrics(): typeof this.metrics {
		return { ...this.metrics }
	}

	/**
	 * Get recent events
	 */
	getRecentEvents(count: number = 50): MonitoringEvent[] {
		return this.events.slice(-count)
	}

	/**
	 * Cleanup resources
	 */
	dispose(): void {
		if (this.monitoringInterval) {
			clearInterval(this.monitoringInterval)
		}
		this.removeAllListeners()
		console.log("[MONITOR] Credit and auth monitor disposed")
	}
}

/**
 * Singleton instance for easy access
 */
let monitorInstance: CreditAuthMonitor | undefined

/**
 * Get or create monitor instance
 */
export function getCreditAuthMonitor(context: vscode.ExtensionContext): CreditAuthMonitor {
	if (!monitorInstance) {
		monitorInstance = CreditAuthMonitor.getInstance(context)
	}
	return monitorInstance
}

/**
 * Quick system health check function
 */
export async function quickHealthCheck(context: vscode.ExtensionContext): Promise<string> {
	const monitor = getCreditAuthMonitor(context)
	const health = await monitor.generateHealthReport()

	return `System Health: ${health.overallHealth} | Queued: ${health.creditHealth.queuedOperations} | Offline: ${health.creditHealth.offlineOperations}`
}

/**
 * Export types for use in other modules
 */
export type { AuthHealthMetrics, CreditMetrics, PerformanceMetrics, SystemHealthReport, MonitoringEvent }
