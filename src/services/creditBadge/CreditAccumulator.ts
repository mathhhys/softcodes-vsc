/**
 * Credit Accumulator Service
 *
 * Tracks session operations and credit usage in real-time.
 * Provides session statistics and operation history.
 */

import { EventEmitter } from "events"
import { CreditConverter } from "./CreditConverter"

export interface SessionOperation {
	id: string
	timestamp: Date
	operation: string
	usdCost: number
	creditsUsed: number
	metadata?: Record<string, any>
}

export interface SessionStats {
	startTime: Date
	endTime?: Date
	duration: number // milliseconds
	operationCount: number
	totalCreditsUsed: number
	totalUSDSpent: number
	operations: SessionOperation[]
	averageCreditsPerOperation: number
	operationsPerHour: number
}

export class CreditAccumulator extends EventEmitter {
	private sessionId!: string
	private sessionStartTime!: Date
	private operations: SessionOperation[] = []
	private converter: CreditConverter

	constructor(converter: CreditConverter) {
		super()
		this.converter = converter
		this.resetSession()
	}

	addOperation(operation: string, usdCost: number, metadata?: Record<string, any>): SessionOperation {
		const conversionResult = this.converter.convertUSDToCredits(usdCost)

		const sessionOperation: SessionOperation = {
			id: this.generateOperationId(),
			timestamp: new Date(),
			operation,
			usdCost,
			creditsUsed: conversionResult.roundedCredits,
			metadata: {
				...metadata,
				conversionDetails: conversionResult,
			},
		}

		this.operations.push(sessionOperation)

		// Emit event for real-time updates
		this.emit("operation_added", sessionOperation)
		this.emit("stats_updated", this.getSessionStats())

		return sessionOperation
	}

	getSessionStats(): SessionStats {
		const now = new Date()
		const duration = now.getTime() - this.sessionStartTime.getTime()
		const totalCreditsUsed = this.operations.reduce((sum, op) => sum + op.creditsUsed, 0)
		const totalUSDSpent = this.operations.reduce((sum, op) => sum + op.usdCost, 0)

		return {
			startTime: this.sessionStartTime,
			duration,
			operationCount: this.operations.length,
			totalCreditsUsed,
			totalUSDSpent,
			operations: [...this.operations],
			averageCreditsPerOperation: this.operations.length > 0 ? totalCreditsUsed / this.operations.length : 0,
			operationsPerHour: duration > 0 ? (this.operations.length * 3600000) / duration : 0,
		}
	}

	resetSession(): void {
		this.sessionId = this.generateSessionId()
		this.sessionStartTime = new Date()
		this.operations = []

		this.emit("session_reset", this.sessionId)
	}

	getRecentOperations(count: number = 10): SessionOperation[] {
		return this.operations.slice(-count)
	}

	getOperationsByType(operationType: string): SessionOperation[] {
		return this.operations.filter((op) => op.operation === operationType)
	}

	// Handle real-time credit updates from the credit system
	onRealTimeUpdate(update: any): void {
		// Sync with real-time credit deduction events
		if (update.operation === "deduction" && update.creditsChanged) {
			// Verify our local tracking matches real deductions
			const recentTotal = this.getRecentOperations(5).reduce((sum, op) => sum + op.creditsUsed, 0)

			if (Math.abs(recentTotal - Math.abs(update.creditsChanged)) > 1) {
				console.warn("[CREDIT-ACCUMULATOR] Tracking mismatch detected", {
					local: recentTotal,
					remote: Math.abs(update.creditsChanged),
				})
			}
		}
	}

	private generateOperationId(): string {
		return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	}

	private generateSessionId(): string {
		return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	}
}
