import { describe, it, expect, beforeEach, vi } from "vitest"
import type { Mocked } from "vitest"

type SpyInstance = ReturnType<typeof vi.spyOn>
import * as vscode from "vscode"
import { UnifiedAuthService } from "../unifiedAuthService"
import { TOKEN_KEYS } from "../config"

// Helper to create fake JWT payloads with exp/iat
function createFakeJWT(expOffsetSeconds: number) {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
	const payload = Buffer.from(
		JSON.stringify({
			sub: "user123",
			email: "test@example.com",
			exp: Math.floor(Date.now() / 1000) + expOffsetSeconds,
			iat: Math.floor(Date.now() / 1000),
		}),
	).toString("base64url")
	const signature = "signature"
	return `${header}.${payload}.${signature}`
}

describe("UnifiedAuthService - Token Refresh Flow", () => {
	let service: UnifiedAuthService
	let secrets: Map<string, string>

	beforeEach(() => {
		secrets = new Map()
		// Mock VSCode secrets API
		const mockContext = {
			secrets: {
				get: vi.fn(async (k: string) => secrets.get(k)),
				store: vi.fn(async (k: string, v: string) => {
					secrets.set(k, v)
				}),
				delete: vi.fn(async (k: string) => {
					secrets.delete(k)
				}),
			},
		} as unknown as vscode.ExtensionContext

		service = UnifiedAuthService.getInstance(mockContext)

		// Mock fetch for refresh token endpoint
		global.fetch = vi.fn(async (url, options) => {
			if ((url as string).includes("refresh")) {
				return {
					ok: true,
					json: async () => ({
						access_token: createFakeJWT(3600),
						refresh_token: "new_refresh",
						session_id: "session123",
					}),
				} as Response
			}
			return {
				ok: true,
				json: async () => ({}),
			} as Response
		}) as any
	})

	it("refreshes when access token is expired", async () => {
		const expiredJWT = createFakeJWT(-10) // expired 10s ago
		secrets.set(TOKEN_KEYS.ACCESS_TOKEN, expiredJWT)
		secrets.set(TOKEN_KEYS.REFRESH_TOKEN, "refresh123")

		const token = await service.ensureValidAccessToken()

		expect(token).toBeDefined()
		expect((token as string).split(".").length).toBe(3)
	})

	it("proactively refreshes when token expires soon", async () => {
		const soonExpiringJWT = createFakeJWT(60) // expires in 1 minute
		secrets.set(TOKEN_KEYS.ACCESS_TOKEN, soonExpiringJWT)
		secrets.set(TOKEN_KEYS.REFRESH_TOKEN, "refresh123")

		const token = await service.ensureValidAccessToken()

		expect(token).toBeDefined()
		expect((token as string).split(".").length).toBe(3)
	})

	it("returns expired token as fallback when no refresh token is available", async () => {
		const expiredJWT = createFakeJWT(-10)
		secrets.set(TOKEN_KEYS.ACCESS_TOKEN, expiredJWT)

		const token = await service.ensureValidAccessToken()

		expect(token).toBeDefined()
	})

	it("allows grace period for recently expired tokens if refresh still provided", async () => {
		const justExpired = createFakeJWT(-60 * 5) // expired 5 minutes ago
		secrets.set(TOKEN_KEYS.ACCESS_TOKEN, justExpired)
		secrets.set(TOKEN_KEYS.REFRESH_TOKEN, "refresh123")

		const token = await service.ensureValidAccessToken()

		expect(token).toBeDefined()
	})
})

describe("UnifiedAuthService - Reconnection After SignOut", () => {
	let service: UnifiedAuthService
	let secrets: Map<string, string>
	let mockUpdateAuthenticationState: SpyInstance
	let mockClearStoredTokens: SpyInstance
	let mockVerifyJWTToken: SpyInstance
	let mockTestTokenStructure: SpyInstance
	let mockValidateTokenWithAPI: SpyInstance
	let mockHandleSuccessfulJWTVerification: SpyInstance
	let mockHandleFallbackTokenStorage: SpyInstance
	let mockHandleSuccessfulAPIValidation: SpyInstance
	let mockWindow: Mocked<typeof vscode.window>

	beforeEach(() => {
		secrets = new Map()
		mockWindow = {
			showInputBox: vi.fn(),
			showInformationMessage: vi.fn(),
			showWarningMessage: vi.fn(),
			showErrorMessage: vi.fn(),
		} as any
		;(vscode.window as any) = mockWindow

		const mockContext = {
			secrets: {
				get: vi.fn(async (k: string) => secrets.get(k)),
				store: vi.fn(async (k: string, v: string) => {
					secrets.set(k, v)
				}),
				delete: vi.fn(async (k: string) => {
					secrets.delete(k)
				}),
			},
			globalState: {
				update: vi.fn(),
				get: vi.fn(),
			},
			subscriptions: [],
		} as unknown as vscode.ExtensionContext

		service = new UnifiedAuthService(mockContext)

		// Mock private methods
		mockUpdateAuthenticationState = vi.spyOn(service as any, "updateAuthenticationState")
		mockClearStoredTokens = vi.spyOn(service as any, "clearStoredTokens")
		mockVerifyJWTToken = vi.spyOn(service as any, "verifyJWTToken")
		mockTestTokenStructure = vi.spyOn(service as any, "testTokenStructure")
		mockValidateTokenWithAPI = vi.spyOn(service as any, "validateTokenWithAPI")
		mockHandleSuccessfulJWTVerification = vi.spyOn(service as any, "handleSuccessfulJWTVerification")
		mockHandleFallbackTokenStorage = vi.spyOn(service as any, "handleFallbackTokenStorage")
		mockHandleSuccessfulAPIValidation = vi.spyOn(service as any, "handleSuccessfulAPIValidation")

		// Mock configuration for dev mode
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockImplementation((key: string) => {
				if (key === "auth.skipAPIValidation") return false
				return undefined
			}),
		} as any)

		// Mock input box to return token
		mockWindow.showInputBox.mockResolvedValue("valid.mock.token")

		// Reset signedOut
		;(service as any).signedOut = false
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("signedOut flag reset during reconnection", () => {
		it("should reset signedOut to false after clearStoredTokens in signinWithToken", async () => {
			// Arrange: Simulate signed out state from previous logout
			;(service as any).signedOut = true
			secrets.set("auth_state", JSON.stringify({ isAuthenticated: false, signedOut: true }))

			// Mock successful verification path (JWT success)
			const mockJWTResult = {
				success: true,
				userInfo: { userId: "user_123", email: "test@example.com" },
				payload: { sub: "user_123", email: "test@example.com" },
			}
			mockVerifyJWTToken.mockResolvedValueOnce(mockJWTResult)
			mockHandleSuccessfulJWTVerification.mockResolvedValue(undefined)

			// Act
			const result = await service.signinWithToken()

			// Assert
			expect(result).toBe(true)
			expect((service as any).signedOut).toBe(false)

			// Verify clearStoredTokens was called first
			expect(mockClearStoredTokens).toHaveBeenCalled()

			// Verify explicit reset happened - updateAuthenticationState called with signedOut: false
			expect(mockUpdateAuthenticationState).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					isAuthenticated: false,
					signedOut: false,
				}),
			)

			// Verify final state update has signedOut: false
			expect(mockUpdateAuthenticationState).toHaveBeenLastCalledWith(
				expect.objectContaining({
					isAuthenticated: true,
					signedOut: false,
				}),
			)
		})

		it("should reset signedOut through fallback authentication path", async () => {
			// Arrange: Simulate signed out state
			;(service as any).signedOut = true

			// Mock JWT failure but structure success
			mockVerifyJWTToken.mockResolvedValueOnce({ success: false, error: "Invalid signature" })
			mockTestTokenStructure.mockResolvedValueOnce({ valid: true, payload: { sub: "user_123" } })
			mockHandleFallbackTokenStorage.mockResolvedValue(undefined)

			// Act
			const result = await service.signinWithToken()

			// Assert
			expect(result).toBe(true)
			expect((service as any).signedOut).toBe(false)

			// Verify reset happened before fallback
			expect(mockUpdateAuthenticationState).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					signedOut: false,
				}),
			)
		})

		it("should reset signedOut in development mode fallback", async () => {
			// Arrange: Simulate signed out state
			;(service as any).signedOut = true

			// Mock failures leading to dev mode
			mockVerifyJWTToken.mockResolvedValueOnce({ success: false })
			mockTestTokenStructure.mockResolvedValueOnce({ valid: false })
			vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValueOnce({
				get: vi.fn().mockReturnValue(true), // skipAPIValidation = true
			} as any)
			mockHandleFallbackTokenStorage.mockResolvedValue(undefined)

			// Act
			const result = await service.signinWithToken()

			// Assert
			expect(result).toBe(true)
			expect((service as any).signedOut).toBe(false)
		})

		it("should handle API validation path with signedOut reset", async () => {
			// Arrange: Simulate signed out state
			;(service as any).signedOut = true

			// Mock failures until API success
			mockVerifyJWTToken.mockResolvedValueOnce({ success: false })
			mockTestTokenStructure.mockResolvedValueOnce({ valid: false })
			const mockAPIResult = { success: true, userInfo: { email: "test@example.com" } }
			mockValidateTokenWithAPI.mockResolvedValueOnce(mockAPIResult)
			mockHandleSuccessfulAPIValidation.mockResolvedValue(undefined)

			// Act
			const result = await service.signinWithToken()

			// Assert
			expect(result).toBe(true)
			expect((service as any).signedOut).toBe(false)
		})

		it("should log signedOut state changes throughout signinWithToken", async () => {
			// Arrange: Enable logging verification (mock console.log if needed, but check calls)
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})

			// Simulate signed out state
			;(service as any).signedOut = true

			// Mock successful path
			const mockJWTResult = { success: true, userInfo: { userId: "user_123" }, payload: { sub: "user_123" } }
			mockVerifyJWTToken.mockResolvedValueOnce(mockJWTResult)
			mockHandleSuccessfulJWTVerification.mockResolvedValue(undefined)

			// Act
			await service.signinWithToken()

			// Assert logging occurred at key points
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("[AUTH-LOG] signedOut state before clearStoredTokens"),
			)
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("[AUTH-FIX] Explicitly resetting signedOut flag"),
			)
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("[AUTH-LOG] signedOut state after explicit reset"),
			)
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("[AUTH-LOG] signedOut state before JWT verification"),
			)
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("[AUTH-LOG] signedOut state before handleSuccessfulJWTVerification"),
			)
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("[AUTH-LOG] signedOut state after handleSuccessfulJWTVerification"),
			)

			consoleSpy.mockRestore()
		})
	})

	describe("updateAuthenticationState signedOut handling", () => {
		it("should force signedOut to false when isAuthenticated true and signedOut was true", async () => {
			// Arrange
			const testState = {
				isAuthenticated: true,
				isConnected: true,
				signedOut: true, // Should be overridden
				clerkId: "user_123",
			}
			;(service as any).signedOut = true
			mockUpdateAuthenticationState.mockResolvedValue(undefined)

			// Act
			await (service as any).updateAuthenticationState(testState)

			// Assert
			expect((service as any).signedOut).toBe(false)
			expect(mockUpdateAuthenticationState).toHaveBeenCalledWith(
				expect.objectContaining({
					signedOut: false,
				}),
			)
		})

		it("should set signedOut false when undefined but isAuthenticated true", async () => {
			// Arrange
			const testState = {
				isAuthenticated: true,
				isConnected: true,
				// signedOut undefined
				clerkId: "user_123",
			}
			;(service as any).signedOut = true

			// Act
			await (service as any).updateAuthenticationState(testState)

			// Assert
			expect((service as any).signedOut).toBe(false)
		})

		it("should log state changes in updateAuthenticationState", async () => {
			// Arrange
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
			const testState = {
				isAuthenticated: true,
				isConnected: true,
				signedOut: undefined,
				clerkId: "user_123",
			}

			// Act
			await (service as any).updateAuthenticationState(testState)

			// Assert
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("[AUTH-LOG] updateAuthenticationState called with state"),
			)
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("[AUTH-STATE] Updated authentication state"),
			)
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					instanceSignedOutAfter: false,
				}),
			)

			consoleSpy.mockRestore()
		})
	})

	describe("clearStoredTokens signedOut reset", () => {
		it("should reset signedOut to false during clearStoredTokens", async () => {
			// Arrange
			;(service as any).signedOut = true

			// Act
			await (service as any).clearStoredTokens()

			// Assert
			expect((service as any).signedOut).toBe(false)
			expect(mockUpdateAuthenticationState).toHaveBeenCalledWith(
				expect.objectContaining({
					signedOut: false,
				}),
			)
		})

		it("should log signedOut changes in clearStoredTokens", async () => {
			// Arrange
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
			;(service as any).signedOut = true

			// Act
			await (service as any).clearStoredTokens()

			// Assert
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("[AUTH-LOG] signedOut state before clearStoredTokens"),
			)
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("[AUTH-LOG] signedOut state after clearStoredTokens"),
			)

			consoleSpy.mockRestore()
		})
	})

	describe("getAuthenticationState after reconnection", () => {
		it("should return signedOut false after successful reconnection", async () => {
			// Arrange: Store successful auth state with signedOut false
			secrets.set(
				"auth_state",
				JSON.stringify({
					isAuthenticated: true,
					isConnected: true,
					signedOut: false,
					clerkId: "user_123",
				}),
			)
			;(service as any).signedOut = false

			// Act
			const state = await service.getAuthenticationState()

			// Assert
			expect(state.signedOut).toBe(false)
			expect(state.isAuthenticated).toBe(true)
		})

		it("should use instance signedOut over stored if they differ", async () => {
			// Arrange: Stored has signedOut true, but instance reset to false during reconnection
			secrets.set(
				"auth_state",
				JSON.stringify({
					isAuthenticated: true,
					signedOut: true,
				}),
			)
			;(service as any).signedOut = false

			// Act
			const state = await service.getAuthenticationState()

			// Assert: Uses instance signedOut
			expect(state.signedOut).toBe(false)
		})
	})
})
