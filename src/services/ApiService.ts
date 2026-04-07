import * as vscode from "vscode"
import { SecretStorageService } from "./SecretStorageService"
import { AuthService } from "./AuthService"

export class ApiService {
	private readonly baseUrl: string

	constructor(
		private readonly secretStorage: SecretStorageService,
		private readonly authService: AuthService,
	) {
		this.baseUrl = vscode.workspace
			.getConfiguration("softcodes")
			.get("apiBaseUrl", "https://www.softcodes.ai/api") as string
	}

	async makeAuthenticatedRequest<T = any>(
		endpoint: string,
		options: RequestInit = {},
	): Promise<{ success: boolean; data?: T; error?: string }> {
		let token = await this.authService.getValidToken()
		if (!token) {
			return { success: false, error: "Not authenticated. Please authenticate first." }
		}

		const url = new URL(endpoint, this.baseUrl).toString()
		const config: RequestInit = {
			...options,
			headers: {
				...((options.headers as Record<string, string>) || {}),
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
		}

		try {
			let response = await fetch(url, config)

			if (response.status === 401) {
				token = await this.authService.getValidToken()
				if (!token) {
					vscode.window.showErrorMessage("Authentication expired. Please re-authenticate.", "Re-authenticate")
					return { success: false, error: "Authentication expired. Please re-authenticate." }
				}

				// Retry the request with new token
				config.headers = {
					...(config.headers as Record<string, string>),
					Authorization: `Bearer ${token}`,
				}
				response = await fetch(url, config)
			}

			if (!response.ok) {
				return {
					success: false,
					error: `Request failed with status ${response.status}: ${response.statusText}`,
				}
			}

			const data = await response.json()
			return { success: true, data }
		} catch (error: any) {
			console.error("[ApiService] Request failed:", error)
			return { success: false, error: error.message || "Network error. Please check your connection." }
		}
	}

	async getUserCredits() {
		return this.makeAuthenticatedRequest<{ credits: number }>("/user/credits")
	}

	async refreshToken(refreshToken: string): Promise<{ success: boolean; data?: any; error?: string }> {
		const url = new URL("/auth/refresh-token", this.baseUrl).toString()

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ token: refreshToken }),
			})

			if (!response.ok) {
				return { success: false, error: `Refresh failed: ${response.statusText}` }
			}

			const data = await response.json()
			if (data.access_token && data.expires_in) {
				await this.secretStorage.storeToken(
					data.access_token,
					data.refresh_token,
					Date.now() + data.expires_in * 1000,
				)
			}

			return { success: true, data }
		} catch (error: any) {
			return { success: false, error: error.message || "Network error during refresh." }
		}
	}
}
