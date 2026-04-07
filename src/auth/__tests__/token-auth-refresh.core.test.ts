import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import * as vscode from "vscode"
import { UnifiedAuthService } from "../unifiedAuthService"
import { TOKEN_KEYS, JWT_CONFIG } from "../config"

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
	}

	const globalState = {
		update: vi.fn(async (key: string, value: unknown) => {
			globalStateMap.set(key, value)
		}),
		get: vi.fn((key: string) => globalStateMap.get(key)),
	}

	const workspace = {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue(true), // Enable development mode for testing
		}),
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
	}
})

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Test utilities
function createMockJWT(expOffsetSeconds: number): string {
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
	}

	const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url")
	const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url")
	const signature = "mock_signature"

	return `${headerB64}.${payloadB64}.${signature}`
}

function createMockContext(): vscode.ExtensionContext {
	const secretsMap = new Map<string, string | undefined>()
	const globalStateMap = new Map<string, any>()

	return {
		secrets: {
			get: vi.fn(async (key: string) => secretsMap.get(key)),
			store: vi.fn(async (key: string, value: string) => {
				secretsMap.set(key, value)
			}),
			delete: vi.fn(async (key: string) => {
				secretsMap.delete(key)
			}),
		},
		globalState: {
			update: vi.fn(async (key: string, value: unknown) => {
				globalStateMap.set(key, value)
			}),
			get: vi.fn((key: string) => globalStateMap.get(key)),
		},
		subscriptions: [],
	} as unknown as vscode.ExtensionContext
}

describe("Token Authentication and Refresh Core Tests", () => {
	let service: UnifiedAuthService
	let context: vscode.ExtensionContext

	beforeEach(() => {
		vi.clearAllMocks()
		mockFetch.mockReset()

		context = createMockContext()
		;(UnifiedAuthService as any).instance = undefined
		service = UnifiedAuthService.getInstance(context)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("Token Storage and Retrieval", () => {
		it("should store and retrieve access tokens securely", async () => {
			const testToken = "test.jwt.token"

			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, testToken)
			const retrievedToken = await context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)

			expect(retrievedToken).toBe(testToken)
		})

		it("should store and retrieve refresh tokens securely", async () => {
			const refreshToken = "refresh.jwt.token"

			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, refreshToken)
			const retrievedToken = await context.secrets.get(TOKEN_KEYS.REFRESH_TOKEN)

			expect(retrievedToken).toBe(refreshToken)
		})

		it("should store complete token set", async () => {
			const tokens = {
				access_token: createMockJWT(3600),
				refresh_token: "refresh_token_123",
				session_id: "session_123",
				organization_id: "org_123",
			}

			await service.storeTokens(tokens)

			expect(await context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)).toBe(tokens.access_token)
			expect(await context.secrets.get(TOKEN_KEYS.REFRESH_TOKEN)).toBe(tokens.refresh_token)
			expect(await context.secrets.get(TOKEN_KEYS.SESSION_ID)).toBe(tokens.session_id)
			expect(await context.secrets.get(TOKEN_KEYS.ORGANIZATION_ID)).toBe(tokens.organization_id)
		})
	})

	describe("Token Expiration Detection", () => {
		it("should detect expired tokens", async () => {
			const expiredToken = createMockJWT(-60) // Expired 1 minute ago
			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)

			const token = await service.getAccessToken()

			expect(token).toBeUndefined()
		})

		it("should return valid tokens", async () => {
			const validToken = createMockJWT(3600) // Valid for 1 hour
			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, validToken)

			const token = await service.getAccessToken()

			expect(token).toBe(validToken)
		})

		it("should return existing token when not near expiration", async () => {
			const validToken = createMockJWT(3600) // Expires in 1 hour (well above 5-min threshold)
			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, validToken)

			const token = await service.ensureValidAccessToken()

			// Should return existing token without refresh
			expect(token).toBe(validToken)
			expect(mockFetch).not.toHaveBeenCalled()
		})
	})

	describe("Token Refresh Mechanism", () => {
		it("should refresh expired tokens when refresh token is available", async () => {
			const expiredToken = createMockJWT(-60)
			const refreshToken = "valid_refresh_token"
			const newAccessToken = createMockJWT(3600)

			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, refreshToken)

			// Mock HEAD check for refresh endpoint availability
			mockFetch.mockResolvedValueOnce({ ok: true })

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
			expect(await context.secrets.get(TOKEN_KEYS.REFRESH_TOKEN)).toBe("new_refresh_token")
		})

		it("should handle refresh API failures gracefully", async () => {
			const expiredToken = createMockJWT(-60)
			const refreshToken = "valid_refresh_token"

			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, refreshToken)

			// Mock API failure
			mockFetch.mockRejectedValueOnce(new Error("Network error"))

			const result = await service.ensureValidAccessToken()

			// Should return undefined when refresh fails
			expect(result).toBeUndefined()
		})

		it("should use fallback token extension in development mode", async () => {
			const expiredToken = createMockJWT(-60)
			const refreshToken = "valid_refresh_token"

			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, refreshToken)

			// Mock HEAD check failing (endpoint not available)
			mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

			const result = await service.ensureValidAccessToken()

			// In development mode with auth.skipAPIValidation=true,
			// fallback extends token lifetime within 30-minute grace period
			expect(result).toBe(expiredToken)
		})

		it("should respect JWT_CONFIG.TOKEN_REFRESH_THRESHOLD for proactive refresh", async () => {
			const threshold = JWT_CONFIG.TOKEN_REFRESH_THRESHOLD || 300
			// Create token that expires within threshold (triggers proactive refresh)
			const tokenExpiringSoon = createMockJWT(Math.floor(threshold / 2))
			const refreshToken = "valid_refresh_token"
			const newAccessToken = createMockJWT(3600)

			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, tokenExpiringSoon)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, refreshToken)

			// Mock HEAD check for refresh endpoint
			mockFetch.mockResolvedValueOnce({ ok: true })

			// Mock successful POST refresh
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					access_token: newAccessToken,
					refresh_token: "new_refresh_token",
				}),
			})

			const result = await service.ensureValidAccessToken()

			// Should have triggered proactive refresh
			expect(result).toBe(newAccessToken)
			expect(mockFetch).toHaveBeenCalled()
		})
	})

	describe("Race Condition Prevention", () => {
		it("should prevent concurrent refresh attempts", async () => {
			const expiredToken = createMockJWT(-60)
			const refreshToken = "valid_refresh_token"
			const newAccessToken = createMockJWT(3600)

			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, refreshToken)

			let headCallCount = 0
			let postCallCount = 0

			// Mock fetch to track HEAD vs POST calls
			mockFetch.mockImplementation((url: any, options: any) => {
				const urlString = url.toString()
				const method = options?.method || "GET"

				if (method === "HEAD") {
					headCallCount++
					return Promise.resolve({ ok: true })
				} else if (method === "POST" && urlString.includes("refresh")) {
					postCallCount++
					// Slow response to test concurrent behavior
					return new Promise((resolve) =>
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
					)
				}
				return Promise.resolve({ ok: false })
			})

			// Start multiple concurrent refresh attempts
			const promises = [
				service.ensureValidAccessToken(),
				service.ensureValidAccessToken(),
				service.ensureValidAccessToken(),
			]

			const results = await Promise.all(promises)

			// All should return the same refreshed token (locking works)
			expect(results[0]).toBe(newAccessToken)
			expect(results[1]).toBe(newAccessToken)
			expect(results[2]).toBe(newAccessToken)

			// Verify locking: only ONE POST refresh despite 3 concurrent attempts
			expect(postCallCount).toBe(1)
			// HEAD checks may happen once
			expect(headCallCount).toBeGreaterThanOrEqual(1)
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
			expect(authState.isConnected).toBe(false) // No Supabase verification
		})

		it("should handle sign out correctly", async () => {
			// Set up authenticated state
			const validToken = createMockJWT(3600)
			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, validToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, "refresh_token")
			await context.secrets.store(TOKEN_KEYS.SESSION_ID, "session_123")

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

	describe("Error Handling", () => {
		it("should handle malformed JWT tokens", async () => {
			const malformedToken = "not.a.valid.jwt"
			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, malformedToken)

			const token = await service.getAccessToken()

			// NOTE: getAccessToken() returns tokens even if malformed
			// This is intentional to prevent false negatives
			// Token validation happens during ensureValidAccessToken()
			expect(token).toBe(malformedToken)
		})

		it("should handle network failures during token operations", async () => {
			const expiredToken = createMockJWT(-60)
			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, "refresh_token")

			// Mock network failure
			mockFetch.mockRejectedValueOnce(new Error("Network error"))

			const result = await service.ensureValidAccessToken()

			expect(result).toBeUndefined()
		})

		it("should handle API timeout gracefully", async () => {
			const expiredToken = createMockJWT(-60)
			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, "refresh_token")

			// Mock timeout
			mockFetch.mockImplementationOnce(
				() => new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 31000)),
			)

			const result = await service.ensureValidAccessToken()

			expect(result).toBeUndefined()
		})
	})

	describe("Token Lifecycle Management", () => {
		it("should detect expired tokens but not delete them in getAccessToken", async () => {
			const expiredToken = createMockJWT(-120) // Expired 2 minutes ago
			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)

			// getAccessToken returns undefined for expired tokens but doesn't delete them
			const token = await service.getAccessToken()

			expect(token).toBeUndefined()
			// Token is still in storage - deletion happens in clearExpiredTokens()
			expect(await context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)).toBe(expiredToken)
		})

		it("should maintain token validity throughout lifecycle", async () => {
			const validToken = createMockJWT(3600)
			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, validToken)

			// Token should remain valid
			let token = await service.getAccessToken()
			expect(token).toBe(validToken)

			// Should still be valid when checked again
			token = await service.ensureValidAccessToken()
			expect(token).toBe(validToken)
		})

		it("should handle token refresh rotation correctly", async () => {
			const expiredToken = createMockJWT(-60)
			const oldRefreshToken = "old_refresh_token"
			const newAccessToken = createMockJWT(3600)
			const newRefreshToken = "new_refresh_token"

			await context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, expiredToken)
			await context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, oldRefreshToken)

			// Mock HEAD check for refresh endpoint
			mockFetch.mockResolvedValueOnce({ ok: true })

			// Mock POST refresh with token rotation
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					access_token: newAccessToken,
					refresh_token: newRefreshToken,
				}),
			})

			const result = await service.ensureValidAccessToken()

			// Verify refresh was successful
			expect(result).toBe(newAccessToken)

			// Verify new tokens are stored
			expect(await context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN)).toBe(newAccessToken)
			expect(await context.secrets.get(TOKEN_KEYS.REFRESH_TOKEN)).toBe(newRefreshToken)
		})
	})
})
