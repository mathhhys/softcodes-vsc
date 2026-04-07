import * as vscode from "vscode"

import { AuthTokens, UserInfo, AuthState } from "./types"

/**
 * Manages secure storage and retrieval of authentication tokens
 * Uses VSCode's SecretStorage API for secure credential storage
 */
export class TokenManager {
	private static readonly KEYS = {
		ACCESS_TOKEN: "softcodes.auth.access_token",
		REFRESH_TOKEN: "softcodes.auth.refresh_token",
		TOKEN_EXPIRES_AT: "softcodes.auth.expires_at",
		SESSION_ID: "softcodes.auth.session_id",
		USER_DATA: "softcodes.auth.user_data",
		PKCE_VERIFIER: "softcodes.auth.pkce_verifier",
		PKCE_STATE: "softcodes.auth.pkce_state",
	} as const

	constructor(private secretStorage: vscode.SecretStorage) {}

	/**
	 * Store authentication tokens securely
	 */
	async storeTokens(tokens: AuthTokens, user: UserInfo): Promise<void> {
		try {
			await this.secretStorage.store(TokenManager.KEYS.ACCESS_TOKEN, tokens.access_token)
			await this.secretStorage.store(TokenManager.KEYS.REFRESH_TOKEN, tokens.refresh_token)
			await this.secretStorage.store(TokenManager.KEYS.SESSION_ID, tokens.session_id)
			await this.secretStorage.store(TokenManager.KEYS.USER_DATA, JSON.stringify(user))

			// Calculate and store expiration timestamp
			const expiresAt = Date.now() + tokens.expires_in * 1000
			await this.secretStorage.store(TokenManager.KEYS.TOKEN_EXPIRES_AT, expiresAt.toString())

			console.log("✅ Tokens stored securely")
		} catch (error) {
			console.error("❌ Failed to store tokens:", error)
			throw new Error("Failed to store authentication tokens")
		}
	}

	/**
	 * Get access token if valid, null otherwise
	 */
	async getAccessToken(): Promise<string | null> {
		const token = await this.secretStorage.get(TokenManager.KEYS.ACCESS_TOKEN)
		return token || null
	}

	/**
	 * Get refresh token
	 */
	async getRefreshToken(): Promise<string | null> {
		const token = await this.secretStorage.get(TokenManager.KEYS.REFRESH_TOKEN)
		return token || null
	}

	/**
	 * Get session ID
	 */
	async getSessionId(): Promise<string | null> {
		const sessionId = await this.secretStorage.get(TokenManager.KEYS.SESSION_ID)
		return sessionId || null
	}

	/**
	 * Get stored user information
	 */
	async getUserInfo(): Promise<UserInfo | null> {
		try {
			const userDataStr = await this.secretStorage.get(TokenManager.KEYS.USER_DATA)
			if (!userDataStr) return null

			const userData = JSON.parse(userDataStr) as UserInfo
			return userData
		} catch (error) {
			console.error("Failed to parse user data:", error)
			return null
		}
	}

	/**
	 * Check if access token is expired or about to expire
	 * @param bufferSeconds Buffer time before expiration (default 5 minutes)
	 */
	async isTokenExpired(bufferSeconds: number = 300): Promise<boolean> {
		const expiresAtStr = await this.secretStorage.get(TokenManager.KEYS.TOKEN_EXPIRES_AT)
		if (!expiresAtStr) return true

		const expiresAt = parseInt(expiresAtStr, 10)
		const bufferMs = bufferSeconds * 1000

		return Date.now() >= expiresAt - bufferMs
	}

	/**
	 * Update only the access token (used after refresh)
	 */
	async updateAccessToken(accessToken: string, expiresIn: number): Promise<void> {
		await this.secretStorage.store(TokenManager.KEYS.ACCESS_TOKEN, accessToken)

		const expiresAt = Date.now() + expiresIn * 1000
		await this.secretStorage.store(TokenManager.KEYS.TOKEN_EXPIRES_AT, expiresAt.toString())
	}

	/**
	 * Store PKCE parameters temporarily during auth flow
	 */
	async storePKCEParams(verifier: string, state: string): Promise<void> {
		await this.secretStorage.store(TokenManager.KEYS.PKCE_VERIFIER, verifier)
		await this.secretStorage.store(TokenManager.KEYS.PKCE_STATE, state)
	}

	/**
	 * Retrieve PKCE parameters
	 */
	async getPKCEParams(): Promise<{ verifier: string; state: string } | null> {
		const verifier = await this.secretStorage.get(TokenManager.KEYS.PKCE_VERIFIER)
		const state = await this.secretStorage.get(TokenManager.KEYS.PKCE_STATE)

		if (!verifier || !state) return null

		return { verifier, state }
	}

	/**
	 * Clear PKCE parameters after successful auth
	 */
	async clearPKCEParams(): Promise<void> {
		await this.secretStorage.delete(TokenManager.KEYS.PKCE_VERIFIER)
		await this.secretStorage.delete(TokenManager.KEYS.PKCE_STATE)
	}

	/**
	 * Clear all stored authentication data
	 */
	async clearAll(): Promise<void> {
		await this.secretStorage.delete(TokenManager.KEYS.ACCESS_TOKEN)
		await this.secretStorage.delete(TokenManager.KEYS.REFRESH_TOKEN)
		await this.secretStorage.delete(TokenManager.KEYS.TOKEN_EXPIRES_AT)
		await this.secretStorage.delete(TokenManager.KEYS.SESSION_ID)
		await this.secretStorage.delete(TokenManager.KEYS.USER_DATA)
		await this.clearPKCEParams()

		console.log("🧹 All auth data cleared")
	}

	/**
	 * Get current authentication state
	 */
	async getAuthState(): Promise<AuthState> {
		const accessToken = await this.getAccessToken()
		const user = await this.getUserInfo()
		const sessionId = await this.getSessionId()
		const isExpired = await this.isTokenExpired()

		return {
			isAuthenticated: !!accessToken && !isExpired && !!user,
			user,
			sessionId,
		}
	}
}
