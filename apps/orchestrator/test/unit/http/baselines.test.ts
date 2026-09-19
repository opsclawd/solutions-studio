import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  createRequirementId,
  createRequirementRevisionId,
  createFindingId,
  createRequirementRevision,
  createCandidateFinding,
  createPolicyConstraintId,
  createPolicyConstraintRevisionId,
  createPolicyConstraintRevision,
  now
} from '@solutions-studio/domain';
import {
  RequirementsBaselineDtoSchema,
  AuthorityBundleDtoSchema,
  BaselineRequirementCoverageDtoSchema
} from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';

describe('HTTP Boundary: Baselines API', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-baseline-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    const composed = composeOrchestratorHttpServer({
      repository: repo,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });
    app = composed.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function seedAuditedRequirement(reqId = 'REQ-001', revId = 'REQ-001-R1') {
    const rev = createRequirementRevision({
      id: createRequirementRevisionId(revId),
      requirementId: createRequirementId(reqId),
      revision: 1,
      statement: 'Audited requirement statement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: []
    });
    await repo.saveRequirementRevision(rev);

    await repo.appendReconciliationRecord({
      id: `rec-${revId}`,
      entityType: 'requirement',
      entityId: createRequirementId(reqId),
      requirementRevisionId: rev.id,
      action: 'ACCEPT',
      previousReviewState: undefined,
      newReviewState: 'ACCEPTED',
      rationale: 'Human audit completed',
      recordedAt: now()
    });

    return rev;
  }

  async function seedAcceptedPolicyConstraint(polId = 'PC-001', revId = 'PC-001@r1') {
    const rev = createPolicyConstraintRevision({
      id: createPolicyConstraintRevisionId(revId),
      policyConstraintId: createPolicyConstraintId(polId),
      revision: 1,
      statement: 'Security constraint',
      authorityReference: 'NIST',
      state: 'ACCEPTED',
      createdBy: 'sec-lead'
    });
    await repo.savePolicyConstraintRevision(rev);
    return rev;
  }

  describe('POST /api/baselines', () => {
    it('creates baseline and returns 200 with baseline DTO', async () => {
      const rev = await seedAuditedRequirement('REQ-001', 'REQ-001-R1');

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines',
        payload: {
          id: 'BASE-001',
          requirementRevisions: [rev.id],
          createdBy: 'lead-reviewer'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const validated = RequirementsBaselineDtoSchema.parse(body);
      expect(validated.id).toBe('BASE-001');
      expect(validated.requirementRevisions).toEqual([rev.id]);
      expect(validated.createdBy).toBe('lead-reviewer');
    });

    it('creates baseline with policyConstraintRevisions and returns 200 with baseline DTO', async () => {
      const reqRev = await seedAuditedRequirement('REQ-010', 'REQ-010-R1');
      const polRev = await seedAcceptedPolicyConstraint('PC-010', 'PC-010@r1');

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines',
        payload: {
          id: 'BASE-POL-001',
          requirementRevisions: [reqRev.id],
          policyConstraintRevisions: [polRev.id],
          createdBy: 'lead-reviewer'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const validated = RequirementsBaselineDtoSchema.parse(body);
      expect(validated.id).toBe('BASE-POL-001');
      expect(validated.requirementRevisions).toEqual([reqRev.id]);
      expect(validated.policyConstraintRevisions).toEqual([polRev.id]);
      expect(validated.createdBy).toBe('lead-reviewer');
    });

    it('returns 409 UNAUDITED_RECONCILIATION when revision lacks acceptance audit history', async () => {
      // Create revision without audit record
      const rev = createRequirementRevision({
        id: createRequirementRevisionId('REQ-002-R1'),
        requirementId: createRequirementId('REQ-002'),
        revision: 1,
        statement: 'Unaudited requirement',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: []
      });
      await repo.saveRequirementRevision(rev);

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines',
        payload: {
          requirementRevisions: [rev.id],
          createdBy: 'lead-reviewer'
        }
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('UNAUDITED_RECONCILIATION');
    });

    it('returns 409 BLOCKED_BY_OPEN_FINDINGS when open finding affects proposed revision', async () => {
      const rev = await seedAuditedRequirement('REQ-001', 'REQ-001-R1');

      const finding = createCandidateFinding({
        id: createFindingId('FIND-BLOCK-01'),
        type: 'missing-authorization',
        affectedRequirementRevisions: [rev.id],
        evidence: [],
        discoveredBy: 'model',
        disposition: 'OPEN'
      });
      await repo.saveCandidateFinding(finding);

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines',
        payload: {
          requirementRevisions: [rev.id],
          createdBy: 'lead-reviewer'
        }
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.code).toBe('BLOCKED_BY_OPEN_FINDINGS');
      expect(body.details.blockingFindings).toHaveLength(1);
    });

    it('returns 400 VALIDATION_ERROR on empty requirement revisions array', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines',
        payload: {
          requirementRevisions: [],
          createdBy: 'lead-reviewer'
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 INVALID_BASELINE_MEMBERSHIP when policy constraint is in PENDING state', async () => {
      const reqRev = await seedAuditedRequirement('REQ-PEND', 'REQ-PEND-R1');
      const pendingPolicy = createPolicyConstraintRevision({
        id: createPolicyConstraintRevisionId('PC-PEND@r1'),
        policyConstraintId: createPolicyConstraintId('PC-PEND'),
        revision: 1,
        statement: 'Pending security policy',
        authorityReference: 'NIST',
        state: 'PENDING',
        createdBy: 'sec-lead'
      });
      await repo.savePolicyConstraintRevision(pendingPolicy);

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines',
        payload: {
          id: 'BASE-PENDING-POLICY',
          requirementRevisions: [reqRev.id],
          policyConstraintRevisions: [pendingPolicy.id],
          createdBy: 'lead-reviewer'
        }
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('INVALID_BASELINE_MEMBERSHIP');
      expect(body.details.violations).toBeDefined();
      expect(body.details.violations.some((v: any) => v.revisionId === pendingPolicy.id)).toBe(
        true
      );
    });

    it('returns 400 INVALID_BASELINE_MEMBERSHIP when policy constraint is in REJECTED state', async () => {
      const reqRev = await seedAuditedRequirement('REQ-REJ', 'REQ-REJ-R1');
      const rejectedPolicy = createPolicyConstraintRevision({
        id: createPolicyConstraintRevisionId('PC-REJ@r1'),
        policyConstraintId: createPolicyConstraintId('PC-REJ'),
        revision: 1,
        statement: 'Rejected security policy',
        authorityReference: 'NIST',
        state: 'REJECTED',
        createdBy: 'sec-lead'
      });
      await repo.savePolicyConstraintRevision(rejectedPolicy);

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines',
        payload: {
          id: 'BASE-REJECTED-POLICY',
          requirementRevisions: [reqRev.id],
          policyConstraintRevisions: [rejectedPolicy.id],
          createdBy: 'lead-reviewer'
        }
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('INVALID_BASELINE_MEMBERSHIP');
      expect(body.details.violations).toBeDefined();
      expect(body.details.violations.some((v: any) => v.revisionId === rejectedPolicy.id)).toBe(
        true
      );
    });

    it('returns 400 INVALID_BASELINE_MEMBERSHIP on duplicate policy constraints in candidate baseline', async () => {
      const reqRev = await seedAuditedRequirement('REQ-DUP', 'REQ-DUP-R1');
      const polRev1 = await seedAcceptedPolicyConstraint('PC-DUP', 'PC-DUP@r1');
      const polRev2 = createPolicyConstraintRevision({
        id: createPolicyConstraintRevisionId('PC-DUP@r2'),
        policyConstraintId: createPolicyConstraintId('PC-DUP'),
        revision: 2,
        statement: 'Updated policy',
        authorityReference: 'NIST',
        state: 'ACCEPTED',
        createdBy: 'sec-lead',
        supersedes: polRev1.id
      });
      await repo.savePolicyConstraintRevision(polRev2);

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines',
        payload: {
          id: 'BASE-DUP-POLICY',
          requirementRevisions: [reqRev.id],
          policyConstraintRevisions: [polRev1.id, polRev2.id],
          createdBy: 'lead-reviewer'
        }
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('INVALID_BASELINE_MEMBERSHIP');
      expect(body.details.violations).toBeDefined();
    });

    it('returns 400 INVALID_BASELINE_MEMBERSHIP when requirement revision is in PENDING reviewState', async () => {
      const pendingReq = createRequirementRevision({
        id: createRequirementRevisionId('REQ-PENDING-REV-R1'),
        requirementId: createRequirementId('REQ-PENDING-REV'),
        revision: 1,
        statement: 'Pending requirement statement',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'PENDING',
        resolutionState: 'CLEAR',
        evidence: []
      });
      await repo.saveRequirementRevision(pendingReq);

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines',
        payload: {
          id: 'BASE-PENDING-REQ',
          requirementRevisions: [pendingReq.id],
          createdBy: 'lead-reviewer'
        }
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('INVALID_BASELINE_MEMBERSHIP');
      expect(body.details.violations).toBeDefined();
      expect(body.details.violations.some((v: any) => v.revisionId === pendingReq.id)).toBe(true);
    });
  });

  describe('GET /api/baselines/:baselineId', () => {
    it('returns 200 with baseline when found', async () => {
      const rev = await seedAuditedRequirement('REQ-001', 'REQ-001-R1');

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/baselines',
        payload: {
          id: 'BASE-FETCH-01',
          requirementRevisions: [rev.id],
          createdBy: 'lead-reviewer'
        }
      });
      expect(createRes.statusCode).toBe(200);

      const getRes = await app.inject({
        method: 'GET',
        url: '/api/baselines/BASE-FETCH-01'
      });
      expect(getRes.statusCode).toBe(200);
      const body = getRes.json();
      expect(body.id).toBe('BASE-FETCH-01');
      expect(body.createdBy).toBe('lead-reviewer');
    });

    it('returns 404 BASELINE_NOT_FOUND when baseline does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/UNKNOWN-BASE'
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('BASELINE_NOT_FOUND');
    });
  });

  describe('GET /api/baselines', () => {
    it('returns 200 with list of baselines ordered by createdAt', async () => {
      const rev1 = await seedAuditedRequirement('REQ-001', 'REQ-001-R1');
      const rev2 = await seedAuditedRequirement('REQ-002', 'REQ-002-R1');

      await app.inject({
        method: 'POST',
        url: '/api/baselines',
        payload: {
          id: 'BASE-001',
          requirementRevisions: [rev1.id],
          createdBy: 'lead-reviewer'
        }
      });

      await app.inject({
        method: 'POST',
        url: '/api/baselines',
        payload: {
          id: 'BASE-002',
          requirementRevisions: [rev1.id, rev2.id],
          createdBy: 'lead-reviewer'
        }
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines'
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(2);
      expect(body[0].id).toBe('BASE-001');
      expect(body[1].id).toBe('BASE-002');
    });
  });

  describe('GET /api/baselines/:baselineId/authority-bundle', () => {
    it('returns 200 with authority bundle including baseline, requirements, and policy constraints', async () => {
      const reqRev = await seedAuditedRequirement('REQ-020', 'REQ-020-R1');
      const polRev = await seedAcceptedPolicyConstraint('PC-020', 'PC-020@r1');

      await app.inject({
        method: 'POST',
        url: '/api/baselines',
        payload: {
          id: 'BASE-AUTH-001',
          requirementRevisions: [reqRev.id],
          policyConstraintRevisions: [polRev.id],
          createdBy: 'lead-reviewer'
        }
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/BASE-AUTH-001/authority-bundle'
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const bundle = AuthorityBundleDtoSchema.parse(body);
      expect(bundle.baseline.id).toBe('BASE-AUTH-001');
      expect(bundle.requirements).toHaveLength(1);
      expect(bundle.requirements[0].id).toBe(reqRev.id);
      expect(bundle.policyConstraints).toHaveLength(1);
      expect(bundle.policyConstraints[0].id).toBe(polRev.id);
    });

    it('returns 404 BASELINE_NOT_FOUND when baseline does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/NONEXISTENT/authority-bundle'
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('BASELINE_NOT_FOUND');
    });
  });

  describe('GET /api/baselines/:baselineId/coverage', () => {
    it('returns 200 with baseline requirement coverage report', async () => {
      const reqRev = await seedAuditedRequirement('REQ-COV-01', 'REQ-COV-01-R1');
      await app.inject({
        method: 'POST',
        url: '/api/baselines',
        payload: {
          id: 'BASE-COV-001',
          requirementRevisions: [reqRev.id],
          createdBy: 'lead-reviewer'
        }
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/BASE-COV-001/coverage'
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const coverage = BaselineRequirementCoverageDtoSchema.parse(body);
      expect(coverage.baselineId).toBe('BASE-COV-001');
      expect(coverage.totalRequirements).toBe(1);
      expect(coverage.coveredCount).toBe(0);
      expect(coverage.uncoveredCount).toBe(1);
      expect(coverage.uncoveredRequirementRevisionIds).toEqual([reqRev.id]);
      expect(coverage.isFullyCovered).toBe(false);
    });

    it('returns 404 BASELINE_NOT_FOUND when baseline does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/NONEXISTENT/coverage'
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('BASELINE_NOT_FOUND');
    });
  });
});
