import * as vscode from 'vscode';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce';
import { 
  getAuthConfig, 
  AUTH_ENDPOINTS, 
  OAUTH_CONFIG, 
  TOKEN_KEYS, 
  AUTH_ERRORS, 
  AUTH_SUCCESS,
  generateUserAgent,
  buildAuthUrl,
  isValidRedirectUri
} from './config';

/**
 * Interface for authentication tokens returned by the unified auth system
 */
export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  session_id?: string;
  organization_id?: string | null;
}

/**
 * Interface for user information
 */
export interface UserInfo {
  email: string;
  firstName?: string;
  lastName?: string;
  organizationName?: string;
  organizationId?: string;
}

/**
 * Unified Authentication Service that bridges VSCode extension with Clerk-based website authentication
 * This service maintains compatibility with both authentication systems while providing a unified interface
 */
export class UnifiedAuthService {
  private static instance: UnifiedAuthService;
  private context: vscode.ExtensionContext;
  private pendingAuth: Map<string, { codeVerifier: string; state: string }> = new Map();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  static getInstance(context: vscode.ExtensionContext): UnifiedAuthService {
    if (!UnifiedAuthService.instance) {
      UnifiedAuthService.instance = new UnifiedAuthService(context);
    }
    return UnifiedAuthService.instance;
  }

  /**
   * Initiate unified OAuth flow that works with both VSCode and website
   */
  async authenticate(): Promise<void> {
    try {
      // Generate PKCE parameters for security
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const state = generateState();

      // Store for later verification
      this.pendingAuth.set(state, { codeVerifier, state });
      await this.context.secrets.store(`${TOKEN_KEYS.PKCE_PREFIX}${state}`, codeVerifier);

      // Build redirect URI - using unified scheme
      const redirectUri = OAUTH_CONFIG.VSCODE.REDIRECT_URI;
      
      // Validate redirect URI for security
      if (!isValidRedirectUri(redirectUri)) {
        throw new Error('Invalid redirect URI configuration');
      }
      
      // Call unified backend initiation endpoint
      const backendUrl = await this.getBackendUrl();
      const authUrl = buildAuthUrl(backendUrl, {
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        state: state
      });
      
      const response = await fetch(authUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': generateUserAgent(),
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: AUTH_ERRORS.NETWORK_ERROR }));
        throw new Error(errorData.error || AUTH_ERRORS.NETWORK_ERROR);
      }

      const data = await response.json();
      
      if (!data.auth_url) {
        throw new Error(AUTH_ERRORS.INVALID_RESPONSE);
      }
      
      // Open browser with Clerk auth URL
      await vscode.env.openExternal(vscode.Uri.parse(data.auth_url));
      
      vscode.window.showInformationMessage('Please complete authentication in your browser');
    } catch (error) {
      console.error('Authentication initiation failed:', error);
      vscode.window.showErrorMessage(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle OAuth callback from unified authentication system
   */
  async handleCallback(uri: vscode.Uri): Promise<void> {
    try {
      const params = new URLSearchParams(uri.query);
      const code = params.get('code');
      const state = params.get('state');

      if (!code || !state) {
        throw new Error(AUTH_ERRORS.MISSING_PARAMS);
      }

      // Retrieve stored PKCE verifier
      const codeVerifier = await this.context.secrets.get(`${TOKEN_KEYS.PKCE_PREFIX}${state}`);
      if (!codeVerifier) {
        throw new Error(AUTH_ERRORS.INVALID_STATE);
      }

      // Exchange code for tokens using unified callback endpoint
      const backendUrl = await this.getBackendUrl();
      const response = await fetch(`${backendUrl}${AUTH_ENDPOINTS.EXTENSION_CALLBACK}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'User-Agent': generateUserAgent(),
        },
        body: JSON.stringify({
          code,
          code_verifier: codeVerifier,
          state,
          redirect_uri: OAUTH_CONFIG.VSCODE.REDIRECT_URI,
          grant_type: OAUTH_CONFIG.VSCODE.GRANT_TYPE
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: AUTH_ERRORS.TOKEN_EXCHANGE_FAILED }));
        throw new Error(error.error || AUTH_ERRORS.TOKEN_EXCHANGE_FAILED);
      }

      const tokens: AuthTokens = await response.json();
      
      // Store tokens securely in VSCode secrets
      await this.storeTokens(tokens);
      
      // Clean up PKCE data
      await this.context.secrets.delete(`${TOKEN_KEYS.PKCE_PREFIX}${state}`);
      this.pendingAuth.delete(state);

      vscode.window.showInformationMessage(AUTH_SUCCESS.AUTHENTICATED);
      
      // Trigger any post-auth actions
      vscode.commands.executeCommand('softcodes.onAuthenticated');
    } catch (error) {
      console.error('Authentication callback failed:', error);
      vscode.window.showErrorMessage(`Authentication callback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get access token, refreshing if necessary
   */
  async getAccessToken(): Promise<string | undefined> {
    let accessToken = await this.context.secrets.get(TOKEN_KEYS.ACCESS_TOKEN);
    
    // If no access token, try to refresh using refresh token
    if (!accessToken) {
      const refreshToken = await this.context.secrets.get(TOKEN_KEYS.REFRESH_TOKEN);
      if (refreshToken) {
        accessToken = await this.refreshAccessToken(refreshToken);
      }
    }
    
    return accessToken;
  }

  /**
   * Get user information from stored session
   */
  async getUserInfo(): Promise<UserInfo | undefined> {
    try {
      const sessionId = await this.context.secrets.get(TOKEN_KEYS.SESSION_ID);
      const accessToken = await this.getAccessToken();
      
      if (!accessToken || !sessionId) {
        return undefined;
      }

      // Fetch user info from unified API
      const backendUrl = await this.getBackendUrl();
      const response = await fetch(`${backendUrl}${AUTH_ENDPOINTS.USER_INFO}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': generateUserAgent(),
        }
      });

      if (!response.ok) {
        console.warn('Failed to fetch user info:', response.statusText);
        return undefined;
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching user info:', error);
      return undefined;
    }
  }

  /**
   * Refresh access token using unified refresh endpoint
   */
  private async refreshAccessToken(refreshToken: string): Promise<string | undefined> {
    try {
      const backendUrl = await this.getBackendUrl();
      const response = await fetch(`${backendUrl}${AUTH_ENDPOINTS.REFRESH_TOKEN}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'User-Agent': generateUserAgent(),
        },
        body: JSON.stringify({ 
          refresh_token: refreshToken,
          client_type: 'vscode'
        })
      });

      if (!response.ok) {
        // Refresh failed, need to re-authenticate
        console.warn('Token refresh failed, clearing stored tokens');
        await this.signOut();
        return undefined;
      }

      const tokens: AuthTokens = await response.json();
      
      // Store new tokens
      await this.storeTokens(tokens);
      
      return tokens.access_token;
    } catch (error) {
      console.error('Token refresh failed:', error);
      await this.signOut(); // Clear invalid tokens
      return undefined;
    }
  }

  /**
   * Store authentication tokens securely
   */
  private async storeTokens(tokens: AuthTokens): Promise<void> {
    await this.context.secrets.store(TOKEN_KEYS.ACCESS_TOKEN, tokens.access_token);
    await this.context.secrets.store(TOKEN_KEYS.REFRESH_TOKEN, tokens.refresh_token);
    
    if (tokens.session_id) {
      await this.context.secrets.store(TOKEN_KEYS.SESSION_ID, tokens.session_id);
    }
    
    if (tokens.organization_id) {
      await this.context.secrets.store(TOKEN_KEYS.ORGANIZATION_ID, tokens.organization_id);
    }
  }

  /**
   * Sign out and clear all stored authentication data
   */
  async signOut(): Promise<void> {
    try {
      // Clear all stored authentication data
      await Promise.all([
        this.context.secrets.delete(TOKEN_KEYS.ACCESS_TOKEN),
        this.context.secrets.delete(TOKEN_KEYS.REFRESH_TOKEN),
        this.context.secrets.delete(TOKEN_KEYS.SESSION_ID),
        this.context.secrets.delete(TOKEN_KEYS.ORGANIZATION_ID)
      ]);

      // Clear any pending auth states
      this.pendingAuth.clear();
      
      // Notify backend about sign out (optional)
      try {
        const backendUrl = await this.getBackendUrl();
        const sessionId = await this.context.secrets.get(TOKEN_KEYS.SESSION_ID);
        
        if (sessionId) {
          await fetch(`${backendUrl}${AUTH_ENDPOINTS.SIGN_OUT}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': generateUserAgent(),
            },
            body: JSON.stringify({ session_id: sessionId })
          });
        }
      } catch (error) {
        // Non-critical error - user is still signed out locally
        console.warn('Failed to notify backend of sign out:', error);
      }
      
      vscode.window.showInformationMessage(AUTH_SUCCESS.SIGNED_OUT);
    } catch (error) {
      console.error('Sign out failed:', error);
      vscode.window.showErrorMessage(`Sign out failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const token = await this.getAccessToken();
    return !!token;
  }

  /**
   * Validate current session with backend
   */
  async validateSession(): Promise<boolean> {
    try {
      const accessToken = await this.getAccessToken();
      const sessionId = await this.context.secrets.get(TOKEN_KEYS.SESSION_ID);
      
      if (!accessToken || !sessionId) {
        return false;
      }

      const backendUrl = await this.getBackendUrl();
      const response = await fetch(`${backendUrl}${AUTH_ENDPOINTS.VALIDATE_SESSION}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': generateUserAgent(),
        },
        body: JSON.stringify({
          session_id: sessionId,
          client_type: 'vscode'
        })
      });

      return response.ok;
    } catch (error) {
      console.error('Session validation failed:', error);
      return false;
    }
  }

  /**
   * Get stored organization ID
   */
  async getOrganizationId(): Promise<string | undefined> {
    return await this.context.secrets.get(TOKEN_KEYS.ORGANIZATION_ID);
  }

  /**
   * Get stored session ID  
   */
  async getSessionId(): Promise<string | undefined> {
    return await this.context.secrets.get(TOKEN_KEYS.SESSION_ID);
  }

  /**
   * Get backend URL from configuration using unified config
   */
  private async getBackendUrl(): Promise<string> {
    const config = vscode.workspace.getConfiguration('softcodes');
    const configuredUrl = config.get('backendUrl');
    
    if (configuredUrl) {
      return configuredUrl as string;
    }
    
    // Use environment-appropriate default
    const authConfig = getAuthConfig();
    return authConfig.API_BASE_URL;
  }

  /**
   * Handle authentication errors consistently
   */
  private async handleAuthError(error: any, context: string): Promise<void> {
    console.error(`Authentication error in ${context}:`, error);
    
    // If it's a 401 or authentication-related error, clear tokens
    if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
      await this.signOut();
      
      // Prompt user to re-authenticate
      const signInAction = 'Sign In';
      const selection = await vscode.window.showErrorMessage(
        AUTH_ERRORS.SESSION_EXPIRED,
        signInAction
      );
      
      if (selection === signInAction) {
        await this.authenticate();
      }
    } else {
      // Show generic error for other issues
      vscode.window.showErrorMessage(`Authentication error: ${error.message || String(error)}`);
    }
  }
}