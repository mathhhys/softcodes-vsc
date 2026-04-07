import { API_CONFIG } from "../config/constants"

export function getKiloBaseUriFromToken(kilocodeToken: string) {
	// Always return OpenRouter URL - no longer using KiloCode backend
	return API_CONFIG.OPENROUTER.BASE_URL.replace("/api/v1", "")
}
