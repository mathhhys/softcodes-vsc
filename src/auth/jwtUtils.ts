/**
 * JWT Utility Functions
 *
 * Unified utilities for JWT token parsing and validation with proper base64url handling
 */

import { ClerkJWTPayload } from "./jwtTypes"

/**
 * Parsed JWT token components
 */
export interface JWTTokenParts {
	header: any
	payload: ClerkJWTPayload
	signature: string
	raw: {
		header: string
		payload: string
		signature: string
	}
}

/**
 * JWT parsing result
 */
export interface JWTParseResult {
	success: boolean
	parts?: JWTTokenParts
	error?: string
}

/**
 * Decode base64url string to UTF-8
 * Base64url uses '-' and '_' instead of '+' and '/', and omits padding
 */
export function base64urlDecode(base64url: string): string {
	console.log(
		`🔧 [JWT-UTILS-V2] base64urlDecode called - converting URL-safe chars: ${base64url.substring(0, 20)}...`,
	)
	try {
		// Replace URL-safe characters with standard base64 characters
		let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/")
		console.log(`✅ [JWT-UTILS-V2] Converted URL-safe chars: ${base64.substring(0, 20)}...`)

		// Add padding if needed
		const padding = "=".repeat((4 - (base64.length % 4)) % 4)
		base64 += padding
		console.log(`✅ [JWT-UTILS-V2] Added padding (${padding.length} chars), final length: ${base64.length}`)

		// Decode and convert to UTF-8
		const result = Buffer.from(base64, "base64").toString("utf8")
		console.log(`✅ [JWT-UTILS-V2] Successfully decoded to UTF-8, length: ${result.length}`)
		return result
	} catch (error) {
		console.error(`❌ [JWT-UTILS-V2] base64urlDecode failed:`, error)
		throw new Error(`Failed to decode base64url string: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * Encode UTF-8 string to base64url
 */
export function base64urlEncode(str: string): string {
	try {
		// Convert to base64
		let base64 = Buffer.from(str, "utf8").toString("base64")

		// Convert to base64url by replacing characters and removing padding
		return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
	} catch (error) {
		throw new Error(
			`Failed to encode string to base64url: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

/**
 * Check if a token has valid JWT format (three parts separated by dots)
 */
export function isValidJWTFormat(token: string): boolean {
	if (!token || typeof token !== "string") {
		return false
	}

	const parts = token.split(".")
	return parts.length === 3 && parts.every((part) => part.length > 0)
}

/**
 * Parse JWT token into its components without verification
 * This is unsafe for production use but useful for fallback scenarios
 */
export function parseJWTUnsafe(token: string): JWTParseResult {
	const startTime = Date.now()
	console.log(`[JWT-DEBUG] Starting parseJWTUnsafe() - Token input validation`)

	try {
		// Step 1: Token input validation
		console.log(`[JWT-DEBUG] Token length: ${token ? token.length : 0} characters`)

		if (!token || typeof token !== "string") {
			console.log(`❌ [JWT-DEBUG] Invalid token input: ${typeof token}, value: ${token}`)
			return {
				success: false,
				error: "Invalid token input: token must be a non-empty string",
			}
		}

		// Step 2: Format validation
		console.log(`[JWT-DEBUG] Validating JWT format (expecting 3 parts separated by dots)`)
		if (!isValidJWTFormat(token)) {
			const parts = token.split(".")
			console.log(`❌ [JWT-DEBUG] Invalid JWT format - found ${parts.length} parts, expected 3`)
			console.log(`[JWT-DEBUG] Parts lengths: [${parts.map((p) => p.length).join(", ")}]`)
			return {
				success: false,
				error: "Invalid JWT format: token must have exactly 3 parts separated by dots",
			}
		}

		const parts = token.split(".")
		const [headerPart, payloadPart, signaturePart] = parts
		console.log(
			`✅ [JWT-DEBUG] Valid JWT format - parts lengths: header=${headerPart.length}, payload=${payloadPart.length}, signature=${signaturePart.length}`,
		)

		// Step 3: Decode header
		console.log(`[JWT-DEBUG] Decoding JWT header...`)
		let header: any
		try {
			const headerJson = base64urlDecode(headerPart)
			console.log(`[JWT-DEBUG] Header base64url decoded, JSON length: ${headerJson.length}`)
			header = JSON.parse(headerJson)
			console.log(`✅ [JWT-DEBUG] Header JSON parsed successfully - keys: [${Object.keys(header).join(", ")}]`)
			console.log(`[JWT-DEBUG] Header algorithm: ${header.alg}, key ID: ${header.kid}`)
		} catch (error) {
			console.log(`❌ [JWT-DEBUG] Header decoding failed:`, error)
			return {
				success: false,
				error: `Failed to decode JWT header: ${error instanceof Error ? error.message : String(error)}`,
			}
		}

		// Step 4: Decode payload
		console.log(`[JWT-DEBUG] Decoding JWT payload...`)
		let payload: ClerkJWTPayload
		try {
			const payloadJson = base64urlDecode(payloadPart)
			console.log(`[JWT-DEBUG] Payload base64url decoded, JSON length: ${payloadJson.length}`)
			payload = JSON.parse(payloadJson)
			const claimCount = Object.keys(payload).length
			console.log(`✅ [JWT-DEBUG] Payload JSON parsed successfully - ${claimCount} claims found`)
			console.log(
				`[JWT-DEBUG] Key claims present: sub=${!!payload.sub}, email=${!!payload.email}, session_id=${!!payload.session_id}`,
			)
			console.log(`[JWT-DEBUG] Expiration: ${payload.exp ? new Date(payload.exp * 1000).toISOString() : "none"}`)
		} catch (error) {
			console.log(`❌ [JWT-DEBUG] Payload decoding failed:`, error)
			return {
				success: false,
				error: `Failed to decode JWT payload: ${error instanceof Error ? error.message : String(error)}`,
			}
		}

		const processingTime = Date.now() - startTime
		console.log(`✅ [JWT-DEBUG] parseJWTUnsafe completed successfully in ${processingTime}ms`)

		return {
			success: true,
			parts: {
				header,
				payload,
				signature: signaturePart,
				raw: {
					header: headerPart,
					payload: payloadPart,
					signature: signaturePart,
				},
			},
		}
	} catch (error) {
		const processingTime = Date.now() - startTime
		console.log(`❌ [JWT-DEBUG] parseJWTUnsafe failed after ${processingTime}ms:`, error)
		return {
			success: false,
			error: `JWT parsing failed: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

/**
 * Extract user information from JWT payload
 */
export function extractUserInfoFromPayload(payload: ClerkJWTPayload): {
	email: string
	userId: string
	sessionId: string
	organizationId?: string
	firstName?: string
	lastName?: string
	fullName?: string
	username?: string
	imageUrl?: string
	phoneNumber?: string
	emailVerified?: boolean
	phoneVerified?: boolean
	organizationSlug?: string
	organizationRole?: string
	organizationPermissions?: string[]
	subscriptionStatus?: string
	subscriptionTier?: string
} {
	const startTime = Date.now()
	console.log(`[CLAIMS-DEBUG] Starting extractUserInfoFromPayload() - User info extraction`)

	// Step 1: Validate required claims presence
	console.log(`[CLAIMS-DEBUG] Validating required user claims...`)
	const hasUserId = !!payload.sub
	const hasEmail = !!payload.email
	const hasSessionId = !!payload.session_id

	console.log(
		`[CLAIMS-DEBUG] Required claims check: userId=${hasUserId}, email=${hasEmail}, sessionId=${hasSessionId}`,
	)

	if (!hasUserId) {
		console.log(`⚠️ [CLAIMS-DEBUG] Missing critical claim: sub (user ID) - will use fallback`)
	} else {
		// Validate user ID format (should be a reasonable string)
		const userIdLength = payload.sub.length
		const isValidFormat = userIdLength > 5 && userIdLength < 100
		console.log(`[CLAIMS-DEBUG] User ID validation: length=${userIdLength}, validFormat=${isValidFormat}`)
	}

	if (!hasEmail) {
		console.log(`⚠️ [CLAIMS-DEBUG] Missing critical claim: email - will use fallback`)
	} else {
		console.log(`[CLAIMS-DEBUG] Email domain: ${payload.email.split("@")[1] || "unknown"}`)
	}

	if (!hasSessionId) {
		console.log(`⚠️ [CLAIMS-DEBUG] Missing critical claim: session_id - will use fallback`)
	}

	// Step 2: Extract personal information
	console.log(`[CLAIMS-DEBUG] Extracting personal information...`)
	const personalInfo = {
		firstName: payload.first_name,
		lastName: payload.last_name,
		fullName: payload.full_name,
		username: payload.username,
		imageUrl: payload.image_url,
		phoneNumber: payload.phone_number,
	}

	const personalInfoCount = Object.values(personalInfo).filter((v) => v != null).length
	console.log(`[CLAIMS-DEBUG] Personal info fields available: ${personalInfoCount}/6`)
	console.log(
		`[CLAIMS-DEBUG] Name info: firstName=${!!personalInfo.firstName}, lastName=${!!personalInfo.lastName}, fullName=${!!personalInfo.fullName}`,
	)

	// Step 3: Extract verification status
	console.log(`[CLAIMS-DEBUG] Extracting verification status...`)
	const emailVerified = payload.email_verified
	const phoneVerified = payload.phone_verified
	console.log(`[CLAIMS-DEBUG] Verification status: email=${emailVerified}, phone=${phoneVerified}`)

	// Step 4: Extract organization information
	console.log(`[CLAIMS-DEBUG] Extracting organization information...`)
	const orgInfo = {
		organizationId: payload.org_id,
		organizationSlug: payload.org_slug,
		organizationRole: payload.org_role,
		organizationPermissions: payload.org_permissions,
	}

	const hasOrgInfo = !!orgInfo.organizationId
	const orgPermissionsCount = Array.isArray(orgInfo.organizationPermissions)
		? orgInfo.organizationPermissions.length
		: 0
	console.log(
		`[CLAIMS-DEBUG] Organization: hasInfo=${hasOrgInfo}, role=${orgInfo.organizationRole || "none"}, permissions=${orgPermissionsCount}`,
	)

	// Step 5: Extract subscription information
	console.log(`[CLAIMS-DEBUG] Extracting subscription information...`)
	const subscriptionStatus = payload.subscription_status
	const subscriptionTier = payload.subscription_tier
	console.log(
		`[CLAIMS-DEBUG] Subscription: status=${subscriptionStatus || "none"}, tier=${subscriptionTier || "none"}`,
	)

	// Step 6: Compile final user info
	const userInfo = {
		email: payload.email || "unknown@example.com",
		userId: payload.sub || "unknown-user",
		sessionId: payload.session_id || "unknown-session",
		organizationId: payload.org_id,
		firstName: payload.first_name,
		lastName: payload.last_name,
		fullName: payload.full_name,
		username: payload.username,
		imageUrl: payload.image_url,
		phoneNumber: payload.phone_number,
		emailVerified: payload.email_verified,
		phoneVerified: payload.phone_verified,
		organizationSlug: payload.org_slug,
		organizationRole: payload.org_role,
		organizationPermissions: payload.org_permissions,
		subscriptionStatus: payload.subscription_status,
		subscriptionTier: payload.subscription_tier,
	}

	// Step 7: Final validation and summary
	const totalClaims = Object.keys(payload).length
	const extractedFields = Object.values(userInfo).filter((v) => v != null).length
	const processingTime = Date.now() - startTime

	console.log(`✅ [CLAIMS-DEBUG] User info extraction completed in ${processingTime}ms`)
	console.log(`[CLAIMS-DEBUG] Summary: ${extractedFields} fields extracted from ${totalClaims} total claims`)
	console.log(`[CLAIMS-DEBUG] Final user: ${userInfo.userId} (${userInfo.email})`)

	return userInfo
}

/**
 * Validate JWT timing claims (exp, iat, nbf)
 */
export function validateJWTTimingClaims(
	payload: ClerkJWTPayload,
	clockTolerance: number = 60,
): {
	valid: boolean
	error?: string
	warnings?: string[]
} {
	const now = Math.floor(Date.now() / 1000)
	const warnings: string[] = []

	// Check expiration
	if (payload.exp) {
		if (now > payload.exp + clockTolerance) {
			return {
				valid: false,
				error: `Token expired at ${new Date(payload.exp * 1000).toISOString()}`,
			}
		}

		// Warn if token expires soon (within 5 minutes)
		if (now > payload.exp - 300) {
			warnings.push(`Token expires soon at ${new Date(payload.exp * 1000).toISOString()}`)
		}
	}

	// Check not before
	if (payload.nbf && now < payload.nbf - clockTolerance) {
		return {
			valid: false,
			error: `Token not active until ${new Date(payload.nbf * 1000).toISOString()}`,
		}
	}

	// Check issued at (warn if token is very old)
	if (payload.iat) {
		const ageInHours = (now - payload.iat) / 3600
		if (ageInHours > 24) {
			warnings.push(`Token is ${Math.round(ageInHours)} hours old`)
		}
	}

	return {
		valid: true,
		warnings: warnings.length > 0 ? warnings : undefined,
	}
}

/**
 * Validate required JWT claims for vscode-session template
 * Only sub (user ID) is required, email and session_id are optional
 */
export function validateRequiredClaims(payload: ClerkJWTPayload): {
	valid: boolean
	missingClaims?: string[]
	error?: string
} {
	const requiredClaims = ["sub"] // Only user ID is required for vscode-session template
	const missingClaims: string[] = []

	for (const claim of requiredClaims) {
		if (!payload[claim as keyof ClerkJWTPayload]) {
			missingClaims.push(claim)
		}
	}

	if (missingClaims.length > 0) {
		return {
			valid: false,
			missingClaims,
			error: `Missing required claims: ${missingClaims.join(", ")}`,
		}
	}

	return { valid: true }
}

/**
 * Get token expiration info
 */
export function getTokenExpirationInfo(payload: ClerkJWTPayload): {
	expires?: Date
	expiresIn?: number // seconds
	isExpired: boolean
	isNearExpiration: boolean // within 5 minutes
} {
	if (!payload.exp) {
		return {
			isExpired: false,
			isNearExpiration: false,
		}
	}

	const now = Math.floor(Date.now() / 1000)
	const expires = new Date(payload.exp * 1000)
	const expiresIn = payload.exp - now

	return {
		expires,
		expiresIn,
		isExpired: expiresIn <= 0,
		isNearExpiration: expiresIn <= 300 && expiresIn > 0, // 5 minutes
	}
}

/**
 * Create a comprehensive JWT analysis for debugging
 */
export function analyzeJWT(token: string): {
	format: {
		valid: boolean
		parts: number
		error?: string
	}
	parsing: JWTParseResult
	claims?: {
		timing: ReturnType<typeof validateJWTTimingClaims>
		required: ReturnType<typeof validateRequiredClaims>
		expiration: ReturnType<typeof getTokenExpirationInfo>
	}
	userInfo?: ReturnType<typeof extractUserInfoFromPayload>
} {
	const formatCheck = {
		valid: isValidJWTFormat(token),
		parts: token ? token.split(".").length : 0,
		error: isValidJWTFormat(token) ? undefined : "Invalid JWT format",
	}

	const parsing = parseJWTUnsafe(token)

	let claims, userInfo
	if (parsing.success && parsing.parts) {
		claims = {
			timing: validateJWTTimingClaims(parsing.parts.payload),
			required: validateRequiredClaims(parsing.parts.payload),
			expiration: getTokenExpirationInfo(parsing.parts.payload),
		}

		try {
			userInfo = extractUserInfoFromPayload(parsing.parts.payload)
		} catch (error) {
			// userInfo will remain undefined if extraction fails
		}
	}

	return {
		format: formatCheck,
		parsing,
		claims,
		userInfo,
	}
}
