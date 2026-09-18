import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  createSourceId,
  createRequirementId,
  createRequirementRevisionId,
  createFindingId,
  createRequirementsBaselineId,
  createReviewerId,
  createRequirementRevision,
  createCandidateFinding,
  createRequirementsBaseline,
  now
} from '@solutions-studio/domain';
import { RequirementsReviewStateDtoSchema } from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';

describe('HTTP Boundary: Review State API', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-review-test-'));
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

  it('GET /api/health returns ok', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health'
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/requirements/review-state on empty store returns valid empty DTO', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirements/review-state'
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const validated = RequirementsReviewStateDtoSchema.parse(body);
    expect(validated.requirementRevisions).toEqual([]);
    expect(validated.findings).toEqual([]);
    expect(validated.reconciliationHistory).toEqual([]);
    expect(validated.evidenceExcerpts).toEqual([]);
    expect(validated.projections).toEqual([]);
    expect(validated.revisionLineage).toEqual([]);
    expect(validated.baseline).toBeUndefined();
  });

  it('GET /api/requirements/review-state in global mode returns latest revisions, findings, excerpts', async () => {
    const src = await repo.captureSourceRevision({
      sourceId: createSourceId('SRC-001'),
      sourceType: 'sop',
      markdownText: '# Security Policy\n\nAll secrets must be rotated every 90 days.'
    });

    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Rotate secrets every 90 days',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: [
        {
          sourceRevisionId: src.revision.id,
          locator: src.locatorIndex[0].locator
        }
      ]
    });
    await repo.saveRequirementRevision(rev1);

    const finding = createCandidateFinding({
      id: createFindingId('FIND-001'),
      type: 'missing-authorization',
      affectedRequirementRevisions: [rev1.id],
      evidence: [
        {
          sourceRevisionId: src.revision.id,
          locator: src.locatorIndex[0].locator
        }
      ],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });
    await repo.saveCandidateFinding(finding);

    const res = await app.inject({
      method: 'GET',
      url: '/api/requirements/review-state'
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const validated = RequirementsReviewStateDtoSchema.parse(body);
    expect(validated.requirementRevisions).toHaveLength(1);
    expect(validated.requirementRevisions[0].id).toBe('REQ-001-R1');
    expect(validated.findings).toHaveLength(1);
    expect(validated.findings[0].id).toBe('FIND-001');
    expect(validated.evidenceExcerpts).toHaveLength(1);
    expect(validated.evidenceExcerpts[0].text).toContain('All secrets must be rotated');
    expect(validated.revisionLineage).toEqual([
      { revisionId: 'REQ-001-R1', requirementId: 'REQ-001' }
    ]);
  });

  it('GET /api/requirements/review-state?baselineId=... returns baseline-anchored state', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Secret rotation rule',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: []
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [rev1],
      createdBy: createReviewerId('reviewer-1'),
      createdAt: now()
    });
    await repo.saveRequirementsBaseline(baseline);

    const res = await app.inject({
      method: 'GET',
      url: '/api/requirements/review-state?baselineId=BASE-001'
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const validated = RequirementsReviewStateDtoSchema.parse(body);
    expect(validated.baseline?.id).toBe('BASE-001');
    expect(validated.requirementRevisions).toHaveLength(1);
    expect(validated.requirementRevisions[0].id).toBe('REQ-001-R1');
  });

  it('GET /api/requirements/review-state with unknown baselineId returns 404 BASELINE_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirements/review-state?baselineId=DOES-NOT-EXIST'
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe('BASELINE_NOT_FOUND');
  });
});
