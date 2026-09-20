import crypto from 'node:crypto';
import { AuthenticationError } from '../../application/ports/identity/index.js';

export interface JwkKey {
  readonly kty: string;
  readonly kid?: string;
  readonly use?: string;
  readonly alg?: string;
  readonly n?: string;
  readonly e?: string;
  readonly x?: string;
  readonly y?: string;
  readonly crv?: string;
  readonly [key: string]: unknown;
}

export interface JwksResponse {
  readonly keys: readonly JwkKey[];
}

export interface JwksCacheOptions {
  readonly ttlMs?: number;
  readonly negativeTtlMs?: number;
  readonly timeoutMs?: number;
  readonly maxKeys?: number;
  readonly minRefreshIntervalMs?: number;
  readonly fetchFn?: (
    url: string,
    init?: RequestInit
  ) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;
}

export class JwksCache {
  private readonly jwksUri: string;
  private readonly ttlMs: number;
  private readonly negativeTtlMs: number;
  private readonly timeoutMs: number;
  private readonly maxKeys: number;
  private readonly minRefreshIntervalMs: number;
  private readonly fetchFn: (
    url: string,
    init?: RequestInit
  ) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;

  private keysByKid = new Map<string, { key: crypto.KeyObject; jwk: JwkKey }>();
  private defaultKey?: { key: crypto.KeyObject; jwk: JwkKey };
  private negativeKidCache = new Map<string, number>();
  private lastFetchedAt = 0;
  private lastRefreshedAt = 0;
  private inFlightRefreshPromise?: Promise<void>;

  constructor(jwksUri: string, options: JwksCacheOptions = {}) {
    this.jwksUri = jwksUri;
    this.ttlMs = options.ttlMs ?? 60 * 60 * 1000; // 1 hour default
    this.negativeTtlMs = options.negativeTtlMs ?? 30 * 1000; // 30 seconds default
    this.timeoutMs = options.timeoutMs ?? 5000; // 5 seconds default
    this.maxKeys = options.maxKeys ?? 50; // Cap at 50 keys
    this.minRefreshIntervalMs = options.minRefreshIntervalMs ?? 10 * 1000; // 10s between unknown-kid refreshes
    this.fetchFn = options.fetchFn ?? ((url: string, init?: RequestInit) => fetch(url, init));
  }

  // Allow injecting keys directly (useful for tests without live HTTP)
  addKey(jwk: JwkKey): void {
    if (jwk.kty !== 'RSA') {
      return;
    }
    if (jwk.use && jwk.use !== 'sig') {
      return;
    }
    if (jwk.alg && jwk.alg !== 'RS256') {
      return;
    }
    const keyObject = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' });
    const entry = { key: keyObject, jwk };
    if (jwk.kid) {
      this.keysByKid.set(jwk.kid, entry);
      this.negativeKidCache.delete(jwk.kid);
    }
    if (!this.defaultKey) {
      this.defaultKey = entry;
    }
  }

  async getPublicKey(kid?: string): Promise<crypto.KeyObject> {
    if (!kid || typeof kid !== 'string' || kid.trim().length === 0) {
      if (this.defaultKey) {
        return this.defaultKey.key;
      }
      throw new AuthenticationError('Missing key ID (kid) in token header', {
        reason: 'MISSING_KID'
      });
    }

    const cleanKid = kid.trim();
    const now = Date.now();

    // 1. Negative cache check for unknown kid to prevent IdP amplification attacks
    const negativeTimestamp = this.negativeKidCache.get(cleanKid);
    if (negativeTimestamp && now - negativeTimestamp < this.negativeTtlMs) {
      throw new AuthenticationError(`Unknown key ID (kid): '${cleanKid}' in JWKS`, {
        reason: 'UNKNOWN_KID',
        kid: cleanKid
      });
    }

    // 2. Cache hit check
    const isExpired = now - this.lastFetchedAt > this.ttlMs;
    if (this.keysByKid.has(cleanKid) && !isExpired) {
      return this.keysByKid.get(cleanKid)!.key;
    }

    // 3. Rate-limit unknown-key refreshes: if keys are cached and refreshed recently, fail closed without outbound spam
    if (
      this.keysByKid.size > 0 &&
      !isExpired &&
      now - this.lastRefreshedAt < this.minRefreshIntervalMs
    ) {
      this.recordNegativeKid(cleanKid);
      throw new AuthenticationError(`Unknown key ID (kid): '${cleanKid}' in JWKS`, {
        reason: 'UNKNOWN_KID',
        kid: cleanKid
      });
    }

    // 4. Refresh JWKS with request coalescing
    await this.coalescedRefresh();

    // 5. Post-refresh key lookup
    const found = this.keysByKid.get(cleanKid);
    if (found) {
      return found.key;
    }

    // Negatively cache the unknown kid so subsequent requests fail fast
    this.recordNegativeKid(cleanKid);
    throw new AuthenticationError(`Unknown key ID (kid): '${cleanKid}' in JWKS`, {
      reason: 'UNKNOWN_KID',
      kid: cleanKid
    });
  }

  private recordNegativeKid(kid: string): void {
    if (this.negativeKidCache.size > 500) {
      const firstKey = this.negativeKidCache.keys().next().value;
      if (firstKey) this.negativeKidCache.delete(firstKey);
    }
    this.negativeKidCache.set(kid, Date.now());
  }

  private async coalescedRefresh(): Promise<void> {
    if (this.inFlightRefreshPromise) {
      return this.inFlightRefreshPromise;
    }

    this.inFlightRefreshPromise = this.doRefresh();
    try {
      await this.inFlightRefreshPromise;
    } finally {
      this.inFlightRefreshPromise = undefined;
    }
  }

  private async doRefresh(): Promise<void> {
    const now = Date.now();
    this.lastRefreshedAt = now;

    try {
      const signal = AbortSignal.timeout(this.timeoutMs);
      const res = await this.fetchFn(this.jwksUri, { signal });
      if (!res.ok) {
        throw new Error(`JWKS HTTP error: ${(res as { status?: number }).status ?? 'not ok'}`);
      }
      const data = (await res.json()) as JwksResponse;
      if (!data || !Array.isArray(data.keys)) {
        throw new Error('Invalid JWKS response structure: missing keys array');
      }

      const newKeysByKid = new Map<string, { key: crypto.KeyObject; jwk: JwkKey }>();
      let newDefaultKey: { key: crypto.KeyObject; jwk: JwkKey } | undefined = undefined;

      const keysToProcess = data.keys.slice(0, this.maxKeys);
      for (const jwk of keysToProcess) {
        // Enforce strict RSA signing key compatibility
        if (jwk.kty !== 'RSA') {
          continue;
        }
        if (jwk.use && jwk.use !== 'sig') {
          continue;
        }
        if (jwk.alg && jwk.alg !== 'RS256') {
          continue;
        }
        if (!jwk.kid || typeof jwk.kid !== 'string' || jwk.kid.trim().length === 0) {
          continue;
        }

        const trimmedKid = jwk.kid.trim();
        if (newKeysByKid.has(trimmedKid)) {
          continue; // Ignore duplicate key IDs
        }

        try {
          const keyObject = crypto.createPublicKey({
            key: jwk as crypto.JsonWebKey,
            format: 'jwk'
          });
          const entry = { key: keyObject, jwk };
          newKeysByKid.set(trimmedKid, entry);
          if (!newDefaultKey) {
            newDefaultKey = entry;
          }
        } catch {
          // Ignore unparseable individual keys
        }
      }

      this.keysByKid = newKeysByKid;
      this.defaultKey = newDefaultKey;
      this.lastFetchedAt = Date.now();
    } catch (err) {
      // If we already have keys cached, continue using them despite refresh error
      if (this.keysByKid.size > 0 || this.defaultKey) {
        return;
      }
      throw new AuthenticationError(
        `Failed to fetch JWKS from '${this.jwksUri}': ${err instanceof Error ? err.message : String(err)}`,
        { reason: 'JWKS_FETCH_FAILED' }
      );
    }
  }
}
