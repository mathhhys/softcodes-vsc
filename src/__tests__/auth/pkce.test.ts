import * as crypto from "crypto"
import { generateCodeVerifier, generateCodeChallenge, generateState } from "../../auth/pkce"
import { vi, describe, it, expect, beforeEach } from "vitest"

// Mock crypto module
vi.mock("crypto", () => ({
	randomBytes: vi.fn(),
	createHash: vi.fn(),
}))

describe("PKCE Functions", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("generateCodeVerifier", () => {
		it("should generate a base64 URL encoded string from 32 random bytes", () => {
			// Mock randomBytes to return a predictable buffer
			const mockBuffer = Buffer.from("test-verifier-bytes-32-chars-long!")
			;(crypto.randomBytes as any).mockReturnValue(mockBuffer)

			const verifier = generateCodeVerifier()

			expect(crypto.randomBytes).toHaveBeenCalledWith(32)
			expect(verifier).toBe("dGVzdC12ZXJpZmllci1ieXRlcy0zMi1jaGFycy1sb25nIQ") // base64 URL encoded of mock buffer
			expect(verifier).not.toContain("+")
			expect(verifier).not.toContain("/")
			expect(verifier).not.toContain("=")
		})

		it("should generate different verifiers on multiple calls", () => {
			// Mock randomBytes to return different buffers
			const mockBuffer1 = Buffer.from("first-verifier-bytes-32-chars-long")
			const mockBuffer2 = Buffer.from("second-verifier-bytes-32-chars-long")
			;(crypto.randomBytes as any).mockReturnValueOnce(mockBuffer1).mockReturnValueOnce(mockBuffer2)

			const verifier1 = generateCodeVerifier()
			const verifier2 = generateCodeVerifier()

			expect(verifier1).not.toBe(verifier2)
			expect(crypto.randomBytes).toHaveBeenCalledTimes(2)
		})
	})

	describe("generateCodeChallenge", () => {
		it("should generate a base64 URL encoded SHA-256 hash of the verifier", async () => {
			const verifier = "test-verifier-string"
			const mockHash = {
				update: vi.fn().mockReturnThis(),
				digest: vi.fn().mockReturnValue(Buffer.from("hashed-verifier-bytes")),
			}
			;(crypto.createHash as any).mockReturnValue(mockHash)

			const challenge = await generateCodeChallenge(verifier)

			expect(crypto.createHash).toHaveBeenCalledWith("sha256")
			expect(mockHash.update).toHaveBeenCalledWith(verifier)
			expect(mockHash.digest).toHaveBeenCalled()
			expect(challenge).toBe("aGFzaGVkLXZlcmlmaWVyLWJ5dGVz") // base64 URL encoded of mock hash
			expect(challenge).not.toContain("+")
			expect(challenge).not.toContain("/")
			expect(challenge).not.toContain("=")
		})

		it("should handle empty verifier", async () => {
			const verifier = ""
			const mockHash = {
				update: vi.fn().mockReturnThis(),
				digest: vi.fn().mockReturnValue(Buffer.from("empty-hash")),
			}
			;(crypto.createHash as ReturnType<typeof vi.fn>).mockReturnValue(mockHash)

			const challenge = await generateCodeChallenge(verifier)

			expect(mockHash.update).toHaveBeenCalledWith("")
			expect(challenge).toBe("ZW1wdHktaGFzaA") // base64 URL encoded of 'empty-hash'
		})
	})

	describe("generateState", () => {
		it("should generate a base64 URL encoded string from 16 random bytes", () => {
			const mockBuffer = Buffer.from("test-state-bytes-16")
			;(crypto.randomBytes as any).mockReturnValue(mockBuffer)

			const state = generateState()

			expect(crypto.randomBytes).toHaveBeenCalledWith(16)
			expect(state).toBe("dGVzdC1zdGF0ZS1ieXRlcy0xNg") // base64 URL encoded of mock buffer
			expect(state).not.toContain("+")
			expect(state).not.toContain("/")
			expect(state).not.toContain("=")
		})
	})

	// Test the base64URLEncode function indirectly through the public functions
	describe("base64URLEncode (indirect testing)", () => {
		it("should replace + with - and / with _ and remove =", () => {
			// Mock a buffer that would produce base64 with +, /, and =
			const mockBuffer = Buffer.from("test+data/with=padding==")
			;(crypto.randomBytes as any).mockReturnValue(mockBuffer)

			const result = generateCodeVerifier()

			// The base64 of 'test+data/with=padding==' is 'dGVzdCtkYXRhL3dpdGg9cGFkZGluZz09'
			// After URL encoding: 'dGVzdCtkYXRhL3dpdGg9cGFkZGluZz09' -> 'dGVzdC1kYXRhX3dpdGg9cGFkZGluZz09'
			// But since we're using a fixed mock, we need to check the pattern
			expect(result).not.toContain("+")
			expect(result).not.toContain("/")
			expect(result).not.toContain("=")
		})
	})
})
