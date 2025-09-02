export function getKiloCodeBackendSignInUrl() {
	const baseUrl = process.env.NODE_ENV === "development" ? "http://localhost:8080" : "https://softcodes.ai"
	return `${baseUrl}/extension/sign-in`
}

export function getKiloCodeBackendSignUpUrl() {
	const baseUrl = process.env.NODE_ENV === "development" ? "http://localhost:8080" : "https://softcodes.ai"
	return `${baseUrl}/extension/sign-up`
}

export function getKiloCodeBackendAuthCallbackUrl() {
	const baseUrl = process.env.NODE_ENV === "development" ? "http://localhost:8080" : "https://softcodes.ai"
	return `${baseUrl}/api/extension/auth/callback`
}
