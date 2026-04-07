/**
 * Enhanced Credit System
 *
 * Provides robust credit tracking that continues to work even when authentication fails.
 * Features:
 * - Fallback credit tracking during auth failures
 * - Operation queueing and retry mechanisms
 * - Persistent session management
 * - Graceful degradation with automatic recovery
 */
import * as vscode from "vscode"
import { EventEmitter } from "events"
import { creditManager, CreditTransaction, CreditOperationMetadata } from "./creditManager"
import { UnifiedAuthService } from "../auth/unifiedAuthService"

/**
 * Queued credit operation for retry
 */
interface QueuedCreditOperation {
	id: string
	operationType: string
	usdAmount: number
	description?: string
	metadata?: CreditOperationMetadata
	timestamp: number
	attempts: number
	maxAttempts: number
	lastError?: string
}

/**
 * Offline credit transaction for fallback tracking
 */
interface OfflineCreditTransaction {
	id: string
	operationType: string
	usdAmount: number
	creditsEstimated: number
	description?: string
	timestamp: number
	synced: boolean
	metadata?: CreditOperationMetadata
}

/**
 * Enhanced credit system status
 */
interface CreditSystemStatus {
	isOnline: boolean
	isAuthenticated: boolean
	hasValidToken: boolean
	queuedOperations: number
	offlineTransactions: number
	lastSyncTime?: number
	lastError?: string
}

/**
 * Enhanced Credit System that provides resilient credit tracking
 */
export class EnhancedCreditSystem extends EventEmitter {
	private static instance: EnhancedCreditSystem
	private authService: UnifiedAuthService
	private operationQueue: QueuedCreditOperation[] = []
	private offlineTransactions: OfflineCreditTransaction[] = []
	private isProcessingQueue = false
	private status: CreditSystemStatus = {
		isOnline: false,
		isAuthenticated: false,
		hasValidToken: false,
		queuedOperations: 0,
		offlineTransactions: 0,
	}
	private syncInterval?: NodeJS.Timeout
	private retryTimeout?: NodeJS.Timeout

	private constructor(context: vscode.ExtensionContext) {
		super()
		this.authService = UnifiedAuthService.getInstance(context)
		this.initializeSystem()
	}

	static getInstance(context: vscode.ExtensionContext): EnhancedCreditSystem {
		if (!EnhancedCreditSystem.instance) {
			EnhancedCreditSystem.instance = new EnhancedCreditSystem(context)
		}
		return EnhancedCreditSystem.instance
	}

	/**
	 * Initialize the enhanced credit system
	 */
	private async initializeSystem(): Promise<void> {
		try {
			console.log("[ENHANCED-CREDIT] Initializing enhanced credit system...")

			// Load persisted data
			await this.loadPersistedData()

			// Check initial authentication status
			await this.updateAuthenticationStatus()

			// Start background sync process
			this.startBackgroundSync()

			// Setup authentication event listeners
			this.setupAuthenticationListeners()

			console.log("[ENHANCED-CREDIT] Enhanced credit system initialized successfully")
		} catch (error) {
			console.error("[ENHANCED-CREDIT] Failed to initialize enhanced credit system:", error)
		}
	}

	/**
	 * Main credit deduction method with enhanced resilience
	 */
	async deductCredits(
		operationType: string,
		usdAmount: number,
		description?: string,
		metadata?: CreditOperationMetadata,
	): Promise<CreditTransaction> {
		const operationId = this.generateOperationId()
		const metadataWithRequestId: CreditOperationMetadata = {
			...metadata,
			operationId,
			requestId: metadata?.requestId || operationId,
			enhancedSystem: true,
			timestamp: Date.now(),
		}
		console.log(
			`[ENHANCED-CREDIT] ${operationId}: Starting resilient credit deduction for ${operationType} ($${usdAmount})`,
		)

		// Check if this operation is already queued or being processed
		const existingQueued = this.operationQueue.find(
			(op) =>
				op.operationType === operationType &&
				op.usdAmount === usdAmount &&
				op.description === description &&
				Date.now() - op.timestamp < 30000, // Within 30 seconds
		)

		if (existingQueued) {
			console.log(
				`[ENHANCED-CREDIT] ${operationId}: Duplicate operation detected, returning existing queued operation`,
			)
			return {
				success: true,
				creditsDeducted:
					existingQueued.metadata?.estimatedCredits || creditManager.calculateCreditsForUSD(usdAmount),
				balanceBefore: 0,
				balanceAfter: 0,
				usdAmount,
				transactionId: existingQueued.id,
				message: "Operation already queued - preventing duplicate deduction",
			}
		}

		try {
			// Check current authentication status
			await this.updateAuthenticationStatus()

			if (this.status.hasValidToken) {
				// Primary path: Normal credit deduction with valid token
				console.log(`[ENHANCED-CREDIT] ${operationId}: Using primary credit deduction path`)
				const accessToken = await this.authService.getAccessToken()

				if (accessToken) {
					const transaction = await creditManager.deductCreditsFromJWT(
						accessToken,
						usdAmount,
						description,
						metadataWithRequestId,
					)

					if (transaction.success) {
						console.log(`[ENHANCED-CREDIT] ${operationId}: Primary deduction successful`)
						// Remove any queued operations for this same request
						this.removeQueuedOperationByRequestId(metadataWithRequestId.requestId!)
						// Return the original transaction ID from the credit manager
						return transaction
					} else {
						console.warn(`[ENHANCED-CREDIT] ${operationId}: Primary deduction failed: ${transaction.error}`)
						// Fall through to fallback handling
					}
				}
			}

			// Fallback path: Queue operation or use offline tracking
			console.log(`[ENHANCED-CREDIT] ${operationId}: Using fallback credit tracking`)
			return await this.handleFallbackCreditDeduction(
				operationId,
				operationType,
				usdAmount,
				description,
				metadataWithRequestId,
			)
		} catch (error) {
			console.error(`[ENHANCED-CREDIT] ${operationId}: Credit deduction failed:`, error)

			// Emergency fallback: Always track the operation locally
			return await this.handleFallbackCreditDeduction(
				operationId,
				operationType,
				usdAmount,
				description,
				metadataWithRequestId,
			)
		}
	}

	/**
	 * Handle fallback credit deduction when primary method fails
	 */
	private async handleFallbackCreditDeduction(
		operationId: string,
		operationType: string,
		usdAmount: number,
		description?: string,
		metadata?: CreditOperationMetadata,
	): Promise<CreditTransaction> {
		const metadataWithRequestId: CreditOperationMetadata = {
			...metadata,
			operationId,
			requestId: metadata?.requestId || operationId,
		}
		const creditsEstimated = creditManager.calculateCreditsForUSD(usdAmount, "softcodes/openrouter") // Use provider-aware conversion

		// Option 1: Queue for retry if we expect authentication to recover soon
		if (this.shouldQueueOperation(operationType)) {
			console.log(`[ENHANCED-CREDIT] ${operationId}: Queueing operation for retry`)

			const queuedOperation: QueuedCreditOperation = {
				id: operationId,
				operationType,
				usdAmount,
				description,
				metadata: metadataWithRequestId,
				timestamp: Date.now(),
				attempts: 0,
				maxAttempts: 3,
			}

			this.operationQueue.push(queuedOperation)
			this.status.queuedOperations = this.operationQueue.length
			await this.persistQueuedOperations()

			// Start retry processing if not already running
			this.scheduleRetryProcessing()

			return {
				success: true,
				creditsDeducted: creditsEstimated,
				balanceBefore: 0, // Unknown in offline mode
				balanceAfter: 0, // Unknown in offline mode
				usdAmount,
				transactionId: operationId,
				message: "Operation queued - will be processed when authentication is restored",
			}
		}

		// Option 2: Track offline and sync later
		console.log(`[ENHANCED-CREDIT] ${operationId}: Using offline credit tracking`)

		const offlineTransaction: OfflineCreditTransaction = {
			id: operationId,
			operationType,
			usdAmount,
			creditsEstimated,
			description,
			timestamp: Date.now(),
			synced: false,
			metadata: metadataWithRequestId,
		}

		this.offlineTransactions.push(offlineTransaction)
		this.status.offlineTransactions = this.offlineTransactions.filter((t) => !t.synced).length
		await this.persistOfflineTransactions()

		// Show user feedback about offline mode
		this.showOfflineModeNotification()

		return {
			success: true,
			creditsDeducted: creditsEstimated,
			balanceBefore: 0, // Unknown in offline mode
			balanceAfter: 0, // Unknown in offline mode
			usdAmount,
			transactionId: operationId,
			message: "Credits tracked offline - will sync when connection is restored",
		}
	}

	/**
	 * Update authentication status and trigger recovery if needed
	 */
	private async updateAuthenticationStatus(): Promise<void> {
		try {
			const authState = await this.authService.getAuthenticationState()
			const accessToken = await this.authService.getAccessToken()

			const previousStatus = { ...this.status }

			this.status = {
				...this.status,
				isAuthenticated: authState?.isAuthenticated || false,
				hasValidToken: !!accessToken,
				isOnline: authState?.isConnected || false,
			}

			// Detect authentication recovery
			if (!previousStatus.hasValidToken && this.status.hasValidToken) {
				console.log("[ENHANCED-CREDIT] Authentication recovered, processing queued operations")
				this.emit("authenticationRecovered")
				this.processQueuedOperations()
			}

			// Detect authentication loss
			if (previousStatus.hasValidToken && !this.status.hasValidToken) {
				console.log("[ENHANCED-CREDIT] Authentication lost, switching to fallback mode")
				this.emit("authenticationLost")
			}
		} catch (error) {
			console.error("[ENHANCED-CREDIT] Error updating authentication status:", error)
			this.status.lastError = error instanceof Error ? error.message : String(error)
			// Set safe defaults when auth service fails
			this.status.isAuthenticated = false
			this.status.hasValidToken = false
			this.status.isOnline = false
		}
	}

	/**
	 * Process queued operations when authentication is restored
	 */
	private async processQueuedOperations(): Promise<void> {
		if (this.isProcessingQueue || this.operationQueue.length === 0) {
			return
		}

		this.isProcessingQueue = true
		console.log(`[ENHANCED-CREDIT] Processing ${this.operationQueue.length} queued operations`)

		const processedOperations: string[] = []

		for (const operation of this.operationQueue) {
			try {
				const accessToken = await this.authService.getAccessToken()
				if (!accessToken) {
					console.log(`[ENHANCED-CREDIT] No access token available, stopping queue processing`)
					break
				}

				console.log(`[ENHANCED-CREDIT] Processing queued operation: ${operation.id}`)

				const transaction = await creditManager.deductCreditsFromJWT(
					accessToken,
					operation.usdAmount,
					operation.description,
					{
						...operation.metadata,
						queuedOperation: true,
						originalTimestamp: operation.timestamp,
						providerId: "softcodes/openrouter",
						requestId: operation.metadata?.requestId || operation.id,
					},
				)

				if (transaction.success) {
					console.log(`[ENHANCED-CREDIT] Successfully processed queued operation: ${operation.id}`)
					processedOperations.push(operation.id)
					this.emit("operationProcessed", { operationId: operation.id, transaction })
				} else {
					operation.attempts++
					operation.lastError = transaction.error || "Unknown error"

					if (operation.attempts >= operation.maxAttempts) {
						console.error(`[ENHANCED-CREDIT] Max attempts reached for operation: ${operation.id}`)
						processedOperations.push(operation.id) // Remove from queue
						this.emit("operationFailed", { operationId: operation.id, error: operation.lastError })
					}
				}
			} catch (error) {
				console.error(`[ENHANCED-CREDIT] Error processing queued operation ${operation.id}:`, error)
				operation.attempts++
				operation.lastError = error instanceof Error ? error.message : String(error)

				if (operation.attempts >= operation.maxAttempts) {
					processedOperations.push(operation.id)
				}
			}
		}

		// Remove processed operations from queue
		this.operationQueue = this.operationQueue.filter((op) => !processedOperations.includes(op.id))
		await this.persistQueuedOperations()

		this.status.queuedOperations = this.operationQueue.length
		this.isProcessingQueue = false

		console.log(`[ENHANCED-CREDIT] Queue processing completed. Remaining: ${this.operationQueue.length}`)
	}

	/**
	 * Sync offline transactions when connection is restored
	 */
	private async syncOfflineTransactions(): Promise<void> {
		const unsyncedTransactions = this.offlineTransactions.filter((t) => !t.synced)

		if (unsyncedTransactions.length === 0) {
			return
		}

		console.log(`[ENHANCED-CREDIT] Syncing ${unsyncedTransactions.length} offline transactions`)

		for (const transaction of unsyncedTransactions) {
			try {
				const accessToken = await this.authService.getAccessToken()
				if (!accessToken) {
					console.log("[ENHANCED-CREDIT] No access token for sync, postponing")
					break
				}

				// Attempt to deduct credits for offline transaction
				const result = await creditManager.deductCreditsFromJWT(
					accessToken,
					transaction.usdAmount,
					transaction.description + " (offline sync)",
					{
						...transaction.metadata,
						offlineSync: true,
						originalTimestamp: transaction.timestamp,
						providerId: "softcodes/openrouter",
						requestId: transaction.metadata?.requestId || transaction.id,
					},
				)

				if (result.success) {
					transaction.synced = true
					console.log(`[ENHANCED-CREDIT] Synced offline transaction: ${transaction.id}`)
					this.emit("transactionSynced", { transactionId: transaction.id, result })
				} else {
					console.error(
						`[ENHANCED-CREDIT] Failed to sync offline transaction ${transaction.id}:`,
						result.error,
					)
				}
			} catch (error) {
				console.error(`[ENHANCED-CREDIT] Error syncing offline transaction ${transaction.id}:`, error)
			}
		}

		await this.persistOfflineTransactions()
		this.status.offlineTransactions = this.offlineTransactions.filter((t) => !t.synced).length
		this.status.lastSyncTime = Date.now()
	}

	/**
	 * Start background sync process
	 */
	private startBackgroundSync(): void {
		// Clear any existing interval
		if (this.syncInterval) {
			clearInterval(this.syncInterval)
		}

		// Sync every 2 minutes
		this.syncInterval = setInterval(async () => {
			try {
				await this.updateAuthenticationStatus()

				if (this.status.hasValidToken) {
					await this.syncOfflineTransactions()
					await this.processQueuedOperations()
				}
			} catch (error) {
				console.error("[ENHANCED-CREDIT] Background sync error:", error)
			}
		}, 120000) // 2 minutes

		console.log("[ENHANCED-CREDIT] Background sync started (2-minute interval)")
	}

	/**
	 * Schedule retry processing with exponential backoff
	 */
	private scheduleRetryProcessing(): void {
		if (this.retryTimeout) {
			return // Already scheduled
		}

		const delay = Math.min(1000 * Math.pow(2, Math.floor(this.operationQueue.length / 5)), 60000) // Max 1 minute

		this.retryTimeout = setTimeout(async () => {
			this.retryTimeout = undefined

			try {
				await this.updateAuthenticationStatus()
				if (this.status.hasValidToken) {
					await this.processQueuedOperations()
				} else {
					// Schedule another retry if still no token
					this.scheduleRetryProcessing()
				}
			} catch (error) {
				console.error("[ENHANCED-CREDIT] Retry processing error:", error)
				this.scheduleRetryProcessing() // Try again
			}
		}, delay)

		console.log(`[ENHANCED-CREDIT] Retry processing scheduled in ${delay}ms`)
	}

	/**
	 * Setup authentication event listeners
	 */
	private setupAuthenticationListeners(): void {
		// Listen for authentication events
		this.on("authenticationRecovered", () => {
			vscode.window.showInformationMessage("Connection restored! Processing pending credit operations...")
		})

		this.on("authenticationLost", () => {
			vscode.window.showWarningMessage("Connection lost. Credit operations will continue in offline mode.")
		})

		this.on("operationProcessed", (event) => {
			console.log(`[ENHANCED-CREDIT] Processed queued operation: ${event.operationId}`)
		})

		this.on("operationFailed", (event) => {
			console.error(`[ENHANCED-CREDIT] Failed to process operation: ${event.operationId} - ${event.error}`)
		})

		this.on("transactionSynced", (event) => {
			console.log(`[ENHANCED-CREDIT] Synced offline transaction: ${event.transactionId}`)
		})
	}

	/**
	 * Determine if operation should be queued vs tracked offline
	 */
	private shouldQueueOperation(operationType: string): boolean {
		// Queue critical operations that must be executed
		const criticalOperations = ["CODE_GENERATION", "CODE_ANALYSIS", "SIMPLE_QUERY"]

		return criticalOperations.includes(operationType)
	}

	/**
	 * Show user notification about offline mode
	 */
	private showOfflineModeNotification(): void {
		const now = Date.now()
		const lastNotification = this.getLastNotificationTime()

		// Don't spam notifications - only show once every 10 minutes
		if (now - lastNotification > 600000) {
			vscode.window.showInformationMessage(
				"Working offline - credits will be synced when connection is restored",
				"Understood",
			)
			this.setLastNotificationTime(now)
		}
	}

	/**
	 * Get last notification time from storage
	 */
	private getLastNotificationTime(): number {
		try {
			const stored = vscode.workspace.getConfiguration("softcodes").get("lastOfflineNotification", 0)
			return typeof stored === "number" ? stored : 0
		} catch {
			return 0
		}
	}

	/**
	 * Set last notification time in storage
	 */
	private setLastNotificationTime(time: number): void {
		try {
			vscode.workspace
				.getConfiguration("softcodes")
				.update("lastOfflineNotification", time, vscode.ConfigurationTarget.Global)
		} catch (error) {
			console.warn("[ENHANCED-CREDIT] Failed to update notification time:", error)
		}
	}

	/**
	 * Load persisted queue and offline data
	 */
	private async loadPersistedData(): Promise<void> {
		try {
			// Load queued operations
			const queueData = vscode.workspace.getConfiguration("softcodes").get("creditOperationQueue", "[]")
			if (typeof queueData === "string") {
				this.operationQueue = JSON.parse(queueData)
				console.log(`[ENHANCED-CREDIT] Loaded ${this.operationQueue.length} queued operations`)
			}

			// Load offline transactions
			const offlineData = vscode.workspace.getConfiguration("softcodes").get("offlineCreditTransactions", "[]")
			if (typeof offlineData === "string") {
				this.offlineTransactions = JSON.parse(offlineData)
				console.log(`[ENHANCED-CREDIT] Loaded ${this.offlineTransactions.length} offline transactions`)
			}

			this.status.queuedOperations = this.operationQueue.length
			this.status.offlineTransactions = this.offlineTransactions.filter((t) => !t.synced).length
		} catch (error) {
			console.error("[ENHANCED-CREDIT] Error loading persisted data:", error)
			this.operationQueue = []
			this.offlineTransactions = []
		}
	}

	/**
	 * Persist queued operations to VSCode settings
	 */
	private async persistQueuedOperations(): Promise<void> {
		try {
			const config = vscode.workspace.getConfiguration("softcodes")
			await config.update(
				"creditOperationQueue",
				JSON.stringify(this.operationQueue),
				vscode.ConfigurationTarget.Global,
			)
		} catch (error) {
			console.error("[ENHANCED-CREDIT] Failed to persist queued operations:", error)
		}
	}

	/**
	 * Persist offline transactions to VSCode settings
	 */
	private async persistOfflineTransactions(): Promise<void> {
		try {
			const config = vscode.workspace.getConfiguration("softcodes")
			await config.update(
				"offlineCreditTransactions",
				JSON.stringify(this.offlineTransactions),
				vscode.ConfigurationTarget.Global,
			)
		} catch (error) {
			console.error("[ENHANCED-CREDIT] Failed to persist offline transactions:", error)
		}
	}

	/**
	 * Remove queued operation by request ID to prevent duplicates
	 */
	private removeQueuedOperationByRequestId(requestId: string): void {
		const initialLength = this.operationQueue.length
		this.operationQueue = this.operationQueue.filter((op) => op.metadata?.requestId !== requestId)
		const removedCount = initialLength - this.operationQueue.length
		if (removedCount > 0) {
			console.log(`[ENHANCED-CREDIT] Removed ${removedCount} queued operations for request: ${requestId}`)
			this.persistQueuedOperations()
		}
	}

	/**
	 * Generate unique operation ID
	 */
	private generateOperationId(): string {
		return `enh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	}

	/**
	 * Get current system status
	 */
	getStatus(): CreditSystemStatus {
		return { ...this.status }
	}

	/**
	 * Force sync of all pending operations
	 */
	async forceSyncAll(): Promise<{ synced: number; failed: number }> {
		console.log("[ENHANCED-CREDIT] Force syncing all pending operations")

		await this.updateAuthenticationStatus()

		if (!this.status.hasValidToken) {
			return { synced: 0, failed: 0 }
		}

		const initialQueueSize = this.operationQueue.length
		const initialOfflineSize = this.offlineTransactions.filter((t) => !t.synced).length

		await this.processQueuedOperations()
		await this.syncOfflineTransactions()

		const finalQueueSize = this.operationQueue.length
		const finalOfflineSize = this.offlineTransactions.filter((t) => !t.synced).length

		const synced = initialQueueSize - finalQueueSize + (initialOfflineSize - finalOfflineSize)
		const failed = finalQueueSize + finalOfflineSize

		return { synced, failed }
	}

	/**
	 * Clear all queued and offline operations (admin function)
	 */
	async clearAllPendingOperations(): Promise<void> {
		this.operationQueue = []
		this.offlineTransactions = []

		await this.persistQueuedOperations()
		await this.persistOfflineTransactions()

		this.status.queuedOperations = 0
		this.status.offlineTransactions = 0

		console.log("[ENHANCED-CREDIT] All pending operations cleared")
	}

	/**
	 * Get detailed diagnostics
	 */
	getDiagnostics(): {
		status: CreditSystemStatus
		queuedOperations: QueuedCreditOperation[]
		offlineTransactions: OfflineCreditTransaction[]
		authState?: any
	} {
		return {
			status: this.getStatus(),
			queuedOperations: [...this.operationQueue],
			offlineTransactions: [...this.offlineTransactions],
		}
	}

	/**
	 * Cleanup resources
	 */
	dispose(): void {
		if (this.syncInterval) {
			clearInterval(this.syncInterval)
		}
		if (this.retryTimeout) {
			clearTimeout(this.retryTimeout)
		}
		this.removeAllListeners()
		console.log("[ENHANCED-CREDIT] Enhanced credit system disposed")
	}

	/**
	 * Format cost for provider-specific display
	 */
	public formatCost(providerId: string, amount: number): string {
		const { formatPrice } = require("./priceFormatter")
		return formatPrice(providerId, amount)
	}
}

/**
 * Singleton instance for easy access
 */
let enhancedCreditSystemInstance: EnhancedCreditSystem | undefined

/**
 * Get or create enhanced credit system instance
 */
export function getEnhancedCreditSystem(context: vscode.ExtensionContext): EnhancedCreditSystem {
	if (!enhancedCreditSystemInstance) {
		enhancedCreditSystemInstance = EnhancedCreditSystem.getInstance(context)
	}
	return enhancedCreditSystemInstance
}

/**
 * Get the global enhanced credit system instance without context
 * Throws if not initialized
 */
export function getGlobalEnhancedCreditSystem(): EnhancedCreditSystem {
	if (!enhancedCreditSystemInstance) {
		throw new Error("Enhanced Credit System not initialized. Call getEnhancedCreditSystem(context) first.")
	}
	return enhancedCreditSystemInstance
}

/**
 * Reset singleton instance (for testing)
 */
export function resetEnhancedCreditSystem(): void {
	if (enhancedCreditSystemInstance) {
		enhancedCreditSystemInstance.dispose()
	}
	enhancedCreditSystemInstance = undefined
	// Also reset the static instance in the class
	;(EnhancedCreditSystem as any).instance = undefined
}

/**
 * Enhanced credit deduction function that never fails
 */
export async function deductCreditsResilient(
	context: vscode.ExtensionContext,
	operationType: string,
	usdAmount: number,
	description?: string,
	metadata?: CreditOperationMetadata,
): Promise<CreditTransaction> {
	const enhancedSystem = getEnhancedCreditSystem(context)
	return enhancedSystem.deductCredits(operationType, usdAmount, description, metadata)
}

/**
 * Export types for use in other modules
 */
export type { QueuedCreditOperation, OfflineCreditTransaction, CreditSystemStatus }
