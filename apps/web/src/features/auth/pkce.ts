/**
 * PKCE (RFC 7636) helpers for Proof Key for Code Exchange in browser-based OIDC flows.
 */

const PKCE_STATE_KEY = 'solutions_studio_pkce_state';
const PKCE_VERIFIER_KEY = 'solutions_studio_pkce_verifier';

export function generateRandomString(length: number = 64): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomValues = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
  } else {
    for (let i = 0; i < length; i++) {
      randomValues[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(randomValues)
    .map((val) => charset[val % charset.length])
    .join('');
}

export function generateCodeVerifier(): string {
  return generateRandomString(64);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);

  const subtleCrypto =
    typeof crypto !== 'undefined' && crypto.subtle
      ? crypto.subtle
      : typeof globalThis !== 'undefined' && globalThis.crypto?.subtle
        ? globalThis.crypto.subtle
        : null;

  if (subtleCrypto) {
    const digest = await subtleCrypto.digest('SHA-256', data);
    return base64UrlEncode(new Uint8Array(digest));
  }

  throw new Error('No crypto implementation available for SHA-256 code challenge generation');
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 =
    typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let inMemoryPkceState: { state: string; verifier: string } | null = null;

export function savePkceState(state: string, verifier: string): void {
  inMemoryPkceState = { state, verifier };
  const storage =
    typeof window !== 'undefined'
      ? window.sessionStorage
      : typeof globalThis !== 'undefined'
        ? globalThis.sessionStorage
        : null;
  if (storage) {
    try {
      storage.setItem(PKCE_STATE_KEY, state);
      storage.setItem(PKCE_VERIFIER_KEY, verifier);
    } catch {
      // Ignore restricted environments
    }
  }
}

export function getAndClearPkceState(): { state: string; verifier: string } | null {
  const storage =
    typeof window !== 'undefined'
      ? window.sessionStorage
      : typeof globalThis !== 'undefined'
        ? globalThis.sessionStorage
        : null;
  if (storage) {
    try {
      const state = storage.getItem(PKCE_STATE_KEY);
      const verifier = storage.getItem(PKCE_VERIFIER_KEY);
      storage.removeItem(PKCE_STATE_KEY);
      storage.removeItem(PKCE_VERIFIER_KEY);
      if (state && verifier) {
        inMemoryPkceState = null;
        return { state, verifier };
      }
    } catch {
      // Ignore
    }
  }
  const fallback = inMemoryPkceState;
  inMemoryPkceState = null;
  return fallback;
}

export interface BuildAuthorizeUrlParams {
  readonly authorizationEndpoint: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scope?: string;
  readonly state: string;
  readonly codeChallenge: string;
}

export function buildAuthorizationUrl(params: BuildAuthorizeUrlParams): string {
  const url = new URL(params.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scope ?? 'openid profile email');
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface TokenExchangeParams {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly code: string;
  readonly codeVerifier: string;
}

export interface TokenResponse {
  readonly access_token: string;
  readonly id_token?: string;
  readonly token_type?: string;
  readonly expires_in?: number;
  readonly refresh_token?: string;
}

export async function exchangeCodeForToken(
  params: TokenExchangeParams,
  fetchFn: typeof fetch = fetch
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier
  });

  const response = await fetchFn(params.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Token exchange failed (${response.status}): ${errText}`);
  }

  return response.json();
}
