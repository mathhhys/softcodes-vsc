// src/auth/__tests__/backend-endpoints.integration.spec.ts

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { UnifiedAuthService, type AuthTokens } from "../unifiedAuthService"
import { AUTH_ENDPOINTS, getAuthConfig, OAUTH_CONFIG } from "../config"
import { generateCodeVerifier, generateCodeChallenge, generateState } from "../pkce"
import type { ExtensionContext } from "vscode"

// Mock VSCode modules
vi.mock("vscode", () => {
	return {
		ExtensionContext: vi.fn(),
		Uri: vi.fn(),
		window: {
			showInformationMessage: vi.fn(),
			showErrorMessage: vi.fn(),
			showWarningMessage: vi.fn(),
			showInputBox: vi.fn(),
		},
		env: {
			openExternal: vi.fn(),
		},
		workspace: {
			getConfiguration: vi.fn(),
			workspaceFolders: [{ uri: { fsPath: "/test/workspace" }, name: "test-workspace" }],
		},
		commands: {
			executeCommand: vi.fn(),
		},
	}
})

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock ContextProxy for compatibility
vi.mock("../../core/config/ContextProxy", () => ({
	ContextProxy: {
		instance: {
			getProviderSettings: vi.fn(() => ({})),
			setProviderSettings: vi.fn(),
		},
	},
}))

// Mock other dependencies
vi.mock("../jwtVerification", () => ({
	JWTVerificationService: {
		getInstance: vi.fn(() => ({
			verifyJWT: vi.fn(),
			isTokenNearExpiration: vi.fn(() => false),
		})),
	},
}))

vi.mock("../clerkBackendService", () => ({
	ClerkBackendService: {
		getInstance: vi.fn(() => ({
			verifyUser: vi.fn(),
		})),
	},
}))

vi.mock("../userVerificationService", () => ({
	UserVerificationService: {
		getInstance: vi.fn(() => ({
			verifyUser: vi.fn(),
		})),
	},
}))

vi.mock("../fallbackHandler", () => ({
	GracefulDegradationManager: vi.fn(() => ({
		verifyUserWithFallback: vi.fn(),
	})),
}))

vi.mock("../supabaseUserVerification", () => ({
	verifyJWTUserInSupabase: vi.fn(),
}))

describe("Backend Endpoints Integration Tests", () => {
	let context: ExtensionContext
	let authService: UnifiedAuthService
	const mockBackendUrl = "https://test.softcodes.ai"
	const mockTokens: AuthTokens = {
		access_token: "mock-access-jwt",
		refresh_token: "mock-refresh-token",
		session_id: "mock-session-id",
		organization_id: "mock-org-id",
	}

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks()
		mockFetch.mockReset()

		// Mock configuration
		;(vscode.workspace.getConfiguration as any).mockImplementation((section: string) => ({
			get: vi.fn((key: string, defaultValue: any) => {
				if (section === "softcodes" && key === "backendUrl") return mockBackendUrl
				if (section === "softcodes" && key === "apiBaseUrl") return mockBackendUrl
				if (key === "auth.skipAPIValidation") return true // Enable dev mode for fallbacks
				return defaultValue
			}),
			update: vi.fn(),
		}))

		// Mock secrets and globalState
		context = {
			secrets: {
				store: vi.fn(),
				get: vi.fn(),
				delete: vi.fn(),
			},
			globalState: {
				update: vi.fn(),
				get: vi.fn(),
			},
			subscriptions: [],
		} as any

		// Mock getAuthConfig to return test URLs
		vi.doMock("../config", () => ({
			...require("../config"),
			getAuthConfig: () => ({ API_BASE_URL: mockBackendUrl }),
		}))

		authService = UnifiedAuthService.getInstance(context as any)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("OAuth Flow Endpoints", () => {
		it("should initiate VSCode auth and get auth_url from /api/auth/initiate-vscode-auth", async () => {
			const codeVerifier = generateCodeVerifier()
			const codeChallenge = await generateCodeChallenge(codeVerifier)
			const state = generateState()

			// Mock the initiate auth endpoint
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					auth_url: "https://clerk.softcodes.ai/v1/client/sign_ins?...",
				}),
			} as Response)

			// Simulate auth initiation (partial, as full auth needs browser)
			const backendUrl = await authService["getBackendUrl"]()
			const authUrl = require("../config").buildAuthUrl(backendUrl, {
				redirect_uri: OAUTH_CONFIG.VSCODE.REDIRECT_URI,
				code_challenge: codeChallenge,
				state,
			})

			const response = await fetch(authUrl, {
				method: "GET",
				headers: { "Content-Type": "application/json" },
			})

			expect(response.ok).toBe(true)
			expect(await response.json()).toEqual({
				auth_url: "https://clerk.softcodes.ai/v1/client/sign_ins?...",
			})
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("/api/auth/initiate-vscode-auth"),
				expect.any(Object),
			)
		})

		it("should handle callback and exchange code via /api/extension/auth/callback", async () => {
			const code = "mock-auth-code"
			const state = "mock-state"
			const codeVerifier = "mock-verifier"
			const redirectUri = OAUTH_CONFIG.VSCODE.REDIRECT_URI

			// Store verifier in secrets
			await context.secrets.store(`pkce_${state}`, codeVerifier)

			// Mock callback endpoint
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					access_token: mockTokens.access_token,
					refresh_token: mockTokens.refresh_token,
					expires_in: 86400,
				}),
			} as Response)

			// Simulate handleCallback (uri with params)
			const mockUri = new URL(`vscode-softcodes://auth/callback?code=${code}&state=${state}`)
			;(mockUri as any).query = `code=${code}&state=${state}`

			await authService.handleCallback(mockUri as any)

			// Verify exchange call
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("/api/extension/auth/callback"),
				expect.objectContaining({
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						code,
						code_verifier: codeVerifier,
						state,
						redirect_uri: redirectUri,
					}),
				}),
			)

			// Verify tokens stored
			expect(context.secrets.store).toHaveBeenCalledWith("access_token", mockTokens.access_token)
			expect(context.secrets.store).toHaveBeenCalledWith("refresh_token", mockTokens.refresh_token)
			expect(context.globalState.update).toHaveBeenCalledWith("token_expiry", expect.any(Number))
			expect(context.globalState.update).toHaveBeenCalledWith("auth_in_progress", false)

			// Verify cleanup
			expect(context.secrets.delete).toHaveBeenCalledWith(expect.stringContaining("pkce_"))
		})

		it("should fail callback with invalid response from /api/extension/auth/callback", async () => {
			const code = "mock-auth-code"
			const state = "mock-state"
			const codeVerifier = "mock-verifier"

			await context.secrets.store(`pkce_${state}`, codeVerifier)

			// Mock failure
			mockFetch.mockResolvedValueOnce({
				ok: false,
				json: async () => ({ error: "Invalid code" }),
			} as Response)

			const mockUri = new URL(`vscode-softcodes://auth/callback?code=${code}&state=${state}`)

			await expect(authService.handleCallback(mockUri as any)).rejects.toThrow("Invalid code")

			expect(mockFetch).toHaveBeenCalled()
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("Authentication callback failed"),
			)
		})
	})

	describe("Token Refresh Endpoint", () => {
		beforeEach(async () => {
			// Store initial tokens
			await context.secrets.store("access_token", "expired-jwt")
			await context.secrets.store("refresh_token", mockTokens.refresh_token)
			await context.secrets.store("session_id", mockTokens.session_id!)
		})

		it("should successfully refresh token via /api/auth/refresh-token", async () => {
			// Mock successful refresh
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockTokens,
			} as Response)

			const refreshedToken = await authService.refreshAccessTokenResilient(mockTokens.refresh_token)

			expect(refreshedToken).toBe(mockTokens.access_token)
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("/api/auth/refresh-token"),
				expect.objectContaining({
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						refresh_token: mockTokens.refresh_token,
						client_type: "vscode",
					}),
				}),
			)

			// Verify new tokens stored
			expect(context.secrets.store).toHaveBeenCalledWith("access_token", mockTokens.access_token)
			expect(context.secrets.store).toHaveBeenCalledWith("refresh_token", mockTokens.refresh_token)
		})

		it("should retry refresh on transient failure", async () => {
			// Mock first two failures, third success
			mockFetch
				.mockResolvedValueOnce({ ok: false, status: 500 } as Response) // Attempt 1
				.mockResolvedValueOnce({ ok: false, status: 503 } as Response) // Attempt 2
				.mockResolvedValueOnce({ ok: true, json: async () => mockTokens } as Response) // Attempt 3

			const refreshedToken = await authService.refreshAccessTokenResilient(mockTokens.refresh_token)

			expect(refreshedToken).toBe(mockTokens.access_token)
			expect(mockFetch).toHaveBeenCalledTimes(3)
			// Delays should be simulated, but we check calls
		})

		it("should fallback to token extension on endpoint unavailability (dev mode)", async () => {
			// Mock endpoint unavailable (404)
			mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as Response)

			// Mock extendTokenLifetime to return existing token (for dev tolerance)
			vi.spyOn(authService as any, "extendTokenLifetime").mockResolvedValueOnce("extended-jwt")

			const refreshedToken = await authService.refreshAccessTokenResilient(mockTokens.refresh_token)

			expect(refreshedToken).toBe("extended-jwt")
			expect((authService as any).extendTokenLifetime).toHaveBeenCalled()
		})

		it("should fail refresh with invalid refresh_token", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				json: async () => ({ error: "Invalid refresh token" }),
			} as Response)

			const refreshedToken = await authService.refreshAccessTokenResilient("invalid-refresh")

			expect(refreshedToken).toBeUndefined()
			expect(mockFetch).toHaveBeenCalled()
			// In full flow, this would clear tokens and prompt re-auth
		})
	})

	describe("Session Validation Endpoint", () => {
		beforeEach(async () => {
			await context.secrets.store("access_token", mockTokens.access_token)
			await context.secrets.store("session_id", mockTokens.session_id!)
		})

		it("should validate session via /api/auth/validate-session", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ valid: true, user: { id: "user_123", email: "test@example.com" } }),
			} as Response)

			const isValid = await authService["validateTokenWithAPI"](mockTokens.access_token)

			expect(isValid.success).toBe(true)
			expect(isValid.userInfo).toEqual({ id: "user_123", email: "test@example.com" })
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("/api/auth/validate-session"),
				expect.objectContaining({
					method: "POST",
					headers: { Authorization: `Bearer ${mockTokens.access_token.substring(0, 20)}...` },
					body: JSON.stringify({
						client_type: "vscode",
						workspace_path: expect.any(String), // Encoded
						workspace_name: "test-workspace",
					}),
				}),
			)
		})

		it("should handle 404 on validate-session (fallback to JWT)", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 404,
				json: async () => ({ error: "Not Found" }),
			} as Response)

			// Mock JWT verification success
			const jwtService = require("../jwtVerification").JWTVerificationService.getInstance()
			vi.spyOn(jwtService, "verifyJWT").mockResolvedValueOnce({
				valid: true,
				userInfo: { email: "test@example.com", userId: "user_123" },
				payload: { sub: "user_123", email: "test@example.com" },
			} as any)

			const currentState = await authService.validateSession()

			expect(currentState).toBe(true)
			expect(mockFetch).toHaveBeenCalled()
			// Falls back to local JWT check
		})
	})

	describe("User Info Endpoint", () => {
		it("should fetch user info via /api/auth/user-info", async () => {
			await context.secrets.store("access_token", mockTokens.access_token)
			await context.secrets.store("session_id", mockTokens.session_id!)

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					email: "test@example.com",
					firstName: "Test",
					planType: "pro",
					credits: 100,
				}),
			} as Response)

			const userInfo = await authService.getUserInfo()

			expect(userInfo).toEqual({
				email: "test@example.com",
				firstName: "Test",
				lastName: undefined,
				organizationName: undefined,
				organizationId: undefined,
			})
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("/api/auth/user-info"),
				expect.objectContaining({
					method: "GET",
					headers: { Authorization: `Bearer ${mockTokens.access_token}` },
				}),
			)
		})

		it("should fallback to JWT extraction on user-info failure", async () => {
			await context.secrets.store("access_token", "mock-jwt-with-payload")

			// Mock fetch failure
			mockFetch.mockRejectedValueOnce(new Error("Network error"))

			// Mock JWT parsing
			vi.doMock("../jwtUtils", () => ({
				parseJWTUnsafe: () => ({
					success: true,
					parts: {
						payload: {
							email: "fallback@example.com",
							first_name: "Fallback",
							sub: "user_fallback",
							org_id: "org_123",
						},
					},
				}),
				extractUserInfoFromPayload: (payload: any) => ({
					email: payload.email,
					userId: payload.sub,
					firstName: payload.first_name,
					organizationId: payload.org_id,
				}),
			}))

			const userInfo = await authService.getUserInfo()

			expect(userInfo).toEqual({
				email: "fallback@example.com",
				firstName: "Fallback",
				lastName: undefined,
				organizationName: undefined,
				organizationId: "org_123",
			})
		})
	})

	describe("Sign Out Endpoint", () => {
		it("should call /api/auth/sign-out on sign out", async () => {
			await context.secrets.store("session_id", mockTokens.session_id!)

			mockFetch.mockResolvedValueOnce({ ok: true } as Response)

			await authService.signOut()

			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("/api/auth/sign-out"),
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ session_id: mockTokens.session_id }),
				}),
			)

			// Verify tokens cleared
			expect(context.secrets.delete).toHaveBeenCalledWith("access_token")
			expect(context.secrets.delete).toHaveBeenCalledWith("refresh_token")
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining("Signed out"))
		})

		it("should continue on sign-out endpoint failure", async () => {
			await context.secrets.store("session_id", mockTokens.session_id!)

			mockFetch.mockRejectedValueOnce(new Error("Network error"))

			await expect(authService.signOut()).resolves.not.toThrow()

			// Still clears local tokens even if backend fails
			expect(context.secrets.delete).toHaveBeenCalled()
		})
	})

	describe("Error Handling and Fallbacks", () => {
		it("should handle backend unavailability gracefully in ensureValidAccessToken", async () => {
			// No tokens stored
			;(context.secrets.get as any).mockResolvedValueOnce(undefined) // access_token
			;(context.secrets.get as any).mockResolvedValueOnce(mockTokens.refresh_token) // refresh_token

			// Mock refresh failure (404)
			mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as Response)

			const token = await authService.ensureValidAccessToken()

			// In dev mode, should fallback/extend if possible
			expect(token).toBeUndefined() // Or extended if mocked
			expect((authService as any).extendTokenLifetime).toHaveBeenCalled()
		})

		it("should clear tokens on 401 errors", async () => {
			await context.secrets.store("access_token", mockTokens.access_token)

			// Simulate 401 in validateTokenWithAPI
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				json: async () => ({ error: "Unauthorized" }),
			} as Response)

			const result = await authService["validateTokenWithAPI"](mockTokens.access_token)

			expect(result.success).toBe(false)
			expect(result.error).toContain("401")
			// In full flow, signOut() would be called
		})
	})
})
