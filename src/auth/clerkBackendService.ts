/**
 * Clerk Backend Service
 *
 * Production-ready service for interacting with Clerk's backend API
 * Handles user verification, organization membership, and session management
 */

import { createClerkClient } from "@clerk/backend"
import type { User, Organization, OrganizationMembership, Session } from "@clerk/backend"
import {
	UserVerificationResult,
	UserVerificationError,
	UserVerificationErrorType,
	VerifiedUser,
	ClerkBackendConfig,
	VerificationOptions,
} from "./userVerificationTypes"

export class ClerkBackendService {
	private static instance: ClerkBackendService
	private client: ReturnType<typeof createClerkClient>
	private config: ClerkBackendConfig

	private constructor(config: ClerkBackendConfig) {
		this.config = config
		this.client = createClerkClient({ secretKey: config.secretKey })

		console.log("[ClerkBackend] Service initialized with production configuration")
	}

	/**
	 * Get singleton instance of the Clerk backend service
	 */
	static getInstance(config?: ClerkBackendConfig): ClerkBackendService {
		if (!ClerkBackendService.instance) {
			if (!config) {
				throw new Error("ClerkBackendService must be initialized with config on first call")
			}
			ClerkBackendService.instance = new ClerkBackendService(config)
		}
		return ClerkBackendService.instance
	}

	/**
	 * Verify user exists and get user data by ID
	 * Primary method for user verification with comprehensive error handling
	 */
	async getUserById(userId: string, options: VerificationOptions = {}): Promise<UserVerificationResult> {
		const startTime = Date.now()
		const timeout = options.timeout || this.config.timeout || 10000

		try {
			console.log(`[CLERK-DEBUG] User lookup initiated`, {
				userId,
				timeout,
				includeOrganizations: options.includeOrganizations || false,
				bypassCache: options.bypassCache || false,
				timestamp: new Date().toISOString(),
			})

			// Validate user ID format
			if (!this.isValidUserId(userId)) {
				console.log(`[CLERK-DEBUG] User ID format validation failed`, {
					userId,
					expectedFormat: "user_[a-zA-Z0-9]+",
					actualFormat: userId.substring(0, 5) + "...",
					timestamp: new Date().toISOString(),
				})
				return this.createErrorResult(
					UserVerificationErrorType.INVALID_USER_ID,
					"Invalid user ID format",
					userId,
				)
			}

			console.log(`[CLERK-DEBUG] User ID format validation passed`, {
				userId,
				timestamp: new Date().toISOString(),
			})

			// Fetch user from Clerk with timeout
			console.log(`[CLERK-DEBUG] Initiating Clerk API call`, {
				userId,
				timeout,
				apiEndpoint: "users.getUser",
				timestamp: new Date().toISOString(),
			})

			const user = await this.executeWithTimeout(() => this.client.users.getUser(userId), timeout)

			const apiResponseTime = Date.now() - startTime
			console.log(`[CLERK-DEBUG] Clerk API response received`, {
				userId,
				responseTime: apiResponseTime,
				userFound: !!user,
				httpStatus: user ? 200 : 404,
				timestamp: new Date().toISOString(),
			})

			if (!user) {
				console.log(`[CLERK-DEBUG] User not found in Clerk database`, {
					userId,
					responseTime: apiResponseTime,
					errorType: "USER_NOT_FOUND",
					timestamp: new Date().toISOString(),
				})
				return this.createErrorResult(
					UserVerificationErrorType.USER_NOT_FOUND,
					"User not found in Clerk database",
					userId,
				)
			}

			// Log user account details
			console.log(`[CLERK-DEBUG] User account details retrieved`, {
				userId,
				email: user.primaryEmailAddress?.emailAddress || null,
				emailVerified: user.primaryEmailAddress?.verification?.status === "verified",
				hasFirstName: !!user.firstName,
				hasLastName: !!user.lastName,
				hasUsername: !!user.username,
				hasImageUrl: !!user.imageUrl,
				createdAt: user.createdAt,
				lastActiveAt: user.lastActiveAt,
				banned: user.banned,
				locked: user.locked,
				phoneNumbers: user.phoneNumbers?.length || 0,
				emailAddresses: user.emailAddresses?.length || 0,
				timestamp: new Date().toISOString(),
			})

			// Check user status
			console.log(`[CLERK-DEBUG] Checking user account status`, {
				userId,
				banned: user.banned,
				locked: user.locked,
				timestamp: new Date().toISOString(),
			})

			const statusCheck = this.checkUserStatus(user, userId)
			if (!statusCheck.valid) {
				console.log(`[CLERK-DEBUG] User status check failed`, {
					userId,
					banned: user.banned,
					locked: user.locked,
					errorType: statusCheck.error?.type,
					errorMessage: statusCheck.error?.message,
					timestamp: new Date().toISOString(),
				})
				return statusCheck
			}

			console.log(`[CLERK-DEBUG] User status check passed`, {
				userId,
				timestamp: new Date().toISOString(),
			})

			// Build verified user object
			console.log(`[CLERK-DEBUG] Building verified user object`, {
				userId,
				includeOrganizations: options.includeOrganizations || false,
				timestamp: new Date().toISOString(),
			})

			const verifiedUser = await this.buildVerifiedUser(user, options)

			const responseTime = Date.now() - startTime
			console.log(`[CLERK-DEBUG] User verification successful`, {
				userId,
				responseTime,
				email: verifiedUser.email,
				verified: verifiedUser.verified,
				organizationCount: verifiedUser.organizations?.length || 0,
				timestamp: new Date().toISOString(),
			})

			return {
				valid: true,
				user: verifiedUser,
				responseTime,
			}
		} catch (error: any) {
			const responseTime = Date.now() - startTime
			console.error(
				`[CLERK-DEBUG] User verification failed with error`,
				{
					userId,
					responseTime,
					errorName: error.name,
					errorMessage: error.message,
					httpStatus: error.status,
					rateLimited: error.status === 429,
					retryAfter: error.headers?.["retry-after"],
					timestamp: new Date().toISOString(),
				},
				error,
			)

			return this.handleClerkError(error, userId, responseTime)
		}
	}

	/**
	 * Verify multiple users efficiently with batching
	 */
	async getUsersById(
		userIds: string[],
		options: VerificationOptions = {},
	): Promise<Map<string, UserVerificationResult>> {
		const results = new Map<string, UserVerificationResult>()

		// Process in batches to avoid overwhelming Clerk API
		const BATCH_SIZE = 10

		for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
			const batch = userIds.slice(i, i + BATCH_SIZE)
			const batchPromises = batch.map((userId) => this.getUserById(userId, options))

			try {
				const batchResults = await Promise.all(batchPromises)
				batchResults.forEach((result, index) => {
					results.set(batch[index], result)
				})
			} catch (error) {
				console.error("[ClerkBackend] Batch verification failed:", error)
				// Add error results for failed batch
				batch.forEach((userId) => {
					results.set(
						userId,
						this.createErrorResult(
							UserVerificationErrorType.VERIFICATION_FAILED,
							"Batch verification failed",
							userId,
						),
					)
				})
			}
		}

		return results
	}

	/**
	 * Verify user's organization membership
	 */
	async verifyOrganizationMembership(userId: string, organizationId: string): Promise<boolean> {
		try {
			const memberships = await this.client.users.getOrganizationMembershipList({ userId })
			return memberships.data.some(
				(membership: OrganizationMembership) =>
					membership.organization.id === organizationId && membership.role !== null,
			)
		} catch (error) {
			console.error(`[ClerkBackend] Error verifying org membership for ${userId}:`, error)
			return false
		}
	}

	/**
	 * Get user's active sessions
	 */
	async getUserActiveSessions(userId: string): Promise<any[]> {
		try {
			const sessions = await this.client.sessions.getSessionList({ userId })
			return sessions.data.filter((session: Session) => session.status === "active")
		} catch (error) {
			console.error(`[ClerkBackend] Error fetching sessions for ${userId}:`, error)
			return []
		}
	}

	/**
	 * Health check for Clerk API connectivity
	 */
	async healthCheck(): Promise<boolean> {
		try {
			// Try to fetch a minimal amount of data to verify connectivity
			await this.executeWithTimeout(
				() => this.client.users.getUserList({ limit: 1 }),
				5000, // 5 second timeout for health check
			)
			return true
		} catch (error) {
			console.error("[ClerkBackend] Health check failed:", error)
			return false
		}
	}

	/**
	 * Validate user ID format (Clerk user IDs start with 'user_')
	 */
	private isValidUserId(userId: string): boolean {
		const isValid = /^user_[a-zA-Z0-9]+$/.test(userId)
		console.log(`[CLERK-DEBUG] User ID format validation`, {
			userId: userId.substring(0, 10) + "...",
			isValid,
			expectedPattern: "user_[a-zA-Z0-9]+",
			actualPrefix: userId.substring(0, 5),
			actualLength: userId.length,
			timestamp: new Date().toISOString(),
		})
		return isValid
	}

	/**
	 * Check user status for bans, locks, etc.
	 */
	private checkUserStatus(user: User, userId: string): UserVerificationResult {
		console.log(`[CLERK-DEBUG] User status validation initiated`, {
			userId,
			banned: user.banned,
			locked: user.locked,
			emailVerified: user.primaryEmailAddress?.verification?.status === "verified",
			hasContactInfo: !!(user.primaryEmailAddress?.emailAddress || user.phoneNumbers?.length),
			lastActiveAt: user.lastActiveAt,
			timestamp: new Date().toISOString(),
		})

		if (user.banned) {
			console.log(`[CLERK-DEBUG] User account is banned`, {
				userId,
				banned: true,
				banReason: "User access has been revoked by administrator",
				accountCreatedAt: user.createdAt,
				timestamp: new Date().toISOString(),
			})
			return this.createErrorResult(
				UserVerificationErrorType.USER_BANNED,
				"User account has been banned",
				userId,
				"User access has been revoked by administrator",
			)
		}

		if (user.locked) {
			console.log(`[CLERK-DEBUG] User account is locked`, {
				userId,
				locked: true,
				lockReason: "Account locked due to security concerns",
				accountCreatedAt: user.createdAt,
				lastActiveAt: user.lastActiveAt,
				timestamp: new Date().toISOString(),
			})
			return this.createErrorResult(
				UserVerificationErrorType.USER_LOCKED,
				"User account is temporarily locked",
				userId,
				"Account locked due to security concerns",
			)
		}

		console.log(`[CLERK-DEBUG] User account status validation passed`, {
			userId,
			banned: false,
			locked: false,
			active: true,
			emailVerified: user.primaryEmailAddress?.verification?.status === "verified",
			timestamp: new Date().toISOString(),
		})

		return { valid: true }
	}

	/**
	 * Build verified user object with optional organization data
	 */
	private async buildVerifiedUser(user: User, options: VerificationOptions): Promise<VerifiedUser> {
		const verifiedUser: VerifiedUser = {
			id: user.id,
			email: user.primaryEmailAddress?.emailAddress,
			firstName: user.firstName,
			lastName: user.lastName,
			username: user.username,
			imageUrl: user.imageUrl,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
			lastActiveAt: user.lastActiveAt || undefined,
			banned: user.banned,
			locked: user.locked,
			verified: true,
		}

		// Include organization data if requested
		if (options.includeOrganizations) {
			try {
				const memberships = await this.client.users.getOrganizationMembershipList({
					userId: user.id,
				})
				verifiedUser.organizations = memberships.data.map((membership: OrganizationMembership) => ({
					id: membership.organization.id,
					name: membership.organization.name,
					role: membership.role,
				}))
			} catch (error) {
				console.warn(`[ClerkBackend] Failed to fetch organizations for ${user.id}:`, error)
				verifiedUser.organizations = []
			}
		}

		return verifiedUser
	}

	/**
	 * Handle Clerk API errors with specific error mapping
	 */
	private handleClerkError(error: any, userId: string, responseTime: number): UserVerificationResult {
		// Handle specific Clerk API errors
		if (error.status === 404) {
			return this.createErrorResult(
				UserVerificationErrorType.USER_NOT_FOUND,
				"User not found in Clerk database",
				userId,
			)
		}

		if (error.status === 429) {
			const retryAfter = parseInt(error.headers?.["retry-after"] || "60")
			return {
				valid: false,
				error: {
					type: UserVerificationErrorType.RATE_LIMITED,
					message: "Rate limited by Clerk API",
					userId,
					retryAfter,
					originalError: error,
				},
				responseTime,
			}
		}

		if (error.status >= 500) {
			return this.createErrorResult(
				UserVerificationErrorType.API_UNAVAILABLE,
				"Clerk API temporarily unavailable",
				userId,
				`Server error: ${error.status}`,
			)
		}

		if (error.name === "TimeoutError") {
			return this.createErrorResult(
				UserVerificationErrorType.NETWORK_ERROR,
				"Request timeout",
				userId,
				"Clerk API request timed out",
			)
		}

		// Generic error fallback
		return this.createErrorResult(
			UserVerificationErrorType.VERIFICATION_FAILED,
			`Clerk API error: ${error.message}`,
			userId,
			error.message,
		)
	}

	/**
	 * Create standardized error result
	 */
	private createErrorResult(
		type: UserVerificationErrorType,
		message: string,
		userId?: string,
		details?: string,
	): UserVerificationResult {
		return {
			valid: false,
			error: {
				type,
				message,
				userId,
				details,
			},
		}
	}

	/**
	 * Execute operation with timeout
	 */
	private async executeWithTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
		return Promise.race([
			operation(),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TimeoutError")), timeoutMs)),
		])
	}

	/**
	 * Get configuration for debugging
	 */
	getConfig(): ClerkBackendConfig {
		return { ...this.config, secretKey: "***REDACTED***" }
	}
}
