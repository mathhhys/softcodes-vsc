/**
 * Credit Integration Service
 *
 * Enhanced integration with credit badge system showing credit consumption
 * instead of dollar amounts in the VSCode status bar.
 */

import * as vscode from "vscode"
import { UnifiedAuthService } from "../auth/unifiedAuthService"
import { CreditBadgeManager } from "./creditBadge"
import { creditManager, CreditTransaction } from "./creditManager"
import { realtimeCreditService } from "./realtimeCreditUpdates"
import { getEnhancedCreditSystem, deductCreditsResilient } from "./enhancedCreditSystem"
import { formatPrice } from "./priceFormatter"

/**
 * API operation cost configuration
 */
// Deprecated: fixed API costs were replaced with dynamic post-payment deduction from OpenRouter
export const API_COSTS = {} as const

/**
 * API request result with credit information
 */
interface APIResultWithCredits<T = any> {
	success: boolean
	data?: T
	error?: string
	creditInfo: {
		charged: number
		remainingCredits: number
		transactionId?: string
		balanceBefore?: number
		display?: string
	}
}

/**
 * User credit information
 */
interface UserCreditInfo {
	userId: string
	clerkId: string
	currentCredits: number
	totalSpent: number
	creditsUsed: number
	planType?: string
	lastUpdate?: string
}

/**
 * Enhanced Credit-aware API client with resilient credit tracking
 */
export class CreditAwareAPIClient {
	private authService: UnifiedAuthService
	private isRealtimeConnected = false
	private currentUser: UserCreditInfo | null = null
	private badgeManager: CreditBadgeManager
	private enhancedCreditSystem: any
	private context: vscode.ExtensionContext

	constructor(context: vscode.ExtensionContext) {
		this.context = context
		this.authService = UnifiedAuthService.getInstance(context)
		this.badgeManager = CreditBadgeManager.getInstance(context)
		this.enhancedCreditSystem = getEnhancedCreditSystem(context)
		this.setupRealtimeCredits()
		this.initializeBadgeSystem(context)
		this.setupEnhancedCreditListeners()
	}

	private async initializeBadgeSystem(context: vscode.ExtensionContext): Promise<void> {
		try {
			await this.badgeManager.initialize()
			console.log("[CREDIT-INTEGRATION] Badge system initialized")
		} catch (error) {
			console.error("[CREDIT-INTEGRATION] Failed to initialize badge system:", error)
		}
	}

	/**
	 * Setup real-time credit monitoring for authenticated user
	 */
	private async setupRealtimeCredits() {
		try {
			const accessToken = await this.authService.getAccessToken()
			if (!accessToken) {
				console.log("[CREDIT-INTEGRATION] No access token available, skipping realtime setup")
				return
			}

			// Get initial credit balance
			this.currentUser = await creditManager.getUserCreditBalance(accessToken)
			if (this.currentUser) {
				this.updateCreditUI(this.currentUser.currentCredits)
				console.log(`[CREDIT-INTEGRATION] Initial credit balance: ${this.currentUser.currentCredits}`)

				// Setup realtime updates
				const clerkId = await this.getClerkIdFromToken(accessToken)
				if (clerkId) {
					await realtimeCreditService.subscribeToUserCredits(clerkId, (update) => {
						console.log(
							`[CREDIT-INTEGRATION] Realtime credit update: ${update.creditsChanged} credits, new balance: ${update.newBalance}`,
						)
						this.currentUser = {
							...this.currentUser!,
							currentCredits: update.newBalance,
							creditsUsed: this.currentUser!.creditsUsed + Math.abs(update.creditsChanged),
							totalSpent: this.currentUser!.totalSpent + (update.usdAmount || 0),
						}
						this.updateCreditUI(update.newBalance)
					})
					this.isRealtimeConnected = true
					console.log("[CREDIT-INTEGRATION] Realtime credit monitoring enabled")
				}
			}
		} catch (error) {
			console.error("[CREDIT-INTEGRATION] Failed to setup realtime credits:", error)
		}
	}

	/**
	 * Extract Clerk ID from JWT token
	 */
	private async getClerkIdFromToken(accessToken: string): Promise<string | null> {
		try {
			// Use the existing JWT extraction logic
			const { extractUserFromJWT } = await import("../auth/jwtVerification")
			const userInfo = await extractUserFromJWT(accessToken)
			return userInfo?.userId || null
		} catch (error) {
			console.error("[CREDIT-INTEGRATION] Failed to extract Clerk ID:", error)
			return null
		}
	}

	/**
	 * Update credit balance in VSCode UI
	 */
	private updateCreditUI(credits: number) {
		// Send message to webview to update credit display
		vscode.commands.executeCommand("softcodes.updateCreditBalance", credits)
	}

	/**
	 * Enhanced API call execution with resilient credit tracking
	 */
	async executeAPICallWithCredits<T>(
		operation: string,
		apiCall: () => Promise<{ result: T; usdCost?: number }>,
		description?: string,
		providerId?: string,
	): Promise<APIResultWithCredits<T>> {
		try {
			// No longer use fixed API_COSTS, cost must come from actual API response (OpenRouter)
			console.log(`[CREDIT-INTEGRATION] Executing ${operation} with enhanced credit tracking (dynamic cost)`)

			// Get authentication status without forcing refresh
			const authState = await this.authService.getAuthenticationState()
			const accessToken = await this.authService.getAccessToken()

			// Execute the API call (get result including usdCost if provided)
			const startTime = Date.now()
			const { result, usdCost = 0 } = await apiCall()
			const executionTime = Date.now() - startTime

			console.log(`[CREDIT-INTEGRATION] ${operation} API call completed in ${executionTime}ms, cost: $${usdCost}`)

			// Log precise conversion details before deduction
			const creditsToDeduct = creditManager.calculateCreditsForUSD(usdCost)
			console.log(
				`[CREDIT-INTEGRATION] Conversion details - Raw USD: ${usdCost}, Credits to deduct: ${creditsToDeduct}, Rate: ${creditManager.getCreditRate()}`,
			)

			// Use enhanced credit deduction that never fails
			const transaction = await deductCreditsResilient(
				this.context,
				operation,
				usdCost,
				description || `${operation} API call`,
				{
					operationType: operation,
					requestId: `api-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
					executionTime,
					apiCallSuccess: true,
				},
			)

			// Enhanced credit system always succeeds, but may be queued or offline
			const isRealtime =
				transaction.message?.includes("queued") === false && transaction.message?.includes("offline") === false

			console.log(`[CREDIT-INTEGRATION] ${operation} credit deduction completed:`, {
				success: transaction.success,
				charged: transaction.creditsDeducted,
				isRealtime,
				message: transaction.message,
			})

			return {
				success: true,
				data: result,
				creditInfo: {
					charged: transaction.creditsDeducted || 0,
					remainingCredits: transaction.balanceAfter || 0,
					transactionId: transaction.transactionId,
					balanceBefore: transaction.balanceBefore,
					display: formatPrice(providerId || "softcodes/openrouter", transaction.creditsDeducted || 0),
				},
			}
		} catch (error) {
			console.error(
				`[CREDIT-INTEGRATION] ${operation} failed:`,
				error instanceof Error ? error : JSON.stringify(error, null, 2),
			)

			// Even in error cases, try to track the credit operation
			try {
				await deductCreditsResilient(this.context, operation, 0, `${operation} API call (error recovery)`, {
					operationType: operation,
					apiCallSuccess: false,
					error: error instanceof Error ? error.message : String(error),
				})
			} catch (creditError) {
				console.error(`[CREDIT-INTEGRATION] Failed to track credits even in error recovery:`, creditError)
			}

			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				creditInfo: {
					charged: 0,
					remainingCredits: this.currentUser?.currentCredits || 0,
					display: formatPrice(providerId || "softcodes/openrouter", 0),
				},
			}
		}
	}

	/**
	 * Setup enhanced credit system event listeners
	 */
	private setupEnhancedCreditListeners(): void {
		this.enhancedCreditSystem.on("authenticationRecovered", () => {
			console.log("[CREDIT-INTEGRATION] Authentication recovered, refreshing UI")
			this.refreshCurrentUserInfo()
		})

		this.enhancedCreditSystem.on("authenticationLost", () => {
			console.log("[CREDIT-INTEGRATION] Authentication lost, updating UI for offline mode")
			// Don't clear user info, just indicate offline status
		})

		this.enhancedCreditSystem.on("operationProcessed", (event: any) => {
			console.log(`[CREDIT-INTEGRATION] Queued operation processed: ${event.operationId}`)
			this.refreshCurrentUserInfo()
		})

		this.enhancedCreditSystem.on("transactionSynced", (event: any) => {
			console.log(`[CREDIT-INTEGRATION] Offline transaction synced: ${event.transactionId}`)
			this.refreshCurrentUserInfo()
		})
	}

	/**
	 * Refresh current user info safely
	 */
	private async refreshCurrentUserInfo(): Promise<void> {
		try {
			const accessToken = await this.authService.getAccessToken()
			if (accessToken) {
				this.currentUser = await creditManager.getUserCreditBalance(accessToken)
				if (this.currentUser) {
					this.updateCreditUI(this.currentUser.currentCredits)
				}
			}
		} catch (error) {
			console.warn("[CREDIT-INTEGRATION] Failed to refresh user info:", error)
		}
	}
}
