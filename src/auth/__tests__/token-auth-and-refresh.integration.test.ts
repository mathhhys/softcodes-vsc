import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import * as vscode from "vscode"
import { UnifiedAuthService } from "../unifiedAuthService"
import { TOKEN_KEYS, JWT_CONFIG } from "../config"
import { parseJWTUnsafe } from "../jwtUtils"

// Mock VSCode APIs
vi.mock("vscode", () => {
	const secretsMap = new Map<string, string | undefined>()
	const globalStateMap = new Map<string, any>()

	const secrets = {
		get: vi.fn(async (key: string) => secretsMap.get(key)),
		store: vi.fn(async (key: string, value: string) => {
			secretsMap.set(key, value)
		}),
		delete: vi.fn(async (key: string) => {
			secretsMap.delete(key)
		}),
		_map: secretsMap,
	}

	const globalState = {
		update: vi.fn(async (key: string, value: unknown) => {
			globalStateMap.set(key, value)
		}),
		get: vi.fn((key: string) => globalStateMap.get(key)),
		_map: globalStateMap,
	}

	const workspace = {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue(false), // Default to production mode
		}),
		workspaceFolders: undefined as any,
	}

	const window = {
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showInputBox: vi.fn(),
	}

	const env = {
		openExternal: vi.fn(),
	}

	const commands = {
		executeCommand: vi.fn(),
	}

	return {
		__esModule: true,
		secrets,
		workspace,
		window,
		env,
		commands,
		extensions: {
			getExtension: vi.fn().mockReturnValue({ packageJSON: { version: "test" } }),
		},
		default: {
			createMockContext: () => ({
				secrets,
				globalState,
				subscriptions: [],
			}),
		},
	}
})

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Test utilities
function createMockJWT(expOffsetSeconds: number, customClaims: any = {}): string {
	const now = Math.floor(Date.now() / 1000)
	const header = { alg: "RS256", typ: "JWT" }
	const payload = {
		iss: "https://clerk.softcodes.ai",
		sub: "user_123",
		email: "test@example.com",
		first_name: "Test",
		last_name: "User",
		session_id: "session_123",
		org_id: "org_123",
		iat: now,
		exp: now + expOffsetSeconds,
		...customClaims,
	}

	const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url")
	const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url")
	const signature = "mock_signature"

	return `${headerB64}.${payloadB64}.${signature}`
}

function createMockContext(): vscode.ExtensionContext {
	const secretsMap = new Map<string, string | undefined>()
	const globalStateMap = new Map<string, any>()

	const context = {
		secrets: {
			get: vi.fn(async (key: string) => secretsMap.get(key)),
			store: vi.fn(async (key: string, value: string) => {
				secretsMap.set(key, value)
			}),
			delete: vi.fn(async (key: string) => {
				secretsMap.delete(key)
			}),
			_map: secretsMap,
		},
		globalState: {
			update: vi.fn(async (key: string, value: unknown) => {
				globalStateMap.set(key, value)
			}),
			get: vi.fn((key: string) => globalStateMap.get(key)),
			_map: globalStateMap,
		},
		subscriptions: [],
	} as unknown as vscode.ExtensionContext

	// Add the _map property for testing
	;(context.secrets as any)._map = secretsMap
	;(context.globalState as any)._map = globalStateMap

	return context
}

describe("Token Authentication and Refresh Integration Tests", () => {
	let service: UnifiedAuthService
	let context: vscode.ExtensionContext

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()
		mockFetch.mockReset()

		// Create fresh context and service
		context = createMockContext()
		;(UnifiedAuthService as any).instance = undefined
		service = UnifiedAuthService.getInstance(context)

		// Clear any stored data
		;(context.secrets as any)._map.clear()
		;(context.globalState as any)._map.clear()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("Token Authentication Flow", () => {
		it("should successfully authenticate with valid JWT token", async () => {
			const validToken = createMockJWT(3600) // Valid for 1 hour

			// Mock successful Supabase verification
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					userExistsInSupabase: true,
					userDetails: {
						id: "user_123",
						email: "test@example.com",
						first_name: "Test",
						last_name: "User",
						created_at: new Date().toISOString(),
					},
				}),
			})

			// Mock successful API validation
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					userInfo: { email: "test@example.com" },
				}),
			})

			await service.signinWithToken()

			// Verify token was prompted for
			expect(vscode.window.showInputBox).toHaveBeenCalled()

			// Simulate user entering token
			const inputBoxCall = (vscode.window.showInputBox as any).mock.calls[0][0]
			inputBoxCall.validateInput(validToken)

			// Verify token was stored
			expect(await context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)).toBe(validToken)

			// Verify authentication state was updated
			const authState = await service.getAuthenticationState()
			expect(authState.isAuthenticated).toBe(true)
			expect(authState.isConnected).toBe(true)
		})

		it("should handle JWT verification failure gracefully", async () => {
			const invalidToken = "invalid.jwt.token"

			await service.signinWithToken()

			// Simulate user entering invalid token
			const inputBoxCall = (vscode.window.showInputBox as any).mock.calls[0][0]
			inputBoxCall.validateInput(invalidToken)

			// Should show error message
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("Unable to verify authentication token"),
			)
		})

		it("should handle expired tokens during input validation", async () => {
			const expiredToken = createMockJWT(-60) // Expired 1 minute ago

			await service.signinWithToken()

			const inputBoxCall = (vscode.window.showInputBox as any).mock.calls[0][0]
			const result = inputBoxCall.validateInput(expiredToken)

			expect(result).toContain("already expired")
		})

		it("should clear expired tokens automatically", async () => {
			const expiredToken = createMockJWT(-60)
			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)

			// Test by calling getAccessToken which should clear expired tokens
			const token = await service.getAccessToken()

			expect(token).toBeUndefined()
			expect(await context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)).toBeUndefined()
		})
	})

	describe("Token Refresh Mechanisms", () => {
		it("should automatically refresh expired tokens", async () => {
			const expiredToken = createMockJWT(-60)
			const refreshToken = "valid_refresh_token"
			const newAccessToken = createMockJWT(3600)

			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, refreshToken)

			// Mock successful refresh
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					access_token: newAccessToken,
					refresh_token: "new_refresh_token",
				}),
			})

			const result = await service.ensureValidAccessToken()

			expect(result).toBe(newAccessToken)
			expect(await context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)).toBe(newAccessToken)
		})

		it("should proactively refresh tokens near expiration", async () => {
			const nearExpiryToken = createMockJWT(120) // Expires in 2 minutes
			const refreshToken = "valid_refresh_token"
			const newAccessToken = createMockJWT(3600)

			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, nearExpiryToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, refreshToken)

			// Mock successful refresh
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					access_token: newAccessToken,
					refresh_token: "new_refresh_token",
				}),
			})

			const result = await service.ensureValidAccessToken()

			expect(result).toBe(newAccessToken)
			expect(mockFetch).toHaveBeenCalled()
		})

		it("should handle refresh token API failures with retry", async () => {
			const expiredToken = createMockJWT(-60)
			const refreshToken = "valid_refresh_token"

			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, refreshToken)

			// Mock API failures followed by success
			mockFetch
				.mockResolvedValueOnce({ ok: false, status: 500 }) // First attempt fails
				.mockResolvedValueOnce({ ok: false, status: 502 }) // Second attempt fails
				.mockResolvedValueOnce({
					// Third attempt succeeds
					ok: true,
					json: async () => ({
						access_token: createMockJWT(3600),
						refresh_token: "new_refresh_token",
					}),
				})

			const result = await service.ensureValidAccessToken()

			expect(result).toBeDefined()
			expect(mockFetch).toHaveBeenCalledTimes(3)
		})

		it("should use fallback token extension when refresh API unavailable", async () => {
			const expiredToken = createMockJWT(-60)
			const refreshToken = "valid_refresh_token"

			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, refreshToken)

			// Mock refresh endpoint as unavailable
			mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

			const result = await service.ensureValidAccessToken()

			// Should return the original token (fallback extension)
			expect(result).toBe(expiredToken)
		})

		it("should prevent race conditions during concurrent refresh attempts", async () => {
			const expiredToken = createMockJWT(-60)
			const refreshToken = "valid_refresh_token"
			const newAccessToken = createMockJWT(3600)

			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, refreshToken)

			// Mock slow refresh response
			mockFetch.mockImplementationOnce(
				() =>
					new Promise((resolve) =>
						setTimeout(
							() =>
								resolve({
									ok: true,
									json: async () => ({
										access_token: newAccessToken,
										refresh_token: "new_refresh_token",
									}),
								}),
							100,
						),
					),
			)

			// Start multiple concurrent refresh attempts
			const promises = [
				service.ensureValidAccessToken(),
				service.ensureValidAccessToken(),
				service.ensureValidAccessToken(),
			]

			const results = await Promise.all(promises)

			// All should return the same refreshed token
			expect(results[0]).toBe(newAccessToken)
			expect(results[1]).toBe(newAccessToken)
			expect(results[2]).toBe(newAccessToken)

			// But fetch should only be called once due to locking
			expect(mockFetch).toHaveBeenCalledTimes(1)
		})

		it("should handle refresh token rotation", async () => {
			const expiredToken = createMockJWT(-60)
			const oldRefreshToken = "old_refresh_token"
			const newAccessToken = createMockJWT(3600)
			const newRefreshToken = "new_refresh_token"

			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, oldRefreshToken)

			// Mock refresh with token rotation
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					access_token: newAccessToken,
					refresh_token: newRefreshToken,
				}),
			})

			await service.ensureValidAccessToken()

			// Verify new refresh token was stored
			expect(await context.secrets.get(TOKEN_KEYS.REFRESH_TOKEN)).toBe(newRefreshToken)
		})
	})

	describe("Authentication State Management", () => {
		it("should track authentication state correctly", async () => {
			// Initially not authenticated
			let authState = await service.getAuthenticationState()
			expect(authState.isAuthenticated).toBe(false)
			expect(authState.isConnected).toBe(false)

			// After storing valid token
			const validToken = createMockJWT(3600)
			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, validToken)

			authState = await service.getAuthenticationState()
			expect(authState.isAuthenticated).toBe(true)
			expect(authState.isConnected).toBe(false) // No Supabase verification yet

			// After successful Supabase verification (simulated through signinWithToken)
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					userExistsInSupabase: true,
					userDetails: { id: "user_123", email: "test@example.com" },
				}),
			})

			// Simulate the full authentication flow which includes Supabase verification
			await service.signinWithToken()
			// Mock user input
			const inputBoxCall = (vscode.window.showInputBox as any).mock.calls[0][0]
			inputBoxCall.validateInput(validToken)

			authState = await service.getAuthenticationState()
			expect(authState.isAuthenticated).toBe(true)
			expect(authState.isConnected).toBe(true)
		})

		it("should persist authentication state across sessions", async () => {
			const validToken = createMockJWT(3600)
			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, validToken)

			// Simulate state persistence
			const authState = {
				isAuthenticated: true,
				isConnected: true,
				clerkId: "user_123",
				supabaseVerified: true,
			}
			await context.secrets.store("auth_state", JSON.stringify(authState))

			const retrievedState = await service.getAuthenticationState()
			expect(retrievedState.isAuthenticated).toBe(true)
			expect(retrievedState.isConnected).toBe(true)
			expect(retrievedState.clerkId).toBe("user_123")
		})

		it("should handle sign out correctly", async () => {
			// Set up authenticated state
			const validToken = createMockJWT(3600)
			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, validToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, "refresh_token")
			await context.secrets.store(TOKEN_KEYS.SESSION_ID, "session_123")

			// Mock sign out API call
			mockFetch.mockResolvedValueOnce({ ok: true })

			await service.signOut()

			// Verify all tokens cleared
			expect(await context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)).toBeUndefined()
			expect(await context.secrets.get(TOKEN_KEYS.REFRESH_TOKEN)).toBeUndefined()
			expect(await context.secrets.get(TOKEN_KEYS.SESSION_ID)).toBeUndefined()

			// Verify state reset
			const authState = await service.getAuthenticationState()
			expect(authState.isAuthenticated).toBe(false)
			expect(authState.isConnected).toBe(false)
		})
	})

	describe("Error Handling and Edge Cases", () => {
		it("should handle network failures during refresh", async () => {
			const expiredToken = createMockJWT(-60)
			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, "refresh_token")

			// Mock network failure
			mockFetch.mockRejectedValueOnce(new Error("Network error"))

			const result = await service.ensureValidAccessToken()

			// Should return undefined when refresh fails
			expect(result).toBeUndefined()
		})

		it("should handle malformed JWT tokens gracefully", async () => {
			const malformedToken = "not.a.valid.jwt"
			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, malformedToken)

			const token = await service.getAccessToken()

			// Should return undefined for malformed tokens
			expect(token).toBeUndefined()
		})

		it("should handle tokens without expiration claims", async () => {
			const tokenWithoutExp = createMockJWT(3600)
			// Remove exp claim by parsing and recreating without it
			const parsed = parseJWTUnsafe(tokenWithoutExp)
			if (parsed.success && parsed.parts) {
				delete (parsed.parts.payload as any).exp
				const headerB64 = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
				const payloadB64 = Buffer.from(JSON.stringify(parsed.parts.payload)).toString("base64url")
				const tokenWithoutExpClaim = `${headerB64}.${payloadB64}.signature`
				await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, tokenWithoutExpClaim)

				const token = await service.getAccessToken()

				// Should return the token even without exp claim
				expect(token).toBe(tokenWithoutExpClaim)
			}
		})

		it("should handle concurrent authentication attempts", async () => {
			const validToken = createMockJWT(3600)

			// Mock successful Supabase verification
			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({
					success: true,
					userExistsInSupabase: true,
					userDetails: { id: "user_123", email: "test@example.com" },
				}),
			})

			// Start multiple concurrent authentication attempts
			const promises = [service.signinWithToken(), service.signinWithToken(), service.signinWithToken()]

			// Mock user input for all attempts
			for (const promise of promises) {
				const inputBoxCall = (vscode.window.showInputBox as any).mock.calls.find(
					(call: any) => call[0]?.validateInput,
				)
				if (inputBoxCall) {
					inputBoxCall[0].validateInput(validToken)
				}
			}

			await Promise.all(promises)

			// Should only store token once
			expect(context.secrets.store).toHaveBeenCalledTimes(4) // access_token + session_id + org_id + auth_state
		})

		it("should respect JWT_CONFIG.TOKEN_REFRESH_THRESHOLD", async () => {
			const threshold = JWT_CONFIG.TOKEN_REFRESH_THRESHOLD || 300
			const tokenExpiringSoon = createMockJWT(threshold - 10) // Expires just before threshold

			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, tokenExpiringSoon)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, "refresh_token")

			// Mock successful refresh
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					access_token: createMockJWT(3600),
					refresh_token: "new_refresh_token",
				}),
			})

			await service.ensureValidAccessToken()

			// Should have triggered refresh due to threshold
			expect(mockFetch).toHaveBeenCalled()
		})
	})

	describe("End-to-End Authentication Scenarios", () => {
		it("should complete full OAuth flow successfully", async () => {
			const authCode = "auth_code_123"
			const newAccessToken = createMockJWT(3600)
			const newRefreshToken = "new_refresh_token"

			// Mock OAuth initiation
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					auth_url: "https://clerk.softcodes.ai/oauth/authorize?code=123",
				}),
			})

			// Mock token exchange
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					access_token: newAccessToken,
					refresh_token: newRefreshToken,
					expires_in: 3600,
				}),
			})

			// Mock Supabase verification
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					userExistsInSupabase: true,
					userDetails: { id: "user_123", email: "test@example.com" },
				}),
			})

			await service.authenticate()

			// Verify browser was opened
			expect(vscode.env.openExternal).toHaveBeenCalled()

			// Simulate callback
			await service.handleCallback(
				vscode.Uri.parse(`vscode-softcodes://auth/callback?code=${authCode}&state=state123`),
			)

			// Verify tokens were stored
			expect(await context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)).toBe(newAccessToken)
			expect(await context.secrets.get(TOKEN_KEYS.REFRESH_TOKEN)).toBe(newRefreshToken)
		})

		it("should handle token refresh during API calls", async () => {
			const expiredToken = createMockJWT(-60)
			const refreshToken = "valid_refresh_token"
			const newAccessToken = createMockJWT(3600)

			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, refreshToken)

			// Mock failed API call with 401 (expired token)
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				json: async () => ({ error: "Token expired" }),
			})

			// Mock successful refresh
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					access_token: newAccessToken,
					refresh_token: "new_refresh_token",
				}),
			})

			// Mock successful retry with new token
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ success: true }),
			})

			const result = await service.validateSession()

			expect(result).toBe(true)
			expect(mockFetch).toHaveBeenCalledTimes(3) // Failed call + refresh + retry
		})

		it("should maintain authentication state across service restarts", async () => {
			// Set up authenticated state
			const validToken = createMockJWT(3600)
			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, validToken)

			const authState = {
				isAuthenticated: true,
				isConnected: true,
				clerkId: "user_123",
				supabaseVerified: true,
			}
			await context.secrets.store("auth_state", JSON.stringify(authState))

			// Simulate service restart by creating new instance
			;(UnifiedAuthService as any).instance = undefined
			const newService = UnifiedAuthService.getInstance(context)

			const retrievedState = await newService.getAuthenticationState()

			expect(retrievedState.isAuthenticated).toBe(true)
			expect(retrievedState.isConnected).toBe(true)
			expect(retrievedState.clerkId).toBe("user_123")
		})
	})
})
