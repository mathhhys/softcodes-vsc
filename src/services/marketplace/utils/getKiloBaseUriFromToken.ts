import * as vscode from "vscode"

export function getKiloBaseUriFromToken(kilocodeToken?: string): string {
	// Use a simple console.log for basic logging that works in all environments
	console.log(`[Softcodes MCP] getKiloBaseUriFromToken called with token: ${kilocodeToken ? "present" : "missing"}`)

	if (kilocodeToken) {
		try {
			const parts = kilocodeToken.split(".")
			console.log(`[Softcodes MCP] JWT has ${parts.length} parts`)

			const payload_string = parts[1]
			if (!payload_string) {
				console.log(`[Softcodes MCP] No payload found in JWT, using default URL`)
				return "https://api.kilocode.ai"
			}

			const payload_json =
				typeof atob !== "undefined" ? atob(payload_string) : Buffer.from(payload_string, "base64").toString()
			console.log(`[Softcodes MCP] Decoded payload: ${payload_json.substring(0, 100)}...`)

			const payload = JSON.parse(payload_json)
			console.log(`[Softcodes MCP] Parsed payload with env: ${payload.env}`)

			//note: this is UNTRUSTED, so we need to make sure we're OK with this being manipulated by an attacker; e.g. we should not read uri's from the JWT directly.
			if (payload.env === "development") {
				console.log(`[Softcodes MCP] Development environment detected, using localhost`)
				return "http://localhost:3000"
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			console.log(`[Softcodes MCP] Failed to get base URL from Kilo Code token: ${errorMsg}`)
			console.warn("Failed to get base URL from Kilo Code token", error)
		}
	}

	console.log(`[Softcodes MCP] Using default base URL: https://api.kilocode.ai`)
	return "https://api.kilocode.ai"
}
