import { vi, describe, it, expect, beforeEach } from "vitest"
import { ApiService } from "../ApiService"
import { AuthService } from "../AuthService"
import { SecretStorageService } from "../SecretStorageService"
import * as vscode from "vscode"

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn(() => "https://www.softcodes.ai/api"),
		})),
	},
	window: {
		showErrorMessage: vi.fn(),
		showInputBox: vi.fn(),
	},
}))

vi.mock("../SecretStorageService")
vi.mock("../AuthService")
vi.mock("global/fetch", () => ({
	default: vi.fn(),
}))

const mockSecretStorage = vi.mocked({
	getToken: vi.fn(),
	getRefreshToken: vi.fn(),
	storeToken: vi.fn(),
} as any) as any as ReturnType<typeof vi.mocked<SecretStorageService>>

const mockAuthService = vi.mocked({
	getValidToken: vi.fn(),
	refreshTokenIfNeeded: vi.fn(),
} as any) as any as ReturnType<typeof vi.mocked<AuthService>>

const mockFetch = vi.fn()

global.fetch = mockFetch as any

describe("ApiService", () => {
	let service: ApiService

	beforeEach(() => {
		service = new ApiService(mockSecretStorage, mockAuthService)
		vi.clearAllMocks()
	})

	it("makes authenticated request with valid token", async () => {
		mockAuthService.getValidToken.mockResolvedValue("valid_token")
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve({ data: "success" }),
		} as Response)

		const result = await service.makeAuthenticatedRequest("/test", { method: "GET" })

		expect(result.success).toBe(true)
		expect(result.data).toEqual({ data: "success" })
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("/test"),
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer valid_token",
				}),
			}),
		)
	})

	it("returns error if not authenticated", async () => {
		mockAuthService.getValidToken.mockResolvedValue(null)

		const result = await service.makeAuthenticatedRequest("/test")

		expect(result.success).toBe(false)
		expect(result.error).toBe("Not authenticated. Please authenticate first.")
		expect(mockFetch).not.toHaveBeenCalled()
	})

	it("refreshes token on 401 and retries", async () => {
		mockAuthService.getValidToken.mockResolvedValueOnce("expired_token")
		mockFetch
			.mockResolvedValueOnce({
				ok: false,
				status: 401,
			} as Response)
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ data: "success" }),
			} as Response)

		mockAuthService.getValidToken.mockResolvedValueOnce("new_token")

		const result = await service.makeAuthenticatedRequest("/test", { method: "GET" })

		expect(result.success).toBe(true)
		expect(mockAuthService.getValidToken).toHaveBeenCalledTimes(2)
		expect(mockFetch).toHaveBeenCalledTimes(2)
		expect(mockFetch).toHaveBeenNthCalledWith(
			2,
			expect.any(String),
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer new_token",
				}),
			}),
		)
	})

	it("prompts re-auth if refresh fails", async () => {
		mockAuthService.getValidToken.mockResolvedValueOnce("expired_token")
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
		} as Response)

		mockAuthService.getValidToken.mockResolvedValueOnce(null)

		const result = await service.makeAuthenticatedRequest("/test")

		expect(result.success).toBe(false)
		expect(result.error).toBe("Authentication expired. Please re-authenticate.")
		expect(vi.mocked(vscode.window).showErrorMessage).toHaveBeenCalledWith(
			"Authentication expired. Please re-authenticate.",
			"Re-authenticate",
		)
	})

	it("handles network errors", async () => {
		mockAuthService.getValidToken.mockResolvedValue("token")
		mockFetch.mockRejectedValueOnce(new Error("Network error"))

		const result = await service.makeAuthenticatedRequest("/test")

		expect(result.success).toBe(false)
		expect(result.error).toBe("Network error")
	})

	it("refreshes token endpoint", async () => {
		mockSecretStorage.storeToken.mockResolvedValue(undefined)
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ access_token: "new_token", refresh_token: "new_refresh", expires_in: 3600 }),
		} as Response)

		const result = await service.refreshToken("refresh_token")

		expect(result.success).toBe(true)
		expect(result.data).toEqual({ access_token: "new_token", refresh_token: "new_refresh", expires_in: 3600 })
		expect(mockSecretStorage.storeToken).toHaveBeenCalledWith("new_token", "new_refresh", expect.any(Number))
	})

	it("gets user credits", async () => {
		mockAuthService.getValidToken.mockResolvedValue("token")
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ credits: 100 }),
		} as Response)

		const result = await service.getUserCredits()

		expect(result.success).toBe(true)
		expect(result.data).toEqual({ credits: 100 })
	})
})
