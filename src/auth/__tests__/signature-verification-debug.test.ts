import * as crypto from "crypto"
import { base64urlDecode } from "../jwtUtils"

describe("Signature Verification Debug", () => {
	test("should demonstrate signature format issue", () => {
		// Sample JWT signature part (base64url encoded)
		const signaturePart = "Ar0TlQaXb05FH6nvzwOl8Y5QcG4EXAMPLE"

		// Current problematic approach
		const decodedSignature = base64urlDecode(signaturePart)
		console.log("Decoded signature type:", typeof decodedSignature)
		console.log("Decoded signature length:", decodedSignature.length)

		// What we should do for signature verification
		const signatureBuffer = Buffer.from(signaturePart.replace(/-/g, "+").replace(/_/g, "/"), "base64")
		console.log("Buffer signature type:", typeof signatureBuffer)
		console.log("Buffer signature length:", signatureBuffer.length)

		// The issue: we're converting binary data to UTF-8, then telling crypto it's base64
		expect(typeof decodedSignature).toBe("string")
		expect(Buffer.isBuffer(signatureBuffer)).toBe(true)
	})

	test("should demonstrate correct signature verification approach", () => {
		// Mock JWT parts
		const header = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9"
		const payload = "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWV9"
		const signature = "example-signature-part"

		const signatureInput = `${header}.${payload}`

		// WRONG: Converting to UTF-8 string then telling crypto it's base64
		const wrongSignature = base64urlDecode(signature)

		// CORRECT: Keep as Buffer and tell crypto it's a buffer
		let correctSignature: Buffer
		try {
			const base64Sig = signature.replace(/-/g, "+").replace(/_/g, "/")
			const padding = "=".repeat((4 - (base64Sig.length % 4)) % 4)
			correctSignature = Buffer.from(base64Sig + padding, "base64")
		} catch (error) {
			// This will fail with the example signature, but demonstrates the concept
			correctSignature = Buffer.alloc(0)
		}

		console.log("Wrong approach - signature as string:", typeof wrongSignature)
		console.log("Correct approach - signature as Buffer:", Buffer.isBuffer(correctSignature))
	})
})
