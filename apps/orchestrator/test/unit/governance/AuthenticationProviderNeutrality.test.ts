import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createCandidateSha, type AuthenticatedActor } from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { DefaultAuthorizationPolicy } from '../../../src/infrastructure/identity/DefaultAuthorizationPolicy.js';
import {
  RecordValidationRunUseCase,
  ApproveCandidateUseCase
} from '../../../src/application/use-cases/governance/index.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';
import { TestAuthenticator } from '../../../src/infrastructure/identity/TestAuthenticator.js';
import { GenericOidcAuthenticator } from '../../../src/infrastructure/identity/GenericOidcAuthenticator.js';
import { JwksCache, type JwkKey } from '../../../src/infrastructure/identity/jwksCache.js';
import { ForbiddenError } from '../../../src/application/ports/identity/index.js';

describe('Authentication Provider Neutrality: Governance Approval Enforcement', () => {
  let tmpDir: string;
  let repo: FilesystemRequirementsRepository;
  let authorizer: DefaultAuthorizationPolicy;
  let recordRunUseCase: RecordValidationRunUseCase;
  let approveUseCase: ApproveCandidateUseCase;

  let privateKey: crypto.KeyObject;
  let publicJwk: JwkKey;
  let jwksCache: JwksCache;
  const issuer = 'http://localhost:8080/realms/solutions-studio';
  const audience = 'solutions-studio-api';
  let genericOidcAuth: GenericOidcAuthenticator;

  const candidateSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';
  const artifactHash = 'a'.repeat(64);

  beforeAll(() => {
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = keyPair.privateKey;
    const exportedJwk = keyPair.publicKey.export({ format: 'jwk' }) as JwkKey;
    publicJwk = {
      ...exportedJwk,
      kid: 'key-test-neutrality',
      use: 'sig',
      alg: 'RS256'
    };
    jwksCache = new JwksCache('http://localhost:8080/mock-jwks');
    jwksCache.addKey(publicJwk);

    genericOidcAuth = new GenericOidcAuthenticator({
      issuer,
      audience,
      jwksCache
    });
  });

  function createSignedJwt(payloadOverrides: Record<string, unknown> = {}): string {
    const header = {
      alg: 'RS256',
      typ: 'JWT',
      kid: 'key-test-neutrality'
    };
    const payload = {
      iss: issuer,
      aud: audience,
      sub: 'usr-123',
      preferred_username: 'bob.reviewer',
      name: 'Bob Enterprise Reviewer',
      email: 'bob@enterprise.corp',
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
    return `${headerB64}.${payloadB64}.${signature.toString('base64url')}`;
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gov-auth-neutrality-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tmpDir });
    authorizer = new DefaultAuthorizationPolicy();
    recordRunUseCase = new RecordValidationRunUseCase(repo);
    approveUseCase = new ApproveCandidateUseCase(repo, authorizer);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('domain & use case enforce provider-neutral capability without provider-specific logic', async () => {
    const run = await recordRunUseCase.execute({
      candidateSha,
      phase: 'phase-3',
      executionMode: 'deterministic-ci',
      provider: 'fake',
      artifacts: [
        {
          name: 'schema-ddl.sql',
          artifactType: 'sql-ddl',
          contentHash: artifactHash
        }
      ],
      proposedDisposition: 'GO',
      executedBy: 'runner:ci'
    });

    // 1. Actor produced by TestAuthenticator
    const testAuth = new TestAuthenticator({
      allowAnonymousFallback: false
    });
    const testActor: AuthenticatedActor = await testAuth.authenticate('test:reviewer');

    // 2. Actor produced by GenericOidcAuthenticator with Keycloak realm role
    const keycloakJwt = createSignedJwt({
      preferred_username: 'bob.reviewer',
      name: 'Bob Keycloak Reviewer',
      realm_access: {
        roles: ['requirements-reviewer']
      }
    });
    const oidcActor: AuthenticatedActor = await genericOidcAuth.authenticate(keycloakJwt);
    expect(oidcActor.capabilities.has('candidate:approve')).toBe(true);

    // Both succeed identically
    const approvalTest = await approveUseCase.execute({
      candidateSha: createCandidateSha(candidateSha),
      validationRunId: run.id,
      evidenceDigest: run.evidenceDigest,
      decision: 'GO',
      rationale: 'Approved via test authenticator actor',
      actor: testActor
    });
    expect(approvalTest.status).toBe('ACTIVE');
    expect(approvalTest.actor.id).toBe(testActor.id);

    // Superseding approval from OIDC actor
    const approvalOidc = await approveUseCase.execute({
      candidateSha: createCandidateSha(candidateSha),
      validationRunId: run.id,
      evidenceDigest: run.evidenceDigest,
      decision: 'GO',
      rationale: 'Approved via OIDC authenticator actor',
      supersedes: approvalTest.id,
      actor: oidcActor
    });
    expect(approvalOidc.status).toBe('ACTIVE');
    expect(approvalOidc.actor.id).toBe('bob.reviewer');
    expect(approvalOidc.supersedes).toBe(approvalTest.id);

    // Both are rejected identically when lacking candidate:approve
    const unauthorizedJwt = createSignedJwt({
      preferred_username: 'charlie.viewer',
      name: 'Charlie Readonly',
      realm_access: {
        roles: ['solutions-studio-viewer']
      }
    });
    const unauthorizedOidcActor = await genericOidcAuth.authenticate(unauthorizedJwt);
    expect(unauthorizedOidcActor.capabilities.has('candidate:approve')).toBe(false);

    await expect(
      approveUseCase.execute({
        candidateSha: createCandidateSha(candidateSha),
        validationRunId: run.id,
        evidenceDigest: run.evidenceDigest,
        decision: 'GO',
        rationale: 'Should fail',
        actor: unauthorizedOidcActor
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it('HTTP routes enforce identical governance approval semantics regardless of plugged-in IAuthenticator', async () => {
    const testAuth = new TestAuthenticator({
      allowAnonymousFallback: false
    });

    const testServer = composeOrchestratorHttpServer({
      storeDir: tmpDir,
      repository: repo,
      authenticator: testAuth,
      fastifyOptions: { logger: false }
    }).app;

    const oidcServer = composeOrchestratorHttpServer({
      storeDir: tmpDir,
      repository: repo,
      authenticator: genericOidcAuth,
      fastifyOptions: { logger: false }
    }).app;

    await testServer.ready();
    await oidcServer.ready();

    try {
      const run = await recordRunUseCase.execute({
        candidateSha,
        phase: 'phase-3',
        executionMode: 'deterministic-ci',
        provider: 'fake',
        artifacts: [
          {
            name: 'schema-ddl.sql',
            artifactType: 'sql-ddl',
            contentHash: artifactHash
          }
        ],
        proposedDisposition: 'GO',
        executedBy: 'runner:ci'
      });

      // 1. Test Server with test:reviewer
      const testRes = await testServer.inject({
        method: 'POST',
        url: '/api/governance/approvals',
        headers: { authorization: 'Bearer test:reviewer' },
        payload: {
          candidateSha,
          validationRunId: run.id,
          evidenceDigest: run.evidenceDigest,
          decision: 'GO',
          rationale: 'Approved via Test Authenticator'
        }
      });
      expect(testRes.statusCode).toBe(201);
      const testApproval = testRes.json();
      expect(testApproval.status).toBe('ACTIVE');

      // 2. OIDC Server with Keycloak RS256 token superseding previous
      const keycloakReviewerJwt = createSignedJwt({
        preferred_username: 'bob.reviewer',
        name: 'Bob Enterprise Reviewer',
        email: 'bob@enterprise.corp',
        realm_access: {
          roles: ['requirements-reviewer']
        }
      });

      const oidcRes = await oidcServer.inject({
        method: 'POST',
        url: '/api/governance/approvals',
        headers: { authorization: `Bearer ${keycloakReviewerJwt}` },
        payload: {
          candidateSha,
          validationRunId: run.id,
          evidenceDigest: run.evidenceDigest,
          decision: 'GO',
          rationale: 'Approved via Keycloak OIDC Authenticator',
          supersedes: testApproval.id
        }
      });
      expect(oidcRes.statusCode).toBe(201);
      const oidcApproval = oidcRes.json();
      expect(oidcApproval.status).toBe('ACTIVE');
      expect(oidcApproval.actor.id).toBe('bob.reviewer');
      expect(oidcApproval.supersedes).toBe(testApproval.id);

      // 3. OIDC Server with Microsoft Entra ID token superseding previous
      const entraReviewerJwt = createSignedJwt({
        preferred_username: 'carol@entra.microsoft.com',
        name: 'Carol Entra Reviewer',
        email: 'carol@entra.microsoft.com',
        roles: ['SolutionsStudio.Reviewer']
      });

      const entraRes = await oidcServer.inject({
        method: 'POST',
        url: '/api/governance/approvals',
        headers: { authorization: `Bearer ${entraReviewerJwt}` },
        payload: {
          candidateSha,
          validationRunId: run.id,
          evidenceDigest: run.evidenceDigest,
          decision: 'GO',
          rationale: 'Approved via Entra ID App Role',
          supersedes: oidcApproval.id
        }
      });
      expect(entraRes.statusCode).toBe(201);
      const entraApproval = entraRes.json();
      expect(entraApproval.status).toBe('ACTIVE');
      expect(entraApproval.actor.id).toBe('carol@entra.microsoft.com');
      expect(entraApproval.supersedes).toBe(oidcApproval.id);

      // 4. Unauthorized OIDC user (viewer role only) is rejected with 403 FORBIDDEN
      const viewerJwt = createSignedJwt({
        preferred_username: 'dan.viewer',
        name: 'Dan Viewer',
        realm_access: {
          roles: ['solutions-studio-viewer']
        }
      });

      const forbiddenOidcRes = await oidcServer.inject({
        method: 'POST',
        url: '/api/governance/approvals',
        headers: { authorization: `Bearer ${viewerJwt}` },
        payload: {
          candidateSha,
          validationRunId: run.id,
          evidenceDigest: run.evidenceDigest,
          decision: 'GO',
          rationale: 'Unauthorized sign-off attempt'
        }
      });
      expect(forbiddenOidcRes.statusCode).toBe(403);
      expect(forbiddenOidcRes.json().code).toBe('FORBIDDEN');

      // 5. Unauthenticated / invalid signature request is rejected with 401 UNAUTHORIZED
      const unauthorizedRes = await oidcServer.inject({
        method: 'POST',
        url: '/api/governance/approvals',
        headers: { authorization: 'Bearer invalid-token-signature' },
        payload: {
          candidateSha,
          validationRunId: run.id,
          evidenceDigest: run.evidenceDigest,
          decision: 'GO',
          rationale: 'Unauthenticated sign-off attempt'
        }
      });
      expect(unauthorizedRes.statusCode).toBe(401);
      expect(unauthorizedRes.json().code).toBe('UNAUTHENTICATED');
    } finally {
      await testServer.close();
      await oidcServer.close();
    }
  });
});
