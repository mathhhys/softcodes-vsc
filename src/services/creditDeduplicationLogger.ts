/**
 * Credit Deduplication Logger
 *
 * Enhanced logging and tracking to prevent duplicate credit deductions.
 */

import { getSupabaseServiceClient } from "./supabaseConfig"

/**
 * Enhanced credit deduplication logger with multiple detection strategies
 */
export class CreditDeduplicationLogger {
	private static instance: CreditDeduplicationLogger
	private processedFingerprints = new Map<string, { expires: number }>()
	private readonly DEDUP_TTL_MS = 300000 // 5 minutes

	private constructor() {}

	static getInstance(): CreditDeduplicationLogger {
		if (!CreditDeduplicationLogger.instance) {
			CreditDeduplicationLogger.instance = new CreditDeduplicationLogger()
		}
		return CreditDeduplicationLogger.instance
	}

	/**
	 * Log a credit deduction attempt with enhanced fingerprinting
	 */
	async logCreditDeductionAttempt(
		userId: string,
		creditsToDeduct: number,
		usdAmount: number,
		description?: string,
		metadata?: any,
	): Promise<void> {
		try {
			const fingerprint = this.generateOperationFingerprint(userId, usdAmount, description)

			console.log(`[CREDIT-DEDUP] Logging credit deduction attempt for user: ${userId}, amount: $${usdAmount}`)

			// Store in memory for fast duplicate detection
			this.processedFingerprints.set(fingerprint, {
				expires: Date.now() + this.DEDUP_TTL_MS,
			})

			// Also log to database for persistence
			await this.persistDedupAttempt({
				fingerprint,
				requestId: metadata?.requestId || "unknown",
				operationType: "deduction",
				usdAmount,
				creditsEstimated: creditsToDeduct,
				timestamp: Date.now(),
				metadata,
			})
		} catch (error) {
			console.warn("[CREDIT-DEDUP] Failed to log credit deduction attempt:", error)
		}
	}

	/**
	 * Generate a unique operation fingerprint
	 */
	private generateOperationFingerprint(userId: string, usdAmount: number, description?: string): string {
		const fingerprintData = {
			userId,
			usdAmount: usdAmount.toFixed(6),
			description: description?.substring(0, 50) || "no-description",
		}

		return `dedup_${Buffer.from(JSON.stringify(fingerprintData)).toString("base64").substring(0, 32)}`
	}

	/**
	 * Check if operation has already been processed
	 */
	isOperationProcessed(fingerprint: string): boolean {
		this.clearExpiredEntries()
		const entry = this.processedFingerprints.get(fingerprint)
		if (entry && entry.expires > Date.now()) {
			console.log(`[CREDIT-DEDUP] Duplicate operation detected (fingerprint: ${fingerprint})`)
			return true
		}
		return false
	}

	/**
	 * Clear expired entries
	 */
	private clearExpiredEntries(): void {
		const now = Date.now()
		for (const [fp, entry] of this.processedFingerprints.entries()) {
			if (entry.expires <= now) {
				this.processedFingerprints.delete(fp)
			}
		}
	}

	/**
	 * Store operation as processed
	 */
	storeProcessedOperation(fingerprint: string, ttl?: number): void {
		this.processedFingerprints.set(fingerprint, {
			expires: Date.now() + (ttl || this.DEDUP_TTL_MS),
		})
	}

	/**
	 * Persist deduplication attempt to database
	 */
	private async persistDedupAttempt(attempt: {
		fingerprint: string
		requestId: string
		operationType: string
		usdAmount: number
		creditsEstimated: number
		timestamp: number
		metadata?: any
	}): Promise<void> {
		try {
			const supabase = await getSupabaseServiceClient()

			// Log to database table if exists
			await supabase.from("credit_deduplication_logs").insert({
				fingerprint: attempt.fingerprint,
				request_id: attempt.requestId,
				operation_type: attempt.operationType,
				usd_amount: attempt.usdAmount,
				credits_estimated: attempt.creditsEstimated,
				timestamp: new Date(attempt.timestamp).toISOString(),
				metadata: attempt.metadata || {},
			})
		} catch (error) {
			console.warn("[CREDIT-DEDUP] Failed to persist deduplication log:", error)
		}
	}

	/**
	 * Clear all deduplication data
	 */
	clearAll(): void {
		this.processedFingerprints.clear()
		console.log("[CREDIT-DEDUP] Cleared all deduplication data")
	}
}

/**
 * Singleton instance for easy access
 */
export const creditDeduplicationLogger = CreditDeduplicationLogger.getInstance()
