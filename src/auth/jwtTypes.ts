/**
 * JWT Types for Clerk Authentication
 *
 * This file contains TypeScript definitions for JWT tokens used in Clerk authentication
 */

/**
 * Standard JWT Claims (base interface)
 */
export interface StandardJWTClaims {
	/** Issuer - identifies the principal that issued the JWT */
	iss: string

	/** Subject - identifies the principal that is the subject of the JWT */
	sub: string

	/** Expiration Time - timestamp after which the JWT must not be accepted */
	exp: number

	/** Issued At - timestamp when the JWT was issued */
	iat: number

	/** Not Before - timestamp before which the JWT must not be accepted */
	nbf?: number

	/** JWT ID - unique identifier for the JWT */
	jti?: string
}

/**
 * Clerk-specific JWT Payload
 * For vscode-session template - audience claim is optional
 */
export interface ClerkJWTPayload extends StandardJWTClaims {
	/** Audience - optional for vscode-session template */
	aud?: string | string[]
	// User identification
	email: string
	email_verified: boolean
	first_name?: string
	last_name?: string
	full_name?: string
	name?: string
	username?: string
	image_url?: string
	picture?: string
	avatar_url?: string

	// Phone information
	phone_number?: string
	phone_verified?: boolean

	// Organization data
	org_id?: string
	org_slug?: string
	org_role?: string
	org_permissions?: string[]

	// Session data
	session_id: string

	// Authentication metadata
	azp?: string // Authorized party
	scope?: string

	// Custom Softcodes claims
	softcodes_user_id?: string
	subscription_status?: string
	subscription_tier?: string
	usage_limits?: {
		requests_per_month?: number
		tokens_per_request?: number
	}
}

/**
 * Extracted User Information from JWT
 */
export interface UserInfoFromJWT {
	userId: string
	email: string
	firstName?: string
	lastName?: string
	fullName?: string
	username?: string
	imageUrl?: string
	phoneNumber?: string
	emailVerified: boolean
	phoneVerified?: boolean
	organizationId?: string
	organizationSlug?: string
	organizationRole?: string
	organizationPermissions?: string[]
	sessionId: string
	subscriptionStatus?: string
	subscriptionTier?: string
}

/**
 * JWT Verification Result
 */
export interface JWTVerificationResult {
	/** Whether the JWT is valid */
	valid: boolean

	/** Decoded JWT payload if valid */
	payload?: ClerkJWTPayload

	/** Extracted user information if valid */
	userInfo?: UserInfoFromJWT

	/** Error information if invalid */
	error?: JWTVerificationError
}

/**
 * JWT Verification Error
 */
export interface JWTVerificationError {
	/** Error type */
	type: JWTErrorType

	/** Human-readable error message */
	message: string

	/** Technical details for debugging */
	details?: string

	/** Original error if available */
	originalError?: Error
}

/**
 * JWT Error Types
 */
export enum JWTErrorType {
	INVALID_SIGNATURE = "INVALID_SIGNATURE",
	TOKEN_EXPIRED = "TOKEN_EXPIRED",
	TOKEN_NOT_ACTIVE = "TOKEN_NOT_ACTIVE",
	INVALID_ISSUER = "INVALID_ISSUER",
	INVALID_AUDIENCE = "INVALID_AUDIENCE",
	MISSING_CLAIMS = "MISSING_CLAIMS",
	MALFORMED_TOKEN = "MALFORMED_TOKEN",
	JWKS_FETCH_ERROR = "JWKS_FETCH_ERROR",
	VERIFICATION_FAILED = "VERIFICATION_FAILED",
	NETWORK_ERROR = "NETWORK_ERROR",
}

/**
 * JWKS (JSON Web Key Set) Response
 */
export interface JWKSResponse {
	keys: JWK[]
}

/**
 * JSON Web Key
 */
export interface JWK {
	/** Key ID */
	kid: string

	/** Key Type (should be 'RSA' for Clerk) */
	kty: string

	/** Algorithm (should be 'RS256' for Clerk) */
	alg: string

	/** Usage (should be 'sig' for signature) */
	use: string

	/** Modulus (for RSA keys) */
	n: string

	/** Exponent (for RSA keys) */
	e: string

	/** X.509 Certificate Chain */
	x5c?: string[]

	/** X.509 Certificate SHA-1 Thumbprint */
	x5t?: string

	/** X.509 Certificate SHA-256 Thumbprint */
	"x5t#S256"?: string
}

/**
 * JWT Header
 */
export interface JWTHeader {
	/** Algorithm */
	alg: string

	/** Type */
	typ: string

	/** Key ID */
	kid?: string
}

/**
 * JWT Token Components
 */
export interface JWTTokenComponents {
	header: JWTHeader
	payload: ClerkJWTPayload
	signature: string
	raw: {
		header: string
		payload: string
		signature: string
	}
}

/**
 * JWT Verification Options
 */
export interface JWTVerificationOptions {
	/** Whether to verify the signature */
	verifySignature?: boolean

	/** Whether to verify expiration */
	verifyExpiration?: boolean

	/** Whether to verify not before */
	verifyNotBefore?: boolean

	/** Whether to verify issuer */
	verifyIssuer?: boolean

	/** Whether to verify audience */
	verifyAudience?: boolean

	/** Clock tolerance in seconds */
	clockTolerance?: number

	/** Expected issuer */
	expectedIssuer?: string

	/** Expected audience */
	expectedAudience?: string | string[]
}

/**
 * Cache Entry for JWKS Keys
 */
export interface JWKSCacheEntry {
	keys: Map<string, JWK>
	expiresAt: number
}

/**
 * JWT Verification Context
 */
export interface JWTVerificationContext {
	/** Original token string */
	token: string

	/** Verification options */
	options: JWTVerificationOptions

	/** Timestamp when verification started */
	startTime: number

	/** Whether this is a retry attempt */
	isRetry?: boolean
}
