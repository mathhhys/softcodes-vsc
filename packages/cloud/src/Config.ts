export const PRODUCTION_CLERK_BASE_URL = "https://clerk.softcodes.ai"
export const PRODUCTION_ROO_CODE_API_URL = "https://softcodes.ai"

// OAuth configuration for VSCode
export const VSCODE_OAUTH_CONFIG = {
	CLIENT_ID: "TJy1ozr5uQaiG961",
	REDIRECT_URI: "vscode://softcodes.softcodes",
	SCOPES: ["openid", "profile", "email"],
}

// Functions with environment variable fallbacks
export const getClerkBaseUrl = () => process.env.CLERK_BASE_URL || PRODUCTION_CLERK_BASE_URL
export const getRooCodeApiUrl = () => process.env.ROO_CODE_API_URL || PRODUCTION_ROO_CODE_API_URL
export const getVSCodeOAuthClientId = () => process.env.VSCODE_OAUTH_CLIENT_ID || VSCODE_OAUTH_CONFIG.CLIENT_ID
