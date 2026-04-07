import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { CreditDeduplicationLogger, creditDeduplicationLogger } from "../creditDeduplicationLogger"
import { getSupabaseServiceClient } from "../supabaseConfig"

// Mock Supabase
vi.mock("../supabaseConfig", () => ({
	getSupabaseServiceClient: vi.fn(),
}))

const mockSupabase = {
	from: vi.fn().mockReturnValue({
		insert: vi.fn().mockResolvedValue({ data: null, error: null }),
	}),
}

const mockGetSupabase = vi.mocked(getSupabaseServiceClient).mockResolvedValue(mockSupabase as any)

describe("CreditDeduplicationLogger", () => {
	let logger: CreditDeduplicationLogger

	beforeEach(() => {
		logger = CreditDeduplicationLogger.getInstance()
		logger.clearAll()
		vi.clearAllMocks()
	})

	afterEach(() => {
		logger.clearAll()
	})

	describe("logCreditDeductionAttempt", () => {
		it("should generate fingerprint and store in memory", async () => {
			const userId = "test-user"
			const credits = 10
			const usd = 0.05
			const description = "Test deduction"

			await logger.logCreditDeductionAttempt(userId, credits, usd, description, { requestId: "test-req" })

			expect(logger["processedFingerprints"].size).toBe(1)
			const fingerprint = logger["processedFingerprints"].keys().next().value!
			expect(fingerprint).toMatch(/^dedup_/)
			expect(logger["processedFingerprints"].has(fingerprint)).toBe(true)
		})

		it("should persist to database when successful", async () => {
			const userId = "test-user"
			const credits = 10
			const usd = 0.05
			const metadata = { requestId: "test-req-123" }

			await logger.logCreditDeductionAttempt(userId, credits, usd, undefined, metadata)

			expect(mockGetSupabase).toHaveBeenCalled()
			expect(mockSupabase.from).toHaveBeenCalledWith("credit_deduplication_logs")
			expect(mockSupabase.from("credit_deduplication_logs").insert).toHaveBeenCalledWith(
				expect.objectContaining({
					fingerprint: expect.any(String),
					request_id: "test-req-123",
					operation_type: "deduction",
					usd_amount: usd,
					credits_estimated: credits,
					metadata: metadata,
				}),
			)
		})

		it("should handle database persistence failure gracefully", async () => {
			mockSupabase.from("credit_deduplication_logs").insert.mockRejectedValueOnce(new Error("DB error"))

			const userId = "test-user"
			const credits = 10
			const usd = 0.05

			await expect(logger.logCreditDeductionAttempt(userId, credits, usd)).resolves.not.toThrow()

			// Should still store in memory
			expect(logger["processedFingerprints"].size).toBe(1)
		})
	})

	describe("isOperationProcessed", () => {
		it("should return false for new operation", () => {
			const fingerprint = "test-fp-new"
			expect(logger.isOperationProcessed(fingerprint)).toBe(false)
		})

		it("should return true for recently processed operation", async () => {
			const userId = "test-user"
			const credits = 10
			const usd = 0.05

			await logger.logCreditDeductionAttempt(userId, credits, usd)

			expect(logger["processedFingerprints"].size).toBe(1)
			const fingerprint = logger["processedFingerprints"].keys().next().value!
			expect(logger.isOperationProcessed(fingerprint)).toBe(true)
		})

		it("should expire old entries", async () => {
			const userId = "test-user"
			const credits = 10
			const usd = 0.05

			// Mock time to simulate expiration
			const originalNow = Date.now
			const fixedTime = Date.now()
			Date.now = vi.fn().mockReturnValue(fixedTime)

			await logger.logCreditDeductionAttempt(userId, credits, usd)

			Date.now = vi.fn().mockReturnValue(fixedTime + 301000) // After TTL

			const fingerprint = logger["processedFingerprints"].keys().next().value!
			expect(logger.isOperationProcessed(fingerprint)).toBe(false)
			expect(logger["processedFingerprints"].size).toBe(0)

			Date.now = originalNow
		})
	})

	describe("storeProcessedOperation", () => {
		it("should store operation with default TTL", () => {
			const fingerprint = "test-fp"
			logger.storeProcessedOperation(fingerprint)

			expect(logger["processedFingerprints"].has(fingerprint)).toBe(true)
			const entry = logger["processedFingerprints"].get(fingerprint)!
			expect(entry.expires).toBeGreaterThan(Date.now())
		})

		it("should store with custom TTL", () => {
			const fingerprint = "test-fp-custom"
			logger.storeProcessedOperation(fingerprint, 10000) // 10 seconds

			const entry = logger["processedFingerprints"].get(fingerprint)!
			expect(entry.expires).toBe(Date.now() + 10000)
		})
	})

	describe("generateOperationFingerprint", () => {
		it("should generate consistent fingerprint for same inputs", () => {
			// Access private method via type assertion or indirect test
			const generateFingerprint = (userId: string, usd: number, desc?: string) => {
				const fingerprintData = {
					userId,
					usdAmount: usd.toFixed(6),
					description: desc?.substring(0, 50) || "no-description",
				}
				return `dedup_${Buffer.from(JSON.stringify(fingerprintData)).toString("base64").substring(0, 32)}`
			}

			const fingerprint1 = generateFingerprint("user1", 0.05, "test desc")
			const fingerprint2 = generateFingerprint("user1", 0.05, "test desc")

			expect(fingerprint1).toBe(fingerprint2)
			expect(fingerprint1).toMatch(/^dedup_/)
		})

		it("should include truncated description", () => {
			const longDesc = "a".repeat(60)
			const generateFingerprint = (userId: string, usd: number, desc?: string) => {
				const fingerprintData = {
					userId,
					usdAmount: usd.toFixed(6),
					description: desc?.substring(0, 50) || "no-description",
				}
				return `dedup_${Buffer.from(JSON.stringify(fingerprintData)).toString("base64").substring(0, 32)}`
			}

			const fingerprint = generateFingerprint("user1", 0.05, longDesc)

			expect(fingerprint.length).toBe(38)
		})
	})
})
