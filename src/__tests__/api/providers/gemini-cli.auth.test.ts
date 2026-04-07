import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as vscode from "vscode"
import axios, { AxiosError } from "axios"
import { OAuth2Client, CodeChallengeMethod } from "google-auth-library"
import { GeminiCliHandler } from "../../../api/providers/gemini-cli"
import { generateCodeVerifier, generateCodeChallenge, generateState } from "../../../auth/pkce"
import * as http from "http"

// Mock dependencies
vi.mock("vscode")
vi.mock("google-auth-library", () => ({
	OAuth2Client: vi.fn().mockImplementation(() => ({
		generateAuthUrl: vi.fn(),
		setCredentials: vi.fn(),
		request: vi.fn(),
	})),
	CodeChallengeMethod: { S256: "S256" },
}))
vi.mock("axios")
vi.mock("../../../auth/pkce")
vi.mock("http", () => ({
	createServer: vi.fn(),
}))

// Mock i18n translation function with exact error formatting
vi.mock("../../../i18n", () => ({
	t: vi.fn().mockImplementation((key: string, params?: Record<string, any>) => {
		if (key.startsWith("common:errors.geminiCli.")) {
			const errorKey = key.replace("common:errors.geminiCli.", "")
			if (params?.error) {
				const errorMsg =
					typeof params.error === "string" ? params.error : params.error.message || String(params.error)
				return `${errorKey} Error: ${errorMsg}`
			}
			return errorKey
		}
		return key
	}),
}))

// Mock the global outputChannel
const mockOutputChannel = {
	appendLine: vi.fn(),
	append: vi.fn(),
	clear: vi.fn(),
	show: vi.fn(),
	hide: vi.fn(),
	dispose: vi.fn(),
}

;(global as any).outputChannel = mockOutputChannel

describe("Gemini CLI Authentication Flow", () => {
	let geminiHandler: GeminiCliHandler
	let mockSecretStorage: any
	let mockWorkspaceConfiguration: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Mock VSCode workspace configuration first
		mockWorkspaceConfiguration = {
			get: vi.fn().mockReturnValue("test-client-id"),
			has: vi.fn().mockReturnValue(true),
			inspect: vi.fn(),
			update: vi.fn(),
		}
		;(vscode.workspace.getConfiguration as any).mockReturnValue(mockWorkspaceConfiguration)

		// Mock VSCode SecretStorage before creating handler
		mockSecretStorage = {
			get: vi.fn().mockResolvedValue(undefined), // Default to no credentials
			store: vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockResolvedValue(undefined),
			onDidChange: vi.fn(),
		}
		;(vscode as any).secretStorage = mockSecretStorage

		// Mock environment
		;(vscode.env.openExternal as any).mockResolvedValue(true)

		// Reset http mock
		vi.mocked(http.createServer).mockReset()

		// Create handler instance after mocks are set
		geminiHandler = new GeminiCliHandler({
			apiModelId: "gemini-1.5-flash",
			modelTemperature: 0.7,
			modelMaxTokens: 8192,
		})
	})

	afterEach(() => {
		vi.resetAllMocks()
	})

	describe("Configuration and Initialization", () => {
		it("should retrieve client ID from VSCode configuration", () => {
			expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("softcodes")
			expect(mockWorkspaceConfiguration.get).toHaveBeenCalledWith("gemini.clientId")
		})

		it("should throw error when client ID is not configured", () => {
			mockWorkspaceConfiguration.get.mockReturnValue(undefined)

			expect(
				() =>
					new GeminiCliHandler({
						apiModelId: "gemini-1.5-flash",
						modelTemperature: 0.7,
						modelMaxTokens: 8192,
					}),
			).toThrow("Gemini client ID not configured. Please set 'softcodes.gemini.clientId' in settings.")
		})

		it("should initialize OAuth2 client with correct parameters", () => {
			expect(OAuth2Client).toHaveBeenCalledWith("test-client-id", undefined, "http://localhost:45289")
		})
	})

	describe("PKCE Code Generation", () => {
		it("should use PKCE functions for authentication flow", async () => {
			const mockVerifier = "test-verifier"
			const mockChallenge = "test-challenge"
			const mockState = "test-state"

			vi.mocked(generateCodeVerifier).mockReturnValue(mockVerifier)
			vi.mocked(generateCodeChallenge).mockResolvedValue(mockChallenge)
			vi.mocked(generateState).mockReturnValue(mockState)

			// Mock axios for exchangeCodeForTokens
			const mockTokenResponse = {
				access_token: "test-access",
				refresh_token: "test-refresh",
				token_type: "Bearer",
				expires_in: 3600,
			}
			vi.mocked(axios.post).mockResolvedValueOnce({ data: mockTokenResponse })

			// Define req/res before server mock
			const mockReq = { url: `/?code=test-code&state=${mockState}` }
			const mockRes = {
				writeHead: vi.fn(),
				end: vi.fn(() => {
					// Simulate response handling
				}),
			}

			// Mock http.createServer with full event handling
			const mockServer = {
				on: vi.fn((event: string, listener: any) => {
					// Simulate event emission for 'request' after listen simulation
					if (event === "request") {
						// Emit request after a delay to simulate listen
						setImmediate(() => {
							if (typeof listener === "function") {
								listener(mockReq, mockRes)
							}
						})
					}
					// For 'error', record but don't emit
				}),
				emit: vi.fn(),
				listen: vi.fn((port: number, host: string, callback?: () => void) => {
					if (callback) callback()
				}),
				close: vi.fn((callback?: () => void) => {
					if (callback) callback()
				}),
			}

			vi.mocked(http.createServer).mockReturnValue(mockServer as any)

			// Mock the authClient properly as function
			const authClientMock = {
				generateAuthUrl: vi.fn().mockReturnValue("https://auth.url"),
				setCredentials: vi.fn(),
				request: vi.fn(),
			}
			;(geminiHandler as any).authClient = authClientMock

			await (geminiHandler as any).authenticate()

			expect(generateCodeVerifier).toHaveBeenCalled()
			expect(generateCodeChallenge).toHaveBeenCalledWith(mockVerifier)
			expect(generateState).toHaveBeenCalled()
			expect(authClientMock.generateAuthUrl).toHaveBeenCalledWith({
				access_type: "offline",
				prompt: "consent",
				scope: [
					"https://www.googleapis.com/auth/cloud-platform",
					"https://www.googleapis.com/auth/codeassist.googleapis.com",
				],
				state: mockState,
				code_challenge: mockChallenge,
				code_challenge_method: CodeChallengeMethod.S256,
			})
			expect(vi.mocked(http.createServer)).toHaveBeenCalled()
		})
	})

	describe("Token Storage and Retrieval", () => {
		it("should load OAuth credentials from SecretStorage", async () => {
			const mockCredentials = {
				access_token: "test-access-token",
				refresh_token: "test-refresh-token",
				token_type: "Bearer",
				expiry_date: Date.now() + 3600000,
			}

			// Set the mock to return credentials for this test
			vi.mocked(mockSecretStorage.get).mockResolvedValueOnce(JSON.stringify(mockCredentials))

			// Call loadOAuthCredentials directly
			const result = await (geminiHandler as any).loadOAuthCredentials()

			expect(vi.mocked(mockSecretStorage.get)).toHaveBeenCalledWith("gemini.oauth")
			expect(result).toEqual(mockCredentials)
		})

		it("should handle missing credentials gracefully", async () => {
			vi.mocked(mockSecretStorage.get).mockResolvedValueOnce(undefined)

			const result = await (geminiHandler as any).loadOAuthCredentials()

			expect(result).toBeNull()
		})

		it("should save OAuth credentials to SecretStorage", async () => {
			const mockCredentials = {
				access_token: "test-access-token",
				refresh_token: "test-refresh-token",
				token_type: "Bearer",
				expiry_date: Date.now() + 3600000,
			}

			await (geminiHandler as any).saveOAuthCredentials(mockCredentials)

			expect(vi.mocked(mockSecretStorage.store)).toHaveBeenCalledWith(
				"gemini.oauth",
				JSON.stringify(mockCredentials),
			)
		})

		it("should handle storage errors when saving credentials", async () => {
			const mockCredentials = {
				access_token: "test-access-token",
				refresh_token: "test-refresh-token",
				token_type: "Bearer",
				expiry_date: Date.now() + 3600000,
			}

			const storageError = new Error("Storage failed")
			vi.mocked(mockSecretStorage.store).mockRejectedValueOnce(storageError)

			await expect((geminiHandler as any).saveOAuthCredentials(mockCredentials)).rejects.toThrow(
				"oauthSaveFailed Error: Storage failed",
			)
		})
	})

	describe("Token Exchange and Refresh", () => {
		it("should exchange authorization code for tokens", async () => {
			const mockCode = "test-auth-code"
			const mockVerifier = "test-verifier"
			const mockTokenResponse = {
				access_token: "new-access-token",
				refresh_token: "new-refresh-token",
				token_type: "Bearer",
				expires_in: 3600,
			}

			vi.mocked(axios.post).mockResolvedValueOnce({ data: mockTokenResponse })

			const result = await (geminiHandler as any).exchangeCodeForTokens(mockCode, mockVerifier)

			expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
				"https://oauth2.googleapis.com/token",
				expect.any(URLSearchParams),
				{
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
				},
			)
			const calledParams = vi.mocked(axios.post).mock.calls[0][1] as URLSearchParams
			expect(calledParams.get("code_verifier")).toBe(mockVerifier)
			expect(calledParams.get("code")).toBe(mockCode)
			expect(result.access_token).toBe("new-access-token")
			expect(result.refresh_token).toBe("new-refresh-token")
		})

		it("should handle token exchange errors", async () => {
			const mockCode = "test-auth-code"
			const mockVerifier = "test-verifier"

			const mockResponse = {
				status: 400,
				statusText: "Bad Request",
				headers: {},
				config: { headers: {} },
				data: { error: "invalid_grant" },
			} as any
			const mockError = new AxiosError("Token exchange failed", "400", undefined, undefined, mockResponse)
			vi.mocked(axios.post).mockRejectedValue(mockError)

			await expect((geminiHandler as any).exchangeCodeForTokens(mockCode, mockVerifier)).rejects.toThrow(
				"tokenExchangeFailed Error: Token exchange failed",
			)
		})

		it("should refresh tokens using refresh token", async () => {
			const mockCredentials = {
				access_token: "old-access-token",
				refresh_token: "test-refresh-token",
				token_type: "Bearer",
				expiry_date: Date.now() - 1000, // Expired
			}

			;(geminiHandler as any).credentials = mockCredentials
			const mockTokenResponse = {
				access_token: "new-access-token",
				token_type: "Bearer",
				expires_in: 3600,
			}

			vi.mocked(axios.post).mockResolvedValue({ data: mockTokenResponse })

			const result = await (geminiHandler as any).refreshTokens()

			expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
				"https://oauth2.googleapis.com/token",
				expect.any(URLSearchParams),
				{
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
				},
			)
			const calledParams = vi.mocked(axios.post).mock.calls[0][1] as URLSearchParams
			expect(calledParams.get("refresh_token")).toBe(mockCredentials.refresh_token)
			expect(result.access_token).toBe("new-access-token")
			expect(result.refresh_token).toBe("test-refresh-token") // Should preserve refresh token
		})

		it("should handle refresh token errors", async () => {
			;(geminiHandler as any).credentials = {
				refresh_token: "test-refresh-token",
			}

			const mockResponse = {
				status: 400,
				statusText: "Bad Request",
				headers: {},
				config: { headers: {} },
				data: { error: "invalid_grant" },
			} as any
			const mockError = new AxiosError("Refresh failed", "400", undefined, undefined, mockResponse)
			vi.mocked(axios.post).mockRejectedValue(mockError)

			await expect((geminiHandler as any).refreshTokens()).rejects.toThrow(
				"tokenRefreshFailed Error: Refresh failed",
			)
		})
	})

	describe("Error Handling Scenarios", () => {
		it("should handle missing refresh token during refresh", async () => {
			;(geminiHandler as any).credentials = null

			await expect((geminiHandler as any).refreshTokens()).rejects.toThrow("No refresh token available")
		})

		it("should handle invalid token response during exchange", async () => {
			vi.mocked(axios.post).mockResolvedValue({
				data: { token_type: "Bearer" }, // Missing access_token and refresh_token
			})

			await expect((geminiHandler as any).exchangeCodeForTokens("code", "verifier")).rejects.toThrow(
				"tokenExchangeFailed Error: Invalid token response",
			)
		})

		it("should handle invalid refresh response", async () => {
			;(geminiHandler as any).credentials = {
				refresh_token: "test-refresh-token",
			}

			vi.mocked(axios.post).mockResolvedValue({
				data: { token_type: "Bearer" }, // Missing access_token
			})

			await expect((geminiHandler as any).refreshTokens()).rejects.toThrow(
				"tokenRefreshFailed Error: Invalid refresh response",
			)
		})
	})

	describe("Authentication Flow Integration", () => {
		it("should ensure authentication loads existing credentials first", async () => {
			const mockCredentials = {
				access_token: "test-access-token",
				refresh_token: "test-refresh-token",
				token_type: "Bearer",
				expiry_date: Date.now() + 3600000, // Not expired
			}

			vi.mocked(mockSecretStorage.get).mockResolvedValueOnce(JSON.stringify(mockCredentials))

			// Mock authClient to avoid calling generateAuthUrl
			;(geminiHandler as any).authClient = {
				generateAuthUrl: vi.fn(),
				setCredentials: vi.fn(),
			}

			await (geminiHandler as any).ensureAuthenticated()

			expect(vi.mocked(mockSecretStorage.get)).toHaveBeenCalledWith("gemini.oauth")
			// Should not call authenticate since credentials are valid
			expect(vscode.env.openExternal).not.toHaveBeenCalled()
		})

		it("should trigger authentication when no credentials exist", async () => {
			vi.mocked(mockSecretStorage.get).mockResolvedValueOnce(undefined)

			// Mock the authenticate method to avoid actual HTTP server creation
			const authenticateMock = vi.fn().mockResolvedValue(undefined)
			;(geminiHandler as any).authenticate = authenticateMock

			await (geminiHandler as any).ensureAuthenticated()

			expect(authenticateMock).toHaveBeenCalled()
		})

		it("should refresh tokens when credentials are expired", async () => {
			const mockCredentials = {
				access_token: "old-access-token",
				refresh_token: "test-refresh-token",
				token_type: "Bearer",
				expiry_date: Date.now() - 1000, // Expired
			}

			vi.mocked(mockSecretStorage.get).mockResolvedValueOnce(JSON.stringify(mockCredentials))
			;(geminiHandler as any).refreshTokens = vi.fn().mockResolvedValue(mockCredentials)

			// Mock authClient to avoid calling generateAuthUrl
			;(geminiHandler as any).authClient = {
				generateAuthUrl: vi.fn(),
				setCredentials: vi.fn(),
			}

			await (geminiHandler as any).ensureAuthenticated()

			expect((geminiHandler as any).refreshTokens).toHaveBeenCalled()
		})

		it("should re-authenticate when refresh fails", async () => {
			const mockCredentials = {
				access_token: "old-access-token",
				refresh_token: "test-refresh-token",
				token_type: "Bearer",
				expiry_date: Date.now() - 1000, // Expired
			}

			vi.mocked(mockSecretStorage.get).mockResolvedValueOnce(JSON.stringify(mockCredentials))
			;(geminiHandler as any).refreshTokens = vi.fn().mockRejectedValue(new Error("Refresh failed"))

			const authenticateMock = vi.fn().mockResolvedValue(undefined)
			;(geminiHandler as any).authenticate = authenticateMock

			await (geminiHandler as any).ensureAuthenticated()

			expect((geminiHandler as any).refreshTokens).toHaveBeenCalled()
			expect(authenticateMock).toHaveBeenCalled()
		})
	})

	describe("Security and Best Practices", () => {
		it("should not contain hardcoded credentials", () => {
			const sourceCode = require("fs").readFileSync(
				require("path").join(__dirname, "../../../api/providers/gemini-cli.ts"),
				"utf8",
			)

			// Check for common hardcoded credential patterns
			expect(sourceCode).not.toMatch(/client_id\s*=\s*['"][^'"]*['"]/)
			expect(sourceCode).not.toMatch(/client_secret\s*=\s*['"][^'"]*['"]/)
			expect(sourceCode).not.toMatch(/access_token\s*=\s*['"][^'"]*['"]/)
			expect(sourceCode).not.toMatch(/refresh_token\s*=\s*['"][^'"]*['"]/)
		})

		it("should always retrieve client ID from configuration", () => {
			// The constructor should call vscode.workspace.getConfiguration
			expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("softcodes")
			expect(mockWorkspaceConfiguration.get).toHaveBeenCalledWith("gemini.clientId")
		})

		it("should use secure token storage via VSCode SecretStorage", () => {
			// Verify that secretStorage is used for credential storage
			expect((geminiHandler as any).loadOAuthCredentials).toBeDefined()
			expect((geminiHandler as any).saveOAuthCredentials).toBeDefined()
		})
	})
})
