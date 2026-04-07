import { vi, describe, it, expect, beforeEach } from "vitest"
import { AuthService } from "../AuthService"
import { SecretStorageService } from "../SecretStorageService"
import * as vscode from "vscode"
import { JWTVerificationService } from "../../auth/jwtVerification"

vi.mock("vscode")
vi.mock("../SecretStorageService")
vi.mock("../../auth/jwtVerification")

describe("AuthService", () => {
	let service: AuthService
	let mockSecretStorage: any
	let mockJWTService: any
	let mockWindow: any

	beforeEach(() => {
		mockSecretStorage = {
			getToken: vi.fn(),
			getRefreshToken: vi.fn(),
			storeToken: vi.fn(),
			clearTokens: vi.fn(),
		}
		vi.mocked(SecretStorageService).mockImplementation(() => mockSecretStorage)

		mockJWTService = {
			verifyJWT: vi.fn(),
		}
		vi.mocked(JWTVerificationService.getInstance).mockReturnValue(mockJWTService)

		mockWindow = {
			showInputBox: vi.fn(),
			showErrorMessage: vi.fn(),
			showInformationMessage: vi.fn(),
			showWarningMessage: vi.fn(),
		}
		;(vscode.window as any) = mockWindow

		service = new AuthService(mockSecretStorage as any)
		vi.clearAllMocks()
	})

	it("verifies valid token", async () => {
		const mockPayload = { sub: "user_123", email: "test@example.com" }
		mockJWTService.verifyJWT.mockResolvedValue({ valid: true, payload: mockPayload })

		const result = await service.verifyToken("valid.token")

		expect(result.valid).toBe(true)
		expect(result.userId).toBe("user_123")
		expect(mockJWTService.verifyJWT).toHaveBeenCalledWith("valid.token")
	})

	it("handles invalid token verification", async () => {
		mockJWTService.verifyJWT.mockResolvedValue({ valid: false, error: { message: "Invalid signature" } })

		const result = await service.verifyToken("invalid.token")

		expect(result.valid).toBe(false)
		expect(result.error).toBe("Invalid signature")
	})

	it("gets valid token", async () => {
		mockSecretStorage.getToken.mockResolvedValue("valid.token")
		const mockPayload = { sub: "user_123" }
		mockJWTService.verifyJWT.mockResolvedValue({ valid: true, payload: mockPayload })

		const token = await service.getValidToken()

		expect(token).toBe("valid.token")
	})

	it("returns null if no token", async () => {
		mockSecretStorage.getToken.mockResolvedValue(undefined)

		const token = await service.getValidToken()

		expect(token).toBeNull()
	})

	it("refreshes token if invalid", async () => {
		mockSecretStorage.getToken.mockResolvedValue("expired.token")
		mockJWTService.verifyJWT.mockResolvedValueOnce({ valid: false }) // Invalid
		mockSecretStorage.getRefreshToken.mockResolvedValue("refresh_token")
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ access_token: "new_token", refresh_token: "new_refresh", expires_in: 3600 }),
		})
		global.fetch = mockFetch

		const token = await service.getValidToken()

		expect(token).toBe("new_token")
		expect(mockSecretStorage.storeToken).toHaveBeenCalledWith("new_token", "new_refresh", expect.any(Number))
		expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("/auth/refresh-token"), expect.any(Object))
	})

	it("prompts and stores valid token", async () => {
		mockWindow.showInputBox.mockResolvedValue("valid.token")
		const mockPayload = { sub: "user_123" }
		mockJWTService.verifyJWT.mockResolvedValue({ valid: true, payload: mockPayload })

		await service.promptAndStoreToken()

		expect(mockWindow.showInputBox).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "Enter your Clerk token from the Softcodes.ai dashboard",
				password: true,
			}),
		)
		expect(mockSecretStorage.storeToken).toHaveBeenCalledWith("valid.token", undefined, expect.any(Number))
		expect(mockWindow.showInformationMessage).toHaveBeenCalledWith(
			"Token stored successfully! Extension is now authenticated.",
		)
	})

	it("shows error for invalid token in prompt", async () => {
		mockWindow.showInputBox.mockResolvedValue("invalid.token")
		mockJWTService.verifyJWT.mockResolvedValue({ valid: false, error: { message: "Invalid" } })

		await service.promptAndStoreToken()

		expect(mockWindow.showErrorMessage).toHaveBeenCalledWith("Token verification failed: Invalid")
		expect(mockSecretStorage.storeToken).not.toHaveBeenCalled()
	})

	it("cancels prompt if no token entered", async () => {
		mockWindow.showInputBox.mockResolvedValue(undefined)

		await service.promptAndStoreToken()

		expect(mockSecretStorage.storeToken).not.toHaveBeenCalled()
	})

	it("clears tokens and prompts for new", async () => {
		await service.clearTokensAndPrompt()

		expect(mockSecretStorage.clearTokens).toHaveBeenCalled()
		expect(mockWindow.showInformationMessage).toHaveBeenCalledWith("Tokens cleared. Please re-authenticate.")
		// The prompt is called, but we can verify the call to promptAndStoreToken indirectly
	})

	it("checks token status and shows warning if invalid", async () => {
		mockSecretStorage.getToken.mockResolvedValue(undefined)

		await service.checkTokenStatus()

		expect(mockWindow.showWarningMessage).toHaveBeenCalledWith(
			'Softcodes.ai: No valid token found. Run "Softcodes: Authenticate" to set up.',
		)
	})

	it("logs valid token on startup check", async () => {
		mockSecretStorage.getToken.mockResolvedValue("valid.token")
		const mockPayload = { sub: "user_123" }
		mockJWTService.verifyJWT.mockResolvedValue({ valid: true, payload: mockPayload })

		await service.checkTokenStatus()

		expect(mockWindow.showWarningMessage).not.toHaveBeenCalled()
	})
})
