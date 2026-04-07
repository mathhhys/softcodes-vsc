# MCP Configuration in Softcodes Extension (Using Kilocode Backend)

## Overview

The Softcodes VS Code extension uses the Model Context Protocol (MCP) to load and manage remote tools and resources from the Kilocode marketplace backend. MCP items (servers and resources) are fetched dynamically during extension initialization, but displayed and logged under the Softcodes brand. This setup preserves the reliable Kilocode infrastructure while maintaining Softcodes UI and auth.

## Configuration

MCP loading uses the Kilocode API endpoints, derived from the extension's auth token.

### Token-Based URL Resolution

- **Backend**: Fetches from `https://api.kilocode.ai` (default) or token-derived URL (e.g., localhost for dev).
- **Token Integration**: Uses Softcodes Clerk JWT token from `SecretStorageService` (key: 'softcodes.clerkToken'). The token is passed to `getKiloBaseUriFromToken` (copied from Kilocode in [`utils/getKiloBaseUriFromToken.ts`](../src/services/marketplace/utils/getKiloBaseUriFromToken.ts)), which parses the JWT payload for environment (e.g., 'development' → localhost:3000).
- **Auth Compatibility**: No changes to PKCE/JWT flow in [`AuthService.ts`](../src/services/AuthService.ts) or [`pkce.ts`](../src/auth/pkce.ts). Token is lazily loaded in `RemoteConfigLoader` constructor via ExtensionContext.
- **Fallback**: If no token or parse fails, defaults to `https://api.kilocode.ai`.

### Local Fallbacks

- If remote fetching fails (e.g., network issues), falls back to:
    - Cached items (5-minute TTL).
    - Empty list (extend via `.kilocode/mcp.json` for local MCPs).
- Local MCPs:
    1. Create `.kilocode/mcp.json` in workspace root:
        ```
        {
          "mcpServers": {
            "local-tool": {
              "command": "npx",
              "args": ["-y", "some-local-tool"]
            }
          }
        }
        ```
    2. Global MCPs in extension state via `MarketplaceManager`.

## Error Handling and Logging

- **Network Errors (e.g., ENOTFOUND)**: Catches DNS failures and connection refusals in `fetchWithRetry`. Retries 3 times with backoff (1s, 2s, 4s).
- **Fallback Behavior**: Returns empty arrays for modes/MCPs on failure. Shows warning: "Softcodes marketplace unavailable – using local config."
- **Logging**: "Softcodes MCP" output channel (View > Output > Softcodes MCP).
    - Init: "[Softcodes MCP] Initialized (using Kilocode backend with lazy token-based URL)".
    - Fetches: "[Softcodes MCP] Fetching MCPs...", success/failure (e.g., "[Softcodes MCP] DNS resolution failed").
    - Retries: "[Softcodes MCP] Retry 1/3 failed...".
- **UI Feedback**: `vscode.window.showWarningMessage` for errors. No dedicated webview; global handling.

## Changes from Original (kilocode-original)

- **URL Logic**: Restored `getKiloBaseUriFromToken` (lines 1-18 in utils file), integrated with Softcodes token (lazy async in constructor, lines 32-50 in [`RemoteConfigLoader.ts`](../src/services/marketplace/RemoteConfigLoader.ts)).
- **Token Access**: Uses `context.secrets.get('softcodes.clerkToken')` (assumes Clerk token works or defaults; test compatibility).
- **Rebranding**: Logs/warnings prefixed "Softcodes MCP" (e.g., lines 38, 101, 157); OutputChannel "Softcodes MCP" (line 26).
- **Fallbacks**: Empty arrays on errors (lines 104, 160); cache preserved.
- **Error Catching**: Enhanced for Axios errors (lines 185-193).
- **Tests**: [`RemoteConfigLoader.spec.ts`](../src/services/marketplace/__tests__/RemoteConfigLoader.spec.ts) mocks token/context, verifies Kilocode URL, rebranded logs, fallbacks.
- **Preserved**: PKCE/JWT unchanged; Kilocode backend/endpoints intact.

## Troubleshooting

1. **ENOTFOUND Error**:

    - Ensure token valid (run "Softcodes: Authenticate").
    - Check if Clerk token payload has 'env' for dev URL.
    - Logs: Output > Softcodes MCP for "[Softcodes MCP] DNS resolution failed".
    - Default: Falls back to api.kilocode.ai.

2. **No MCPs Loaded**:

    - Debug: `MarketplaceManager.getMarketplaceItems()` in console.
    - Clear cache: `loader.clearCache()`.
    - Fallback: Warning shown; use local `.kilocode/mcp.json`.

3. **Token/Auth Issues**:

    - MCP uses Clerk token for URL derivation. If incompatible, defaults to Kilocode API.
    - Test: Authenticate, reload, check logs for "from token: true" and URL.

4. **Testing Locally**:
    - Set dev token with 'env': 'development' for localhost.
    - Tests: `cd src && npx vitest services/marketplace/__tests__/RemoteConfigLoader.spec.ts`.
    - Mock errors to test fallbacks.

## Future Enhancements

- Full Clerk token compatibility if needed (extend parse for Softcodes claims).
- Local MCP auto-load on fallback.
- Webview for MCP management.

For issues, check Output > Softcodes MCP or file bug with logs.
