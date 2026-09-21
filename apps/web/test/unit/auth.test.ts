import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getAuthToken,
  setAuthToken,
  getSelectedPersona,
  setSelectedPersona,
  resetAuthStore,
  PRESET_PERSONAS
} from '../../src/features/auth/tokenStore';
import { apiClient } from '../../src/features/review/api/client';

describe('Web Auth Module & TokenStore', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetAuthStore();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetAuthStore();
  });

  it('manages auth token in storage and memory', () => {
    expect(getAuthToken()).toBeNull();

    setAuthToken('test:reviewer');
    expect(getAuthToken()).toBe('test:reviewer');

    setAuthToken(null);
    expect(getAuthToken()).toBeNull();
  });

  it('manages selected persona in storage and memory', () => {
    expect(getSelectedPersona()).toBe('anonymous');

    setSelectedPersona('reviewer.alice');
    expect(getSelectedPersona()).toBe('reviewer.alice');

    const reviewer = PRESET_PERSONAS.find((p) => p.id === 'reviewer.alice');
    expect(reviewer).toBeDefined();
    expect(reviewer?.token).toBe('test:reviewer');
    expect(reviewer?.capabilities).toContain('requirements:reconcile');
    expect(reviewer?.capabilities).toContain('candidate:approve');
  });

  it('apiClient attaches Authorization Bearer header when token is set', async () => {
    setAuthToken('test-jwt-token-12345');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' })
    } as Response);

    await apiClient('/api/auth/me', { baseUrl: 'http://test-server' });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://test-server/api/auth/me',
      expect.objectContaining({
        headers: expect.any(Headers)
      })
    );

    const callArgs = (global.fetch as any).mock.calls[0];
    const headers = callArgs[1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer test-jwt-token-12345');
  });

  it('apiClient does not override explicit Authorization header', async () => {
    setAuthToken('default-token');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' })
    } as Response);

    await apiClient('/api/auth/me', {
      baseUrl: 'http://test-server',
      headers: {
        Authorization: 'Bearer explicit-override-token'
      }
    });

    const callArgs = (global.fetch as any).mock.calls[0];
    const headers = callArgs[1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer explicit-override-token');
  });

  it('apiClient does not set Authorization header when token is null', async () => {
    setAuthToken(null);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' })
    } as Response);

    await apiClient('/api/test', { baseUrl: 'http://test-server' });

    const callArgs = (global.fetch as any).mock.calls[0];
    const headers = callArgs[1].headers as Headers;
    expect(headers.get('Authorization')).toBeNull();
  });

  it('stores tokens in sessionStorage and NEVER in localStorage (AC-1, F-554aa6b3)', () => {
    if (typeof window !== 'undefined') {
      setAuthToken('confidential-bearer-token');
      expect(sessionStorage.getItem('solutions-studio-auth-token')).toBe(
        'confidential-bearer-token'
      );
      expect(localStorage.getItem('solutions-studio-auth-token')).toBeNull();
      expect(localStorage.getItem('solutions-studio-actor-id')).toBeNull();
    }
  });

  describe('PKCE RFC 7636 Utilities', () => {
    it('generates high-entropy code verifier and computes SHA-256 code challenge', async () => {
      const { generateCodeVerifier, generateCodeChallenge } =
        await import('../../src/features/auth/pkce');
      const verifier = generateCodeVerifier();
      expect(verifier).toBeDefined();
      expect(verifier.length).toBe(64);
      expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);

      const challenge = await generateCodeChallenge(verifier);
      expect(challenge).toBeDefined();
      expect(challenge.length).toBeGreaterThanOrEqual(43);
      expect(challenge).not.toBe(verifier);

      // Deterministic check: same verifier yields same challenge
      const challenge2 = await generateCodeChallenge(verifier);
      expect(challenge2).toBe(challenge);
    });

    it('manages and single-use clears PKCE state in sessionStorage', async () => {
      const { savePkceState, getAndClearPkceState } = await import('../../src/features/auth/pkce');
      savePkceState('state-12345', 'verifier-abcdef');

      const retrieved = getAndClearPkceState();
      expect(retrieved).toEqual({
        state: 'state-12345',
        verifier: 'verifier-abcdef'
      });

      // Second retrieval must return null (single-use clearing prevents replay)
      expect(getAndClearPkceState()).toBeNull();
    });

    it('builds compliant OIDC authorization URL with PKCE parameters', async () => {
      const { buildAuthorizationUrl } = await import('../../src/features/auth/pkce');
      const url = buildAuthorizationUrl({
        authorizationEndpoint:
          'http://localhost:8080/realms/solutions-studio/protocol/openid-connect/auth',
        clientId: 'solutions-studio-web',
        redirectUri: 'http://localhost:3000/auth/callback',
        state: 'test-state-99',
        codeChallenge: 'test-challenge-hash'
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('client_id')).toBe('solutions-studio-web');
      expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/callback');
      expect(parsed.searchParams.get('state')).toBe('test-state-99');
      expect(parsed.searchParams.get('code_challenge')).toBe('test-challenge-hash');
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('exchanges authorization code and verifier for tokens via token endpoint', async () => {
      const { exchangeCodeForToken } = await import('../../src/features/auth/pkce');
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'exchanged-access-token-jwt',
          token_type: 'Bearer',
          expires_in: 3600
        })
      });

      const result = await exchangeCodeForToken(
        {
          tokenEndpoint:
            'http://localhost:8080/realms/solutions-studio/protocol/openid-connect/token',
          clientId: 'solutions-studio-web',
          redirectUri: 'http://localhost:3000/auth/callback',
          code: 'authz-code-123',
          codeVerifier: 'verifier-secret-456'
        },
        mockFetch as any
      );

      expect(result.access_token).toBe('exchanged-access-token-jwt');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/realms/solutions-studio/protocol/openid-connect/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })
      );
    });
  });
});
