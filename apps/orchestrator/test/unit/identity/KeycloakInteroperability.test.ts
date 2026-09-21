import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import type { JwkKey } from '../../../src/infrastructure/identity/jwksCache.js';

describe('Keycloak Realm Interoperability & Audience Protocol Mapper Proof (AC-1, AC-4, F-adfa7d6a)', () => {
  let tempDir: string;
  let privateKey: crypto.KeyObject;
  let publicJwk: JwkKey;
  let fetchSpy: any;
  let originalEnv: NodeJS.ProcessEnv;

  const keycloakIssuer = 'http://localhost:8080/realms/solutions-studio';
  const keycloakAudience = 'solutions-studio-api';
  const keycloakJwksUri =
    'http://localhost:8080/realms/solutions-studio/protocol/openid-connect/certs';

  beforeAll(() => {
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = keyPair.privateKey;
    const exported = keyPair.publicKey.export({ format: 'jwk' }) as JwkKey;
    publicJwk = {
      ...exported,
      kid: 'keycloak-rsa-key-1',
      use: 'sig',
      alg: 'RS256'
    };
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'keycloak-comp-test-'));
    originalEnv = { ...process.env };
    process.env.AUTH_PROVIDER = 'oidc';
    process.env.OIDC_ISSUER = keycloakIssuer;
    process.env.OIDC_AUDIENCE = keycloakAudience;
    process.env.OIDC_JWKS_URI = keycloakJwksUri;

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url) === keycloakJwksUri) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ keys: [publicJwk] })
        } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    });
  });

  afterEach(async () => {
    fetchSpy?.mockRestore();
    process.env = { ...originalEnv };
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function signKeycloakJwt(payload: Record<string, unknown>): string {
    const header = { alg: 'RS256', typ: 'JWT', kid: 'keycloak-rsa-key-1' };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.sign(
      'RSA-SHA256',
      Buffer.from(`${headerB64}.${payloadB64}`),
      privateKey
    );
    return `${headerB64}.${payloadB64}.${signature.toString('base64url')}`;
  }

  it('authenticates seeded reviewer.alice with audience-mapper and grants review capabilities', async () => {
    const server = composeOrchestratorHttpServer({
      storeDir: tempDir,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });

    // Realistic token emitted by Keycloak for reviewer.alice via solutions-studio-web client
    // including the audience mapper for solutions-studio-api
    const token = signKeycloakJwt({
      iss: keycloakIssuer,
      aud: keycloakAudience,
      sub: '33333333-aaaa-bbbb-cccc-000000000001',
      preferred_username: 'reviewer.alice',
      email: 'alice.reviewer@solutions-studio.local',
      name: 'Alice Reviewer',
      azp: 'solutions-studio-web',
      realm_access: {
        roles: ['requirements-reviewer', 'default-roles-solutions-studio']
      },
      iat: Math.floor(Date.now() / 1000) - 60,
      nbf: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const response = await server.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe('reviewer.alice');
    expect(body.name).toBe('Alice Reviewer');
    expect(body.email).toBe('alice.reviewer@solutions-studio.local');
    expect(body.actorType).toBe('human');
    expect(body.capabilities).toContain('requirements:reconcile');
    expect(body.capabilities).toContain('candidate:approve');
    expect(body.capabilities).not.toContain('baseline:create');

    await server.app.close();
  });

  it('authenticates seeded architect.bob with lead-architect role and grants baseline/decision capabilities', async () => {
    const server = composeOrchestratorHttpServer({
      storeDir: tempDir,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });

    const token = signKeycloakJwt({
      iss: keycloakIssuer,
      aud: keycloakAudience,
      sub: '33333333-aaaa-bbbb-cccc-000000000002',
      preferred_username: 'architect.bob',
      email: 'bob.architect@solutions-studio.local',
      name: 'Bob Architect',
      azp: 'solutions-studio-web',
      realm_access: {
        roles: ['lead-architect', 'default-roles-solutions-studio']
      },
      iat: Math.floor(Date.now() / 1000) - 60,
      nbf: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const response = await server.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe('architect.bob');
    expect(body.actorType).toBe('human');
    expect(body.capabilities).toContain('engineering-decision:approve');
    expect(body.capabilities).toContain('engineering-decision:author');
    expect(body.capabilities).toContain('baseline:create');
    expect(body.capabilities).toContain('policy-constraint:author');

    await server.app.close();
  });

  it('rejects token missing the audience protocol mapper output with 401 unauthenticated', async () => {
    const server = composeOrchestratorHttpServer({
      storeDir: tempDir,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });

    // Without the audience mapper, Keycloak emits aud: ['account'] or aud: 'solutions-studio-web'
    const tokenWithoutAudienceMapper = signKeycloakJwt({
      iss: keycloakIssuer,
      aud: 'solutions-studio-web',
      sub: '33333333-aaaa-bbbb-cccc-000000000001',
      preferred_username: 'reviewer.alice',
      email: 'alice.reviewer@solutions-studio.local',
      realm_access: {
        roles: ['requirements-reviewer']
      },
      iat: Math.floor(Date.now() / 1000) - 60,
      nbf: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const response = await server.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        authorization: `Bearer ${tokenWithoutAudienceMapper}`
      }
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.code).toBe('UNAUTHENTICATED');

    await server.app.close();
  });

  it('classifies Keycloak service account token as system actor and strips approval capabilities in composition', async () => {
    const server = composeOrchestratorHttpServer({
      storeDir: tempDir,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });

    // Keycloak service-account token: preferred_username starts with service-account-
    const token = signKeycloakJwt({
      iss: keycloakIssuer,
      aud: keycloakAudience,
      sub: 'service-account-solutions-studio-cli',
      preferred_username: 'service-account-solutions-studio-cli',
      azp: 'solutions-studio-cli',
      realm_access: {
        // Even if assigned requirements-reviewer role
        roles: ['requirements-reviewer']
      },
      iat: Math.floor(Date.now() / 1000) - 60,
      nbf: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const response = await server.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.actorType).toBe('system');
    expect(body.capabilities).not.toContain('requirements:reconcile');
    expect(body.capabilities).not.toContain('candidate:approve');

    await server.app.close();
  });
});
