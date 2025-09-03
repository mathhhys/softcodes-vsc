import * as crypto from 'crypto';

/**
 * Generate a cryptographically random code verifier for PKCE
 */
export function generateCodeVerifier(): string {
  return base64URLEncode(crypto.randomBytes(32));
}

/**
 * Generate code challenge from verifier
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64URLEncode(hash);
}

/**
 * Generate random state for CSRF protection
 */
export function generateState(): string {
  return base64URLEncode(crypto.randomBytes(16));
}

/**
 * Base64 URL encoding
 */
function base64URLEncode(buffer: Buffer): string {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}