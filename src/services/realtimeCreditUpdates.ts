/**
 * Real-time Credit Updates Service
 *
 * Provides real-time credit balance updates using Supabase Realtime
 * Integrates with the credit manager to provide live updates to the VSCode extension UI
 */

import { EventEmitter } from "events"
import { creditManager, UserCreditInfo } from "./creditManager"
import { getSupabaseRealtimeClient, supabaseConfig } from "./supabaseConfig"

/**
 * Credit update event data
 */
interface CreditUpdateEvent {
	userId: string
	clerkId: string
	previousBalance: number
	newBalance: number
	creditsChanged: number
	usdAmount?: number
	operation: "deduction" | "addition" | "purchase" | "refund"
	timestamp: Date
}

/**
 * Low credit warning event
 */
interface LowCreditWarning {
	userId: string
	currentBalance: number
	threshold: number
	planType?: string
}

/**
 * Real-time subscription status
 */
interface SubscriptionStatus {
	connected: boolean
	userId?: string
	subscriptionId?: string
	lastUpdate?: Date
	errorCount: number
}

/**
 * Real-time credit updates service using Supabase Realtime
 */
export class RealtimeCreditService extends EventEmitter {
	private static instance: RealtimeCreditService
	private supabaseClient: any
	private subscriptions = new Map<string, any>()
	private status: SubscriptionStatus = {
		connected: false,
		errorCount: 0,
	}
	private readonly LOW_CREDIT_THRESHOLD = 10
	private reconnectAttempts = 0
	private readonly MAX_RECONNECT_ATTEMPTS = 5

	private constructor() {
		super()
		// Don't initialize connection in constructor - use lazy initialization
		console.log("[REALTIME-CREDITS] RealtimeCreditService created with lazy initialization")
	}

	static getInstance(): RealtimeCreditService {
		if (!RealtimeCreditService.instance) {
			RealtimeCreditService.instance = new RealtimeCreditService()
		}
		return RealtimeCreditService.instance
	}

	/**
	 * Initialize Supabase Realtime connection (lazy initialization)
	 */
	private async initializeRealtimeConnection(): Promise<void> {
		if (this.supabaseClient) {
			console.log("[REALTIME-CREDITS] Supabase client already initialized")
			return
		}

		try {
			console.log("[REALTIME-CREDITS] Initializing Supabase realtime client...")
			this.supabaseClient = await getSupabaseRealtimeClient()
			console.log("[REALTIME-CREDITS] ✅ Supabase realtime client initialized successfully")
		} catch (error) {
			console.error("[REALTIME-CREDITS] ❌ Failed to initialize Supabase client:", error)
			this.status.errorCount++
			throw error
		}
	}

	/**
	 * Get user info by Clerk ID (for realtime subscriptions)
	 */
	private async getUserInfoByClerkId(clerkUserId: string): Promise<UserCreditInfo | null> {
		try {
			// Ensure Supabase client is initialized
			if (!this.supabaseClient) {
				await this.initializeRealtimeConnection()
			}

			if (!this.supabaseClient) {
				console.error("[REALTIME-CREDITS] Supabase client still not available after initialization")
				return null
			}

			const { data, error } = await this.supabaseClient.rpc("get_user_credit_info", {
				p_clerk_id: clerkUserId,
			})

			if (error || !data || !data.success) {
				console.error("[REALTIME-CREDITS] Failed to get user info by Clerk ID:", error || data?.message)
				return null
			}

			return {
				userId: data.user_id,
				clerkId: data.clerk_id,
				currentCredits: data.current_credits || 0,
				creditsUsed: data.credits_used || 0,
				totalSpent: parseFloat(data.total_spent_usd || "0"),
				planType: data.plan_type,
				lastUpdate: data.last_credit_update,
			}
		} catch (error) {
			console.error("[REALTIME-CREDITS] Error getting user info by Clerk ID:", error)
			return null
		}
	}

	/**
	 * Subscribe to credit updates for a specific user
	 */
	async subscribeToUserCredits(
		clerkUserId: string,
		callback: (update: CreditUpdateEvent) => void,
	): Promise<string | null> {
		try {
			// Ensure Supabase client is initialized
			if (!this.supabaseClient) {
				console.log("[REALTIME-CREDITS] Initializing Supabase client for subscription...")
				await this.initializeRealtimeConnection()
			}

			if (!this.supabaseClient) {
				console.error("[REALTIME-CREDITS] Supabase client initialization failed")
				return null
			}

			// First get the internal user ID from clerk ID
			// For realtime subscriptions, we need to get user info directly from the database
			// since we don't have a JWT token in this context
			const userInfo = await this.getUserInfoByClerkId(clerkUserId)
			if (!userInfo) {
				console.error("[REALTIME-CREDITS] User not found for subscription:", clerkUserId)
				return null
			}

			const channelName = `credits-${clerkUserId}`

			// Unsubscribe from existing subscription for this user
			await this.unsubscribeFromUser(clerkUserId)

			console.log(`[REALTIME-CREDITS] Creating subscription for user: ${clerkUserId}`)

			const subscription = this.supabaseClient
				.channel(channelName)
				.on(
					"postgres_changes",
					{
						event: "UPDATE",
						schema: "public",
						table: "users",
						filter: `clerk_id=eq.${clerkUserId}`,
					},
					(payload: any) => {
						this.handleUserCreditUpdate(payload, callback)
					},
				)
				.on(
					"postgres_changes",
					{
						event: "INSERT",
						schema: "public",
						table: "credit_transactions",
						filter: `user_id=eq.${userInfo.userId}`,
					},
					(payload: any) => {
						this.handleCreditTransaction(payload, clerkUserId, callback)
					},
				)
				.subscribe((status: string) => {
					console.log(`[REALTIME-CREDITS] Subscription status for ${clerkUserId}:`, status)

					if (status === "SUBSCRIBED") {
						this.status.connected = true
						this.status.userId = clerkUserId
						this.status.lastUpdate = new Date()
						this.reconnectAttempts = 0
						this.emit("connected", { userId: clerkUserId })
					} else if (status === "CLOSED") {
						this.status.connected = false
						this.emit("disconnected", { userId: clerkUserId })
						this.handleReconnection(clerkUserId, callback)
					}
				})

			// Store subscription
			this.subscriptions.set(clerkUserId, subscription)
			this.status.subscriptionId = channelName

			return channelName
		} catch (error) {
			console.error("[REALTIME-CREDITS] Subscription failed:", error)
			this.status.errorCount++
			this.emit("error", { error, userId: clerkUserId })
			return null
		}
	}

	/**
	 * Handle user credit balance updates
	 */
	private handleUserCreditUpdate(payload: any, callback: (update: CreditUpdateEvent) => void) {
		try {
			const { old: oldRecord, new: newRecord } = payload

			const previousBalance = oldRecord?.credits || 0
			const newBalance = newRecord?.credits || 0
			const creditsChanged = newBalance - previousBalance

			if (creditsChanged === 0) return // No credit change

			const updateEvent: CreditUpdateEvent = {
				userId: newRecord.id,
				clerkId: newRecord.clerk_id,
				previousBalance,
				newBalance,
				creditsChanged,
				operation: creditsChanged > 0 ? "addition" : "deduction",
				timestamp: new Date(),
			}

			console.log(`[REALTIME-CREDITS] Credit update detected:`, {
				clerkId: updateEvent.clerkId,
				change: creditsChanged,
				newBalance: newBalance,
			})

			// Check for low credit warning
			this.checkLowCreditWarning(newRecord)

			// Invalidate cache for this user
			creditManager.clearUserCache(newRecord.clerk_id)

			// CRITICAL: Broadcast to UI immediately via VSCode command
			try {
				const vscode = require("vscode")
				vscode.commands.executeCommand("softcodes.updateCreditBalance", newBalance)
				console.log(`[REALTIME-CREDITS] Broadcasted balance update: ${newBalance}`)
			} catch (error) {
				console.warn(`[REALTIME-CREDITS] Failed to broadcast balance:`, error)
			}

			// Call the callback
			callback(updateEvent)

			// Emit event for other listeners
			this.emit("creditUpdate", updateEvent)
		} catch (error) {
			console.error("[REALTIME-CREDITS] Error handling credit update:", error)
			this.emit("error", { error })
		}
	}

	/**
	 * Handle credit transaction events
	 */
	private handleCreditTransaction(payload: any, clerkUserId: string, callback: (update: CreditUpdateEvent) => void) {
		try {
			const transaction = payload.new

			const updateEvent: CreditUpdateEvent = {
				userId: transaction.user_id,
				clerkId: clerkUserId,
				previousBalance: transaction.balance_before,
				newBalance: transaction.balance_after,
				creditsChanged: transaction.credits_amount * (transaction.operation_type === "deduction" ? -1 : 1),
				usdAmount: parseFloat(transaction.usd_amount),
				operation: transaction.operation_type,
				timestamp: new Date(transaction.created_at),
			}

			console.log(`[REALTIME-CREDITS] Transaction detected:`, {
				type: transaction.operation_type,
				amount: transaction.credits_amount,
				balance: transaction.balance_after,
			})

			// Call the callback
			callback(updateEvent)

			// Emit transaction event
			this.emit("creditTransaction", updateEvent)
		} catch (error) {
			console.error("[REALTIME-CREDITS] Error handling transaction:", error)
			this.emit("error", { error })
		}
	}

	/**
	 * Check for low credit warnings
	 */
	private checkLowCreditWarning(userRecord: any) {
		const currentBalance = userRecord.credits || 0

		if (currentBalance <= this.LOW_CREDIT_THRESHOLD && currentBalance > 0) {
			const warning: LowCreditWarning = {
				userId: userRecord.id,
				currentBalance,
				threshold: this.LOW_CREDIT_THRESHOLD,
				planType: userRecord.plan_type,
			}

			console.log(`[REALTIME-CREDITS] Low credit warning:`, warning)
			this.emit("lowCreditWarning", warning)
		}
	}

	/**
	 * Handle reconnection attempts
	 */
	private async handleReconnection(clerkUserId: string, callback: (update: CreditUpdateEvent) => void) {
		if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
			console.error("[REALTIME-CREDITS] Max reconnection attempts reached")
			this.emit("reconnectionFailed", { userId: clerkUserId })
			return
		}

		this.reconnectAttempts++
		const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000) // Exponential backoff, max 30s

		console.log(
			`[REALTIME-CREDITS] Attempting reconnection ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} in ${delay}ms`,
		)

		setTimeout(async () => {
			try {
				await this.subscribeToUserCredits(clerkUserId, callback)
			} catch (error) {
				console.error("[REALTIME-CREDITS] Reconnection failed:", error)
				this.handleReconnection(clerkUserId, callback)
			}
		}, delay)
	}

	/**
	 * Unsubscribe from user credit updates
	 */
	async unsubscribeFromUser(clerkUserId: string): Promise<void> {
		const subscription = this.subscriptions.get(clerkUserId)

		if (subscription) {
			try {
				await this.supabaseClient.removeChannel(subscription)
				this.subscriptions.delete(clerkUserId)

				console.log(`[REALTIME-CREDITS] Unsubscribed from user: ${clerkUserId}`)

				if (this.subscriptions.size === 0) {
					this.status.connected = false
					this.status.userId = undefined
				}
			} catch (error) {
				console.error("[REALTIME-CREDITS] Error unsubscribing:", error)
			}
		}
	}

	/**
	 * Unsubscribe from all credit updates
	 */
	async unsubscribeAll(): Promise<void> {
		try {
			const userIds = Array.from(this.subscriptions.keys())

			for (const userId of userIds) {
				await this.unsubscribeFromUser(userId)
			}

			this.subscriptions.clear()
			this.status.connected = false

			console.log("[REALTIME-CREDITS] Unsubscribed from all credit updates")
		} catch (error) {
			console.error("[REALTIME-CREDITS] Error unsubscribing from all:", error)
		}
	}

	/**
	 * Get current subscription status
	 */
	getStatus(): SubscriptionStatus {
		return { ...this.status }
	}

	/**
	 * Get active subscription count
	 */
	getActiveSubscriptions(): number {
		return this.subscriptions.size
	}

	/**
	 * Set low credit threshold
	 */
	setLowCreditThreshold(threshold: number): void {
		if (threshold > 0) {
			;(this as any).LOW_CREDIT_THRESHOLD = threshold
		}
	}
}

/**
 * Singleton instance for easy access
 */
export const realtimeCreditService = RealtimeCreditService.getInstance()

/**
 * Convenience functions for common operations
 */

/**
 * Subscribe to credit updates for a user
 */
export async function subscribeToUserCredits(
	clerkUserId: string,
	callback: (update: CreditUpdateEvent) => void,
): Promise<string | null> {
	return realtimeCreditService.subscribeToUserCredits(clerkUserId, callback)
}

/**
 * Unsubscribe from user credit updates
 */
export async function unsubscribeFromUserCredits(clerkUserId: string): Promise<void> {
	return realtimeCreditService.unsubscribeFromUser(clerkUserId)
}

/**
 * Listen for low credit warnings
 */
export function onLowCreditWarning(callback: (warning: LowCreditWarning) => void): void {
	realtimeCreditService.on("lowCreditWarning", callback)
}

/**
 * Listen for connection status changes
 */
export function onConnectionStatusChange(onConnected: () => void, onDisconnected: () => void): void {
	realtimeCreditService.on("connected", onConnected)
	realtimeCreditService.on("disconnected", onDisconnected)
}

/**
 * Export types for use in other modules
 */
export type { CreditUpdateEvent, LowCreditWarning, SubscriptionStatus }
