/**
 * Unified Authentication Configuration
 * 
 * This file contains configuration constants for the unified authentication system
 * that bridges the VSCode extension with the Clerk-based website authentication.
 */

/**
 * Environment-specific configuration
 */
export const AUTH_CONFIG = {
  // Production URLs (aligned with website)
  PRODUCTION: {
    CLERK_BASE_URL: "https://clerk.softcodes.ai",
    API_BASE_URL: "https://softcodes.ai",
    WEBSITE_URL: "https://softcodes.ai"
  },
  
  // Development URLs (for testing)
  DEVELOPMENT: {
    CLERK_BASE_URL: "https://clerk.softcodes.ai", // Use production Clerk for consistency
    API_BASE_URL: "http://localhost:3000",
    WEBSITE_URL: "http://localhost:3000"
  }
} as const;

/**
 * OAuth Configuration
 */
export const OAUTH_CONFIG = {
  // VSCode-specific OAuth parameters
  VSCODE: {
    REDIRECT_URI: "vscode-softcodes://auth/callback",
    SCOPE: "openid profile email",
    RESPONSE_TYPE: "code",
    GRANT_TYPE: "authorization_code"
  },
  
  // Website OAuth parameters (for reference)
  WEBSITE: {
    REDIRECT_URI_PATTERN: /^https:\/\/(softcodes\.ai|localhost:3000)/,
    SCOPE: "openid profile email",
    RESPONSE_TYPE: "code"
  }
} as const;

/**
 * API Endpoints for unified authentication
 */
export const AUTH_ENDPOINTS = {
  // New unified endpoints
  INITIATE_VSCODE_AUTH: "/api/auth/initiate-vscode-auth",
  EXTENSION_CALLBACK: "/api/extension/auth/callback", 
  REFRESH_TOKEN: "/api/auth/refresh-token",
  SESSION_TOKEN: "/api/auth/session-token",
  VALIDATE_SESSION: "/api/auth/validate-session",
  USER_INFO: "/api/auth/user-info",
  SIGN_OUT: "/api/auth/sign-out",
  
  // Webhook endpoints (for backend implementation)
  CLERK_WEBHOOK: "/api/webhooks/clerk",
  
  // Legacy endpoints (for backward compatibility)
  LEGACY: {
    TOKEN_EXCHANGE: "/api/auth/token"
  }
} as const;

/**
 * Token Storage Keys
 */
export const TOKEN_KEYS = {
  ACCESS_TOKEN: "access_token",
  REFRESH_TOKEN: "refresh_token", 
  SESSION_ID: "session_id",
  ORGANIZATION_ID: "organization_id",
  PKCE_PREFIX: "pkce_"
} as const;

/**
 * Error Messages
 */
export const AUTH_ERRORS = {
  MISSING_PARAMS: "Missing authentication parameters",
  INVALID_STATE: "Invalid authentication state",
  TOKEN_EXCHANGE_FAILED: "Token exchange failed",
  REFRESH_FAILED: "Token refresh failed",
  SESSION_EXPIRED: "Your session has expired. Please sign in again.",
  NETWORK_ERROR: "Network error during authentication",
  INVALID_RESPONSE: "Invalid response from authentication service"
} as const;

/**
 * Success Messages
 */
export const AUTH_SUCCESS = {
  AUTHENTICATED: "Successfully authenticated with Softcodes!",
  SIGNED_OUT: "Signed out from Softcodes",
  TOKEN_REFRESHED: "Authentication token refreshed"
} as const;

/**
 * Get the current environment configuration
 */
export function getAuthConfig() {
  // Check if we're in development mode
  const isDevelopment = process.env.NODE_ENV === 'development';
  return isDevelopment ? AUTH_CONFIG.DEVELOPMENT : AUTH_CONFIG.PRODUCTION;
}

/**
 * Build authentication URL with proper parameters
 */
export function buildAuthUrl(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(AUTH_ENDPOINTS.INITIATE_VSCODE_AUTH, baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

/**
 * Validate redirect URI for security
 */
export function isValidRedirectUri(redirectUri: string): boolean {
  // VSCode extension should always use the specific scheme
  if (redirectUri === OAUTH_CONFIG.VSCODE.REDIRECT_URI) {
    return true;
  }
  
  // Website redirects should match the pattern
  return OAUTH_CONFIG.WEBSITE.REDIRECT_URI_PATTERN.test(redirectUri);
}

/**
 * Generate User-Agent string for API requests
 */
export function generateUserAgent(): string {
  try {
    const vscode = require('vscode');
    const extension = vscode.extensions.getExtension('softcodes.softcodes');
    const version = extension?.packageJSON?.version || 'unknown';
    return `VSCode-Softcodes/${version}`;
  } catch {
    return 'VSCode-Softcodes/unknown';
  }
}