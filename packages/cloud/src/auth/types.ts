/**
 * Authentication types for Softcodes Blue Byte Booster integration
 */

export interface AuthTokens {
	access_token: string
	refresh_token: string
	token_type: "Bearer"
	expires_in: number
	session_id: string
}

export interface UserInfo {
	clerk_id: string
	email: string
	username: string
	plan_type: "starter" | "pro" | "teams"
	credits: number
	organization_id?: string
}

export interface AuthState {
	isAuthenticated: boolean
	user: UserInfo | null
	sessionId: string | null
}

export interface PKCEParams {
	code_verifier: string
	code_challenge: string
	state: string
}

export interface TokenExchangeRequest {
	code: string
	grant_type: "authorization_code" | "refresh_token"
	code_verifier?: string
	refresh_token?: string
	state: string
}

export interface TokenExchangeResponse extends AuthTokens {
	user: UserInfo
}

export interface AuthError {
	error: string
	error_description?: string
}

export interface AuthConfig {
	apiBaseUrl: string
	redirectUri: string
	authEndpoint: string
	tokenEndpoint: string
	refreshEndpoint: string
}
