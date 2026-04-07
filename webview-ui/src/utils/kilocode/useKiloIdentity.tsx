import { useEffect, useState } from "react"

// JWT parsing utilities - using the same approach as the backend
function parseJWTUnsafe(token: string): { success: boolean; parts?: { payload: any }; error?: string } {
	try {
		const parts = token.split(".")
		if (parts.length !== 3) {
			return { success: false, error: "Invalid JWT format" }
		}

		// Decode payload (second part) - using base64url decoding
		const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/")

		const decodedPayload = JSON.parse(atob(payload))

		return {
			success: true,
			parts: { payload: decodedPayload },
		}
	} catch (error) {
		return {
			success: false,
			error: `Failed to parse JWT: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

export function useKiloIdentity(kilocodeToken: string, machineId: string) {
	const [kiloIdentity, setKiloIdentity] = useState("")

	useEffect(() => {
		if (kilocodeToken) {
			console.debug("KILOTEL: extracting user identity from JWT...")

			try {
				// Parse JWT to extract user information directly
				const parseResult = parseJWTUnsafe(kilocodeToken)

				if (parseResult.success && parseResult.parts?.payload) {
					const payload = parseResult.parts.payload

					// Extract user identity from JWT payload
					// Use email if available, otherwise fall back to user ID or sub
					const userIdentity = payload.email || payload.sub || payload.user_id || payload.softcodes_user_id

					if (userIdentity) {
						console.debug("KILOTEL: Kilo user identified from JWT:", userIdentity)
						setKiloIdentity(userIdentity)
					} else {
						console.warn("KILOTEL: No user identity found in JWT payload, falling back to machine ID")
						setKiloIdentity(machineId)
					}
				} else {
					console.error("KILOTEL: Failed to parse JWT token:", parseResult.error)
					setKiloIdentity(machineId)
				}
			} catch (error) {
				console.error("KILOTEL: Error extracting user identity from JWT:", error)
				setKiloIdentity(machineId)
			}
		} else {
			console.debug("KILOTEL: no Kilo token provided")
			setKiloIdentity("")
		}
	}, [kilocodeToken, machineId])

	return kiloIdentity || machineId
}
