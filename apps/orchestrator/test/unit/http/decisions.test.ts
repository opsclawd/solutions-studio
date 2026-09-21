import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  createRequirementId,
  createRequirementRevisionId,
  createPolicyConstraintId,
  createPolicyConstraintRevisionId,
  createRequirementsBaselineId,
  createReviewerId,
  createRequirementRevision,
  createPolicyConstraintRevision,
  createRequirementsBaseline
} from '@solutions-studio/domain';
import { EngineeringDecisionDtoSchema } from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';

describe('HTTP Boundary: Decisions API', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-decision-test-'));
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

  async function seedBaseline(baseId = 'BASE-001') {
    const reqRev = createRequirementRevision({
      id: createRequirementRevisionId(`REQ-${baseId}-R1`),
      requirementId: createRequirementId(`REQ-${baseId}`),
      revision: 1,
      statement: 'Audited requirement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(reqRev);

    const polRev = createPolicyConstraintRevision({
      id: createPolicyConstraintRevisionId(`PC-${baseId}@r1`),
      policyConstraintId: createPolicyConstraintId(`PC-${baseId}`),
      revision: 1,
      statement: 'Policy constraint',
      authorityReference: 'REF-1',
      state: 'ACCEPTED',
      createdBy: 'sec-lead'
    });
    await repo.savePolicyConstraintRevision(polRev);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId(baseId),
      requirements: [reqRev],
      policyConstraints: [polRev],
      createdBy: createReviewerId('lead-reviewer')
    });
    await repo.saveRequirementsBaseline(baseline);

    return { baseline, reqRev, polRev };
  }

  describe('POST /api/baselines/:baselineId/decisions', () => {
    it('creates a decision in PROPOSED state and returns 201 with DTO', async () => {
      const { baseline, reqRev, polRev } = await seedBaseline('BASE-001');

      const res = await app.inject({
        method: 'POST',
        url: `/api/baselines/${baseline.id}/decisions`,
        payload: {
          statement: 'Use read-replicas for query workload',
          rationale: 'Addresses p99 latency SLAs without sharding complexity',
          requirementRevisionIds: [reqRev.id],
          policyConstraintRevisionIds: [polRev.id],
          createdBy: 'lead-arch'
        }
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      const validated = EngineeringDecisionDtoSchema.parse(body);
      expect(validated.baselineId).toBe(baseline.id);
      expect(validated.statement).toBe('Use read-replicas for query workload');
      expect(validated.state).toBe('PROPOSED');
      expect(validated.requirementRevisionIds).toEqual([reqRev.id]);
      expect(validated.policyConstraintRevisionIds).toEqual([polRev.id]);
      expect(validated.acceptedBy).toBeUndefined();
    });

    it('returns 404 BASELINE_NOT_FOUND when baseline does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/NONEXISTENT/decisions',
        payload: {
          statement: 'Some technical choice',
          rationale: 'Some rationale',
          createdBy: 'lead-arch'
        }
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('BASELINE_NOT_FOUND');
    });

    it('returns 400 VALIDATION_ERROR when input revision is not in baseline', async () => {
      const { baseline } = await seedBaseline('BASE-002');

      const res = await app.inject({
        method: 'POST',
        url: `/api/baselines/${baseline.id}/decisions`,
        payload: {
          statement: 'Some decision',
          rationale: 'Some rationale',
          requirementRevisionIds: ['REQ-NOT-IN-BASELINE-R1'],
          createdBy: 'lead-arch'
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/baselines/:baselineId/decisions', () => {
    it('lists decisions for a baseline and filters by state', async () => {
      const { baseline } = await seedBaseline('BASE-003');

      // Create 2 decisions
      const post1 = await app.inject({
        method: 'POST',
        url: `/api/baselines/${baseline.id}/decisions`,
        payload: {
          statement: 'Decision 1',
          rationale: 'Rationale 1',
          createdBy: 'dev'
        }
      });
      const d1 = post1.json();

      const post2 = await app.inject({
        method: 'POST',
        url: `/api/baselines/${baseline.id}/decisions`,
        payload: {
          statement: 'Decision 2',
          rationale: 'Rationale 2',
          createdBy: 'dev'
        }
      });
      const d2 = post2.json();

      // Transition d1 to ACCEPTED
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${d1.id}/transition`,
        payload: {
          newState: 'ACCEPTED',
          rationale: 'Approved after review',
          actorId: 'lead-reviewer'
        }
      });

      // List all
      const allRes = await app.inject({
        method: 'GET',
        url: `/api/baselines/${baseline.id}/decisions`
      });
      expect(allRes.statusCode).toBe(200);
      const all = allRes.json();
      expect(all).toHaveLength(2);

      // Filter by PROPOSED
      const proposedRes = await app.inject({
        method: 'GET',
        url: `/api/baselines/${baseline.id}/decisions?state=PROPOSED`
      });
      expect(proposedRes.statusCode).toBe(200);
      const proposed = proposedRes.json();
      expect(proposed).toHaveLength(1);
      expect(proposed[0].id).toBe(d2.id);

      // Filter by ACCEPTED
      const acceptedRes = await app.inject({
        method: 'GET',
        url: `/api/baselines/${baseline.id}/decisions?state=ACCEPTED`
      });
      expect(acceptedRes.statusCode).toBe(200);
      const accepted = acceptedRes.json();
      expect(accepted).toHaveLength(1);
      expect(accepted[0].id).toBe(d1.id);
    });
  });

  describe('GET /api/decisions/:decisionId', () => {
    it('returns decision when found', async () => {
      const { baseline } = await seedBaseline('BASE-004');

      const post = await app.inject({
        method: 'POST',
        url: `/api/baselines/${baseline.id}/decisions`,
        payload: {
          statement: 'Decision test',
          rationale: 'Rationale test',
          createdBy: 'dev'
        }
      });
      const created = post.json();

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/decisions/${created.id}`
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().id).toBe(created.id);
    });

    it('returns 404 ENGINEERING_DECISION_NOT_FOUND when not found', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/decisions/DEC-NONEXISTENT'
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('ENGINEERING_DECISION_NOT_FOUND');
    });
  });

  describe('POST /api/decisions/:decisionId/transition', () => {
    it('transitions decision to ACCEPTED and records reviewer', async () => {
      const { baseline } = await seedBaseline('BASE-005');

      const post = await app.inject({
        method: 'POST',
        url: `/api/baselines/${baseline.id}/decisions`,
        payload: {
          statement: 'Use Postgres for relational metadata',
          rationale: 'ACID compliance needed for transactions',
          createdBy: 'dev'
        }
      });
      const created = post.json();

      const transRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${created.id}/transition`,
        payload: {
          newState: 'ACCEPTED',
          rationale: 'Review complete and signed off',
          actorId: 'arch-lead'
        }
      });

      expect(transRes.statusCode).toBe(200);
      const body = transRes.json();
      expect(body.state).toBe('ACCEPTED');
      expect(body.rationale).toBe('ACID compliance needed for transactions');
      expect(body.transitionRationale).toBe('Review complete and signed off');
      expect(body.acceptedBy).toBe('lead-reviewer');
      expect(body.acceptedAt).toBeDefined();

      // Verify via GET
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/decisions/${created.id}`
      });
      expect(getRes.json().state).toBe('ACCEPTED');
      expect(getRes.json().rationale).toBe('ACID compliance needed for transactions');
      expect(getRes.json().transitionRationale).toBe('Review complete and signed off');
    });

    it('returns 409 INVALID_TRANSITION when transition is identical', async () => {
      const { baseline } = await seedBaseline('BASE-006');

      const post = await app.inject({
        method: 'POST',
        url: `/api/baselines/${baseline.id}/decisions`,
        payload: {
          statement: 'Duplicate transition test',
          rationale: 'Test',
          createdBy: 'dev'
        }
      });
      const created = post.json();

      // Transition to PROPOSED when already PROPOSED
      const transRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${created.id}/transition`,
        payload: {
          newState: 'PROPOSED',
          rationale: 'Same state',
          actorId: 'dev'
        }
      });
      expect(transRes.statusCode).toBe(409);
      expect(transRes.json().code).toBe('INVALID_TRANSITION');
    });
  });
});
