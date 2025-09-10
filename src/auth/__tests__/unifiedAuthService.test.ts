import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { UnifiedAuthService, AuthTokens, UserInfo } from "../unifiedAuthService"
import * as pkce from "../pkce"
import { AUTH_ENDPOINTS, OAUTH_CONFIG, TOKEN_KEYS, AUTH_ERRORS, AUTH_SUCCESS } from "../config"

// Mock JWT verification service
vi.mock("../jwtVerification", () => ({
	JWTVerificationService: {
		getInstance: vi.fn(() => ({
			verifyJWT: vi.fn().mockResolvedValue({
				valid: false,
				error: { type: "INVALID_SIGNATURE", message: "JWT verification failed" },
			}),
			isTokenNearExpiration: vi.fn().mockReturnValue(false),
		})),
	},
}))

// Mock navigator for browser-specific error handling
Object.defineProperty(global, "navigator", {
	value: {
		userAgent: "test-user-agent",
		onLine: true,
		connection: {
			effectiveType: "4g",
			downlink: 10,
			rtt: 50,
		},
	},
	writable: true,
})

// Mock vscode module
vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showInputBox: vi.fn(),
		showWarningMessage: vi.fn(),
	},
	commands: {
		executeCommand: vi.fn(),
	},
	env: {
		openExternal: vi.fn(),
		uriScheme: "vscode-softcodes",
	},
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn((key) => {
				if (key === "backendUrl") return "https://softcodes.ai"
				return undefined
			}),
		})),
	},
	Uri: {
		parse: vi.fn((url) => ({ toString: () => url })),
	},
	extensions: {
		getExtension: vi.fn(() => ({
			packageJSON: { version: "1.0.0" },
		})),
	},
}))

// Mock fetch
global.fetch = vi.fn()

// Mock PKCE functions
vi.mock("../pkce", () => ({
	generateCodeVerifier: vi.fn(),
	generateCodeChallenge: vi.fn(),
	generateState: vi.fn(),
}))

describe("UnifiedAuthService", () => {
	let authService: UnifiedAuthService
	let mockContext: any

	beforeEach(() => {
		// Reset singleton instance
		;(UnifiedAuthService as any).instance = undefined

		// Setup mock context
		mockContext = {
			secrets: {
				get: vi.fn(),
				store: vi.fn(),
				delete: vi.fn(),
			},
		}

		// Create service instance
		authService = UnifiedAuthService.getInstance(mockContext)

		// Reset all mocks
		vi.clearAllMocks()

		// Setup default PKCE mock returns
		vi.mocked(pkce.generateCodeVerifier).mockReturnValue("test-verifier")
		vi.mocked(pkce.generateCodeChallenge).mockResolvedValue("test-challenge")
		vi.mocked(pkce.generateState).mockReturnValue("test-state")
	})

	afterEach(() => {
		vi.restoreAllMocks()
		// Reset singleton instance
		;(UnifiedAuthService as any).instance = undefined
	})

	describe("getInstance", () => {
		it("should return singleton instance", () => {
			// Reset singleton for this test
			;(UnifiedAuthService as any).instance = undefined

			const instance1 = UnifiedAuthService.getInstance(mockContext)
			const instance2 = UnifiedAuthService.getInstance(mockContext)

			expect(instance1).toBe(instance2)
		})
	})

	describe("authenticate", () => {
		it("should initiate unified OAuth flow with PKCE parameters", async () => {
			const mockAuthUrl = "https://clerk.softcodes.ai/auth?code=123"

			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ auth_url: mockAuthUrl }),
			} as any)

			await authService.authenticate()

			// Should generate PKCE parameters
			expect(pkce.generateCodeVerifier).toHaveBeenCalled()
			expect(pkce.generateCodeChallenge).toHaveBeenCalledWith("test-verifier")
			expect(pkce.generateState).toHaveBeenCalled()

			// Should store verifier with correct key format
			expect(mockContext.secrets.store).toHaveBeenCalledWith(
				`${TOKEN_KEYS.PKCE_PREFIX}test-state`,
				"test-verifier",
			)

			// Should call unified backend API
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining(AUTH_ENDPOINTS.INITIATE_VSCODE_AUTH),
				expect.objectContaining({
					method: "GET",
					headers: expect.objectContaining({
						"Content-Type": "application/json",
						"User-Agent": expect.stringContaining("VSCode-Softcodes"),
					}),
				}),
			)

			// Should open browser
			expect(vscode.env.openExternal).toHaveBeenCalled()

			// Should show info message
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				"Please complete authentication in your browser",
			)
		})

		it("should handle authentication initiation failure", async () => {
			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: false,
				json: vi.fn().mockResolvedValue({ error: "Service unavailable" }),
			} as any)

			await authService.authenticate()

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("Service unavailable"))
		})

		it("should handle network errors", async () => {
			vi.mocked(global.fetch).mockRejectedValueOnce(new Error("Network error"))

			await authService.authenticate()

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("Network error"))
		})
	})

	describe("handleCallback", () => {
		it("should exchange code for tokens using unified endpoint", async () => {
			const mockUri = {
				query: "code=auth-code-123&state=test-state",
			}

			// Mock stored verifier
			mockContext.secrets.get.mockResolvedValueOnce("test-verifier")

			// Mock token exchange response with unified format
			const mockTokens: AuthTokens = {
				access_token: "access-token-123",
				refresh_token: "refresh-token-456",
				session_id: "session-789",
				organization_id: "org-123",
			}

			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue(mockTokens),
			} as any)

			await authService.handleCallback(mockUri as any)

			// Should retrieve stored verifier with correct key
			expect(mockContext.secrets.get).toHaveBeenCalledWith(`${TOKEN_KEYS.PKCE_PREFIX}test-state`)

			// Should call unified callback endpoint
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining(AUTH_ENDPOINTS.EXTENSION_CALLBACK),
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"Content-Type": "application/json",
						"User-Agent": expect.stringContaining("VSCode-Softcodes"),
					}),
					body: JSON.stringify({
						code: "auth-code-123",
						code_verifier: "test-verifier",
						state: "test-state",
						redirect_uri: OAUTH_CONFIG.VSCODE.REDIRECT_URI,
						grant_type: OAUTH_CONFIG.VSCODE.GRANT_TYPE,
					}),
				}),
			)

			// Should store all tokens with correct keys
			expect(mockContext.secrets.store).toHaveBeenCalledWith(TOKEN_KEYS.ACCESS_TOKEN, "access-token-123")
			expect(mockContext.secrets.store).toHaveBeenCalledWith(TOKEN_KEYS.REFRESH_TOKEN, "refresh-token-456")
			expect(mockContext.secrets.store).toHaveBeenCalledWith(TOKEN_KEYS.SESSION_ID, "session-789")
			expect(mockContext.secrets.store).toHaveBeenCalledWith(TOKEN_KEYS.ORGANIZATION_ID, "org-123")

			// Should clean up PKCE data with correct key
			expect(mockContext.secrets.delete).toHaveBeenCalledWith(`${TOKEN_KEYS.PKCE_PREFIX}test-state`)

			// Should show success message
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(AUTH_SUCCESS.AUTHENTICATED)

			// Should trigger post-auth command
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith("softcodes.onAuthenticated")
		})

		it("should handle missing authentication parameters", async () => {
			const mockUri = {
				query: "state=test-state", // Missing code
			}

			await authService.handleCallback(mockUri as any)

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining(AUTH_ERRORS.MISSING_PARAMS),
			)
		})

		it("should handle invalid authentication state", async () => {
			const mockUri = {
				query: "code=auth-code-123&state=test-state",
			}

			// No stored verifier
			mockContext.secrets.get.mockResolvedValueOnce(undefined)

			await authService.handleCallback(mockUri as any)

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining(AUTH_ERRORS.INVALID_STATE),
			)
		})

		it("should handle token exchange failure", async () => {
			const mockUri = {
				query: "code=auth-code-123&state=test-state",
			}

			// Setup verifier retrieval
			mockContext.secrets.get.mockResolvedValueOnce("test-verifier")

			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: false,
				json: vi.fn().mockResolvedValue({ error: "Invalid authorization code" }),
			} as any)

			await authService.handleCallback(mockUri as any)

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("Invalid authorization code"),
			)
		})
	})

	describe("getAccessToken", () => {
		it("should return stored access token", async () => {
			mockContext.secrets.get.mockImplementation((key: string) => {
				if (key === TOKEN_KEYS.ACCESS_TOKEN) return Promise.resolve("stored-access-token")
				return Promise.resolve(undefined)
			})

			const token = await authService.getAccessToken()

			expect(token).toBe("stored-access-token")
			expect(mockContext.secrets.get).toHaveBeenCalledWith(TOKEN_KEYS.ACCESS_TOKEN)
		})

		it("should refresh token if access token is missing", async () => {
			let callCount = 0
			mockContext.secrets.get.mockImplementation((key: string) => {
				callCount++
				if (key === TOKEN_KEYS.ACCESS_TOKEN && callCount === 1) return Promise.resolve(undefined)
				if (key === TOKEN_KEYS.REFRESH_TOKEN) return Promise.resolve("refresh-token-123")
				return Promise.resolve(undefined)
			})

			// Mock refresh response with unified format
			const mockRefreshTokens: AuthTokens = {
				access_token: "new-access-token",
				refresh_token: "new-refresh-token",
				session_id: "new-session",
			}

			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue(mockRefreshTokens),
			} as any)

			const token = await authService.getAccessToken()

			expect(token).toBe("new-access-token")

			// Should have stored new tokens
			expect(mockContext.secrets.store).toHaveBeenCalledWith(TOKEN_KEYS.ACCESS_TOKEN, "new-access-token")
			expect(mockContext.secrets.store).toHaveBeenCalledWith(TOKEN_KEYS.REFRESH_TOKEN, "new-refresh-token")
			expect(mockContext.secrets.store).toHaveBeenCalledWith(TOKEN_KEYS.SESSION_ID, "new-session")
		})
	})

	describe("getUserInfo", () => {
		it("should fetch user info with valid tokens", async () => {
			const mockUserInfo: UserInfo = {
				email: "test@example.com",
				firstName: "John",
				lastName: "Doe",
				organizationName: "Test Org",
			}

			mockContext.secrets.get.mockImplementation((key: string) => {
				if (key === TOKEN_KEYS.ACCESS_TOKEN) return Promise.resolve("valid-token")
				if (key === TOKEN_KEYS.SESSION_ID) return Promise.resolve("session-123")
				return Promise.resolve(undefined)
			})

			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue(mockUserInfo),
			} as any)

			const userInfo = await authService.getUserInfo()

			expect(userInfo).toEqual(mockUserInfo)
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining(AUTH_ENDPOINTS.USER_INFO),
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer valid-token",
					}),
				}),
			)
		})

		it("should return undefined when not authenticated", async () => {
			mockContext.secrets.get.mockImplementation(() => Promise.resolve(undefined))

			const userInfo = await authService.getUserInfo()

			expect(userInfo).toBeUndefined()
		})
	})

	describe("validateSession", () => {
		it("should validate session successfully", async () => {
			mockContext.secrets.get.mockImplementation((key: string) => {
				if (key === TOKEN_KEYS.ACCESS_TOKEN) return Promise.resolve("valid-token")
				if (key === TOKEN_KEYS.SESSION_ID) return Promise.resolve("session-123")
				return Promise.resolve(undefined)
			})

			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: true,
			} as any)

			const isValid = await authService.validateSession()

			expect(isValid).toBe(true)
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining(AUTH_ENDPOINTS.VALIDATE_SESSION),
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({
						session_id: "session-123",
						client_type: "vscode",
					}),
				}),
			)
		})

		it("should return false for invalid session", async () => {
			mockContext.secrets.get.mockImplementation((key: string) => {
				if (key === TOKEN_KEYS.ACCESS_TOKEN) return Promise.resolve("invalid-token")
				if (key === TOKEN_KEYS.SESSION_ID) return Promise.resolve("session-123")
				return Promise.resolve(undefined)
			})

			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: false,
			} as any)

			const isValid = await authService.validateSession()

			expect(isValid).toBe(false)
		})
	})

	describe("signOut", () => {
		it("should clear all stored tokens", async () => {
			await authService.signOut()

			expect(mockContext.secrets.delete).toHaveBeenCalledWith(TOKEN_KEYS.ACCESS_TOKEN)
			expect(mockContext.secrets.delete).toHaveBeenCalledWith(TOKEN_KEYS.REFRESH_TOKEN)
			expect(mockContext.secrets.delete).toHaveBeenCalledWith(TOKEN_KEYS.SESSION_ID)
			expect(mockContext.secrets.delete).toHaveBeenCalledWith(TOKEN_KEYS.ORGANIZATION_ID)

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(AUTH_SUCCESS.SIGNED_OUT)
		})

		it("should handle sign out errors gracefully", async () => {
			mockContext.secrets.delete.mockRejectedValueOnce(new Error("Storage error"))

			await authService.signOut()

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("Sign out failed"))
		})
	})

	describe("getOrganizationId", () => {
		it("should return stored organization ID", async () => {
			mockContext.secrets.get.mockImplementation((key: string) => {
				if (key === TOKEN_KEYS.ORGANIZATION_ID) return Promise.resolve("org-123")
				return Promise.resolve(undefined)
			})

			const orgId = await authService.getOrganizationId()

			expect(orgId).toBe("org-123")
			expect(mockContext.secrets.get).toHaveBeenCalledWith(TOKEN_KEYS.ORGANIZATION_ID)
		})
	})

	describe("getSessionId", () => {
		it("should return stored session ID", async () => {
			mockContext.secrets.get.mockImplementation((key: string) => {
				if (key === TOKEN_KEYS.SESSION_ID) return Promise.resolve("session-123")
				return Promise.resolve(undefined)
			})

			const sessionId = await authService.getSessionId()

			expect(sessionId).toBe("session-123")
			expect(mockContext.secrets.get).toHaveBeenCalledWith(TOKEN_KEYS.SESSION_ID)
		})
	})

	describe("isAuthenticated", () => {
		it("should return true when token exists", async () => {
			mockContext.secrets.get.mockImplementation((key: string) => {
				if (key === TOKEN_KEYS.ACCESS_TOKEN) return Promise.resolve("valid-token")
				return Promise.resolve(undefined)
			})

			const isAuth = await authService.isAuthenticated()

			expect(isAuth).toBe(true)
		})

		it("should return false when no token exists", async () => {
			mockContext.secrets.get.mockImplementation(() => Promise.resolve(undefined))

			const isAuth = await authService.isAuthenticated()

			expect(isAuth).toBe(false)
		})

		it("should return true when access token can be refreshed", async () => {
			let callCount = 0
			mockContext.secrets.get.mockImplementation((key: string) => {
				callCount++
				if (key === TOKEN_KEYS.ACCESS_TOKEN && callCount === 1) return Promise.resolve(undefined)
				if (key === TOKEN_KEYS.REFRESH_TOKEN) return Promise.resolve("refresh-token")
				return Promise.resolve(undefined)
			})

			// Mock successful refresh
			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({
					access_token: "refreshed-token",
					refresh_token: "new-refresh-token",
				}),
			} as any)

			const isAuth = await authService.isAuthenticated()

			expect(isAuth).toBe(true)
		})
	})

	describe("signinWithToken", () => {
		beforeEach(() => {
			vi.mocked(vscode.window.showInputBox).mockClear()
			vi.mocked(global.fetch).mockClear()
			vi.mocked(vscode.window.showErrorMessage).mockClear()
			vi.mocked(vscode.window.showInformationMessage).mockClear()
			vi.mocked(vscode.window.showWarningMessage).mockClear()
		})

		it("should successfully authenticate with valid token via API fallback", async () => {
			const testToken =
				"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWV9.TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ" // Valid JWT format

			// Mock user input
			vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(testToken)

			// Mock successful API validation (JWT verification fails, API succeeds)
			vi.mocked(global.fetch)
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({ valid: true }),
				} as any)
				// Mock user info response
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({
						email: "test@example.com",
						session_id: "session-456",
						organization_id: "org-789",
					}),
				} as any)

			await authService.signinWithToken()

			// Should validate token with backend API
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining(AUTH_ENDPOINTS.VALIDATE_SESSION),
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						Authorization: `Bearer ${testToken}`,
						"Content-Type": "application/json",
					}),
					body: JSON.stringify({
						client_type: "vscode",
					}),
				}),
			)

			// Should store the token
			expect(mockContext.secrets.store).toHaveBeenCalledWith(TOKEN_KEYS.ACCESS_TOKEN, testToken)

			// Should show success message
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(AUTH_SUCCESS.AUTHENTICATED)

			// Should trigger post-auth command
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith("softcodes.onAuthenticated")
		})

		it("should handle 404 backend error with helpful message", async () => {
			const testToken =
				"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWV9.TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ"

			// Mock user input
			vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(testToken)

			// Mock 404 response (backend not implemented)
			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: false,
				status: 404,
				json: vi.fn().mockResolvedValue({ error: "Not Found" }),
			} as any)

			// Mock user choosing to contact support
			vi.mocked(vscode.window.showErrorMessage).mockResolvedValueOnce("Contact Support" as any)

			await authService.signinWithToken()

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("Authentication service is not fully implemented yet"),
				"Contact Support",
				"Try Again Later",
				"Use Development Mode",
			)

			// Should not store invalid token
			expect(mockContext.secrets.store).not.toHaveBeenCalled()
		})

		it("should handle user cancellation", async () => {
			// Mock user cancelling input
			vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(undefined)

			await authService.signinWithToken()

			// Should not make any API calls
			expect(global.fetch).not.toHaveBeenCalled()

			// Should not show any messages
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
		})

		it("should validate input and show error for empty token", async () => {
			// Mock showInputBox to test validation
			const mockShowInputBox = vi.mocked(vscode.window.showInputBox)

			// Get the validation function from the call
			mockShowInputBox.mockImplementationOnce(async (options) => {
				// Test the validation function
				const validateInput = options?.validateInput
				if (validateInput) {
					expect(validateInput("")).toBe("Token cannot be empty")
					expect(validateInput("   ")).toBe("Token cannot be empty")
					expect(validateInput("short")).toBe("Token appears to be too short")
					expect(validateInput("a.b.c")).toBe("Token must be a valid JWT format (xxx.yyy.zzz)")
					expect(
						validateInput(
							"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWV9.TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ",
						),
					).toBeNull()
				}
				return undefined // User cancelled
			})

			await authService.signinWithToken()

			expect(mockShowInputBox).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: "Enter your Softcodes authentication token (JWT)",
					password: true,
					placeHolder: "Paste your JWT token here...",
					ignoreFocusOut: true,
					validateInput: expect.any(Function),
				}),
			)
		})

		it("should handle network errors during validation", async () => {
			const testToken =
				"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWV9.TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ"

			// Mock user input
			vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(testToken)

			// Mock network error
			vi.mocked(global.fetch).mockRejectedValueOnce(new Error("Failed to fetch"))

			// Mock user choosing to try again
			vi.mocked(vscode.window.showErrorMessage).mockResolvedValueOnce("Try Again" as any)

			await authService.signinWithToken()

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("Unable to connect to authentication service"),
				"Try Again",
				"Contact Support",
			)
		})

		it("should store additional user info when available", async () => {
			const testToken =
				"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWV9.TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ"

			// Mock user input
			vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(testToken)

			// Mock successful validation and user info
			vi.mocked(global.fetch)
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({ valid: true }),
				} as any)
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({
						email: "test@example.com",
						session_id: "session-456",
						organization_id: "org-789",
					}),
				} as any)

			await authService.signinWithToken()

			// Should store all available info
			expect(mockContext.secrets.store).toHaveBeenCalledWith(TOKEN_KEYS.ACCESS_TOKEN, testToken)
			expect(mockContext.secrets.store).toHaveBeenCalledWith(TOKEN_KEYS.SESSION_ID, "session-456")
			expect(mockContext.secrets.store).toHaveBeenCalledWith(TOKEN_KEYS.ORGANIZATION_ID, "org-789")
		})

		it("should handle development mode when API validation is skipped", async () => {
			const testToken =
				"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWV9.TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ"

			// Mock configuration to skip API validation
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValueOnce({
				get: vi.fn((key) => {
					if (key === "auth.skipAPIValidation") return true
					if (key === "backendUrl") return "https://softcodes.ai"
					return undefined
				}),
			} as any)

			// Mock user input
			vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(testToken)

			// Mock user choosing to use token in development mode
			vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce("Yes, Use Token" as any)

			await authService.signinWithToken()

			// Should store token in fallback mode
			expect(mockContext.secrets.store).toHaveBeenCalledWith(TOKEN_KEYS.ACCESS_TOKEN, testToken)
			expect(mockContext.secrets.store).toHaveBeenCalledWith(TOKEN_KEYS.SESSION_ID, "fallback-session")

			// Should show development mode warning
			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
				expect.stringContaining("Token stored in development mode"),
				"Understood",
			)
		})
	})
})
