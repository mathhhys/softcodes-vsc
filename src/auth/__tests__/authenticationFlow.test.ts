import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { UnifiedAuthService } from "../unifiedAuthService"

// Mock vscode
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
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
			update: vi.fn(),
		})),
	},
	ConfigurationTarget: { Global: 1 },
	Uri: { parse: vi.fn() },
	env: { openExternal: vi.fn() },
	extensions: {
		getExtension: vi.fn(() => ({ packageJSON: { version: "1.0.0" } })),
	},
}))

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

// Mock fetch globally
global.fetch = vi.fn()

describe("End-to-End Authentication Flow", () => {
	let authService: UnifiedAuthService
	let mockContext: any

	beforeEach(() => {
		// Reset singleton
		;(UnifiedAuthService as any).instance = undefined

		mockContext = {
			secrets: {
				get: vi.fn(),
				store: vi.fn(),
				delete: vi.fn(),
			},
		}

		authService = UnifiedAuthService.getInstance(mockContext)
		vi.clearAllMocks()
	})

	it("should successfully authenticate with backend unavailable (user chooses Use Token Now)", async () => {
		const testToken =
			"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiZmlyc3RfbmFtZSI6IkpvaG4iLCJsYXN0X25hbWUiOiJEb2UiLCJzZXNzaW9uX2lkIjoic2Vzc2lvbi0xMjMiLCJvcmdfaWQiOiJvcmctNDU2In0.Uf8xKNlHyG7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ"

		// Mock user input
		vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(testToken)

		// Mock 404 backend response (service not available)
		vi.mocked(global.fetch).mockResolvedValueOnce({
			ok: false,
			status: 404,
			statusText: "Not Found",
			json: vi.fn().mockResolvedValue({ error: "Not Found" }),
		} as any)

		// Mock user choosing to use token anyway
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce({
			title: "✅ Use Token Now",
		} as any)

		await authService.signinWithToken()

		// Should store the token
		expect(mockContext.secrets.store).toHaveBeenCalledWith("access_token", testToken)
		expect(mockContext.secrets.store).toHaveBeenCalledWith("session_id", "session-123")
		expect(mockContext.secrets.store).toHaveBeenCalledWith("organization_id", "org-456")

		// Should show success message with user's name
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			expect.stringContaining("Welcome, John!"),
			"Understood",
		)

		// Should trigger post-auth command
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith("softcodes.onAuthenticated")
	})

	it("should enable offline mode when user chooses Enable Offline Mode", async () => {
		const testToken =
			"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiZmlyc3RfbmFtZSI6IkpvaG4ifQ.TestSignature"

		// Mock user input
		vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(testToken)

		// Mock backend unavailable
		vi.mocked(global.fetch).mockRejectedValueOnce(new Error("Failed to fetch"))

		// Mock user choosing offline mode
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce({
			title: "⚙️ Enable Offline Mode",
		} as any)

		const mockConfig = {
			get: vi.fn(),
			update: vi.fn(),
		}
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)

		await authService.signinWithToken()

		// Should enable development mode
		expect(mockConfig.update).toHaveBeenCalledWith("auth.skipAPIValidation", true, 1)

		// Should store token
		expect(mockContext.secrets.store).toHaveBeenCalledWith("access_token", testToken)

		// Should show offline mode enabled message
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			expect.stringContaining("Offline Mode Enabled"),
			"Got It",
		)
	})

	it("should skip API validation when in development mode", async () => {
		const testToken =
			"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIn0.TestSignature"

		// Mock user input
		vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(testToken)

		// Mock development mode enabled
		const mockConfig = {
			get: vi.fn((key) => (key === "auth.skipAPIValidation" ? true : false)),
			update: vi.fn(),
		}
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)

		await authService.signinWithToken()

		// Should NOT call fetch (API validation skipped)
		expect(global.fetch).not.toHaveBeenCalled()

		// Should store token immediately
		expect(mockContext.secrets.store).toHaveBeenCalledWith("access_token", testToken)

		// Should show success message
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			expect.stringContaining("Welcome, test@example.com!"),
			"Understood",
		)
	})

	it("should handle malformed JWT gracefully in fallback mode", async () => {
		const testToken = "not.a.valid.jwt.token"

		// Mock user input
		vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(testToken)

		// Mock backend unavailable
		vi.mocked(global.fetch).mockResolvedValueOnce({
			ok: false,
			status: 404,
			json: vi.fn().mockResolvedValue({ error: "Not Found" }),
		} as any)

		// Mock user choosing to use token anyway
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce({
			title: "✅ Use Token Now",
		} as any)

		await authService.signinWithToken()

		// Should still store the token
		expect(mockContext.secrets.store).toHaveBeenCalledWith("access_token", testToken)
		expect(mockContext.secrets.store).toHaveBeenCalledWith("session_id", "fallback-session")

		// Should show success with generic user name
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			expect.stringContaining("Welcome, User!"),
			"Understood",
		)
	})

	it("should respect user cancellation", async () => {
		const testToken = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.TestSignature"

		// Mock user input
		vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(testToken)

		// Mock backend unavailable
		vi.mocked(global.fetch).mockRejectedValueOnce(new Error("Failed to fetch"))

		// Mock user cancelling
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce({
			title: "❌ Cancel",
		} as any)

		await authService.signinWithToken()

		// Should NOT store token
		expect(mockContext.secrets.store).not.toHaveBeenCalled()

		// Should show cancellation message
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			"Authentication cancelled. You can try again anytime!",
		)

		// Should NOT trigger post-auth command
		expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith("softcodes.onAuthenticated")
	})
})
