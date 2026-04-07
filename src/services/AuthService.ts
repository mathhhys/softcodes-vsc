import * as vscode from "vscode"
import { JWTVerificationService } from "../auth/jwtVerification"
import { SecretStorageService } from "./SecretStorageService"

export class AuthService {
	private secretStorage: SecretStorageService

	constructor(secretStorage: SecretStorageService) {
		this.secretStorage = secretStorage
	}

	async verifyToken(token: string): Promise<{ valid: boolean; userId?: string; error?: string }> {
		try {
			const jwtService = JWTVerificationService.getInstance()
			const result = await jwtService.verifyJWT(token)

			if (result.valid && result.payload) {
				if (!result.payload.sub) {
					throw new Error("Missing user ID in token claims")
				}

				console.log("[Auth] Token verified successfully for user:", result.payload.sub)
				return { valid: true, userId: result.payload.sub }
			} else {
				throw new Error(result.error?.message || "Token verification failed")
			}
		} catch (error) {
			console.error("[Auth] Token verification failed:", error)
			return { valid: false, error: (error as Error).message }
		}
	}

	async getValidToken(): Promise<string | null> {
		const token = await this.secretStorage.getToken()
		if (!token) return null

		const verification = await this.verifyToken(token)
		if (verification.valid) {
			return token
		}

		// Token invalid, try refresh
		return await this.refreshTokenIfNeeded()
	}

	public async refreshTokenIfNeeded(): Promise<string | null> {
		const refreshToken = await this.secretStorage.getRefreshToken()
		if (!refreshToken) return null

		const baseUrl = vscode.workspace
			.getConfiguration("softcodes")
			.get("apiBaseUrl", "https://www.softcodes.ai/api") as string
		const response = await fetch(`${baseUrl}/auth/refresh-token`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ token: refreshToken }),
		})

		if (response.ok) {
			const data = await response.json()
			if (data.access_token) {
				await this.secretStorage.storeToken(
					data.access_token,
					data.refresh_token,
					Date.now() + data.expires_in * 1000,
				)
				return data.access_token
			}
		}

		return null
	}

	async promptAndStoreToken(): Promise<void> {
		const token = await vscode.window.showInputBox({
			prompt: "Enter your Clerk token from the Softcodes dashboard",
			placeHolder: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
			ignoreFocusOut: true,
			password: true, // Hide input for security
		})

		if (!token) return

		const verification = await this.verifyToken(token)
		if (!verification.valid) {
			return
		}

		// Assume refresh token is not needed initially; backend can provide on first API call if required
		await this.secretStorage.storeToken(token, undefined, Date.now() + 24 * 60 * 60 * 1000) // Assume 24h
		vscode.window.showInformationMessage("Token stored successfully! Extension is now authenticated.")
	}

	async clearTokensAndPrompt(): Promise<void> {
		await this.secretStorage.clearTokens()
		vscode.window.showInformationMessage("Tokens cleared. Please re-authenticate.")
		await this.promptAndStoreToken()
	}

	async checkTokenStatus(): Promise<void> {
		const token = await this.getValidToken()
		if (token) {
			console.log("[Auth] Valid token loaded on startup")
		}
	}
}
