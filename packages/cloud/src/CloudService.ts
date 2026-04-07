import * as vscode from "vscode"

import type {
	CloudUserInfo,
	TelemetryEvent,
	OrganizationAllowList,
	ClineMessage,
	ShareVisibility,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { CloudServiceCallbacks } from "./types"
import type { AuthService } from "./auth"
import { WebAuthService, StaticTokenAuthService } from "./auth"
import type { SettingsService } from "./SettingsService"
import { CloudSettingsService } from "./CloudSettingsService"
import { StaticSettingsService } from "./StaticSettingsService"
import { TelemetryClient } from "./TelemetryClient"
import { ShareService, TaskNotFoundError } from "./ShareService"
import { SoftcodesAuthService } from "./auth/SoftcodesAuthService"
import type { UserInfo } from "./auth/types"

export class CloudService {
	private static _instance: CloudService | null = null

	private context: vscode.ExtensionContext
	private callbacks: CloudServiceCallbacks
	private authListener: () => void
	private authService: AuthService | null = null
	private softcodesAuthService: SoftcodesAuthService | null = null
	private outputChannel: vscode.OutputChannel | null = null
	private settingsService: SettingsService | null = null
	private telemetryClient: TelemetryClient | null = null
	private shareService: ShareService | null = null
	private isInitialized = false
	private log: (...args: unknown[]) => void

	private constructor(context: vscode.ExtensionContext, callbacks: CloudServiceCallbacks) {
		this.context = context
		this.callbacks = callbacks
		this.log = callbacks.log || console.log
		this.authListener = () => {
			this.callbacks.stateChanged?.()
		}
	}

	public async initialize(): Promise<void> {
		if (this.isInitialized) {
			return
		}

		try {
			const cloudToken = process.env.ROO_CODE_CLOUD_TOKEN
			if (cloudToken && cloudToken.length > 0) {
				this.authService = new StaticTokenAuthService(this.context, cloudToken, this.log)
			} else {
				this.authService = new WebAuthService(this.context, this.log)
			}

			await this.authService.initialize()

			this.authService.on("attempting-session", this.authListener)
			this.authService.on("inactive-session", this.authListener)
			this.authService.on("active-session", this.authListener)
			this.authService.on("logged-out", this.authListener)
			this.authService.on("user-info", this.authListener)

			// Initialize Softcodes authentication service
			this.outputChannel = vscode.window.createOutputChannel("Softcodes Authentication")
			this.softcodesAuthService = new SoftcodesAuthService(this.context, this.outputChannel)

			// Check for static settings environment variable
			const staticOrgSettings = process.env.ROO_CODE_CLOUD_ORG_SETTINGS
			if (staticOrgSettings && staticOrgSettings.length > 0) {
				this.settingsService = new StaticSettingsService(staticOrgSettings, this.log)
			} else {
				const cloudSettingsService = new CloudSettingsService(
					this.context,
					this.authService,
					() => this.callbacks.stateChanged?.(),
					this.log,
				)
				cloudSettingsService.initialize()
				this.settingsService = cloudSettingsService
			}

			this.telemetryClient = new TelemetryClient(this.authService, this.settingsService)

			this.shareService = new ShareService(this.authService, this.settingsService, this.log)

			try {
				TelemetryService.instance.register(this.telemetryClient)
			} catch (error) {
				this.log("[CloudService] Failed to register TelemetryClient:", error)
			}

			this.isInitialized = true
		} catch (error) {
			this.log("[CloudService] Failed to initialize:", error)
			throw new Error(`Failed to initialize CloudService: ${error}`)
		}
	}

	// AuthService

	public async login(): Promise<void> {
		this.ensureInitialized()
		return this.authService!.login()
	}

	public async logout(): Promise<void> {
		this.ensureInitialized()
		return this.authService!.logout()
	}

	public isAuthenticated(): boolean {
		this.ensureInitialized()
		return this.authService!.isAuthenticated()
	}

	public hasActiveSession(): boolean {
		this.ensureInitialized()
		return this.authService!.hasActiveSession()
	}

	public hasOrIsAcquiringActiveSession(): boolean {
		this.ensureInitialized()
		return this.authService!.hasOrIsAcquiringActiveSession()
	}

	public getUserInfo(): CloudUserInfo | null {
		this.ensureInitialized()
		return this.authService!.getUserInfo()
	}

	public getOrganizationId(): string | null {
		this.ensureInitialized()
		const userInfo = this.authService!.getUserInfo()
		return userInfo?.organizationId || null
	}

	public getOrganizationName(): string | null {
		this.ensureInitialized()
		const userInfo = this.authService!.getUserInfo()
		return userInfo?.organizationName || null
	}

	public getOrganizationRole(): string | null {
		this.ensureInitialized()
		const userInfo = this.authService!.getUserInfo()
		return userInfo?.organizationRole || null
	}

	public hasStoredOrganizationId(): boolean {
		this.ensureInitialized()
		return this.authService!.getStoredOrganizationId() !== null
	}

	public getStoredOrganizationId(): string | null {
		this.ensureInitialized()
		return this.authService!.getStoredOrganizationId()
	}

	public getAuthState(): string {
		this.ensureInitialized()
		return this.authService!.getState()
	}

	public async handleAuthCallback(
		code: string | null,
		state: string | null,
		organizationId?: string | null,
	): Promise<void> {
		this.ensureInitialized()

		// Try Softcodes auth first if it has stored PKCE params
		if (this.softcodesAuthService) {
			const pkceParams = await this.softcodesAuthService.getUserInfo()
			if (pkceParams) {
				const success = await this.softcodesAuthService.handleCallback(code, state, organizationId)
				if (success) {
					this.callbacks.stateChanged?.()
					return
				}
			}
		}

		// Fall back to Roo Code auth
		return this.authService!.handleCallback(code, state, organizationId)
	}

	// Softcodes Authentication Methods

	public async softcodesLogin(): Promise<void> {
		this.ensureInitialized()
		if (!this.softcodesAuthService) {
			throw new Error("Softcodes authentication service not available")
		}
		return this.softcodesAuthService.login()
	}

	public async softcodesLogout(): Promise<void> {
		this.ensureInitialized()
		if (!this.softcodesAuthService) {
			throw new Error("Softcodes authentication service not available")
		}
		await this.softcodesAuthService.logout()
		this.callbacks.stateChanged?.()
	}

	public async softcodesIsAuthenticated(): Promise<boolean> {
		this.ensureInitialized()
		if (!this.softcodesAuthService) {
			return false
		}
		return this.softcodesAuthService.isAuthenticated()
	}

	public async softcodesGetUserInfo(): Promise<UserInfo | null> {
		this.ensureInitialized()
		if (!this.softcodesAuthService) {
			return null
		}
		return this.softcodesAuthService.getUserInfo()
	}

	public async softcodesGetAccessToken(): Promise<string | null> {
		this.ensureInitialized()
		if (!this.softcodesAuthService) {
			return null
		}
		return this.softcodesAuthService.getAccessToken()
	}

	public async softcodesMakeAuthenticatedRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
		this.ensureInitialized()
		if (!this.softcodesAuthService) {
			throw new Error("Softcodes authentication service not available")
		}
		return this.softcodesAuthService.makeAuthenticatedRequest<T>(endpoint, options)
	}

	// SettingsService

	public getAllowList(): OrganizationAllowList {
		this.ensureInitialized()
		return this.settingsService!.getAllowList()
	}

	// TelemetryClient

	public captureEvent(event: TelemetryEvent): void {
		this.ensureInitialized()
		this.telemetryClient!.capture(event)
	}

	// ShareService

	public async shareTask(
		taskId: string,
		visibility: ShareVisibility = "organization",
		clineMessages?: ClineMessage[],
	) {
		this.ensureInitialized()

		try {
			return await this.shareService!.shareTask(taskId, visibility)
		} catch (error) {
			if (error instanceof TaskNotFoundError && clineMessages) {
				// Backfill messages and retry
				await this.telemetryClient!.backfillMessages(clineMessages, taskId)
				return await this.shareService!.shareTask(taskId, visibility)
			}
			throw error
		}
	}

	public async canShareTask(): Promise<boolean> {
		this.ensureInitialized()
		return this.shareService!.canShareTask()
	}

	// Lifecycle

	public dispose(): void {
		if (this.authService) {
			this.authService.off("attempting-session", this.authListener)
			this.authService.off("inactive-session", this.authListener)
			this.authService.off("active-session", this.authListener)
			this.authService.off("logged-out", this.authListener)
			this.authService.off("user-info", this.authListener)
		}
		if (this.settingsService) {
			this.settingsService.dispose()
		}
		if (this.outputChannel) {
			this.outputChannel.dispose()
		}

		this.isInitialized = false
	}

	private ensureInitialized(): void {
		if (!this.isInitialized) {
			throw new Error("CloudService not initialized.")
		}
	}

	static get instance(): CloudService {
		if (!this._instance) {
			throw new Error("CloudService not initialized")
		}

		return this._instance
	}

	static async createInstance(
		context: vscode.ExtensionContext,
		callbacks: CloudServiceCallbacks = {},
	): Promise<CloudService> {
		if (this._instance) {
			throw new Error("CloudService instance already created")
		}

		this._instance = new CloudService(context, callbacks)
		await this._instance.initialize()
		return this._instance
	}

	static hasInstance(): boolean {
		return this._instance !== null && this._instance.isInitialized
	}

	static resetInstance(): void {
		if (this._instance) {
			this._instance.dispose()
			this._instance = null
		}
	}

	static isEnabled(): boolean {
		return !!this._instance?.isAuthenticated()
	}
}
