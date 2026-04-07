/**
 * Enhanced Credit System Tests
 *
 * Tests for the resilient credit tracking system that handles authentication failures
 */

import { describe, test, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from "vitest"

// Mock VSCode API completely before importing anything else
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
			update: vi.fn().mockResolvedValue(undefined),
			has: vi.fn(),
			inspect: vi.fn(),
		})),
	},
	window: {
		showInformationMessage: vi.fn().mockResolvedValue(undefined),
		showWarningMessage: vi.fn().mockResolvedValue(undefined),
		showErrorMessage: vi.fn().mockResolvedValue(undefined),
		createOutputChannel: vi.fn(() => ({
			clear: vi.fn(),
			appendLine: vi.fn(),
			show: vi.fn(),
		})),
	},
	ConfigurationTarget: {
		Global: 1,
		Workspace: 2,
		WorkspaceFolder: 3,
	},
	commands: {
		executeCommand: vi.fn(),
	},
}))

// Mock the enhanced credit system dependencies
vi.mock("../creditManager", () => ({
	creditManager: {
		deductCreditsFromJWT: vi.fn(),
		getUserCreditBalance: vi.fn(),
		checkSufficientCredits: vi.fn(),
		calculateCreditsForUSD: vi.fn((usd: number) => Math.ceil(usd / 0.014)),
		clearAllCaches: vi.fn(),
		getCacheStats: vi.fn(() => ({
			userCacheSize: 0,
			jwtCacheSize: 0,
			config: {},
		})),
	},
}))

vi.mock("../../auth/unifiedAuthService", () => ({
	UnifiedAuthService: {
		getInstance: vi.fn(() => ({
			getAuthenticationState: vi.fn(),
			getAccessToken: vi.fn(),
			getRefreshToken: vi.fn(),
			refreshCurrentAccessToken: vi.fn(),
			signinWithToken: vi.fn(),
		})),
	},
}))

// Now import the modules
import {
	EnhancedCreditSystem,
	getEnhancedCreditSystem,
	deductCreditsResilient,
	resetEnhancedCreditSystem,
} from "../enhancedCreditSystem"
import { creditManager } from "../creditManager"
import { UnifiedAuthService } from "../../auth/unifiedAuthService"

// Mock VSCode context
const mockContext = {
	secrets: {
		store: vi.fn().mockResolvedValue(undefined),
		get: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
	},
	subscriptions: [],
	workspaceState: {
		get: vi.fn(),
		update: vi.fn(),
	},
	globalState: {
		get: vi.fn(),
		update: vi.fn(),
	},
} as any

// Mock environment variables
const mockEnvVars = {
	SUPABASE_URL: "https://test.supabase.co",
	SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
	CLERK_SECRET_KEY: "sk_test_12345",
}

describe("Enhanced Credit System", () => {
	let enhancedCreditSystem: EnhancedCreditSystem
	let mockAuthService: any

	beforeAll(() => {
		// Set up environment variables
		Object.entries(mockEnvVars).forEach(([key, value]) => {
			process.env[key] = value
		})
	})

	afterAll(() => {
		// Clean up environment variables
		Object.keys(mockEnvVars).forEach((key) => {
			delete process.env[key]
		})
	})

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

		// Reset singleton instance for clean state
		resetEnhancedCreditSystem()

		// Setup mock auth service
		mockAuthService = {
			getAuthenticationState: vi.fn().mockResolvedValue({
				isAuthenticated: false,
				isConnected: false,
			}),
			getAccessToken: vi.fn().mockResolvedValue(undefined),
			getRefreshToken: vi.fn().mockResolvedValue(undefined),
			refreshCurrentAccessToken: vi.fn(),
			signinWithToken: vi.fn(),
		}

		vi.mocked(UnifiedAuthService.getInstance).mockReturnValue(mockAuthService)

		// Get fresh instance
		enhancedCreditSystem = getEnhancedCreditSystem(mockContext)
	})

	afterEach(() => {
		// Cleanup
		if (enhancedCreditSystem) {
			enhancedCreditSystem.dispose()
		}
		// Reset singleton for next test
		resetEnhancedCreditSystem()
	})

	describe("Initialization", () => {
		test("should initialize enhanced credit system without errors", () => {
			expect(enhancedCreditSystem).toBeDefined()

			const status = enhancedCreditSystem.getStatus()
			expect(status).toBeDefined()
			expect(typeof status.isOnline).toBe("boolean")
			expect(typeof status.isAuthenticated).toBe("boolean")
			expect(typeof status.hasValidToken).toBe("boolean")
			expect(typeof status.queuedOperations).toBe("number")
			expect(typeof status.offlineTransactions).toBe("number")
		})
	})

	describe("Credit Deduction Resilience", () => {
		test("should handle credit deduction when authenticated", async () => {
			// Mock successful authentication
			mockAuthService.getAuthenticationState.mockResolvedValue({
				isAuthenticated: true,
				isConnected: true,
			})

			mockAuthService.getAccessToken.mockResolvedValue("valid-jwt-token")

			// Mock successful credit deduction
			vi.mocked(creditManager.deductCreditsFromJWT).mockResolvedValue({
				success: true,
				creditsDeducted: 5,
				balanceBefore: 100,
				balanceAfter: 95,
				usdAmount: 0.07,
				transactionId: "tx_12345",
			})

			const result = await enhancedCreditSystem.deductCredits("CODE_GENERATION", 0.07, "Test code generation")

			expect(result.success).toBe(true)
			expect(result.creditsDeducted).toBe(5)
			expect(result.transactionId).toBe("tx_12345")
		})

		test("should queue operations when authentication fails", async () => {
			// Mock failed authentication
			mockAuthService.getAuthenticationState.mockResolvedValue({
				isAuthenticated: false,
				isConnected: false,
			})

			mockAuthService.getAccessToken.mockResolvedValue(undefined)

			const result = await enhancedCreditSystem.deductCredits(
				"CODE_GENERATION", // Critical operation that should be queued
				0.07,
				"Test code generation",
			)

			expect(result.success).toBe(true)
			expect(result.message).toContain("queued")

			const status = enhancedCreditSystem.getStatus()
			expect(status.queuedOperations).toBe(1)
		})

		test("should use offline tracking for non-critical operations", async () => {
			// Mock failed authentication
			mockAuthService.getAuthenticationState.mockResolvedValue({
				isAuthenticated: false,
				isConnected: false,
			})

			mockAuthService.getAccessToken.mockResolvedValue(undefined)

			const result = await enhancedCreditSystem.deductCredits(
				"FILE_PROCESSING", // Non-critical operation that should be tracked offline
				0.028,
				"Test file processing",
			)

			expect(result.success).toBe(true)
			expect(result.message).toContain("offline")

			const status = enhancedCreditSystem.getStatus()
			expect(status.offlineTransactions).toBe(1)
		})

		test("should handle mixed success/failure scenarios", async () => {
			// Mock partially working authentication
			mockAuthService.getAuthenticationState.mockResolvedValue({
				isAuthenticated: true,
				isConnected: true,
			})

			mockAuthService.getAccessToken.mockResolvedValue("valid-token")

			// Mock credit deduction failure (e.g., database error)
			vi.mocked(creditManager.deductCreditsFromJWT).mockResolvedValue({
				success: false,
				error: "Database temporarily unavailable",
			})

			const result = await enhancedCreditSystem.deductCredits("CODE_ANALYSIS", 0.042, "Test code analysis")

			// Should fall back to queueing/offline tracking
			expect(result.success).toBe(true)
			expect(result.message).toMatch(/queued|offline/)
		})
	})

	describe("Queue Processing", () => {
		test("should process queued operations when authentication is restored", async () => {
			// First, queue an operation (auth failed)
			mockAuthService.getAuthenticationState.mockResolvedValue({
				isAuthenticated: false,
				isConnected: false,
			})
			mockAuthService.getAccessToken.mockResolvedValue(undefined)

			await enhancedCreditSystem.deductCredits("CODE_GENERATION", 0.07, "Test operation")

			let status = enhancedCreditSystem.getStatus()
			expect(status.queuedOperations).toBe(1)

			// Then simulate authentication recovery
			mockAuthService.getAuthenticationState.mockResolvedValue({
				isAuthenticated: true,
				isConnected: true,
			})
			mockAuthService.getAccessToken.mockResolvedValue("restored-token")

			vi.mocked(creditManager.deductCreditsFromJWT).mockResolvedValue({
				success: true,
				creditsDeducted: 5,
				balanceBefore: 100,
				balanceAfter: 95,
				transactionId: "tx_restored",
			})

			// Trigger queue processing
			await enhancedCreditSystem.forceSyncAll()

			status = enhancedCreditSystem.getStatus()
			expect(status.queuedOperations).toBe(0) // Should be processed
		})

		test("should handle retry attempts for failed operations", async () => {
			// Mock authentication recovery but failing credit deduction
			mockAuthService.getAuthenticationState.mockResolvedValue({
				isAuthenticated: true,
				isConnected: true,
			})
			mockAuthService.getAccessToken.mockResolvedValue("valid-token")

			// Mock persistent failure
			vi.mocked(creditManager.deductCreditsFromJWT).mockResolvedValue({
				success: false,
				error: "Persistent database error",
			})

			// Queue an operation first
			mockAuthService.getAuthenticationState.mockResolvedValueOnce({
				isAuthenticated: false,
				isConnected: false,
			})
			mockAuthService.getAccessToken.mockResolvedValueOnce(undefined)

			await enhancedCreditSystem.deductCredits("CODE_GENERATION", 0.07, "Test operation")

			// Try to process the queue - should handle retries
			const syncResult = await enhancedCreditSystem.forceSyncAll()

			expect(syncResult).toBeDefined()
			expect(typeof syncResult.synced).toBe("number")
			expect(typeof syncResult.failed).toBe("number")
		})
	})

	describe("Offline Transaction Sync", () => {
		test("should sync offline transactions when connection is restored", async () => {
			// Create offline transaction first
			mockAuthService.getAuthenticationState.mockResolvedValue({
				isAuthenticated: false,
				isConnected: false,
			})
			mockAuthService.getAccessToken.mockResolvedValue(undefined)

			await enhancedCreditSystem.deductCredits("CHAT_MESSAGE", 0.014, "Test chat")

			let status = enhancedCreditSystem.getStatus()
			expect(status.offlineTransactions).toBe(1)

			// Simulate connection restoration
			mockAuthService.getAuthenticationState.mockResolvedValue({
				isAuthenticated: true,
				isConnected: true,
			})
			mockAuthService.getAccessToken.mockResolvedValue("restored-token")

			vi.mocked(creditManager.deductCreditsFromJWT).mockResolvedValue({
				success: true,
				creditsDeducted: 1,
				transactionId: "tx_synced",
			})

			// Force sync
			const syncResult = await enhancedCreditSystem.forceSyncAll()

			expect(syncResult.synced).toBeGreaterThan(0)

			status = enhancedCreditSystem.getStatus()
			expect(status.offlineTransactions).toBe(0) // Should be synced
		})
	})

	describe("Resilient Credit Deduction Function", () => {
		test("should never fail credit deduction operations", async () => {
			// Test various failure scenarios
			const scenarios = [
				{ auth: false, token: undefined, description: "No authentication" },
				{ auth: true, token: "expired-token", description: "Expired token" },
				{ auth: true, token: "valid-token", description: "Valid token but DB error" },
			]

			for (const scenario of scenarios) {
				mockAuthService.getAuthenticationState.mockResolvedValue({
					isAuthenticated: scenario.auth,
					isConnected: scenario.auth,
				})
				mockAuthService.getAccessToken.mockResolvedValue(scenario.token)

				if (scenario.token) {
					vi.mocked(creditManager.deductCreditsFromJWT).mockResolvedValue({
						success: false,
						error: "Database error",
					})
				}

				const result = await deductCreditsResilient(
					mockContext,
					"TEST_OPERATION",
					0.014,
					`Test ${scenario.description}`,
				)

				// Enhanced system should ALWAYS succeed by using fallback tracking
				expect(result.success).toBe(true)
				expect(result.creditsDeducted).toBeGreaterThan(0)
				expect(result.transactionId).toBeDefined()
			}
		})

		test("should provide meaningful status information", async () => {
			const status = enhancedCreditSystem.getStatus()

			expect(status).toHaveProperty("isOnline")
			expect(status).toHaveProperty("isAuthenticated")
			expect(status).toHaveProperty("hasValidToken")
			expect(status).toHaveProperty("queuedOperations")
			expect(status).toHaveProperty("offlineTransactions")

			// Should not have lastError initially
			expect(status.lastError).toBeUndefined()
		})

		test("should provide detailed diagnostics", async () => {
			const diagnostics = enhancedCreditSystem.getDiagnostics()

			expect(diagnostics).toHaveProperty("status")
			expect(diagnostics).toHaveProperty("queuedOperations")
			expect(diagnostics).toHaveProperty("offlineTransactions")

			expect(Array.isArray(diagnostics.queuedOperations)).toBe(true)
			expect(Array.isArray(diagnostics.offlineTransactions)).toBe(true)
		})
	})

	describe("Error Handling", () => {
		test("should handle authentication service errors gracefully", async () => {
			// Mock authentication service throwing errors
			mockAuthService.getAuthenticationState.mockRejectedValue(new Error("Authentication service unavailable"))

			// Should still handle credit deduction via fallback
			const result = await enhancedCreditSystem.deductCredits("SIMPLE_QUERY", 0.014, "Test with auth error")

			expect(result.success).toBe(true) // Enhanced system should handle errors gracefully
			expect(result.message).toMatch(/queued|offline/)
		})

		test("should handle credit manager errors gracefully", async () => {
			// Mock valid authentication but credit manager failure
			mockAuthService.getAuthenticationState.mockResolvedValue({
				isAuthenticated: true,
				isConnected: true,
			})
			mockAuthService.getAccessToken.mockResolvedValue("valid-token")

			vi.mocked(creditManager.deductCreditsFromJWT).mockRejectedValue(new Error("Credit manager system error"))

			const result = await enhancedCreditSystem.deductCredits("CODE_ANALYSIS", 0.042, "Test with credit error")

			expect(result.success).toBe(true) // Should fall back gracefully
			expect(result.message).toMatch(/queued|offline/)
		})
	})

	describe("Resource Management", () => {
		test("should dispose resources properly", () => {
			// Verify no errors during disposal
			expect(() => enhancedCreditSystem.dispose()).not.toThrow()

			// Test that the system can be re-initialized after disposal
			const newSystem = getEnhancedCreditSystem(mockContext)
			expect(newSystem).toBeDefined()
		})
	})
})

/**
 * Integration test that can be run manually to verify the complete system
 */
export async function manualEnhancedCreditTest(): Promise<void> {
	console.log("🧪 [MANUAL-TEST] Starting enhanced credit system integration test...")

	try {
		// Create a test context
		const testContext = mockContext
		const enhancedSystem = getEnhancedCreditSystem(testContext)

		console.log("[MANUAL-TEST] Step 1: Testing basic initialization...")
		const initialStatus = enhancedSystem.getStatus()
		console.log("[MANUAL-TEST] Initial status:", initialStatus)

		console.log("[MANUAL-TEST] Step 2: Testing credit deduction in various states...")

		// Test offline deduction
		const offlineResult = await enhancedSystem.deductCredits("SIMPLE_QUERY", 0.014, "Manual test - offline mode")
		console.log("[MANUAL-TEST] Offline deduction result:", offlineResult)

		console.log("[MANUAL-TEST] Step 3: Testing diagnostics...")
		const diagnostics = enhancedSystem.getDiagnostics()
		console.log("[MANUAL-TEST] System diagnostics:", diagnostics)

		console.log("[MANUAL-TEST] Step 4: Testing force sync...")
		const syncResult = await enhancedSystem.forceSyncAll()
		console.log("[MANUAL-TEST] Sync result:", syncResult)

		console.log("[MANUAL-TEST] Step 5: Testing cleanup...")
		await enhancedSystem.clearAllPendingOperations()

		const finalStatus = enhancedSystem.getStatus()
		console.log("[MANUAL-TEST] Final status:", finalStatus)

		enhancedSystem.dispose()

		console.log("🎉 [MANUAL-TEST] Enhanced credit system integration test completed successfully!")
	} catch (error) {
		console.error("❌ [MANUAL-TEST] Manual test failed:", error)
		throw error
	}
}
