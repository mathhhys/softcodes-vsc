/**
 * Clerk JWKS Client
 *
 * Handles fetching and caching JSON Web Key Sets (JWKS) from Clerk
 * for JWT signature verification
 */

import * as crypto from "crypto"
import { JWT_CONFIG } from "./config"
import { JWKSResponse, JWK, JWKSCacheEntry, JWTErrorType, JWTVerificationError } from "./jwtTypes"
import { base64urlDecode, isValidJWTFormat } from "./jwtUtils"

// Simple JWT verification without external dependencies
interface JWTComponents {
	header: any
	payload: any
	signature: string
}

/**
 * Clerk JWKS Client for managing public keys
 */
export class ClerkJWKSClient {
	private static instance: ClerkJWKSClient
	private keyCache = new Map<string, JWKSCacheEntry>()

	private constructor() {
		// Initialize empty - we'll fetch keys on demand
	}

	/**
	 * Get singleton instance
	 */
	static getInstance(): ClerkJWKSClient {
		if (!ClerkJWKSClient.instance) {
			ClerkJWKSClient.instance = new ClerkJWKSClient()
		}
		return ClerkJWKSClient.instance
	}

	/**
	 * Get signing key for JWT verification
	 */
	async getSigningKey(kid: string): Promise<string> {
		console.log(`[JWKS-DEBUG] Getting signing key for kid: ${kid}`)
		const signingKeyStartTime = Date.now()

		try {
			const key = await this.getKey(kid)

			console.log(`[JWKS-DEBUG] Converting JWK to PEM format...`)
			const pemConversionStartTime = Date.now()
			const pemKey = this.jwkToPem(key)
			const pemConversionTime = Date.now() - pemConversionStartTime

			const totalSigningKeyTime = Date.now() - signingKeyStartTime
			console.log(
				`✅ [JWKS-DEBUG] Signing key conversion completed in ${pemConversionTime}ms (total: ${totalSigningKeyTime}ms)`,
			)
			console.log(
				`[JWKS-DEBUG] PEM key type: ${pemKey.includes("CERTIFICATE") ? "Certificate" : "RSA Public Key"}`,
			)

			return pemKey
		} catch (error) {
			const totalSigningKeyTime = Date.now() - signingKeyStartTime
			console.log(`❌ [JWKS-DEBUG] Failed to get signing key after ${totalSigningKeyTime}ms:`, error)
			throw this.createJWKSError(
				JWTErrorType.JWKS_FETCH_ERROR,
				`Failed to fetch signing key for kid: ${kid}`,
				error instanceof Error ? error.message : String(error),
				error instanceof Error ? error : undefined,
			)
		}
	}

	/**
	 * Convert JWK to PEM format for use with jsonwebtoken
	 */
	private jwkToPem(jwk: JWK): string {
		if (jwk.kty !== "RSA") {
			throw new Error(`Unsupported key type: ${jwk.kty}`)
		}

		// Use x5c certificate chain if available (most reliable)
		if (jwk.x5c && jwk.x5c.length > 0) {
			const cert = jwk.x5c[0]
			return `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`
		}

		// Fallback: construct RSA public key from n and e components
		return this.constructRSAPublicKey(jwk)
	}

	/**
	 * Construct RSA public key PEM from modulus and exponent
	 */
	private constructRSAPublicKey(jwk: JWK): string {
		try {
			// Convert base64url to base64
			const n = this.base64urlToBase64(jwk.n)
			const e = this.base64urlToBase64(jwk.e)

			// Create a simple JSON Web Key object that Node.js crypto can understand
			const nodeJwk = {
				kty: jwk.kty,
				n: n,
				e: e,
				alg: jwk.alg,
				use: jwk.use,
			}

			// Use Node.js crypto to create public key
			const publicKey = crypto.createPublicKey({
				key: nodeJwk as any, // Type assertion to avoid complex type issues
				format: "jwk",
			})

			return publicKey.export({
				type: "spki",
				format: "pem",
			}) as string
		} catch (error) {
			throw new Error(
				`Failed to construct RSA public key: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * Convert base64url to base64
	 */
	private base64urlToBase64(base64url: string): string {
		let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/")
		while (base64.length % 4) {
			base64 += "="
		}
		return base64
	}

	/**
	 * Fetch and cache JWKS from Clerk with timeout
	 */
	async fetchJWKS(): Promise<JWK[]> {
		const fetchStartTime = Date.now()
		console.log(`[JWKS-DEBUG] ============ Starting JWKS fetch from Clerk ============`)
		console.log(`[JWKS-DEBUG] JWKS URL: ${JWT_CONFIG.CLERK_JWKS_URL}`)
		console.log(`[JWKS-DEBUG] Cache TTL: ${JWT_CONFIG.CACHE_TTL} seconds`)

		try {
			// Step 1: Setup request with timeout
			console.log(`[JWKS-DEBUG] Setting up HTTP request with 30s timeout...`)
			const controller = new AbortController()
			const timeoutId = setTimeout(() => {
				console.log(`❌ [JWKS-DEBUG] Request timeout triggered after 30 seconds`)
				controller.abort()
			}, 30000)

			// Step 2: Make HTTP request
			console.log(`[JWKS-DEBUG] Making HTTP request to Clerk JWKS endpoint...`)
			const requestStartTime = Date.now()
			const response = await fetch(JWT_CONFIG.CLERK_JWKS_URL, {
				method: "GET",
				headers: {
					Accept: "application/json",
					"User-Agent": "Softcodes-VSCode-Extension",
				},
				signal: controller.signal,
			})

			clearTimeout(timeoutId)
			const requestTime = Date.now() - requestStartTime
			console.log(`[JWKS-DEBUG] HTTP request completed in ${requestTime}ms`)
			console.log(`[JWKS-DEBUG] Response status: ${response.status} ${response.statusText}`)

			if (!response.ok) {
				console.log(`❌ [JWKS-DEBUG] HTTP request failed with status ${response.status}`)
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			// Step 3: Parse JSON response
			console.log(`[JWKS-DEBUG] Parsing JWKS JSON response...`)
			const jsonParseStartTime = Date.now()
			const jwks: JWKSResponse = await response.json()
			const jsonParseTime = Date.now() - jsonParseStartTime
			console.log(`[JWKS-DEBUG] JSON parsing completed in ${jsonParseTime}ms`)

			if (!jwks.keys || !Array.isArray(jwks.keys)) {
				console.log(`❌ [JWKS-DEBUG] Invalid JWKS response structure:`, jwks)
				throw new Error("Invalid JWKS response: missing keys array")
			}

			console.log(`✅ [JWKS-DEBUG] Valid JWKS response received with ${jwks.keys.length} keys`)

			// Step 4: Process and cache keys
			console.log(`[JWKS-DEBUG] Processing and caching keys...`)
			const keyMap = new Map<string, JWK>()
			let validKeyCount = 0

			for (const key of jwks.keys) {
				if (key.kid) {
					keyMap.set(key.kid, key)
					validKeyCount++
					console.log(`[JWKS-DEBUG] Key cached: ${key.kid} (${key.kty}, ${key.alg}, use: ${key.use})`)
				} else {
					console.log(`⚠️ [JWKS-DEBUG] Key without kid found, skipping:`, key)
				}
			}

			const cacheEntry: JWKSCacheEntry = {
				keys: keyMap,
				expiresAt: Date.now() + JWT_CONFIG.CACHE_TTL * 1000,
			}

			this.keyCache.set("jwks", cacheEntry)
			const cacheExpiresAt = new Date(cacheEntry.expiresAt)

			console.log(`✅ [JWKS-DEBUG] ${validKeyCount} keys cached successfully`)
			console.log(`[JWKS-DEBUG] Cache expires at: ${cacheExpiresAt.toISOString()}`)

			const totalFetchTime = Date.now() - fetchStartTime
			console.log(
				`✅ [JWKS-DEBUG] ========== JWKS fetch completed successfully in ${totalFetchTime}ms ==========`,
			)

			return jwks.keys
		} catch (error) {
			const totalFetchTime = Date.now() - fetchStartTime
			console.log(`❌ [JWKS-DEBUG] JWKS fetch FAILED after ${totalFetchTime}ms:`, error)

			if ((error as any).name === "AbortError") {
				console.log(`[JWKS-DEBUG] Error type: Request timeout`)
				throw this.createJWKSError(
					JWTErrorType.NETWORK_ERROR,
					"Request timeout while fetching JWKS",
					"The request to fetch JWKS keys timed out after 30 seconds",
				)
			}

			console.log(`[JWKS-DEBUG] Error type: ${error instanceof Error ? error.constructor.name : typeof error}`)
			throw this.createJWKSError(
				JWTErrorType.JWKS_FETCH_ERROR,
				"Failed to fetch JWKS from Clerk",
				error instanceof Error ? error.message : String(error),
				error instanceof Error ? error : undefined,
			)
		}
	}

	/**
	 * Get cached JWKS or fetch if not cached/expired
	 */
	async getJWKS(): Promise<JWK[]> {
		console.log(`[JWKS-DEBUG] Getting JWKS (checking cache first)...`)
		const cached = this.keyCache.get("jwks")

		if (cached) {
			const now = Date.now()
			const isExpired = cached.expiresAt <= now
			const timeToExpiry = cached.expiresAt - now

			console.log(
				`[JWKS-DEBUG] Cache found: ${cached.keys.size} keys, expires in ${Math.round(timeToExpiry / 1000)}s`,
			)

			if (!isExpired) {
				console.log(`✅ [JWKS-DEBUG] Using cached JWKS (${cached.keys.size} keys)`)
				return Array.from(cached.keys.values())
			} else {
				console.log(
					`[JWKS-DEBUG] Cache expired ${Math.round(-timeToExpiry / 1000)}s ago, fetching fresh JWKS...`,
				)
			}
		} else {
			console.log(`[JWKS-DEBUG] No cache found, fetching JWKS for first time...`)
		}

		return await this.fetchJWKS()
	}

	/**
	 * Get specific key by kid
	 */
	async getKey(kid: string): Promise<JWK> {
		console.log(`[JWKS-DEBUG] Looking up key with kid: ${kid}`)
		const keyLookupStartTime = Date.now()

		const keys = await this.getJWKS()
		const key = keys.find((k) => k.kid === kid)

		const keyLookupTime = Date.now() - keyLookupStartTime

		if (!key) {
			console.log(
				`❌ [JWKS-DEBUG] Key not found for kid: ${kid} (searched ${keys.length} keys in ${keyLookupTime}ms)`,
			)
			console.log(`[JWKS-DEBUG] Available key IDs: [${keys.map((k) => k.kid).join(", ")}]`)
			throw this.createJWKSError(
				JWTErrorType.JWKS_FETCH_ERROR,
				`Key with kid '${kid}' not found in JWKS`,
				"The specified key ID was not found in the current key set",
			)
		}

		console.log(`✅ [JWKS-DEBUG] Key found for kid: ${kid} in ${keyLookupTime}ms`)
		console.log(`[JWKS-DEBUG] Key details: type=${key.kty}, algorithm=${key.alg}, use=${key.use}`)
		return key
	}

	/**
	 * Verify JWT signature using JWKS
	 */
	async verifyJWTSignature(token: string, options: any = {}): Promise<any> {
		const verificationStartTime = Date.now()
		console.log(`[JWKS-DEBUG] ============ Starting JWT signature verification ============`)
		console.log(`[JWKS-DEBUG] Token length: ${token ? token.length : 0} characters`)
		console.log(`[JWKS-DEBUG] Verification options:`, options)

		try {
			// Step 1: Parse JWT components
			console.log(`[JWKS-DEBUG] Step 1/5: Parsing JWT components...`)
			const parseStartTime = Date.now()
			const components = this.parseJWT(token)
			const parseTime = Date.now() - parseStartTime
			console.log(`✅ [JWKS-DEBUG] JWT parsing completed in ${parseTime}ms`)
			console.log(`[JWKS-DEBUG] Header algorithm: ${components.header.alg}, key ID: ${components.header.kid}`)

			if (!components.header.kid) {
				console.log(`❌ [JWKS-DEBUG] JWT header missing key ID (kid)`)
				throw new Error("JWT header missing kid (key ID)")
			}
			console.log(`[JWKS-DEBUG] Using key ID: ${components.header.kid}`)

			// Step 2: Get the signing key
			console.log(`[JWKS-DEBUG] Step 2/5: Retrieving signing key for kid: ${components.header.kid}...`)
			const keyRetrievalStartTime = Date.now()
			const signingKey = await this.getSigningKey(components.header.kid)
			const keyRetrievalTime = Date.now() - keyRetrievalStartTime
			console.log(`✅ [JWKS-DEBUG] Signing key retrieved in ${keyRetrievalTime}ms`)
			console.log(
				`[JWKS-DEBUG] Signing key type: ${signingKey.includes("CERTIFICATE") ? "Certificate" : "RSA Public Key"}`,
			)

			// Step 3: Verify the signature
			console.log(`[JWKS-DEBUG] Step 3/5: Verifying JWT signature...`)
			const signatureVerificationStartTime = Date.now()
			const signatureValid = this.verifySignature(token, signingKey)
			const signatureVerificationTime = Date.now() - signatureVerificationStartTime

			if (!signatureValid) {
				console.log(`❌ [JWKS-DEBUG] Signature verification FAILED in ${signatureVerificationTime}ms`)
				throw this.createJWKSError(
					JWTErrorType.INVALID_SIGNATURE,
					"JWT signature verification failed",
					"The token signature does not match the expected signature",
				)
			}
			console.log(`✅ [JWKS-DEBUG] Signature verification SUCCESSFUL in ${signatureVerificationTime}ms`)

			// Step 4: Validate JWT timing claims
			console.log(`[JWKS-DEBUG] Step 4/5: Validating timing claims (exp, nbf, iat)...`)
			const timingValidationStartTime = Date.now()
			this.validateTimingClaims(components.payload, options)
			const timingValidationTime = Date.now() - timingValidationStartTime
			console.log(`✅ [JWKS-DEBUG] Timing claims validation completed in ${timingValidationTime}ms`)

			// Step 5: Validate issuer and audience
			console.log(`[JWKS-DEBUG] Step 5/5: Validating standard claims (issuer, audience)...`)
			const standardClaimsStartTime = Date.now()
			this.validateStandardClaims(components.payload, options)
			const standardClaimsTime = Date.now() - standardClaimsStartTime
			console.log(`✅ [JWKS-DEBUG] Standard claims validation completed in ${standardClaimsTime}ms`)

			const totalVerificationTime = Date.now() - verificationStartTime
			console.log(
				`✅ [JWKS-DEBUG] ========== JWT signature verification SUCCESSFUL in ${totalVerificationTime}ms ==========`,
			)
			console.log(`[JWKS-DEBUG] Verified user: ${components.payload.sub} (${components.payload.email})`)

			return components.payload
		} catch (error: any) {
			const totalVerificationTime = Date.now() - verificationStartTime
			console.log(`❌ [JWKS-DEBUG] JWT signature verification FAILED after ${totalVerificationTime}ms:`, error)

			if (error.type) {
				// Already a JWTVerificationError
				console.log(`[JWKS-DEBUG] JWT verification error type: ${error.type}`)
				console.log(`[JWKS-DEBUG] Error message: ${error.message}`)
				if (error.details) {
					console.log(`[JWKS-DEBUG] Error details: ${error.details}`)
				}
				throw error
			}

			console.log(`[JWKS-DEBUG] Unexpected error during signature verification:`, error)
			throw this.createJWKSError(
				JWTErrorType.VERIFICATION_FAILED,
				error.message || "JWT verification failed",
				error.message,
				error,
			)
		}
	}

	/**
	 * Parse JWT token into components
	 */
	private parseJWT(token: string): JWTComponents {
		if (!isValidJWTFormat(token)) {
			throw this.createJWKSError(
				JWTErrorType.MALFORMED_TOKEN,
				"JWT must have exactly 3 parts",
				"Invalid JWT format",
			)
		}

		const parts = token.split(".")

		try {
			const header = JSON.parse(base64urlDecode(parts[0]))
			const payload = JSON.parse(base64urlDecode(parts[1]))
			const signature = parts[2]

			return { header, payload, signature }
		} catch (error) {
			throw this.createJWKSError(
				JWTErrorType.MALFORMED_TOKEN,
				"Failed to parse JWT components",
				error instanceof Error ? error.message : String(error),
			)
		}
	}

	/**
	 * Verify JWT signature
	 */
	private verifySignature(token: string, publicKey: string): boolean {
		try {
			const parts = token.split(".")
			const signatureInput = `${parts[0]}.${parts[1]}`

			// Convert base64url signature to Buffer directly
			const base64Signature = this.base64urlToBase64(parts[2])
			const signatureBuffer = Buffer.from(base64Signature, "base64")

			const verifier = crypto.createVerify("RSA-SHA256")
			verifier.update(signatureInput)

			return verifier.verify(publicKey, signatureBuffer)
		} catch (error) {
			console.error("Signature verification failed:", error)
			return false
		}
	}

	/**
	 * Validate timing claims (exp, iat, nbf)
	 */
	private validateTimingClaims(payload: any, options: any): void {
		const now = Math.floor(Date.now() / 1000)
		const clockTolerance = options.clockTolerance || JWT_CONFIG.CLOCK_TOLERANCE

		// Check expiration
		if (payload.exp && now > payload.exp + clockTolerance) {
			throw this.createJWKSError(
				JWTErrorType.TOKEN_EXPIRED,
				"JWT token has expired",
				`Token expired at ${new Date(payload.exp * 1000).toISOString()}`,
			)
		}

		// Check not before
		if (payload.nbf && now < payload.nbf - clockTolerance) {
			throw this.createJWKSError(
				JWTErrorType.TOKEN_NOT_ACTIVE,
				"JWT token is not yet active",
				`Token becomes active at ${new Date(payload.nbf * 1000).toISOString()}`,
			)
		}
	}

	/**
	 * Validate standard claims (iss, aud)
	 */
	private validateStandardClaims(payload: any, options: any): void {
		// Validate issuer
		const expectedIssuer = options.issuer || JWT_CONFIG.ISSUER
		if (expectedIssuer && payload.iss !== expectedIssuer) {
			throw this.createJWKSError(
				JWTErrorType.INVALID_ISSUER,
				"JWT issuer is invalid",
				`Expected: ${expectedIssuer}, actual: ${payload.iss}`,
			)
		}

		// Validate audience (only if JWT contains audience claim)
		const expectedAudience = options.audience || JWT_CONFIG.AUDIENCE
		if (expectedAudience && payload.aud) {
			const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
			if (!audiences.includes(expectedAudience)) {
				throw this.createJWKSError(
					JWTErrorType.INVALID_AUDIENCE,
					"JWT audience is invalid",
					`Expected: ${expectedAudience}, actual: ${audiences.join(", ")}`,
				)
			}
		} else if (expectedAudience && !payload.aud) {
			console.log(`[JWKS-DEBUG] JWT does not contain audience claim, skipping audience validation`)
		}
	}

	/**
	 * Clear JWKS cache
	 */
	clearCache(): void {
		this.keyCache.clear()
	}

	/**
	 * Get cache status
	 */
	getCacheStatus(): { cached: boolean; expiresAt?: number; keyCount?: number } {
		const cached = this.keyCache.get("jwks")

		if (!cached) {
			return { cached: false }
		}

		return {
			cached: cached.expiresAt > Date.now(),
			expiresAt: cached.expiresAt,
			keyCount: cached.keys.size,
		}
	}

	/**
	 * Preload JWKS (useful for warming up the cache)
	 */
	async preloadJWKS(): Promise<void> {
		try {
			await this.fetchJWKS()
			console.log("JWKS preloaded successfully")
		} catch (error) {
			console.warn("Failed to preload JWKS:", error)
			// Don't throw - this is optional warming
		}
	}

	/**
	 * Create standardized JWKS error
	 */
	private createJWKSError(
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
}

/**
 * Convenience function to get JWKS client instance
 */
export function getJWKSClient(): ClerkJWKSClient {
	return ClerkJWKSClient.getInstance()
}
