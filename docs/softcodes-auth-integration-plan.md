# Softcodes Auth Integration Plan

## Overview

This document outlines the integration plan for Softcodes authentication, focusing on secure implementation using OAuth 2.0 with PKCE (Proof Key for Code Exchange) flow. The integration leverages VSCode's extension capabilities and Clerk for authentication, ensuring a seamless and secure experience without compromising on security standards.

The implementation avoids hardcoded credentials entirely, relying on dynamic configuration and secure storage mechanisms. Comprehensive tests cover the auth flow to validate security and functionality.

## Security Best Practices

The authentication system adheres to the following security best practices:

1. **Use of PKCE Flow**: Implements the PKCE extension to OAuth 2.0, providing protection against authorization code interception and replay attacks.
2. **No Client Secrets**: As a public client (VSCode extension), no client secrets are used or stored, reducing exposure risks.
3. **Secure Token Storage**: Tokens are stored using VSCode's built-in SecretStorage API, which encrypts data using the system's keychain (e.g., macOS Keychain on macOS).
4. **State Parameter for CSRF Protection**: Includes a state parameter in OAuth requests to prevent cross-site request forgery.
5. **Short-Lived Tokens**: Access tokens are short-lived, with refresh tokens used for renewal, minimizing the impact of token compromise.
6. **HTTPS Enforcement**: All communications occur over HTTPS to prevent man-in-the-middle attacks.
7. **Input Validation and Sanitization**: All inputs (e.g., redirect URIs, codes) are validated server-side.
8. **Rate Limiting**: Authentication endpoints are rate-limited to prevent brute-force attacks.
9. **No Hardcoded Credentials**: All sensitive data, including API keys and client IDs, are sourced from environment variables or user-configurable settings, never embedded in code.

## PKCE Implementation

### Why PKCE?

PKCE is essential for public clients like VSCode extensions, where client secrets cannot be securely stored. It replaces the client secret with a dynamically generated code challenge and verifier:

- **Benefits for Public Clients**:
    - Protects against code interception: Even if an attacker intercepts the authorization code, they cannot exchange it without the code verifier.
    - No need for client secrets: Eliminates the risk of secret leakage in client-side code.
    - Compliance with OAuth 2.0 best practices: Recommended by OAuth working groups for native and browser-based apps.
    - Enhanced security in untrusted environments: VSCode extensions run in a semi-trusted environment, and PKCE adds an extra layer of protection.

### Flow Details

1. **Code Challenge Generation**: The extension generates a random `code_verifier` and derives a `code_challenge` using SHA-256 hash (base64url encoded).
2. **Authorization Request**: Sent to the auth server with `code_challenge` and `code_challenge_method=S256`.
3. **User Authorization**: User authenticates via Clerk, receives authorization code.
4. **Token Exchange**: Extension sends `code` and `code_verifier` to the token endpoint; server verifies by recomputing the challenge.
5. **Token Issuance**: Validated requests receive access and refresh tokens.

This flow ensures that only the legitimate client can exchange the code.

### Why Client Secrets Are Not Needed

Client secrets are designed for confidential clients (e.g., server-side apps) where secrets can be securely stored. For public clients like browser extensions or VSCode extensions:

- Secrets would be exposed in the bundled code or runtime environment.
- PKCE provides equivalent security without secrets by binding the authorization code to the client via the verifier.
- This aligns with RFC 7636, making the implementation future-proof and compliant.

## Token Management

### Secure Storage

- **VSCode SecretStorage API**: Tokens (access_token, refresh_token, session_id) are stored using `vscode.secrets.store(key, value)`. This API:
    - Encrypts data using the OS keychain (e.g., Keychain on macOS, Credential Manager on Windows).
    - Isolates storage per extension, preventing access by other extensions.
    - Handles key migration across VSCode updates.
- **Retrieval**: Tokens are fetched via `vscode.secrets.get(key)` only when needed (e.g., for API calls).
- **Deletion on Sign-Out**: All tokens are deleted using `vscode.secrets.delete(key)` during sign-out to invalidate the session.
- **No Persistence in Files**: Tokens are never written to disk or logged, ensuring they remain in memory or secure storage only.

### Token Lifecycle

- **Access Token**: Used for API authorization; refreshed when expired (401 responses).
- **Refresh Token**: Securely stored and used to obtain new access tokens without re-authentication.
- **Rotation**: Refresh tokens are rotated on use to prevent replay attacks.
- **Expiration Handling**: Extension monitors token expiry and proactively refreshes.

No hardcoded credentials are used at any point; all configuration is dynamic.

## Configuration

### Configurable Client ID

The client ID is configurable via VSCode settings to allow flexibility:

- **Default**: Uses the production Clerk client ID for Softcodes.
- **Custom Configuration**: Users can override the client ID in VSCode settings:
    ```json
    {
    	"softcodes.auth.clientId": "your-custom-clerk-client-id"
    }
    ```
    - Access via `vscode.workspace.getConfiguration('softcodes.auth').get('clientId')`.
    - Benefits: Enables testing with dev/staging Clerk instances or custom OAuth providers without code changes.
    - Validation: Client ID is validated during auth initiation to ensure it matches expected formats.

### Setting Up Custom Client IDs

1. Obtain a Clerk application client ID from the Clerk dashboard.
2. Add to VSCode settings.json: `"softcodes.auth.clientId": "pk_test_your-client-id"`.
3. Restart the extension or reload window for changes to take effect.
4. The extension will use this ID in OAuth requests, falling back to default if not set.

This configurability supports enterprise deployments or multi-tenant setups without compromising security.

## Conclusion

This integration plan prioritizes security through PKCE, secure storage, and zero hardcoded credentials. By following these guidelines, the Softcodes auth system provides a robust, user-friendly authentication experience suitable for production use. Regular security audits and updates to OAuth libraries are recommended to maintain compliance.
