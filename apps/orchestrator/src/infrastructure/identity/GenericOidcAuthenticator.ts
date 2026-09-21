import crypto from 'node:crypto';
import type { AuthenticatedActor } from '@solutions-studio/domain';
import {
  AuthenticationError,
  type IAuthenticator,
  type IdentityHealthReport,
  type IClaimMapper,
  type ValidatedTokenClaims
} from '../../application/ports/identity/index.js';
import { JwksCache } from './jwksCache.js';
import { ConfigurableClaimMapper } from './ConfigurableClaimMapper.js';

export interface GenericOidcAuthenticatorOptions {
  readonly issuer: string;
  readonly audience: string | readonly string[];
  readonly jwksUri?: string;
  readonly jwksCache?: JwksCache;
  readonly claimMapper?: IClaimMapper;
  readonly clockToleranceSeconds?: number;
}

export class GenericOidcAuthenticator implements IAuthenticator {
  private readonly issuer: string;
  private readonly audience: string | readonly string[];
  private readonly jwksCache: JwksCache;
  private readonly claimMapper: IClaimMapper;
  private readonly clockToleranceSeconds: number;

  constructor(options: GenericOidcAuthenticatorOptions) {
    this.issuer = options.issuer;
    this.audience = options.audience;
    this.clockToleranceSeconds = options.clockToleranceSeconds ?? 5;
    this.claimMapper = options.claimMapper ?? new ConfigurableClaimMapper();

    if (options.jwksCache) {
      this.jwksCache = options.jwksCache;
    } else if (options.jwksUri) {
      this.jwksCache = new JwksCache(options.jwksUri);
    } else {
      // Default standard Keycloak certs endpoint derivation if jwksUri not provided
      const defaultJwks = `${options.issuer.replace(/\/$/, '')}/protocol/openid-connect/certs`;
      this.jwksCache = new JwksCache(defaultJwks);
    }
  }

  async authenticate(token?: string): Promise<AuthenticatedActor> {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new AuthenticationError('Missing bearer token', {
        reason: 'MISSING_BEARER_TOKEN'
      });
    }

    const trimmed = token.trim();
    const parts = trimmed.split('.');
    if (parts.length !== 3) {
      throw new AuthenticationError('Malformed JWT: must contain 3 segments', {
        reason: 'MALFORMED_JWT'
      });
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    let header: { alg?: string; kid?: string; typ?: string };
    let payload: ValidatedTokenClaims;

    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    } catch {
      throw new AuthenticationError('Malformed JWT header: invalid JSON', {
        reason: 'MALFORMED_HEADER'
      });
    }

    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      throw new AuthenticationError('Malformed JWT payload: invalid JSON', {
        reason: 'MALFORMED_PAYLOAD'
      });
    }

    // 1. Verify algorithm (RS256 is the standard OIDC algorithm)
    if (!header.alg || header.alg !== 'RS256') {
      if (header.alg === 'none') {
        throw new AuthenticationError('Unsigned JWTs (alg: none) are forbidden', {
          reason: 'UNSIGNED_TOKEN'
        });
      }
      throw new AuthenticationError(
        `Unsupported JWT algorithm '${header.alg ?? 'undefined'}', only 'RS256' is supported`,
        { reason: 'UNSUPPORTED_ALGORITHM', alg: header.alg }
      );
    }

    if (!header.kid || typeof header.kid !== 'string' || header.kid.trim().length === 0) {
      throw new AuthenticationError('Missing or empty key ID (kid) in token header', {
        reason: 'MISSING_KID'
      });
    }

    // 2. Resolve public key from JWKS and verify signature
    const publicKey = await this.jwksCache.getPublicKey(header.kid.trim());
    const dataToVerify = Buffer.from(`${headerB64}.${payloadB64}`);
    const signature = Buffer.from(signatureB64, 'base64url');

    const isValidSig = crypto.verify('RSA-SHA256', dataToVerify, publicKey, signature);
    if (!isValidSig) {
      throw new AuthenticationError('Invalid token signature', {
        reason: 'INVALID_SIGNATURE'
      });
    }

    // 3. Validate issuer (iss)
    if (payload.iss !== this.issuer) {
      throw new AuthenticationError(
        `Invalid token issuer '${payload.iss}', expected '${this.issuer}'`,
        { reason: 'INVALID_ISSUER', actual: payload.iss, expected: this.issuer }
      );
    }

    // 4. Validate audience (aud)
    const expectedAudiences = Array.isArray(this.audience) ? this.audience : [this.audience];
    const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const hasAudienceMatch = expectedAudiences.some((ea) => tokenAudiences.includes(ea));
    if (!hasAudienceMatch) {
      throw new AuthenticationError(
        `Invalid token audience, expected one of [${expectedAudiences.join(', ')}]`,
        { reason: 'INVALID_AUDIENCE', actual: payload.aud, expected: this.audience }
      );
    }

    // 5. Validate expiration (exp) and not-before (nbf)
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (typeof payload.exp !== 'number') {
      throw new AuthenticationError('Missing or invalid exp claim in token', {
        reason: 'MISSING_EXP'
      });
    }

    if (nowSeconds > payload.exp + this.clockToleranceSeconds) {
      throw new AuthenticationError('Token has expired', {
        reason: 'TOKEN_EXPIRED',
        exp: payload.exp,
        now: nowSeconds
      });
    }

    if (typeof payload.nbf === 'number' && nowSeconds < payload.nbf - this.clockToleranceSeconds) {
      throw new AuthenticationError('Token is not yet valid', {
        reason: 'TOKEN_NOT_YET_VALID',
        nbf: payload.nbf,
        now: nowSeconds
      });
    }

    // 6. Validate subject (sub)
    if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) {
      throw new AuthenticationError('Missing or empty subject (sub) claim', {
        reason: 'MISSING_SUBJECT'
      });
    }

    // 7. Derive AuthenticatedActor through provider-neutral claim mapper
    return this.claimMapper.mapClaimsToActor(payload);
  }

  async checkHealth(): Promise<IdentityHealthReport> {
    const probe = await this.jwksCache.checkJwksReachability();
    return {
      status: probe.reachable ? 'healthy' : 'unhealthy',
      provider: 'oidc',
      issuer: this.issuer,
      reachable: probe.reachable,
      latencyMs: probe.latencyMs,
      error: probe.error
    };
  }
}
