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
  now
} from '@solutions-studio/domain';
import { RequirementsBaselineDtoSchema } from '@solutions-studio/contracts';
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
});
