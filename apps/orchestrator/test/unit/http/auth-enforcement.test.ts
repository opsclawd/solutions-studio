import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  createRequirementId,
  createRequirementRevisionId,
  createRequirementsBaselineId,
  createReviewerId,
  createActorId,
  createRequirementRevision,
  createRequirementsBaseline,
  createFindingId,
  createCandidateFinding,
  now
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';
import { TestAuthenticator } from '../../../src/infrastructure/identity/TestAuthenticator.js';

describe('HTTP Boundary: Authentication & Capability Enforcement', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let fakeGen: FakeGenerationGateway;
  let fakeLinter: FakeMermaidLinterGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-enforcement-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    fakeGen = new FakeGenerationGateway();
    fakeLinter = new FakeMermaidLinterGateway();
    fakeGen.setDefaultResponse('graph TD;\n  A[Start] --> B[Finish];');
    fakeLinter.setDefaultResult({ isValid: true });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function initApp(options?: { allowAnonymousFallback?: boolean }) {
    const authenticator = new TestAuthenticator({
      allowAnonymousFallback: options?.allowAnonymousFallback ?? true
    });
    const composed = composeOrchestratorHttpServer({
      repository: repo,
      generationGateway: fakeGen,
      linterGateway: fakeLinter,
      authenticator
    });
    app = composed.app;
    await app.ready();
    return app;
  }

  async function seedTestEntities() {
    // 1. Audited accepted requirement for clean baseline creation
    const reqAudited = createRequirementRevision({
      id: createRequirementRevisionId('REQ-100-R1'),
      requirementId: createRequirementId('REQ-100'),
      revision: 1,
      statement: 'Audited accepted requirement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(reqAudited);
    await repo.appendReconciliationRecord({
      id: 'rec-100',
      entityType: 'requirement',
      entityId: reqAudited.requirementId,
      requirementRevisionId: reqAudited.id,
      action: 'ACCEPT',
      previousReviewState: undefined,
      newReviewState: 'ACCEPTED',
      rationale: 'Initial audit approved',
      actorId: createActorId('initial-reviewer'),
      recordedAt: now()
    });

    // 2. Pending requirement for testing reconcile actions
    const reqPending = createRequirementRevision({
      id: createRequirementRevisionId('REQ-200-R1'),
      requirementId: createRequirementId('REQ-200'),
      revision: 1,
      statement: 'Pending requirement for reconcile action',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED'
    });
    await repo.saveRequirementRevision(reqPending);

    // 3. Existing baseline for handoff and projections
    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-100'),
      requirements: [reqAudited],
      createdBy: createReviewerId('initial-author')
    });
    await repo.saveRequirementsBaseline(baseline);

    // 4. Candidate finding for testing disposition
    const finding = createCandidateFinding({
      id: createFindingId('FIND-100'),
      type: 'missing-authorization',
      affectedRequirementRevisions: [reqPending.id],
      evidence: [],
      discoveredBy: 'artifact-validation',
      disposition: 'OPEN',
      rationale: 'Unauthenticated endpoint found'
    });
    await repo.saveCandidateFinding(finding);
  }

  describe('GET /api/auth/me', () => {
    it('returns default fallback principal when anonymous fallback is enabled', async () => {
      await initApp({ allowAnonymousFallback: true });
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me'
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.id).toBe('lead-reviewer');
      expect(data.actorType).toBe('human');
      expect(data.capabilities).toContain('requirements:reconcile');
      expect(data.capabilities).toContain('baseline:create');
    });

    it('returns authenticated actor details when Bearer token is provided', async () => {
      await initApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: 'Bearer test:architect'
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.id).toBe('lead-architect');
      expect(data.name).toBe('Bob Architect');
      expect(data.capabilities).toContain('engineering-decision:approve');
      expect(data.capabilities).not.toContain('operator:admin');
    });
  });

  describe('Unauthenticated Request Handling (401)', () => {
    it('returns 401 UNAUTHENTICATED when anonymous fallback is disabled and no token is passed', async () => {
      await initApp({ allowAnonymousFallback: false });
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me'
      });

      expect(res.statusCode).toBe(401);
      const data = res.json();
      expect(data.code).toBe('UNAUTHENTICATED');
      expect(data.message).toMatch(/Missing authentication token/i);
    });

    it('returns 401 UNAUTHENTICATED when invalid token is passed', async () => {
      await initApp({ allowAnonymousFallback: true });
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: 'Bearer invalid-token-xyz'
        }
      });

      expect(res.statusCode).toBe(401);
      const data = res.json();
      expect(data.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('Capability Enforcement (403 Forbidden)', () => {
    beforeEach(async () => {
      await initApp();
      await seedTestEntities();
    });

    it('rejects reconcile requirement when caller lacks requirements:reconcile', async () => {
      // test:viewer has empty capabilities
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/REQ-200-R1/accept',
        headers: {
          authorization: 'Bearer test:viewer'
        },
        payload: {
          rationale: 'Viewer trying to accept'
        }
      });

      expect(res.statusCode).toBe(403);
      const data = res.json();
      expect(data.code).toBe('FORBIDDEN');
      expect(data.message).toMatch(/requirements:reconcile/);
    });

    it('rejects candidate finding disposition when caller lacks candidate:approve', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/findings/FIND-100/disposition',
        headers: {
          authorization: 'Bearer test:viewer'
        },
        payload: {
          disposition: 'RESOLVED',
          rationale: 'Viewer disposition attempt'
        }
      });

      expect(res.statusCode).toBe(403);
      const data = res.json();
      expect(data.code).toBe('FORBIDDEN');
      expect(data.message).toMatch(/candidate:approve/);
    });

    it('rejects baseline creation when caller lacks baseline:create', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines',
        headers: {
          authorization: 'Bearer test:viewer'
        },
        payload: {
          requirementRevisions: ['REQ-100-R1']
        }
      });

      expect(res.statusCode).toBe(403);
      const data = res.json();
      expect(data.code).toBe('FORBIDDEN');
      expect(data.message).toMatch(/baseline:create/);
    });

    it('rejects policy constraint creation when caller lacks policy-constraint:author', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/policy-constraints',
        headers: {
          authorization: 'Bearer test:viewer'
        },
        payload: {
          policyConstraintId: 'PC-100',
          statement: 'Strict authentication is required',
          authorityReference: 'NIST-800-63B'
        }
      });

      expect(res.statusCode).toBe(403);
      const data = res.json();
      expect(data.code).toBe('FORBIDDEN');
      expect(data.message).toMatch(/policy-constraint:author/);
    });

    it('rejects handoff export when caller lacks backlog:export', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/BASE-100/handoff',
        headers: {
          authorization: 'Bearer test:viewer'
        }
      });

      expect(res.statusCode).toBe(403);
      const data = res.json();
      expect(data.code).toBe('FORBIDDEN');
      expect(data.message).toMatch(/backlog:export/);
    });
  });

  describe('Agent Isolation Invariant', () => {
    beforeEach(async () => {
      await initApp();
      await seedTestEntities();
    });

    it('rejects agent attempt to approve candidate finding', async () => {
      // test:agent has actorType: 'agent' and projection:generate
      const res = await app.inject({
        method: 'POST',
        url: '/api/findings/FIND-100/disposition',
        headers: {
          authorization: 'Bearer test:agent'
        },
        payload: {
          disposition: 'RESOLVED',
          rationale: 'Agent trying to approve finding'
        }
      });

      expect(res.statusCode).toBe(403);
      const data = res.json();
      expect(data.code).toBe('FORBIDDEN');
      expect(data.message).toMatch(/candidate:approve/);
    });

    it('rejects agent attempt to create requirements baseline', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines',
        headers: {
          authorization: 'Bearer test:agent'
        },
        payload: {
          requirementRevisions: ['REQ-100-R1']
        }
      });

      expect(res.statusCode).toBe(403);
      const data = res.json();
      expect(data.code).toBe('FORBIDDEN');
      expect(data.message).toMatch(/baseline:create/);
    });

    it('allows agent to generate projections', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-100/projections',
        headers: {
          authorization: 'Bearer test:agent'
        },
        payload: {
          artifactType: 'process-diagram'
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.artifactType).toBe('process-diagram');
    });
  });

  describe('Anti-Spoofing Identity Derivation', () => {
    beforeEach(async () => {
      await initApp();
      await seedTestEntities();
    });

    it('overrides caller-supplied actorId with authenticated principal identity on requirement reconcile', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/REQ-200-R1/accept',
        headers: {
          authorization: 'Bearer test:reviewer'
        },
        payload: {
          rationale: 'Accepted by Alice',
          actorId: 'spoofed-hacker-id' // Attempting to spoof identity in body
        }
      });

      expect(res.statusCode).toBe(200);
      // Verify recorded audit history in repository has the authenticated actor ID
      const history = await repo.listReconciliationRecords(
        'requirement',
        createRequirementId('REQ-200')
      );
      expect(history.length).toBeGreaterThan(0);
      expect(history[history.length - 1].actorId).toBe('lead-reviewer');
    });

    it('overrides caller-supplied createdBy with authenticated principal identity on baseline creation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines',
        headers: {
          authorization: 'Bearer test:reviewer'
        },
        payload: {
          requirementRevisions: ['REQ-100-R1'],
          createdBy: 'spoofed-creator'
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.createdBy).toBe('lead-reviewer');
    });

    it('overrides caller-supplied createdBy with authenticated principal identity on policy constraint creation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/policy-constraints',
        headers: {
          authorization: 'Bearer test:architect'
        },
        payload: {
          policyConstraintId: 'PC-200',
          statement: 'Data encryption in transit is mandatory',
          authorityReference: 'FIPS-140-3',
          createdBy: 'spoofed-policy-author'
        }
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.createdBy).toBe('lead-architect');
    });

    it('overrides caller-supplied actorId with authenticated principal identity on requirement discovery', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/discoveries',
        headers: {
          authorization: 'Bearer test:reviewer'
        },
        payload: {
          statement: 'Discovered data constraint requirement',
          category: 'data-constraint',
          origin: 'DISCOVERED',
          rationale: 'Identified during threat model',
          actorId: 'spoofed-discovery-actor'
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.actorId).toBe('lead-reviewer');
      const saved = await repo.getRequirementRevision(createRequirementRevisionId(data.id));
      expect(saved?.actorId).toBe('lead-reviewer');
    });

    it('overrides caller-supplied actorId even under anonymous fallback mode', async () => {
      // Anonymous fallback mode (no Authorization header)
      const res = await app.inject({
        method: 'POST',
        url: '/api/policy-constraints',
        payload: {
          policyConstraintId: 'PC-201',
          statement: 'Default fallback policy constraint',
          authorityReference: 'INTERNAL-01',
          createdBy: 'spoofed-under-fallback'
        }
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      // Must be bound to request.actor.id ('lead-reviewer'), NOT 'spoofed-under-fallback'
      expect(data.createdBy).toBe('lead-reviewer');
    });
  });
});
