/**
 * JWT Utils Test Suite
 *
 * Tests for the unified JWT decoding utilities
 */

import { describe, test, expect } from "vitest"
import {
	base64urlDecode,
	base64urlEncode,
	isValidJWTFormat,
	parseJWTUnsafe,
	extractUserInfoFromPayload,
	validateJWTTimingClaims,
	validateRequiredClaims,
	getTokenExpirationInfo,
	analyzeJWT,
} from "../jwtUtils"
import { ClerkJWTPayload } from "../jwtTypes"

describe("JWT Utils", () => {
	describe("Base64URL encoding/decoding", () => {
		test("should encode and decode base64url correctly", () => {
			const testString = "Hello, World! This is a test with special chars: +/="
			const encoded = base64urlEncode(testString)
			const decoded = base64urlDecode(encoded)

			expect(decoded).toBe(testString)
			expect(encoded).not.toContain("+")
			expect(encoded).not.toContain("/")
			expect(encoded).not.toContain("=")
		})

		test("should handle URL-safe characters in base64url", () => {
			// This is a real base64url string with URL-safe characters
			const base64urlString = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9"
			const decoded = base64urlDecode(base64urlString)
			const parsed = JSON.parse(decoded)

			expect(parsed).toEqual({
				alg: "RS256",
				typ: "JWT",
			})
		})

		test("should handle padding correctly", () => {
			const testCases = [
				"SGVsbG8", // no padding needed
				"SGVsbG9X", // 1 padding char needed
				"SGVsbG9Xb3I", // 2 padding chars needed
				"SGVsbG9Xb3Js", // 3 padding chars needed (none)
			]

			testCases.forEach((encoded) => {
				expect(() => base64urlDecode(encoded)).not.toThrow()
			})
		})
	})

	describe("JWT format validation", () => {
		test("should validate correct JWT format", () => {
			const validJWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature"
			expect(isValidJWTFormat(validJWT)).toBe(true)
		})

		test("should reject invalid JWT formats", () => {
			expect(isValidJWTFormat("")).toBe(false)
			expect(isValidJWTFormat("only.two")).toBe(false) // Only 2 parts
			expect(isValidJWTFormat("too.many.parts.here.invalid")).toBe(false) // 5 parts
			expect(isValidJWTFormat("header..signature")).toBe(false) // Empty middle part
			expect(isValidJWTFormat("single")).toBe(false) // Only 1 part
			expect(isValidJWTFormat(null as any)).toBe(false)
			expect(isValidJWTFormat(undefined as any)).toBe(false)
		})
	})

	describe("JWT parsing", () => {
		// Create a valid test JWT token
		const createTestJWT = (payload: Partial<ClerkJWTPayload> = {}) => {
			const header = { alg: "RS256", typ: "JWT" }
			const defaultPayload: ClerkJWTPayload = {
				iss: "https://clerk.softcodes.ai",
				sub: "user_123",
				aud: "softcodes-vscode-extension",
				exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
				first_name: "Test",
				last_name: "User",
				...payload,
			}

			const headerEncoded = base64urlEncode(JSON.stringify(header))
			const payloadEncoded = base64urlEncode(JSON.stringify(defaultPayload))
			const signature = "mock_signature"

			return `${headerEncoded}.${payloadEncoded}.${signature}`
		}

		test("should parse valid JWT successfully", () => {
			const jwt = createTestJWT()
			const result = parseJWTUnsafe(jwt)

			expect(result.success).toBe(true)
			expect(result.parts).toBeDefined()
			expect(result.parts!.header.alg).toBe("RS256")
			expect(result.parts!.payload.email).toBe("test@example.com")
			expect(result.parts!.signature).toBe("mock_signature")
		})

		test("should handle malformed JWT", () => {
			const malformedJWT = "invalid.jwt.format"
			const result = parseJWTUnsafe(malformedJWT)

			expect(result.success).toBe(false)
			expect(result.error).toContain("Failed to decode JWT")
		})

		test("should extract user info correctly", () => {
			const payload: ClerkJWTPayload = {
				iss: "https://clerk.softcodes.ai",
				sub: "user_456",
				aud: "softcodes-vscode-extension",
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "john.doe@example.com",
				email_verified: true,
				session_id: "sess_456",
				first_name: "John",
				last_name: "Doe",
				org_id: "org_123",
				org_role: "admin",
			}

			const userInfo = extractUserInfoFromPayload(payload)

			expect(userInfo.email).toBe("john.doe@example.com")
			expect(userInfo.userId).toBe("user_456")
			expect(userInfo.sessionId).toBe("sess_456")
			expect(userInfo.firstName).toBe("John")
			expect(userInfo.lastName).toBe("Doe")
			expect(userInfo.organizationId).toBe("org_123")
			expect(userInfo.organizationRole).toBe("admin")
		})
	})

	describe("JWT validation", () => {
		test("should validate timing claims correctly", () => {
			const now = Math.floor(Date.now() / 1000)

			// Valid token (not expired, not too early)
			const validPayload: ClerkJWTPayload = {
				iss: "test",
				sub: "test",
				aud: "test",
				exp: now + 3600, // expires in 1 hour
				iat: now - 60, // issued 1 minute ago
				nbf: now - 30, // valid since 30 seconds ago
				email: "test@example.com",
				email_verified: true,
				session_id: "test",
			}

			const result = validateJWTTimingClaims(validPayload)
			expect(result.valid).toBe(true)

			// Expired token
			const expiredPayload: ClerkJWTPayload = {
				...validPayload,
				exp: now - 3600, // expired 1 hour ago
			}

			const expiredResult = validateJWTTimingClaims(expiredPayload)
			expect(expiredResult.valid).toBe(false)
			expect(expiredResult.error).toContain("expired")

			// Token not yet active
			const futurePayload: ClerkJWTPayload = {
				...validPayload,
				nbf: now + 3600, // not active for 1 hour
			}

			const futureResult = validateJWTTimingClaims(futurePayload)
			expect(futureResult.valid).toBe(false)
			expect(futureResult.error).toContain("not active")
		})

		test("should validate required claims", () => {
			// Valid payload with all required claims
			const validPayload: ClerkJWTPayload = {
				iss: "test",
				sub: "user_123",
				aud: "test",
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
			}

			const validResult = validateRequiredClaims(validPayload)
			expect(validResult.valid).toBe(true)

			// Missing email
			const noEmailPayload = { ...validPayload }
			delete (noEmailPayload as any).email

			const noEmailResult = validateRequiredClaims(noEmailPayload)
			expect(noEmailResult.valid).toBe(false)
			expect(noEmailResult.missingClaims).toContain("email")

			// Missing session_id
			const noSessionPayload = { ...validPayload }
			delete (noSessionPayload as any).session_id

			const noSessionResult = validateRequiredClaims(noSessionPayload)
			expect(noSessionResult.valid).toBe(false)
			expect(noSessionResult.missingClaims).toContain("session_id")
		})

		test("should get token expiration info", () => {
			const now = Math.floor(Date.now() / 1000)

			// Token expiring in 10 minutes (near expiration)
			const nearExpirationPayload: ClerkJWTPayload = {
				iss: "test",
				sub: "test",
				aud: "test",
				exp: now + 600, // 10 minutes
				iat: now,
				email: "test@example.com",
				email_verified: true,
				session_id: "test",
			}

			const nearExpInfo = getTokenExpirationInfo(nearExpirationPayload)
			expect(nearExpInfo.isExpired).toBe(false)
			expect(nearExpInfo.isNearExpiration).toBe(false) // 10 minutes is not near (< 5 minutes)
			expect(nearExpInfo.expiresIn).toBeGreaterThan(0)

			// Token expiring in 2 minutes (near expiration)
			const veryNearPayload: ClerkJWTPayload = {
				...nearExpirationPayload,
				exp: now + 120, // 2 minutes
			}

			const veryNearInfo = getTokenExpirationInfo(veryNearPayload)
			expect(veryNearInfo.isNearExpiration).toBe(true)

			// Expired token
			const expiredPayload: ClerkJWTPayload = {
				...nearExpirationPayload,
				exp: now - 60, // expired 1 minute ago
			}

			const expiredInfo = getTokenExpirationInfo(expiredPayload)
			expect(expiredInfo.isExpired).toBe(true)
			expect(expiredInfo.expiresIn).toBeLessThan(0)
		})
	})

	describe("JWT analysis", () => {
		test("should provide comprehensive JWT analysis", () => {
			const jwt =
				"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ0ZXN0Iiwic3ViIjoidXNlcl8xMjMiLCJhdWQiOiJ0ZXN0IiwiZXhwIjoxNzE2NzQ4ODAwLCJpYXQiOjE3MTY3NDUyMDAsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJzZXNzaW9uX2lkIjoidGVzdCJ9.signature"

			const analysis = analyzeJWT(jwt)

			expect(analysis.format.valid).toBe(true)
			expect(analysis.format.parts).toBe(3)
			expect(analysis.parsing.success).toBe(true)
			expect(analysis.userInfo).toBeDefined()
			expect(analysis.userInfo!.email).toBe("test@example.com")
			expect(analysis.claims).toBeDefined()
		})

		test("should handle invalid JWT in analysis", () => {
			const invalidJWT = "invalid.jwt"

			const analysis = analyzeJWT(invalidJWT)

			expect(analysis.format.valid).toBe(false)
			expect(analysis.parsing.success).toBe(false)
			expect(analysis.userInfo).toBeUndefined()
			expect(analysis.claims).toBeUndefined()
		})
	})

	describe("Real-world JWT handling", () => {
		test("should handle JWT with URL-safe characters in payload", () => {
			// This simulates a real JWT with URL-safe characters that would break with regular base64
			const header = { alg: "RS256", typ: "JWT" }
			const payload = {
				iss: "https://clerk.softcodes.ai",
				sub: "user_2abc123def456",
				aud: "softcodes-vscode-extension",
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "user+test@example.com", // This could create URL-safe chars when encoded
				email_verified: true,
				session_id: "sess_abc123def456",
				org_id: "org_xyz789",
			}

			const headerEncoded = base64urlEncode(JSON.stringify(header))
			const payloadEncoded = base64urlEncode(JSON.stringify(payload))
			const jwt = `${headerEncoded}.${payloadEncoded}.signature`

			const result = parseJWTUnsafe(jwt)

			expect(result.success).toBe(true)
			expect(result.parts!.payload.email).toBe("user+test@example.com")
			expect(result.parts!.payload.org_id).toBe("org_xyz789")
		})

		test("should extract comprehensive user info from complex payload", () => {
			const complexPayload: ClerkJWTPayload = {
				iss: "https://clerk.softcodes.ai",
				sub: "user_complex123",
				aud: ["softcodes-vscode-extension", "softcodes-web"],
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "complex.user@example.com",
				email_verified: true,
				first_name: "Complex",
				last_name: "User",
				full_name: "Complex User",
				username: "complex_user",
				image_url: "https://example.com/avatar.jpg",
				phone_number: "+1234567890",
				phone_verified: true,
				session_id: "sess_complex123",
				org_id: "org_enterprise",
				org_slug: "enterprise-corp",
				org_role: "admin",
				org_permissions: ["users:read", "users:write", "billing:read"],
				subscription_status: "active",
				subscription_tier: "pro",
			}

			const userInfo = extractUserInfoFromPayload(complexPayload)

			expect(userInfo.email).toBe("complex.user@example.com")
			expect(userInfo.firstName).toBe("Complex")
			expect(userInfo.lastName).toBe("User")
			expect(userInfo.fullName).toBe("Complex User")
			expect(userInfo.username).toBe("complex_user")
			expect(userInfo.imageUrl).toBe("https://example.com/avatar.jpg")
			expect(userInfo.phoneNumber).toBe("+1234567890")
			expect(userInfo.emailVerified).toBe(true)
			expect(userInfo.phoneVerified).toBe(true)
			expect(userInfo.organizationId).toBe("org_enterprise")
			expect(userInfo.organizationSlug).toBe("enterprise-corp")
			expect(userInfo.organizationRole).toBe("admin")
			expect(userInfo.organizationPermissions).toEqual(["users:read", "users:write", "billing:read"])
			expect(userInfo.subscriptionStatus).toBe("active")
			expect(userInfo.subscriptionTier).toBe("pro")
		})
	})
})
