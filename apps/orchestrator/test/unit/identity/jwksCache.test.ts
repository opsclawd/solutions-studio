import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { JwksCache, type JwkKey } from '../../../src/infrastructure/identity/jwksCache.js';
import { AuthenticationError } from '../../../src/application/ports/identity/IdentityErrors.js';

describe('JwksCache DDoS & Amplification Defense (F-55dfe7bc & F-ec3af5da)', () => {
  function generateRsaJwk(kid: string, overrides: Partial<JwkKey> = {}): JwkKey {
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = keyPair.publicKey.export({ format: 'jwk' }) as JwkKey;
    return {
      ...jwk,
      kid,
      use: 'sig',
      alg: 'RS256',
      ...overrides
    };
  }

  it('coalesces concurrent refreshes into a single outbound fetch call', async () => {
    let fetchCount = 0;
    const testJwk = generateRsaJwk('key-1');

    const slowFetch = vi.fn(async () => {
      fetchCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        ok: true,
        status: 200,
        json: async () => ({ keys: [testJwk] })
      };
    });

    const cache = new JwksCache('https://idp.example.com/jwks', {
      fetchFn: slowFetch
    });

    // Fire 5 concurrent requests for key-1 before cache is populated
    const results = await Promise.all([
      cache.getPublicKey('key-1'),
      cache.getPublicKey('key-1'),
      cache.getPublicKey('key-1'),
      cache.getPublicKey('key-1'),
      cache.getPublicKey('key-1')
    ]);

    expect(results.length).toBe(5);
    expect(results[0]).toBeDefined();
    // All 5 concurrent calls must share the single in-flight fetch
    expect(fetchCount).toBe(1);
    expect(slowFetch).toHaveBeenCalledTimes(1);
  });

  it('aborts stalled JWKS fetch using timeout', async () => {
    const stalledFetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>(
          (_resolve, reject) => {
            if (init?.signal) {
              init.signal.addEventListener('abort', () => {
                reject(new Error('Fetch timed out'));
              });
            }
          }
        )
    );

    const cache = new JwksCache('https://idp.example.com/stalled-jwks', {
      timeoutMs: 50, // fast timeout for test
      fetchFn: stalledFetch
    });

    await expect(cache.getPublicKey('key-1')).rejects.toThrow(AuthenticationError);
  });

  it('negatively caches unknown key IDs to prevent IdP amplification attacks', async () => {
    let fetchCount = 0;
    const testJwk = generateRsaJwk('valid-key');

    const mockFetch = vi.fn(async () => {
      fetchCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ keys: [testJwk] })
      };
    });

    const cache = new JwksCache('https://idp.example.com/jwks', {
      negativeTtlMs: 1000,
      minRefreshIntervalMs: 1000,
      fetchFn: mockFetch
    });

    // First lookup for unknown kid triggers fetch and fails
    await expect(cache.getPublicKey('unknown-kid-xyz')).rejects.toThrow(
      "Unknown key ID (kid): 'unknown-kid-xyz'"
    );
    expect(fetchCount).toBe(1);

    // Repeated lookups for the same unknown kid must NOT trigger further outbound fetches
    for (let i = 0; i < 5; i++) {
      await expect(cache.getPublicKey('unknown-kid-xyz')).rejects.toThrow(
        "Unknown key ID (kid): 'unknown-kid-xyz'"
      );
    }
    expect(fetchCount).toBe(1);
  });

  it('filters out non-RSA, encryption (enc), and non-RS256 keys', async () => {
    const rsaSigKey = generateRsaJwk('rsa-sig-key');
    const rsaEncKey = generateRsaJwk('rsa-enc-key', { use: 'enc' });
    const rsaPsKey = generateRsaJwk('rsa-ps-key', { alg: 'PS256' });
    const ecKey = {
      kty: 'EC',
      kid: 'ec-key',
      use: 'sig',
      crv: 'P-256',
      x: 'f83OJ3D2xFmT4v7Gy4e55UTqD8UvxUgh1L8kK27i200',
      y: 'x_da7Wygv2hMoZ69o4rdNR0vo1gQKPVTVY2zBgo40TV'
    };

    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ keys: [rsaSigKey, rsaEncKey, rsaPsKey, ecKey] })
    }));

    const cache = new JwksCache('https://idp.example.com/jwks', {
      fetchFn: mockFetch
    });

    // rsa-sig-key should be accepted
    const keyObject = await cache.getPublicKey('rsa-sig-key');
    expect(keyObject).toBeDefined();

    // rsa-enc-key must be ignored and rejected
    await expect(cache.getPublicKey('rsa-enc-key')).rejects.toThrow(
      "Unknown key ID (kid): 'rsa-enc-key'"
    );

    // rsa-ps-key must be ignored and rejected
    await expect(cache.getPublicKey('rsa-ps-key')).rejects.toThrow(
      "Unknown key ID (kid): 'rsa-ps-key'"
    );

    // ecKey must be ignored and rejected
    await expect(cache.getPublicKey('ec-key')).rejects.toThrow("Unknown key ID (kid): 'ec-key'");
  });

  it('caps accepted keys to maxKeys limit', async () => {
    const keys: JwkKey[] = [];
    for (let i = 1; i <= 10; i++) {
      keys.push(generateRsaJwk(`key-${i}`));
    }

    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ keys })
    }));

    const cache = new JwksCache('https://idp.example.com/jwks', {
      maxKeys: 3,
      fetchFn: mockFetch
    });

    // First 3 keys should be available
    expect(await cache.getPublicKey('key-1')).toBeDefined();
    expect(await cache.getPublicKey('key-2')).toBeDefined();
    expect(await cache.getPublicKey('key-3')).toBeDefined();

    // 4th key should not be loaded
    await expect(cache.getPublicKey('key-4')).rejects.toThrow("Unknown key ID (kid): 'key-4'");
  });
});
