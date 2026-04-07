import * as vscode from "vscode"

export class SecretStorageService {
	private context: vscode.ExtensionContext
	private readonly TOKEN_KEY = "softcodes.clerkToken"
	private readonly REFRESH_TOKEN_KEY = "softcodes.refreshToken"
	private readonly TOKEN_EXPIRY_KEY = "softcodes.tokenExpiry"

	constructor(context: vscode.ExtensionContext) {
		this.context = context
	}

	async storeToken(token: string, refreshToken?: string, expiry?: number): Promise<void> {
		await this.context.secrets.store(this.TOKEN_KEY, token)
		if (refreshToken) {
			await this.context.secrets.store(this.REFRESH_TOKEN_KEY, refreshToken)
		}
		if (expiry) {
			await this.context.globalState.update(this.TOKEN_EXPIRY_KEY, expiry)
		}
		console.log("[SecretStorage] Token stored securely")
	}

	async getToken(): Promise<string | undefined> {
		return this.context.secrets.get(this.TOKEN_KEY)
	}

	async getRefreshToken(): Promise<string | undefined> {
		return this.context.secrets.get(this.REFRESH_TOKEN_KEY)
	}

	async getTokenExpiry(): Promise<number | undefined> {
		return this.context.globalState.get(this.TOKEN_EXPIRY_KEY)
	}

	async clearTokens(): Promise<void> {
		await this.context.secrets.delete(this.TOKEN_KEY)
		await this.context.secrets.delete(this.REFRESH_TOKEN_KEY)
		await this.context.globalState.update(this.TOKEN_EXPIRY_KEY, undefined)
		console.log("[SecretStorage] Tokens cleared")
	}

	async isTokenExpiringSoon(thresholdMinutes = 5): Promise<boolean> {
		const expiry = await this.getTokenExpiry()
		if (!expiry) return true
		const now = Date.now()
		return expiry - now < thresholdMinutes * 60 * 1000
	}
}
