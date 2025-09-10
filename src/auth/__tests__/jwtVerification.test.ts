/**
 * JWT Verification Service Tests
 *
 * Comprehensive tests for JWT token decryption and verification
 */

import { describe, it, expect, beforeEach, vi, Mock } from "vitest"
import { JWTVerificationService } from "../jwtVerification"
import { ClerkJWKSClient } from "../clerkJWKSClient"
import { JWTErrorType, ClerkJWTPayload } from "../jwtTypes"
import { JWT_CONFIG } from "../config"

// Mock the JWKS client
vi.mock("../clerkJWKSClient", () => ({
	ClerkJWKSClient: {
		getInstance: vi.fn(() => ({
			verifyJWTSignature: vi.fn(),
			getSigningKey: vi.fn(),
			fetchJWKS: vi.fn(),
			getJWKS: vi.fn(),
			getKey: vi.fn(),
			clearCache: vi.fn(),
			getCacheStatus: vi.fn(),
			preloadJWKS: vi.fn(),
		})),
	},
}))

describe("JWTVerificationService", () => {
	let jwtService: JWTVerificationService
	let mockJwksClient: any

	beforeEach(() => {
		vi.clearAllMocks()
		mockJwksClient = ClerkJWKSClient.getInstance()
		jwtService = JWTVerificationService.getInstance()
	})

	describe("JWT Token Parsing", () => {
		it("should parse valid JWT components correctly", async () => {
			const validJWT =
				"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InRlc3Qta2lkIn0.eyJpc3MiOiJodHRwczovL2NsZXJrLnNvZnRjb2Rlcy5haSIsInN1YiI6InVzZXJfMTIzIiwiYXVkIjoic29mdGNvZGVzLXZzY29kZS1leHRlbnNpb24iLCJleHAiOjk5OTk5OTk5OTksImlhdCI6MTcwMDAwMDAwMCwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInNlc3Npb25faWQiOiJzZXNzXzEyMyJ9.signature"

			mockJwksClient.verifyJWTSignature.mockResolvedValue({
				iss: "https://clerk.softcodes.ai",
				sub: "user_123",
				aud: "softcodes-vscode-extension",
				exp: 9999999999,
				iat: 1700000000,
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
			})

			const result = await jwtService.verifyJWT(validJWT)

			expect(result.valid).toBe(true)
			expect(result.payload?.email).toBe("test@example.com")
			expect(result.userInfo?.userId).toBe("user_123")
		})

		it("should reject malformed JWT tokens", async () => {
			const malformedJWT = "invalid.jwt"

			const result = await jwtService.verifyJWT(malformedJWT)

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(JWTErrorType.MALFORMED_TOKEN)
		})

		it("should reject JWT with wrong number of parts", async () => {
			const invalidJWT = "header.payload"

			const result = await jwtService.verifyJWT(invalidJWT)

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(JWTErrorType.MALFORMED_TOKEN)
		})
	})

	describe("JWT Signature Verification", () => {
		it("should verify valid JWT signatures", async () => {
			const validJWT = createMockJWT({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
			})

			mockJwksClient.verifyJWTSignature.mockResolvedValue({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
			})

			const result = await jwtService.verifyJWT(validJWT)

			expect(result.valid).toBe(true)
			expect(mockJwksClient.verifyJWTSignature).toHaveBeenCalledWith(
				validJWT,
				expect.objectContaining({
					issuer: JWT_CONFIG.ISSUER,
					audience: JWT_CONFIG.AUDIENCE,
				}),
			)
		})

		it("should reject JWT with invalid signature", async () => {
			const invalidJWT = createMockJWT({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
			})

			mockJwksClient.verifyJWTSignature.mockRejectedValue({
				type: JWTErrorType.INVALID_SIGNATURE,
				message: "Invalid signature",
			})

			const result = await jwtService.verifyJWT(invalidJWT)

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(JWTErrorType.INVALID_SIGNATURE)
		})
	})

	describe("JWT Claims Validation", () => {
		it("should validate issuer claim", async () => {
			const jwtWithInvalidIssuer = createMockJWT({
				iss: "https://invalid-issuer.com",
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
			})

			mockJwksClient.verifyJWTSignature.mockResolvedValue({
				iss: "https://invalid-issuer.com",
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
			})

			const result = await jwtService.verifyJWT(jwtWithInvalidIssuer)

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(JWTErrorType.INVALID_ISSUER)
		})

		it("should validate audience claim", async () => {
			const jwtWithInvalidAudience = createMockJWT({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: "invalid-audience",
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
			})

			mockJwksClient.verifyJWTSignature.mockResolvedValue({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: "invalid-audience",
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
			})

			const result = await jwtService.verifyJWT(jwtWithInvalidAudience)

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(JWTErrorType.INVALID_AUDIENCE)
		})

		it("should validate required email claim", async () => {
			const jwtWithoutEmail = createMockJWT({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email_verified: true,
				session_id: "sess_123",
			})

			mockJwksClient.verifyJWTSignature.mockResolvedValue({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email_verified: true,
				session_id: "sess_123",
			})

			const result = await jwtService.verifyJWT(jwtWithoutEmail)

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(JWTErrorType.MISSING_CLAIMS)
		})

		it("should validate required session_id claim", async () => {
			const jwtWithoutSessionId = createMockJWT({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: true,
			})

			mockJwksClient.verifyJWTSignature.mockResolvedValue({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: true,
			})

			const result = await jwtService.verifyJWT(jwtWithoutSessionId)

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(JWTErrorType.MISSING_CLAIMS)
		})
	})

	describe("JWT Expiration Validation", () => {
		it("should reject expired JWT tokens", async () => {
			const expiredJWT = createMockJWT({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
				iat: Math.floor(Date.now() / 1000) - 7200,
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
			})

			mockJwksClient.verifyJWTSignature.mockResolvedValue({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) - 3600,
				iat: Math.floor(Date.now() / 1000) - 7200,
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
			})

			const result = await jwtService.verifyJWT(expiredJWT)

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(JWTErrorType.TOKEN_EXPIRED)
		})

		it("should accept tokens within clock tolerance", async () => {
			const slightlyExpiredJWT = createMockJWT({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) - 30, // Expired 30 seconds ago
				iat: Math.floor(Date.now() / 1000) - 3600,
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
			})

			mockJwksClient.verifyJWTSignature.mockResolvedValue({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) - 30,
				iat: Math.floor(Date.now() / 1000) - 3600,
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
			})

			const result = await jwtService.verifyJWT(slightlyExpiredJWT)

			expect(result.valid).toBe(true) // Should pass due to clock tolerance
		})

		it("should detect tokens near expiration", () => {
			const payload: ClerkJWTPayload = {
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				exp: Math.floor(Date.now() / 1000) + 200, // Expires in 200 seconds
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
			}

			const isNearExpiration = jwtService.isTokenNearExpiration(payload)

			expect(isNearExpiration).toBe(true) // Should be true since 200 < 300 (TOKEN_REFRESH_THRESHOLD)
		})
	})

	describe("User Info Extraction", () => {
		it("should extract complete user information from JWT payload", async () => {
			const completeJWT = createMockJWT({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: true,
				first_name: "John",
				last_name: "Doe",
				full_name: "John Doe",
				image_url: "https://example.com/avatar.jpg",
				org_id: "org_123",
				org_slug: "test-org",
				org_role: "admin",
				session_id: "sess_123",
				subscription_status: "active",
				subscription_tier: "pro",
			})

			mockJwksClient.verifyJWTSignature.mockResolvedValue({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: true,
				first_name: "John",
				last_name: "Doe",
				full_name: "John Doe",
				image_url: "https://example.com/avatar.jpg",
				org_id: "org_123",
				org_slug: "test-org",
				org_role: "admin",
				session_id: "sess_123",
				subscription_status: "active",
				subscription_tier: "pro",
			})

			const result = await jwtService.verifyJWT(completeJWT)

			expect(result.valid).toBe(true)
			expect(result.userInfo).toEqual({
				userId: "user_123",
				email: "test@example.com",
				firstName: "John",
				lastName: "Doe",
				fullName: "John Doe",
				imageUrl: "https://example.com/avatar.jpg",
				emailVerified: true,
				organizationId: "org_123",
				organizationSlug: "test-org",
				organizationRole: "admin",
				sessionId: "sess_123",
				subscriptionStatus: "active",
				subscriptionTier: "pro",
			})
		})

		it("should handle minimal user information", async () => {
			const minimalJWT = createMockJWT({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: false,
				session_id: "sess_123",
			})

			mockJwksClient.verifyJWTSignature.mockResolvedValue({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: false,
				session_id: "sess_123",
			})

			const result = await jwtService.verifyJWT(minimalJWT)

			expect(result.valid).toBe(true)
			expect(result.userInfo).toEqual({
				userId: "user_123",
				email: "test@example.com",
				emailVerified: false,
				sessionId: "sess_123",
				firstName: undefined,
				lastName: undefined,
				fullName: undefined,
				username: undefined,
				imageUrl: undefined,
				phoneNumber: undefined,
				phoneVerified: undefined,
				organizationId: undefined,
				organizationSlug: undefined,
				organizationRole: undefined,
				organizationPermissions: undefined,
				subscriptionStatus: undefined,
				subscriptionTier: undefined,
			})
		})
	})

	describe("Error Handling", () => {
		it("should handle JWKS fetch errors gracefully", async () => {
			const validJWT = createMockJWT({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
			})

			mockJwksClient.verifyJWTSignature.mockRejectedValue({
				type: JWTErrorType.JWKS_FETCH_ERROR,
				message: "Failed to fetch JWKS",
			})

			const result = await jwtService.verifyJWT(validJWT)

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(JWTErrorType.JWKS_FETCH_ERROR)
		})

		it("should handle network errors during verification", async () => {
			const validJWT = createMockJWT({
				iss: JWT_CONFIG.ISSUER,
				sub: "user_123",
				aud: JWT_CONFIG.AUDIENCE,
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				email: "test@example.com",
				email_verified: true,
				session_id: "sess_123",
			})

			mockJwksClient.verifyJWTSignature.mockRejectedValue(new Error("Network error"))

			const result = await jwtService.verifyJWT(validJWT)

			expect(result.valid).toBe(false)
			expect(result.error?.type).toBe(JWTErrorType.VERIFICATION_FAILED)
		})
	})

	describe("Cache Management", () => {
		it("should warm up cache without throwing errors", async () => {
			mockJwksClient.preloadJWKS.mockResolvedValue(undefined)

			await expect(jwtService.warmupCache()).resolves.not.toThrow()
			expect(mockJwksClient.preloadJWKS).toHaveBeenCalled()
		})

		it("should handle cache warmup failures gracefully", async () => {
			mockJwksClient.preloadJWKS.mockRejectedValue(new Error("Cache warmup failed"))

			await expect(jwtService.warmupCache()).resolves.not.toThrow()
		})

		it("should clear cache successfully", () => {
			mockJwksClient.clearCache.mockReturnValue(undefined)

			expect(() => jwtService.clearCache()).not.toThrow()
			expect(mockJwksClient.clearCache).toHaveBeenCalled()
		})
	})
})

/**
 * Helper function to create mock JWT tokens for testing
 */
function createMockJWT(payload: any): string {
	const header = {
		alg: "RS256",
		typ: "JWT",
		kid: "test-kid",
	}

	const encodedHeader = btoa(JSON.stringify(header))
	const encodedPayload = btoa(JSON.stringify(payload))
	const signature = "mock-signature"

	return `${encodedHeader}.${encodedPayload}.${signature}`
}
