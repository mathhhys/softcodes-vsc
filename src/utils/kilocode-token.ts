export function getKiloBaseUriFromToken(kilocodeToken: string) {
	// Return default URL if token is empty or invalid
	if (!kilocodeToken || kilocodeToken.trim() === "") {
		return "https://kilocode.ai"
	}

	try {
		const parts = kilocodeToken.split(".")
		if (parts.length !== 3) {
			// Not a valid JWT format
			return "https://kilocode.ai"
		}

		const payload_string = parts[1]
		const payload = JSON.parse(Buffer.from(payload_string, "base64").toString())
		//note: this is UNTRUSTED, so we need to make sure we're OK with this being manipulated by an attacker; e.g. we should not read uri's from the JWT directly.
		if (payload.env === "development") return "http://localhost:3000"
	} catch (_error) {
		// Only log warning if token was provided but invalid
		if (kilocodeToken && kilocodeToken.trim() !== "") {
			console.warn("Failed to get base URL from Softcodes token")
		}
	}
	return "https://kilocode.ai"
}
