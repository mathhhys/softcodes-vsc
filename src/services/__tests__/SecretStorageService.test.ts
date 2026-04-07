import { vi, describe, it, expect, beforeEach } from "vitest"
import { SecretStorageService } from "../SecretStorageService"
import * as vscode from "vscode"

const mockSecrets = {
	store: vi.fn(),
	get: vi.fn(),
	delete: vi.fn(),
}

const mockGlobalState = {
	update: vi.fn(),
	get: vi.fn(),
}

const mockContext = {
	secrets: mockSecrets,
	globalState: mockGlobalState,
} as unknown as vscode.ExtensionContext

describe("SecretStorageService", () => {
	let service: SecretStorageService

	beforeEach(() => {
		service = new SecretStorageService(mockContext)
		vi.clearAllMocks()
	})

	it("stores token and optional refresh token and expiry", async () => {
		await service.storeToken("access_token", "refresh_token", 3600000)

		expect(mockSecrets.store).toHaveBeenCalledWith("softcodes.clerkToken", "access_token")
		expect(mockSecrets.store).toHaveBeenCalledWith("softcodes.refreshToken", "refresh_token")
		expect(mockGlobalState.update).toHaveBeenCalledWith("softcodes.tokenExpiry", 3600000)
	})

	it("gets token", async () => {
		mockSecrets.get.mockReturnValue("stored_token")

		const token = await service.getToken()

		expect(token).toBe("stored_token")
		expect(mockSecrets.get).toHaveBeenCalledWith("softcodes.clerkToken")
	})

	it("gets refresh token", async () => {
		mockSecrets.get.mockReturnValue("stored_refresh")

		const refresh = await service.getRefreshToken()

		expect(refresh).toBe("stored_refresh")
		expect(mockSecrets.get).toHaveBeenCalledWith("softcodes.refreshToken")
	})

	it("gets token expiry", async () => {
		mockGlobalState.get.mockReturnValue(3600000)

		const expiry = await service.getTokenExpiry()

		expect(expiry).toBe(3600000)
		expect(mockGlobalState.get).toHaveBeenCalledWith("softcodes.tokenExpiry")
	})

	it("clears all tokens", async () => {
		await service.clearTokens()

		expect(mockSecrets.delete).toHaveBeenCalledWith("softcodes.clerkToken")
		expect(mockSecrets.delete).toHaveBeenCalledWith("softcodes.refreshToken")
		expect(mockGlobalState.update).toHaveBeenCalledWith("softcodes.tokenExpiry", undefined)
	})

	it("checks if token is expiring soon", async () => {
		mockGlobalState.get.mockReturnValue(Date.now() + 4 * 60 * 1000) // 4 minutes from now

		const isExpiring = await service.isTokenExpiringSoon(5)

		expect(isExpiring).toBe(true)
	})

	it("returns true if no expiry", async () => {
		mockGlobalState.get.mockReturnValue(undefined)

		const isExpiring = await service.isTokenExpiringSoon()

		expect(isExpiring).toBe(true)
	})
})
