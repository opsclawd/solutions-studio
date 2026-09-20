import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { GenericOidcAuthenticator } from '../../../src/infrastructure/identity/GenericOidcAuthenticator.js';
import { JwksCache, type JwkKey } from '../../../src/infrastructure/identity/jwksCache.js';
import { AuthenticationError } from '../../../src/application/ports/identity/IdentityErrors.js';

describe('GenericOidcAuthenticator', () => {
  let privateKey: crypto.KeyObject;
  let publicJwk: JwkKey;
  let jwksCache: JwksCache;
  const issuer = 'http://localhost:8080/realms/solutions-studio';
  const audience = 'solutions-studio-api';

  beforeAll(() => {
    // Generate RSA 2048 key pair
    const keyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048
    });
    privateKey = keyPair.privateKey;
    const exportedJwk = keyPair.publicKey.export({ format: 'jwk' }) as JwkKey;
    publicJwk = {
      ...exportedJwk,
      kid: 'key-1',
      use: 'sig',
      alg: 'RS256'
    };

    jwksCache = new JwksCache('http://localhost:8080/mock-jwks');
    jwksCache.addKey(publicJwk);
  });

  function createSignedJwt(
    payloadOverrides: Record<string, unknown> = {},
    headerOverrides: Record<string, unknown> = {}
  ): string {
    const header = {
      alg: 'RS256',
      typ: 'JWT',
      kid: 'key-1',
      ...headerOverrides
    };

    const payload = {
      iss: issuer,
      aud: audience,
      sub: 'usr-123',
      preferred_username: 'alice.reviewer',
      name: 'Alice Reviewer',
      realm_access: {
        roles: ['requirements-reviewer']
      },
      exp: Math.floor(Date.now() / 1000) + 3600,
      nbf: Math.floor(Date.now() / 1000) - 10,
      ...payloadOverrides
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.sign(
      'RSA-SHA256',
      Buffer.from(`${headerB64}.${payloadB64}`),
      privateKey
    );
    const signatureB64 = signature.toString('base64url');

    return `${headerB64}.${payloadB64}.${signatureB64}`;
  }

  it('successfully authenticates a valid RS256 signed OIDC token', async () => {
    const auth = new GenericOidcAuthenticator({
      issuer,
      audience,
      jwksCache
    });

    const token = createSignedJwt();
    const actor = await auth.authenticate(token);

    expect(actor.id).toBe('alice.reviewer');
    expect(actor.name).toBe('Alice Reviewer');
    expect(actor.actorType).toBe('human');
    expect(actor.capabilities.has('requirements:reconcile')).toBe(true);
    expect(actor.capabilities.has('candidate:approve')).toBe(true);
  });

  it('rejects missing or empty token with AuthenticationError', async () => {
    const auth = new GenericOidcAuthenticator({
      issuer,
      audience,
      jwksCache
    });

    await expect(auth.authenticate(undefined)).rejects.toThrow(AuthenticationError);
    await expect(auth.authenticate('')).rejects.toThrow(AuthenticationError);
  });

  it('rejects malformed token structure', async () => {
    const auth = new GenericOidcAuthenticator({
      issuer,
      audience,
      jwksCache
    });

    await expect(auth.authenticate('not.a.valid.jwt.token')).rejects.toThrow(AuthenticationError);
    await expect(auth.authenticate('only-one-part')).rejects.toThrow(AuthenticationError);
  });

  it('rejects token with tampered signature', async () => {
    const auth = new GenericOidcAuthenticator({
      issuer,
      audience,
      jwksCache
    });

    const validToken = createSignedJwt();
    const parts = validToken.split('.');
    // Tamper with payload
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(parts[1], 'base64url').toString()),
        sub: 'hacker'
      })
    ).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    await expect(auth.authenticate(tamperedToken)).rejects.toThrow('Invalid token signature');
  });

  it('rejects token with mismatched issuer', async () => {
    const auth = new GenericOidcAuthenticator({
      issuer,
      audience,
      jwksCache
    });

    const token = createSignedJwt({ iss: 'https://rogue-idp.com' });
    await expect(auth.authenticate(token)).rejects.toThrow(
      "Invalid token issuer 'https://rogue-idp.com'"
    );
  });

  it('rejects token with mismatched audience', async () => {
    const auth = new GenericOidcAuthenticator({
      issuer,
      audience,
      jwksCache
    });

    const token = createSignedJwt({ aud: 'other-app' });
    await expect(auth.authenticate(token)).rejects.toThrow('Invalid token audience');
  });

  it('rejects expired token', async () => {
    const auth = new GenericOidcAuthenticator({
      issuer,
      audience,
      jwksCache,
      clockToleranceSeconds: 0
    });

    const expiredToken = createSignedJwt({
      exp: Math.floor(Date.now() / 1000) - 60
    });
    await expect(auth.authenticate(expiredToken)).rejects.toThrow('Token has expired');
  });

  it('rejects token with future not-before (nbf)', async () => {
    const auth = new GenericOidcAuthenticator({
      issuer,
      audience,
      jwksCache,
      clockToleranceSeconds: 0
    });

    const futureToken = createSignedJwt({
      nbf: Math.floor(Date.now() / 1000) + 120
    });
    await expect(auth.authenticate(futureToken)).rejects.toThrow('Token is not yet valid');
  });

  it('rejects token with alg: none (unsigned token)', async () => {
    const auth = new GenericOidcAuthenticator({
      issuer,
      audience,
      jwksCache
    });

    const noneToken = createSignedJwt({}, { alg: 'none' });
    await expect(auth.authenticate(noneToken)).rejects.toThrow(
      'Unsigned JWTs (alg: none) are forbidden'
    );
  });

  it('rejects token with missing alg in header', async () => {
    const auth = new GenericOidcAuthenticator({
      issuer,
      audience,
      jwksCache
    });

    const header = { typ: 'JWT', kid: 'key-1' };
    const payload = {
      iss: issuer,
      aud: audience,
      sub: 'usr-123',
      exp: Math.floor(Date.now() / 1000) + 3600
    };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sigB64 = Buffer.from('fake-sig').toString('base64url');
    const token = `${headerB64}.${payloadB64}.${sigB64}`;

    await expect(auth.authenticate(token)).rejects.toThrow(
      "Unsupported JWT algorithm 'undefined', only 'RS256' is supported"
    );
  });

  it('rejects token with unsupported symmetric or asymmetric algorithm (HS256)', async () => {
    const auth = new GenericOidcAuthenticator({
      issuer,
      audience,
      jwksCache
    });

    const hs256Token = createSignedJwt({}, { alg: 'HS256' });
    await expect(auth.authenticate(hs256Token)).rejects.toThrow(
      "Unsupported JWT algorithm 'HS256', only 'RS256' is supported"
    );
  });

  it('rejects token with missing or empty kid', async () => {
    const auth = new GenericOidcAuthenticator({
      issuer,
      audience,
      jwksCache
    });

    const noKidToken = createSignedJwt({}, { kid: '' });
    await expect(auth.authenticate(noKidToken)).rejects.toThrow(
      'Missing or empty key ID (kid) in token header'
    );
  });

  it('rejects token with unknown kid not present in JWKS', async () => {
    const auth = new GenericOidcAuthenticator({
      issuer,
      audience,
      jwksCache
    });

    const unknownKidToken = createSignedJwt({}, { kid: 'non-existent-kid-999' });
    await expect(auth.authenticate(unknownKidToken)).rejects.toThrow(
      "Unknown key ID (kid): 'non-existent-kid-999' in JWKS"
    );
  });
});
