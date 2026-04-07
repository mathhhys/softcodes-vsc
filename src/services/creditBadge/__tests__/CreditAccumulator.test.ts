import { describe, test, expect, beforeEach, vi } from "vitest"
import { CreditAccumulator } from "../CreditAccumulator"
import { CreditConverter } from "../CreditConverter"

describe("CreditAccumulator", () => {
	let accumulator: CreditAccumulator
	let converter: CreditConverter

	beforeEach(() => {
		converter = new CreditConverter({
			dollarToCreditRate: 0.014,
			roundingMode: "ceil",
			precision: 4,
		})
		accumulator = new CreditAccumulator(converter)
	})

	describe("addOperation", () => {
		test("should add operation and track credits", () => {
			const operation = accumulator.addOperation("CODE_GENERATION", 0.07)

			expect(operation.operation).toBe("CODE_GENERATION")
			expect(operation.usdCost).toBe(0.07)
			expect(operation.creditsUsed).toBe(5)
			expect(operation.id).toBeDefined()
			expect(operation.timestamp).toBeInstanceOf(Date)
		})

		test("should emit operation_added event", () => {
			const mockListener = vi.fn()
			accumulator.on("operation_added", mockListener)

			accumulator.addOperation("SIMPLE_QUERY", 0.014)

			expect(mockListener).toHaveBeenCalledTimes(1)
		})

		test("should emit stats_updated event", () => {
			const mockListener = vi.fn()
			accumulator.on("stats_updated", mockListener)

			accumulator.addOperation("SIMPLE_QUERY", 0.014)

			expect(mockListener).toHaveBeenCalledTimes(1)
		})

		test("should include metadata in operation", () => {
			const metadata = { testKey: "testValue" }
			const operation = accumulator.addOperation("TEST_OP", 0.014, metadata)

			expect(operation.metadata).toMatchObject(metadata)
			expect(operation.metadata?.conversionDetails).toBeDefined()
		})
	})

	describe("getSessionStats", () => {
		test("should return correct session statistics", () => {
			accumulator.addOperation("CODE_GENERATION", 0.07)
			accumulator.addOperation("SIMPLE_QUERY", 0.014)

			const stats = accumulator.getSessionStats()

			expect(stats.operationCount).toBe(2)
			expect(stats.totalCreditsUsed).toBe(6) // 5 + 1
			expect(stats.totalUSDSpent).toBe(0.084) // 0.070 + 0.014
			expect(stats.averageCreditsPerOperation).toBe(3) // 6 / 2
			expect(stats.startTime).toBeInstanceOf(Date)
		})

		test("should calculate operations per hour correctly", () => {
			const startTime = Date.now()

			// Mock Date constructor for consistent timing
			vi.useFakeTimers()
			vi.setSystemTime(startTime)

			// Reset to get new start time
			accumulator.resetSession()

			// Advance time by 1 hour
			vi.setSystemTime(startTime + 3600000) // +1 hour later

			accumulator.addOperation("CODE_GENERATION", 0.07)

			const stats = accumulator.getSessionStats()
			expect(stats.operationsPerHour).toBe(1)

			vi.useRealTimers()
		})

		test("should handle empty session", () => {
			const stats = accumulator.getSessionStats()

			expect(stats.operationCount).toBe(0)
			expect(stats.totalCreditsUsed).toBe(0)
			expect(stats.totalUSDSpent).toBe(0)
			expect(stats.averageCreditsPerOperation).toBe(0)
			expect(stats.operations).toHaveLength(0)
		})

		test("should calculate duration correctly", () => {
			const stats = accumulator.getSessionStats()

			expect(stats.duration).toBeGreaterThanOrEqual(0)
			expect(stats.startTime).toBeInstanceOf(Date)
		})
	})

	describe("resetSession", () => {
		test("should reset session data", () => {
			accumulator.addOperation("CODE_GENERATION", 0.07)

			accumulator.resetSession()

			const stats = accumulator.getSessionStats()
			expect(stats.operationCount).toBe(0)
			expect(stats.totalCreditsUsed).toBe(0)
			expect(stats.totalUSDSpent).toBe(0)
			expect(stats.operations).toHaveLength(0)
		})

		test("should emit session_reset event", () => {
			const mockListener = vi.fn()
			accumulator.on("session_reset", mockListener)

			accumulator.resetSession()

			expect(mockListener).toHaveBeenCalledTimes(1)
			expect(mockListener).toHaveBeenCalledWith(expect.stringMatching(/^session_/))
		})

		test("should generate new session ID on reset", () => {
			const mockListener = vi.fn()
			accumulator.on("session_reset", mockListener)

			accumulator.resetSession()
			const sessionId1 = mockListener.mock.calls[0][0]

			accumulator.resetSession()
			const sessionId2 = mockListener.mock.calls[1][0]

			// Session IDs should be different
			expect(sessionId1).not.toBe(sessionId2)
			expect(sessionId1).toMatch(/^session_/)
			expect(sessionId2).toMatch(/^session_/)
		})
	})

	describe("getRecentOperations", () => {
		test("should return recent operations", () => {
			for (let i = 0; i < 15; i++) {
				accumulator.addOperation(`Operation_${i}`, 0.014)
			}

			const recent = accumulator.getRecentOperations(5)
			expect(recent).toHaveLength(5)
			expect(recent[4].operation).toBe("Operation_14")
			expect(recent[0].operation).toBe("Operation_10")
		})

		test("should handle count larger than available operations", () => {
			accumulator.addOperation("OP1", 0.014)
			accumulator.addOperation("OP2", 0.014)

			const recent = accumulator.getRecentOperations(10)
			expect(recent).toHaveLength(2)
		})

		test("should return empty array when no operations", () => {
			const recent = accumulator.getRecentOperations(5)
			expect(recent).toHaveLength(0)
		})
	})

	describe("getOperationsByType", () => {
		test("should filter operations by type", () => {
			accumulator.addOperation("CODE_GENERATION", 0.07)
			accumulator.addOperation("SIMPLE_QUERY", 0.014)
			accumulator.addOperation("CODE_GENERATION", 0.07)
			accumulator.addOperation("CODE_ANALYSIS", 0.042)

			const codeGenOps = accumulator.getOperationsByType("CODE_GENERATION")
			expect(codeGenOps).toHaveLength(2)
			expect(codeGenOps.every((op) => op.operation === "CODE_GENERATION")).toBe(true)
		})

		test("should return empty array for non-existent type", () => {
			accumulator.addOperation("CODE_GENERATION", 0.07)

			const nonExistent = accumulator.getOperationsByType("NON_EXISTENT")
			expect(nonExistent).toHaveLength(0)
		})
	})

	describe("onRealTimeUpdate", () => {
		test("should handle real-time credit updates", () => {
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

			// Add some operations
			accumulator.addOperation("CODE_GENERATION", 0.07) // 5 credits
			accumulator.addOperation("SIMPLE_QUERY", 0.014) // 1 credit

			// Simulate real-time update that matches
			accumulator.onRealTimeUpdate({
				operation: "deduction",
				creditsChanged: -6, // Should match our local tracking
			})

			expect(consoleSpy).not.toHaveBeenCalled()

			// Simulate mismatched update
			accumulator.onRealTimeUpdate({
				operation: "deduction",
				creditsChanged: -10, // Doesn't match our local tracking
			})

			expect(consoleSpy).toHaveBeenCalledWith(
				"[CREDIT-ACCUMULATOR] Tracking mismatch detected",
				expect.objectContaining({
					local: 6,
					remote: 10,
				}),
			)

			consoleSpy.mockRestore()
		})

		test("should ignore non-deduction updates", () => {
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

			accumulator.onRealTimeUpdate({
				operation: "addition",
				creditsChanged: 10,
			})

			expect(consoleSpy).not.toHaveBeenCalled()
			consoleSpy.mockRestore()
		})
	})

	describe("operation ID generation", () => {
		test("should generate unique operation IDs", () => {
			const op1 = accumulator.addOperation("OP1", 0.014)
			const op2 = accumulator.addOperation("OP2", 0.014)

			expect(op1.id).not.toBe(op2.id)
			expect(op1.id).toMatch(/^op_\d+_[a-z0-9]+$/)
			expect(op2.id).toMatch(/^op_\d+_[a-z0-9]+$/)
		})
	})
})
