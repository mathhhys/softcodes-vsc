/**
 * JWT Verification Service
 *
 * Main service for verifying and processing JWT tokens from Clerk
 * Provides secure JWT validation with comprehensive error handling
 */

import * as vscode from "vscode"
import { ClerkJWKSClient } from "./clerkJWKSClient"
import { JWT_CONFIG, JWT_ERRORS } from "./config"
import {
	ClerkJWTPayload,
	UserInfoFromJWT,
	JWTVerificationResult,
	JWTVerificationError,
	JWTErrorType,
	JWTTokenComponents,
	JWTVerificationOptions,
	JWTVerificationContext,
} from "./jwtTypes"
import { base64urlDecode, isValidJWTFormat, validateJWTTimingClaims, validateRequiredClaims } from "./jwtUtils"

// Verification marker for JWT utilities
console.log("🔧 [JWT-VERIFICATION] Loaded with NEW base64urlDecode from jwtUtils.ts")

/**
 * JWT Verification Service for Clerk tokens
 */
export class JWTVerificationService {
	private static instance: JWTVerificationService
	private jwksClient: ClerkJWKSClient

	private constructor() {
		this.jwksClient = ClerkJWKSClient.getInstance()
	}

	/**
	 * Get singleton instance
	 */
	static getInstance(): JWTVerificationService {
		if (!JWTVerificationService.instance) {
			JWTVerificationService.instance = new JWTVerificationService()
		}
		return JWTVerificationService.instance
	}

	/**
	 * Verify and extract data from JWT token
	 */
	async verifyJWT(token: string, options: JWTVerificationOptions = {}): Promise<JWTVerificationResult> {
		const verificationStartTime = Date.now()
		console.log(`[JWT-DEBUG] ============ Starting JWT verification ============`)
		console.log(`[JWT-DEBUG] Token length: ${token ? token.length : 0} characters`)

		const context: JWTVerificationContext = {
			token,
			options: this.mergeDefaultOptions(options),
			startTime: Date.now(),
		}

		console.log(
			`[JWT-DEBUG] Verification options: signature=${context.options.verifySignature}, expiration=${context.options.verifyExpiration}, audience=${context.options.verifyAudience}`,
		)
		console.log(
			`[JWT-DEBUG] Expected issuer: ${context.options.expectedIssuer}, audience: ${context.options.expectedAudience}`,
		)

		try {
			// Step 1: Basic token format validation
			console.log(`[JWT-DEBUG] Step 1/5: Parsing JWT components...`)
			const parseStartTime = Date.now()
			const components = this.parseJWTComponents(token)
			const parseTime = Date.now() - parseStartTime
			console.log(`✅ [JWT-DEBUG] JWT parsing completed in ${parseTime}ms`)

			// Step 2: Verify signature if required
			console.log(
				`[JWT-DEBUG] Step 2/5: ${context.options.verifySignature !== false ? "Verifying signature" : "Skipping signature verification"}...`,
			)
			let payload: ClerkJWTPayload

			if (context.options.verifySignature !== false) {
				const signatureStartTime = Date.now()
				payload = await this.verifySignatureAndExtractPayload(token, context.options)
				const signatureTime = Date.now() - signatureStartTime
				console.log(`✅ [JWT-DEBUG] Signature verification completed in ${signatureTime}ms`)
			} else {
				// Skip signature verification (not recommended for production)
				console.log(`⚠️ [JWT-DEBUG] Signature verification skipped - UNSAFE for production!`)
				payload = this.decodePayloadUnsafe(components)
			}

			// Step 3: Validate claims
			console.log(`[JWT-DEBUG] Step 3/5: Validating JWT claims...`)
			const claimsStartTime = Date.now()
			this.validateClaims(payload, context.options)
			const claimsTime = Date.now() - claimsStartTime
			console.log(`✅ [JWT-DEBUG] Claims validation completed in ${claimsTime}ms`)

			// Step 4: Extract user information
			console.log(`[JWT-DEBUG] Step 4/5: Extracting user information...`)
			const userInfoStartTime = Date.now()
			const userInfo = this.extractUserInfo(payload)
			const userInfoTime = Date.now() - userInfoStartTime
			console.log(`✅ [JWT-DEBUG] User info extraction completed in ${userInfoTime}ms`)
			console.log(`[JWT-DEBUG] Extracted user: ${userInfo.userId} (${userInfo.email})`)

			// Step 5: Check token expiration status
			console.log(`[JWT-DEBUG] Step 5/5: Checking token expiration status...`)
			this.checkTokenExpiration(payload)

			const totalVerificationTime = Date.now() - verificationStartTime
			console.log(
				`✅ [JWT-DEBUG] ========== JWT verification SUCCESSFUL in ${totalVerificationTime}ms ==========`,
			)

			return {
				valid: true,
				payload,
				userInfo,
			}
		} catch (error) {
			const totalVerificationTime = Date.now() - verificationStartTime
			console.log(`❌ [JWT-DEBUG] JWT verification FAILED after ${totalVerificationTime}ms:`, error)

			if (this.isJWTVerificationError(error)) {
				const jwtError = error as JWTVerificationError
				console.log(`[JWT-DEBUG] Error type: ${jwtError.type}, message: ${jwtError.message}`)
				if (jwtError.details) {
					console.log(`[JWT-DEBUG] Error details: ${jwtError.details}`)
				}
				return {
					valid: false,
					error: jwtError,
				}
			}

			console.log(`[JWT-DEBUG] Unexpected error during verification:`, error)
			return {
				valid: false,
				error: {
					type: JWTErrorType.VERIFICATION_FAILED,
					message: "JWT verification failed",
					details: error instanceof Error ? error.message : String(error),
					originalError: error instanceof Error ? error : undefined,
				},
			}
		}
	}

	/**
	 * Verify JWT signature and extract payload
	 */
	private async verifySignatureAndExtractPayload(
		token: string,
		options: JWTVerificationOptions,
	): Promise<ClerkJWTPayload> {
		try {
			const payload = await this.jwksClient.verifyJWTSignature(token, {
				issuer: options.expectedIssuer || JWT_CONFIG.ISSUER,
				audience: options.expectedAudience || JWT_CONFIG.AUDIENCE,
				clockTolerance: options.clockTolerance || JWT_CONFIG.CLOCK_TOLERANCE,
			})

			return payload as ClerkJWTPayload
		} catch (error) {
			if (this.isJWTVerificationError(error)) {
				throw error
			}

			throw this.createVerificationError(
				JWTErrorType.VERIFICATION_FAILED,
				"Failed to verify JWT signature",
				error instanceof Error ? error.message : String(error),
				error instanceof Error ? error : undefined,
			)
		}
	}

	/**
	 * Parse JWT into its components (unsafe - no verification)
	 */
	private parseJWTComponents(token: string): JWTTokenComponents {
		const parseStartTime = Date.now()
		console.log(`[JWT-DEBUG] Starting parseJWTComponents() for token parsing`)

		try {
			// Step 1: Format validation
			console.log(`[JWT-DEBUG] Validating JWT format...`)
			if (!isValidJWTFormat(token)) {
				const parts = token.split(".")
				console.log(`❌ [JWT-DEBUG] Invalid JWT format: found ${parts.length} parts, expected 3`)
				console.log(`[JWT-DEBUG] Parts lengths: [${parts.map((p) => p.length).join(", ")}]`)
				throw this.createVerificationError(
					JWTErrorType.MALFORMED_TOKEN,
					"JWT must have exactly 3 parts separated by dots",
					`Invalid JWT format: ${parts.length} parts found`,
				)
			}

			const parts = token.split(".")
			const [headerPart, payloadPart, signaturePart] = parts
			console.log(
				`✅ [JWT-DEBUG] Valid JWT format confirmed - parts lengths: header=${headerPart.length}, payload=${payloadPart.length}, signature=${signaturePart.length}`,
			)

			// Step 2: Decode header
			console.log(`[JWT-DEBUG] Decoding JWT header using base64urlDecode...`)
			let header: any
			try {
				const headerDecodeStart = Date.now()
				const headerJson = base64urlDecode(headerPart)
				const headerDecodeTime = Date.now() - headerDecodeStart
				console.log(
					`[JWT-DEBUG] Header base64url decoded in ${headerDecodeTime}ms, JSON length: ${headerJson.length}`,
				)

				header = JSON.parse(headerJson)
				console.log(
					`✅ [JWT-DEBUG] Header JSON parsed - algorithm: ${header.alg}, keyId: ${header.kid}, type: ${header.typ}`,
				)
				console.log(`[JWT-DEBUG] Header keys: [${Object.keys(header).join(", ")}]`)
			} catch (error) {
				console.log(`❌ [JWT-DEBUG] Header decoding failed:`, error)
				throw this.createVerificationError(
					JWTErrorType.MALFORMED_TOKEN,
					"Failed to decode JWT header",
					error instanceof Error ? error.message : String(error),
					error instanceof Error ? error : undefined,
				)
			}

			// Step 3: Decode payload
			console.log(`[JWT-DEBUG] Decoding JWT payload using base64urlDecode...`)
			let payload: any
			try {
				const payloadDecodeStart = Date.now()
				const payloadJson = base64urlDecode(payloadPart)
				const payloadDecodeTime = Date.now() - payloadDecodeStart
				console.log(
					`[JWT-DEBUG] Payload base64url decoded in ${payloadDecodeTime}ms, JSON length: ${payloadJson.length}`,
				)

				payload = JSON.parse(payloadJson)
				const claimCount = Object.keys(payload).length
				console.log(`✅ [JWT-DEBUG] Payload JSON parsed - ${claimCount} claims found`)
				console.log(
					`[JWT-DEBUG] Key claims: sub=${!!payload.sub}, email=${!!payload.email}, exp=${!!payload.exp}, iss=${payload.iss}`,
				)

				if (payload.exp) {
					const expiresAt = new Date(payload.exp * 1000)
					const expiresIn = payload.exp - Math.floor(Date.now() / 1000)
					console.log(`[JWT-DEBUG] Token expires: ${expiresAt.toISOString()} (in ${expiresIn}s)`)
				}
			} catch (error) {
				console.log(`❌ [JWT-DEBUG] Payload decoding failed:`, error)
				throw this.createVerificationError(
					JWTErrorType.MALFORMED_TOKEN,
					"Failed to decode JWT payload",
					error instanceof Error ? error.message : String(error),
					error instanceof Error ? error : undefined,
				)
			}

			const totalParseTime = Date.now() - parseStartTime
			console.log(`✅ [JWT-DEBUG] parseJWTComponents completed successfully in ${totalParseTime}ms`)

			return {
				header,
				payload,
				signature: signaturePart,
				raw: {
					header: headerPart,
					payload: payloadPart,
					signature: signaturePart,
				},
			}
		} catch (error) {
			const totalParseTime = Date.now() - parseStartTime
			console.log(`❌ [JWT-DEBUG] parseJWTComponents failed after ${totalParseTime}ms:`, error)

			if (this.isJWTVerificationError(error)) {
				throw error
			}

			throw this.createVerificationError(
				JWTErrorType.MALFORMED_TOKEN,
				"Failed to parse JWT token",
				error instanceof Error ? error.message : String(error),
				error instanceof Error ? error : undefined,
			)
		}
	}

	/**
	 * Decode payload without signature verification (unsafe)
	 */
	private decodePayloadUnsafe(components: JWTTokenComponents): ClerkJWTPayload {
		return components.payload as ClerkJWTPayload
	}

	/**
	 * Validate JWT claims
	 */
	private validateClaims(payload: ClerkJWTPayload, options: JWTVerificationOptions): void {
		const clockTolerance = options.clockTolerance || JWT_CONFIG.CLOCK_TOLERANCE

		// Use unified timing validation
		if (options.verifyExpiration !== false || options.verifyNotBefore !== false) {
			const timingResult = validateJWTTimingClaims(payload, clockTolerance)
			if (!timingResult.valid) {
				const errorType = timingResult.error?.includes("expired")
					? JWTErrorType.TOKEN_EXPIRED
					: JWTErrorType.TOKEN_NOT_ACTIVE
				throw this.createVerificationError(errorType, timingResult.error || "Timing validation failed")
			}
		}

		// Validate issuer
		if (options.verifyIssuer !== false && options.expectedIssuer) {
			if (payload.iss !== options.expectedIssuer) {
				throw this.createVerificationError(
					JWTErrorType.INVALID_ISSUER,
					"JWT issuer is invalid",
					`Expected issuer: ${options.expectedIssuer}, actual issuer: ${payload.iss}`,
				)
			}
		}

		// Validate audience
		if (options.verifyAudience !== false && options.expectedAudience) {
			const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
			const expectedAudiences = Array.isArray(options.expectedAudience)
				? options.expectedAudience
				: [options.expectedAudience]

			const hasValidAudience = expectedAudiences.some((expected) => audiences.includes(expected))

			if (!hasValidAudience) {
				throw this.createVerificationError(
					JWTErrorType.INVALID_AUDIENCE,
					"JWT audience is invalid",
					`Expected audience: ${expectedAudiences.join(", ")}, actual audience: ${audiences.join(", ")}`,
				)
			}
		}

		// Use unified required claims validation
		const claimsResult = validateRequiredClaims(payload)
		if (!claimsResult.valid) {
			throw this.createVerificationError(
				JWTErrorType.MISSING_CLAIMS,
				claimsResult.error || "Required claims validation failed",
				claimsResult.missingClaims?.join(", "),
			)
		}
	}

	/**
	 * Extract user information from verified JWT payload
	 */
	private extractUserInfo(payload: ClerkJWTPayload): UserInfoFromJWT {
		return {
			userId: payload.sub,
			email: payload.email,
			firstName: payload.first_name,
			lastName: payload.last_name,
			fullName: payload.full_name,
			username: payload.username,
			imageUrl: payload.image_url,
			phoneNumber: payload.phone_number,
			emailVerified: payload.email_verified,
			phoneVerified: payload.phone_verified,
			organizationId: payload.org_id,
			organizationSlug: payload.org_slug,
			organizationRole: payload.org_role,
			organizationPermissions: payload.org_permissions,
			sessionId: payload.session_id,
			subscriptionStatus: payload.subscription_status,
			subscriptionTier: payload.subscription_tier,
		}
	}

	/**
	 * Check if token is near expiration
	 */
	isTokenNearExpiration(payload: ClerkJWTPayload): boolean {
		if (!payload.exp) {
			return false
		}

		const now = Math.floor(Date.now() / 1000)
		const expiresIn = payload.exp - now

		return expiresIn <= JWT_CONFIG.TOKEN_REFRESH_THRESHOLD
	}

	/**
	 * Check token expiration and log warnings
	 */
	private checkTokenExpiration(payload: ClerkJWTPayload): void {
		if (this.isTokenNearExpiration(payload)) {
			const expiresAt = new Date(payload.exp * 1000)
			console.warn(`JWT token expires soon at ${expiresAt.toISOString()}`)
		}
	}

	/**
	 * Validate token without signature verification (for fallback scenarios)
	 */
	async validateTokenStructure(
		token: string,
	): Promise<{ valid: boolean; payload?: ClerkJWTPayload; error?: string }> {
		try {
			const components = this.parseJWTComponents(token)
			const payload = this.decodePayloadUnsafe(components)

			// Basic validation without signature
			this.validateClaims(payload, {
				verifySignature: false,
				verifyExpiration: true,
				verifyNotBefore: true,
			})

			return { valid: true, payload }
		} catch (error) {
			return {
				valid: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Merge default options with provided options
	 */
	private mergeDefaultOptions(options: JWTVerificationOptions): JWTVerificationOptions {
		return {
			verifySignature: true,
			verifyExpiration: true,
			verifyNotBefore: true,
			verifyIssuer: true,
			verifyAudience: true,
			clockTolerance: JWT_CONFIG.CLOCK_TOLERANCE,
			expectedIssuer: JWT_CONFIG.ISSUER,
			expectedAudience: JWT_CONFIG.AUDIENCE,
			...options,
		}
	}

	/**
	 * Create standardized verification error
	 */
	private createVerificationError(
		type: JWTErrorType,
		message: string,
		details?: string,
		originalError?: Error,
	): JWTVerificationError {
		return {
			type,
			message,
			details,
			originalError,
		}
	}

	/**
	 * Check if error is a JWT verification error
	 */
	private isJWTVerificationError(error: any): boolean {
		return error && typeof error === "object" && "type" in error && "message" in error
	}

	/**
	 * Preload JWKS for faster verification
	 */
	async warmupCache(): Promise<void> {
		try {
			await this.jwksClient.preloadJWKS()
		} catch (error) {
			console.warn("Failed to warmup JWT verification cache:", error)
		}
	}

	/**
	 * Clear verification cache
	 */
	clearCache(): void {
		this.jwksClient.clearCache()
	}
}

/**
 * Convenience function to get JWT verification service instance
 */
export function getJWTVerificationService(): JWTVerificationService {
	return JWTVerificationService.getInstance()
}

/**
 * Quick JWT verification function
 */
export async function verifyClerkJWT(token: string): Promise<JWTVerificationResult> {
	const service = JWTVerificationService.getInstance()
	return await service.verifyJWT(token)
}

/**
 * Quick user info extraction from JWT
 */
export async function extractUserFromJWT(token: string): Promise<UserInfoFromJWT | null> {
	try {
		const result = await verifyClerkJWT(token)
		return result.valid ? result.userInfo || null : null
	} catch (error) {
		console.error("Failed to extract user from JWT:", error)
		return null
	}
}
