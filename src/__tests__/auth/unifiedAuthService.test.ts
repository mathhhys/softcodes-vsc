import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { UnifiedAuthService, type AuthenticationState } from "../../auth/unifiedAuthService"
import { ContextProxy } from "../../core/config/ContextProxy"
import { parseJWTUnsafe } from "../../auth/jwtUtils"

// Mock VSCode modules
vi.mock("vscode", () => {
	const mockWindow = {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showInputBox: vi.fn(),
	}

	const mockEnv = {
		openExternal: vi.fn(),
	}

	const mockWorkspace = {
		getConfiguration: vi.fn(),
		workspaceFolders: [{ uri: { fsPath: "/test/workspace" } }],
	}

	const mockCommands = {
		executeCommand: vi.fn(),
	}

	return {
		window: mockWindow,
		env: mockEnv,
		workspace: mockWorkspace,
		commands: mockCommands,
	}
})

// Mock ContextProxy
vi.mock("../../core/config/ContextProxy", () => ({
	ContextProxy: {
		instance: {
			getProviderSettings: vi.fn(),
			setProviderSettings: vi.fn(),
		},
	},
}))

// Mock jwtUtils
vi.mock("../../auth/jwtUtils", () => ({
	parseJWTUnsafe: vi.fn(),
}))

// Mock other dependencies as needed
vi.mock("../../auth/config", () => ({
	getAuthConfig: vi.fn(() => ({ API_BASE_URL: "https://test-api.com" })),
	OAUTH_CONFIG: { VSCODE: { REDIRECT_URI: "vscode://test" } },
	AUTH_ENDPOINTS: { REFRESH_TOKEN: "/auth/refresh", USER_INFO: "/auth/user" },
	TOKEN_KEYS: {
		ACCESS_TOKEN: "access_token",
		REFRESH_TOKEN: "refresh_token",
		SESSION_ID: "session_id",
		ORGANIZATION_ID: "organization_id",
	},
}))

vi.mock("../../auth/jwtVerification", () => ({
	JWTVerificationService: {
		getInstance: vi.fn(() => ({
			verifyJWT: vi.fn(),
			isTokenNearExpiration: vi.fn(() => false),
		})),
	},
}))

vi.mock("../../auth/supabaseUserVerification", () => ({
	verifyJWTUserInSupabase: vi.fn(),
}))

describe("UnifiedAuthService - Authentication State Management", () => {
	let mockContext: any
	let authService: UnifiedAuthService
	let mockSecretsStore: Map<string, string>
	let mockSecretsGet: any
	let mockSecretsDelete: any
	let mockGlobalStateUpdate: any

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks()

		// Mock secrets store as a simple Map for testing
		mockSecretsStore = new Map<string, string>()
		mockSecretsGet = vi.fn(async (key: string) => mockSecretsStore.get(key))
		mockSecretsDelete = vi.fn(async (key: string) => mockSecretsStore.delete(key))

		mockGlobalStateUpdate = vi.fn()

		mockContext = {
			secrets: {
				get: mockSecretsGet,
				store: vi.fn(async (key: string, value: string) => mockSecretsStore.set(key, value)),
				delete: mockSecretsDelete,
			},
			globalState: {
				get: vi.fn(),
				update: mockGlobalStateUpdate,
			},
			subscriptions: [],
		}

		// Mock vscode.workspace.getConfiguration
		;(vscode.workspace.getConfiguration as any).mockReturnValue({
			get: vi.fn((key: string, defaultValue?: any) => {
				if (key === "softcodes.auth.skipAPIValidation") return false
				if (key === "softcodes.auth.enableClerkBackend") return false
				if (key === "softcodes.auth.forceBackendVerification") return false
				if (key === "softcodes.backendUrl") return undefined
				if (key === "softcodes.apiBaseUrl") return "https://test-api.com"
				return defaultValue
			}),
			update: vi.fn(),
		})

		// Mock parseJWTUnsafe
		;(parseJWTUnsafe as any).mockImplementation((token: string) => {
			if (token.includes("expired")) {
				return {
					success: true,
					parts: {
						payload: { exp: Math.floor(Date.now() / 1000) - 100 },
					},
				}
			}
			return {
				success: true,
				parts: {
					payload: {
						exp: Math.floor((Date.now() + 3600000) / 1000), // 1 hour from now
						sub: "test-user-id",
						email: "test@example.com",
					},
				},
			}
		})

		// Create auth service instance
		authService = new UnifiedAuthService(mockContext as any)
	})

	afterEach(() => {
		// Clean up
		mockSecretsStore.clear()
		vi.clearAllMocks()
	})

	describe("signOut() - Clears storage and sets signedOut flag", () => {
		it("should clear all stored tokens and set signedOut to true", async () => {
			// Setup: Store some tokens
			mockSecretsStore.set("access_token", "valid-access-token")
			mockSecretsStore.set("refresh_token", "valid-refresh-token")
			mockSecretsStore.set("session_id", "test-session")
			mockSecretsStore.set("organization_id", "test-org")
			mockSecretsStore.set("auth_state", JSON.stringify({ isAuthenticated: true, isConnected: true }))

			// Mock ContextProxy for kilocodeToken
			const mockContextProxy = {
				getProviderSettings: vi.fn(() => ({ kilocodeToken: "old-token" })),
				setProviderSettings: vi.fn(),
			}
			vi.doMock("../../core/config/ContextProxy", () => ({
				ContextProxy: { instance: mockContextProxy },
			}))

			// Execute signOut
			await authService.signOut()

			// Verify storage cleared
			expect(mockSecretsGet).toHaveBeenCalledWith("access_token")
			expect(mockSecretsDelete).toHaveBeenCalledWith("access_token")
			expect(mockSecretsDelete).toHaveBeenCalledWith("refresh_token")
			expect(mockSecretsDelete).toHaveBeenCalledWith("session_id")
			expect(mockSecretsDelete).toHaveBeenCalledWith("organization_id")
			expect(mockSecretsDelete).toHaveBeenCalledWith("auth_state")

			// Verify auth_state is cleared from store
			expect(mockSecretsStore.has("auth_state")).toBe(false)

			// Verify kilocodeToken cleared
			expect(mockContextProxy.setProviderSettings).toHaveBeenCalledWith(
				expect.objectContaining({
					kilocodeToken: undefined,
				}),
			)

			// Verify signedOut flag is set
			expect(authService["signedOut"]).toBe(true)

			// Verify authentication state updated with signedOut: true
			const state = await authService.getAuthenticationState()
			expect(state).toEqual({
				isAuthenticated: false,
				isConnected: false,
				signedOut: true,
			})
		})

		it("should handle errors during cleanup gracefully", async () => {
			// Mock failing delete
			mockSecretsDelete.mockRejectedValueOnce(new Error("Storage error"))

			// Setup tokens
			mockSecretsStore.set("access_token", "test-token")

			// Execute signOut (should not throw)
			await expect(authService.signOut()).resolves.not.toThrow()

			// Verify signedOut flag still set even on error
			expect(authService["signedOut"]).toBe(true)
		})
	})

	describe("getAuthenticationState() - Always includes signedOut flag", () => {
		it("should return stored state with signedOut flag from instance", async () => {
			// Setup: Store auth_state
			const storedState = { isAuthenticated: true, isConnected: true }
			mockSecretsStore.set("auth_state", JSON.stringify(storedState))

			// Case 1: signedOut is false (default)
			const state1 = await authService.getAuthenticationState()
			expect(state1).toEqual({
				...storedState,
				signedOut: false, // Should include instance's signedOut
			})

			// Case 2: Set signedOut to true
			authService["signedOut"] = true
			const state2 = await authService.getAuthenticationState()
			expect(state2).toEqual({
				...storedState,
				signedOut: true, // Should reflect instance's signedOut
			})

			// Case 3: No stored state, but tokens exist
			mockSecretsStore.clear() // Clear everything to test empty state
			mockSecretsStore.set("access_token", "valid-token")
			const state3 = await authService.getAuthenticationState()
			expect(state3).toEqual({
				isAuthenticated: true,
				isConnected: false,
				signedOut: true, // Still includes signedOut
			})

			// Case 4: No tokens, signedOut true
			mockSecretsStore.clear()
			authService["signedOut"] = true
			const state4 = await authService.getAuthenticationState()
			expect(state4).toEqual({
				isAuthenticated: false,
				isConnected: false,
				signedOut: true,
			})
		})

		it("should not trigger token refresh or state changes", async () => {
			// Mock ensureValidAccessToken to detect if called (it shouldn't be)
			const mockEnsureValid = vi.fn().mockResolvedValue("token")
			authService["ensureValidAccessToken"] = mockEnsureValid as any

			// Call getAuthenticationState multiple times
			await authService.getAuthenticationState()
			await authService.getAuthenticationState()

			// Should not call ensureValidAccessToken
			expect(mockEnsureValid).not.toHaveBeenCalled()
		})

		it("should handle storage errors gracefully", async () => {
			// Mock failing secrets.get
			mockSecretsGet.mockRejectedValueOnce(new Error("Storage read error"))

			const state = await authService.getAuthenticationState()
			expect(state).toEqual({
				isAuthenticated: false,
				isConnected: false,
				signedOut: false,
				error: "Failed to retrieve authentication state",
			})
		})
	})

	describe("Race Condition Simulation - signOut vs getAuthenticationState", () => {
		it("should block profile requests after signOut even if getAuthenticationState is called concurrently", async () => {
			// Setup initial authenticated state
			mockSecretsStore.set("access_token", "valid-token")
			mockSecretsStore.set("auth_state", JSON.stringify({ isAuthenticated: true, isConnected: true }))

			// Simulate concurrent calls: signOut and getAuthenticationState
			const signOutPromise = authService.signOut()
			const statePromise = authService.getAuthenticationState()

			await Promise.all([signOutPromise, statePromise])

			// After signOut, state should reflect signedOut: true
			const finalState = await authService.getAuthenticationState()
			expect(finalState.signedOut).toBe(true)
			expect(finalState.isAuthenticated).toBe(false)

			// ensureValidAccessToken should return undefined when signedOut
			const token = await authService["ensureValidAccessToken"]()
			expect(token).toBeUndefined()
		})
	})

	describe("ensureValidAccessToken() - Respects signedOut flag", () => {
		it("should return undefined immediately if signedOut is true", async () => {
			// Set signedOut flag
			authService["signedOut"] = true

			// Even if token exists
			mockSecretsStore.set("access_token", "valid-token")

			const token = await authService["ensureValidAccessToken"]()
			expect(token).toBeUndefined()
		})

		it("should not attempt refresh if signedOut is true", async () => {
			// Mock refresh to detect calls
			const mockRefresh = vi.fn().mockResolvedValue(undefined)
			authService["performTokenRefreshWithLocking"] = mockRefresh as any

			authService["signedOut"] = true
			mockSecretsStore.set("refresh_token", "valid-refresh")

			await authService["ensureValidAccessToken"]()

			// Should not attempt refresh
			expect(mockRefresh).not.toHaveBeenCalled()
		})
	})

	describe("updateAuthenticationState() - Properly persists and notifies", () => {
		it("should store state with signedOut and trigger callback if set", async () => {
			// Setup callback
			const callbackMock = vi.fn()
			authService.setStateChangeCallback(callbackMock)

			authService["signedOut"] = true
			const newState: AuthenticationState = {
				isAuthenticated: false,
				isConnected: false,
				signedOut: true,
			}

			await authService["updateAuthenticationState"](newState)

			// Verify stored
			expect(mockSecretsStore.get("auth_state")).toBe(JSON.stringify(newState))

			// Verify callback called
			expect(callbackMock).toHaveBeenCalledWith(newState)
		})
	})
})
