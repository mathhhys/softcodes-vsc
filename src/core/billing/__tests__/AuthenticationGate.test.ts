/**
 * Tests for AuthenticationGate service
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import * as vscode from "vscode"
import { AuthenticationGate } from "../AuthenticationGate"
import { UnifiedAuthService } from "../../../auth/unifiedAuthService"
import { creditManager } from "../../../services/creditManager"
import { AuthenticationRequiredError, InsufficientCreditsError, ApiKeyRequiredError } from "../BillingError"
import { BillingModel } from "../BillingStrategy"
import type { ProviderSettings } from "@roo-code/types"

// Mock the dependencies
vi.mock("../../../auth/unifiedAuthService")
vi.mock("../../../services/creditManager")

const mockContext = {
	secrets: {
		get: vi.fn(),
		store: vi.fn(),
		delete: vi.fn(),
	},
	globalStorageUri: { fsPath: "/test/path" },
} as unknown as vscode.ExtensionContext

const mockAuthService = {
	getAuthenticationState: vi.fn(),
	getAccessToken: vi.fn(),
} as unknown as UnifiedAuthService

const mockCreditManager = {
	getUserCreditBalance: vi.fn(),
	getCreditRate: vi.fn().mockReturnValue(0.014),
	deductCreditsFromJWT: vi.fn(),
	checkSufficientCredits: vi.fn(),
}

describe("AuthenticationGate", () => {
	let authGate: AuthenticationGate

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(UnifiedAuthService.getInstance).mockReturnValue(mockAuthService)

		// Properly mock creditManager methods
		vi.mocked(creditManager.getUserCreditBalance).mockImplementation(mockCreditManager.getUserCreditBalance)
		vi.mocked(creditManager.getCreditRate).mockImplementation(mockCreditManager.getCreditRate)

		authGate = AuthenticationGate.getInstance(mockContext)
	})

	afterEach(() => {
		vi.resetAllMocks()
	})

	describe("Credit-based providers (kilocode, openrouter)", () => {
		const creditBasedConfig: ProviderSettings = {
			apiProvider: "kilocode",
		}

		test("should require authentication for credit-based providers", async () => {
			// Mock unauthenticated state
			vi.mocked(mockAuthService.getAuthenticationState).mockResolvedValue({
				isAuthenticated: false,
				isConnected: false,
			})

			const result = await authGate.validateRequest(creditBasedConfig, 1000)

			expect(result.canProceed).toBe(false)
			expect(result.error).toBeInstanceOf(AuthenticationRequiredError)
			expect(result.billingModel).toBe(BillingModel.CREDIT_BASED)
		})

		test("should check credit balance for authenticated users", async () => {
			// Mock authenticated state
			vi.mocked(mockAuthService.getAuthenticationState).mockResolvedValue({
				isAuthenticated: true,
				isConnected: true,
			})
			vi.mocked(mockAuthService.getAccessToken).mockResolvedValue("valid-jwt-token")

			// Mock very low credits that will definitely be insufficient
			const insufficientCredits = {
				userId: "user-123",
				clerkId: "clerk-123",
				currentCredits: 1, // Only 1 credit available
				totalSpent: 10,
				creditsUsed: 95,
			}

			vi.mocked(mockCreditManager.getUserCreditBalance).mockResolvedValue(insufficientCredits)

			// The cost estimation: 50000 tokens * 0.002 USD per 1000 tokens = $0.1
			// Required credits: $0.1 / $0.014 per credit = ~7.14 credits
			// With 10% buffer: ~8 credits total needed
			// User only has 1 credit, so should fail
			const result = await authGate.validateRequest(creditBasedConfig, 50000)

			expect(result.canProceed).toBe(false)
			expect(result.error).toBeInstanceOf(InsufficientCreditsError)
			if (result.error instanceof InsufficientCreditsError) {
				expect(result.error.availableCredits).toBe(1)
				expect(result.error.requiredCredits).toBeGreaterThan(1)
			}
		})

		test("should allow request with sufficient credits", async () => {
			// Mock authenticated state
			vi.mocked(mockAuthService.getAuthenticationState).mockResolvedValue({
				isAuthenticated: true,
				isConnected: true,
			})
			vi.mocked(mockAuthService.getAccessToken).mockResolvedValue("valid-jwt-token")

			// Mock sufficient credits
			vi.mocked(mockCreditManager.getUserCreditBalance).mockResolvedValue({
				userId: "user-123",
				clerkId: "clerk-123",
				currentCredits: 100,
				totalSpent: 10,
				creditsUsed: 50,
			})

			const result = await authGate.validateRequest(creditBasedConfig, 1000)

			expect(result.canProceed).toBe(true)
			expect(result.billingModel).toBe(BillingModel.CREDIT_BASED)
			expect(result.availableCredits).toBe(100)
		})
	})

	describe("Dollar-based providers (anthropic, openai, etc.)", () => {
		test("should require authentication for all providers", async () => {
			const dollarBasedConfig: ProviderSettings = {
				apiProvider: "anthropic",
			}

			// Mock unauthenticated state
			vi.mocked(mockAuthService.getAuthenticationState).mockResolvedValue({
				isAuthenticated: false,
				isConnected: false,
			})

			const result = await authGate.validateRequest(dollarBasedConfig, 1000)

			expect(result.canProceed).toBe(false)
			expect(result.error).toBeInstanceOf(AuthenticationRequiredError)
			expect(result.billingModel).toBe(BillingModel.DOLLAR_BASED)
		})

		test("should require API key for anthropic provider", async () => {
			const anthropicConfig: ProviderSettings = {
				apiProvider: "anthropic",
				// Missing apiKey
			}

			// Mock authenticated state
			vi.mocked(mockAuthService.getAuthenticationState).mockResolvedValue({
				isAuthenticated: true,
				isConnected: true,
			})

			const result = await authGate.validateRequest(anthropicConfig, 1000)

			expect(result.canProceed).toBe(false)
			expect(result.error).toBeInstanceOf(ApiKeyRequiredError)
			expect((result.error as ApiKeyRequiredError).missingKeys).toContain("apiKey")
		})

		test("should allow request with valid API key", async () => {
			const anthropicConfig: ProviderSettings = {
				apiProvider: "anthropic",
				apiKey: "sk-ant-123456789",
			}

			// Mock authenticated state
			vi.mocked(mockAuthService.getAuthenticationState).mockResolvedValue({
				isAuthenticated: true,
				isConnected: true,
			})

			const result = await authGate.validateRequest(anthropicConfig, 1000)

			expect(result.canProceed).toBe(true)
			expect(result.billingModel).toBe(BillingModel.DOLLAR_BASED)
		})

		test("should handle complex providers like bedrock", async () => {
			const bedrockConfig: ProviderSettings = {
				apiProvider: "bedrock",
				awsAccessKey: "AKIA123",
				// Missing awsSecretKey and awsRegion
			}

			// Mock authenticated state
			vi.mocked(mockAuthService.getAuthenticationState).mockResolvedValue({
				isAuthenticated: true,
				isConnected: true,
			})

			const result = await authGate.validateRequest(bedrockConfig, 1000)

			expect(result.canProceed).toBe(false)
			expect(result.error).toBeInstanceOf(ApiKeyRequiredError)
			expect((result.error as ApiKeyRequiredError).missingKeys).toContain(
				"AWS credentials (awsAccessKey, awsSecretKey, awsRegion)",
			)
		})
	})

	describe("Utility methods", () => {
		test("should correctly identify credit-based providers", () => {
			expect(authGate.isCreditBasedProvider("kilocode")).toBe(true)
			expect(authGate.isCreditBasedProvider("openrouter")).toBe(true)
			expect(authGate.isCreditBasedProvider("anthropic")).toBe(false)
			expect(authGate.isCreditBasedProvider("openai")).toBe(false)
		})

		test("should return correct billing models", () => {
			expect(authGate.getBillingModelForProvider("kilocode")).toBe(BillingModel.CREDIT_BASED)
			expect(authGate.getBillingModelForProvider("openrouter")).toBe(BillingModel.CREDIT_BASED)
			expect(authGate.getBillingModelForProvider("anthropic")).toBe(BillingModel.DOLLAR_BASED)
			expect(authGate.getBillingModelForProvider("openai")).toBe(BillingModel.DOLLAR_BASED)
		})

		test("should check authentication status", async () => {
			vi.mocked(mockAuthService.getAuthenticationState).mockResolvedValue({
				isAuthenticated: true,
				isConnected: true,
			})

			const isAuth = await authGate.isUserAuthenticated()
			expect(isAuth).toBe(true)
		})

		test("should get provider requirements", () => {
			const kilocodeReqs = authGate.getProviderRequirements("kilocode")
			expect(kilocodeReqs).toContain("Softcodes Authentication")
			expect(kilocodeReqs).toContain("Sufficient Credit Balance")

			const anthropicReqs = authGate.getProviderRequirements("anthropic")
			expect(anthropicReqs).toContain("Anthropic API Key")
		})
	})

	describe("Error handling", () => {
		test("should handle authentication service errors gracefully", async () => {
			const config: ProviderSettings = { apiProvider: "anthropic" }

			vi.mocked(mockAuthService.getAuthenticationState).mockRejectedValue(new Error("Auth service unavailable"))

			const result = await authGate.validateRequest(config, 1000)

			expect(result.canProceed).toBe(false)
			expect(result.error?.type).toBe("unsupported_provider")
		})

		test("should handle credit manager errors gracefully", async () => {
			const config: ProviderSettings = { apiProvider: "kilocode" }

			vi.mocked(mockAuthService.getAuthenticationState).mockResolvedValue({
				isAuthenticated: true,
				isConnected: true,
			})
			vi.mocked(mockAuthService.getAccessToken).mockResolvedValue("valid-jwt-token")
			vi.mocked(mockCreditManager.getUserCreditBalance).mockRejectedValue(new Error("Database connection failed"))

			const result = await authGate.validateRequest(config, 1000)

			expect(result.canProceed).toBe(false)
			expect(result.error?.type).toBe("billing_validation_failed")
		})
	})
})
