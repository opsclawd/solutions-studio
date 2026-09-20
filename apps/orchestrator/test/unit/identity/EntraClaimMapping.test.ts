import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConfigurableClaimMapper } from '../../../src/infrastructure/identity/ConfigurableClaimMapper.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import type { JwkKey } from '../../../src/infrastructure/identity/jwksCache.js';

describe('Microsoft Entra ID Claim Mapping Compatibility Proof', () => {
  it('maps standard Microsoft Entra ID v2.0 token claims into Solutions Studio capabilities', () => {
    const mapper = new ConfigurableClaimMapper();

    // Realistic Microsoft Entra ID access token claims fixture
    const entraClaims = {
      aud: 'https://api.solutions-studio.enterprise.com',
      iss: 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0',
      iat: Math.floor(Date.now() / 1000) - 60,
      nbf: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
      aio: 'AXQAi/8TAAAA...',
      azp: 'd0e06000-0000-0000-0000-000000000000',
      name: 'Alice Corp',
      oid: 'aaaaaaaa-0000-0000-0000-000000000001',
      preferred_username: 'alice@corp.onmicrosoft.com',
      rh: '0.AAAA...',
      roles: ['SolutionsStudio.Reviewer'],
      sub: 'aaaaaaaa-0000-0000-0000-000000000001',
      tid: '72f988bf-86f1-41af-91ab-2d7cd011db47',
      upn: 'alice@corp.onmicrosoft.com',
      uti: 'm5m9V6...',
      ver: '2.0'
    };

    const actor = mapper.mapClaimsToActor(entraClaims);

    expect(actor.id).toBe('alice@corp.onmicrosoft.com');
    expect(actor.name).toBe('Alice Corp');
    expect(actor.email).toBe('alice@corp.onmicrosoft.com');
    expect(actor.actorType).toBe('human');
    expect(actor.capabilities.has('requirements:reconcile')).toBe(true);
    expect(actor.capabilities.has('candidate:approve')).toBe(true);
    expect(actor.capabilities.has('baseline:create')).toBe(false);
  });

  it('maps Entra ID Architect role with decision and baseline capabilities', () => {
    const mapper = new ConfigurableClaimMapper();

    const entraArchitectClaims = {
      aud: 'https://api.solutions-studio.enterprise.com',
      iss: 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0',
      exp: Math.floor(Date.now() / 1000) + 3600,
      name: 'Bob Enterprise Architect',
      oid: 'bbbbbbbb-0000-0000-0000-000000000002',
      preferred_username: 'bob@corp.onmicrosoft.com',
      roles: ['SolutionsStudio.Architect'],
      sub: 'bbbbbbbb-0000-0000-0000-000000000002',
      tid: '72f988bf-86f1-41af-91ab-2d7cd011db47',
      upn: 'bob@corp.onmicrosoft.com'
    };

    const actor = mapper.mapClaimsToActor(entraArchitectClaims);

    expect(actor.id).toBe('bob@corp.onmicrosoft.com');
    expect(actor.capabilities.has('engineering-decision:approve')).toBe(true);
    expect(actor.capabilities.has('engineering-decision:author')).toBe(true);
    expect(actor.capabilities.has('baseline:create')).toBe(true);
    expect(actor.capabilities.has('policy-constraint:author')).toBe(true);
  });

  it('correctly identifies Entra app-only (service principal) token as system actor and denies approval capabilities', () => {
    const mapper = new ConfigurableClaimMapper();

    // App-only token has appid, idp, oid, sub, roles, but NO upn/preferred_username
    const entraServicePrincipalClaims = {
      aud: 'https://api.solutions-studio.enterprise.com',
      iss: 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0',
      exp: Math.floor(Date.now() / 1000) + 3600,
      appid: '11111111-2222-3333-4444-555555555555',
      idp: 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0',
      oid: '99999999-8888-7777-6666-555555555555',
      sub: '99999999-8888-7777-6666-555555555555',
      tid: '72f988bf-86f1-41af-91ab-2d7cd011db47',
      // App claims SolutionsStudio.Reviewer app role
      roles: ['SolutionsStudio.Reviewer']
    };

    const actor = mapper.mapClaimsToActor(entraServicePrincipalClaims);

    expect(actor.actorType).toBe('system');
    // Human approval capabilities MUST NOT be granted to service principal
    expect(actor.capabilities.has('requirements:reconcile')).toBe(false);
    expect(actor.capabilities.has('candidate:approve')).toBe(false);
  });

  describe('Entra ID End-to-End Composition & Verification Proof', () => {
    let tempDir: string;
    let privateKey: crypto.KeyObject;
    let publicJwk: JwkKey;
    let fetchSpy: any;
    let originalEnv: NodeJS.ProcessEnv;

    const tenantId = '72f988bf-86f1-41af-91ab-2d7cd011db47';
    const entraIssuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
    const entraAudience = 'api://solutions-studio';
    const entraJwksUri = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;

    beforeAll(() => {
      const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      privateKey = keyPair.privateKey;
      const exported = keyPair.publicKey.export({ format: 'jwk' }) as JwkKey;
      publicJwk = {
        ...exported,
        kid: 'entra-rsa-key-1',
        use: 'sig',
        alg: 'RS256'
      };
    });

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'entra-comp-test-'));
      originalEnv = { ...process.env };
      process.env.AUTH_PROVIDER = 'oidc';
      process.env.OIDC_ISSUER = entraIssuer;
      process.env.OIDC_AUDIENCE = entraAudience;
      process.env.OIDC_JWKS_URI = entraJwksUri;

      fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (String(url) === entraJwksUri) {
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

    function signEntraJwt(payload: Record<string, unknown>): string {
      const header = { alg: 'RS256', typ: 'JWT', kid: 'entra-rsa-key-1' };
      const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const signature = crypto.sign(
        'RSA-SHA256',
        Buffer.from(`${headerB64}.${payloadB64}`),
        privateKey
      );
      return `${headerB64}.${payloadB64}.${signature.toString('base64url')}`;
    }

    it('authenticates Entra user token via composed Fastify server and /api/auth/me', async () => {
      const server = composeOrchestratorHttpServer({
        storeDir: tempDir,
        generationGateway: new FakeGenerationGateway(),
        linterGateway: new FakeMermaidLinterGateway()
      });

      const token = signEntraJwt({
        aud: entraAudience,
        iss: entraIssuer,
        iat: Math.floor(Date.now() / 1000) - 60,
        nbf: Math.floor(Date.now() / 1000) - 60,
        exp: Math.floor(Date.now() / 1000) + 3600,
        name: 'Alice Corp',
        oid: 'aaaaaaaa-0000-0000-0000-000000000001',
        preferred_username: 'alice@corp.onmicrosoft.com',
        roles: ['SolutionsStudio.Reviewer'],
        sub: 'aaaaaaaa-0000-0000-0000-000000000001',
        tid: tenantId,
        upn: 'alice@corp.onmicrosoft.com',
        ver: '2.0'
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
      expect(body.id).toBe('alice@corp.onmicrosoft.com');
      expect(body.name).toBe('Alice Corp');
      expect(body.email).toBe('alice@corp.onmicrosoft.com');
      expect(body.actorType).toBe('human');
      expect(body.capabilities).toContain('requirements:reconcile');
      expect(body.capabilities).toContain('candidate:approve');

      await server.app.close();
    });

    it('authenticates Entra app-only token as system actor and denies human approvals in composition', async () => {
      const server = composeOrchestratorHttpServer({
        storeDir: tempDir,
        generationGateway: new FakeGenerationGateway(),
        linterGateway: new FakeMermaidLinterGateway()
      });

      const token = signEntraJwt({
        aud: entraAudience,
        iss: entraIssuer,
        iat: Math.floor(Date.now() / 1000) - 60,
        nbf: Math.floor(Date.now() / 1000) - 60,
        exp: Math.floor(Date.now() / 1000) + 3600,
        appid: '11111111-2222-3333-4444-555555555555',
        oid: '99999999-8888-7777-6666-555555555555',
        sub: '99999999-8888-7777-6666-555555555555',
        tid: tenantId,
        roles: ['SolutionsStudio.Reviewer'],
        ver: '2.0'
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
});
