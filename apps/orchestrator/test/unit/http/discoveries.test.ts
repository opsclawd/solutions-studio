import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  createRequirementId,
  createRequirementRevisionId,
  createRequirementsBaselineId,
  createReviewerId,
  createRequirementRevision,
  createRequirementsBaseline,
  createCandidateFinding,
  createFindingId
} from '@solutions-studio/domain';
import {
  RequirementRevisionDtoSchema,
  CandidateFindingDtoSchema,
  RequirementsReviewStateDtoSchema
} from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';
import type { ProjectionRecord } from '../../../src/application/ports/persistence/IRequirementsRepository.js';

describe('HTTP Boundary: Discoveries API', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-discoveries-test-'));
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

  async function seedBaselineAndProjection(baselineIdStr = 'BASELINE-001', projIdStr = 'PROJ-001') {
    const rev = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Initial requirement in baseline',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: []
    });
    await repo.saveRequirementRevision(rev);
    await repo.appendReconciliationRecord({
      id: `REC-${randomUUID()}`,
      entityType: 'requirement',
      entityId: rev.requirementId,
      requirementRevisionId: rev.id,
      action: 'ACCEPT',
      previousReviewState: undefined,
      newReviewState: 'ACCEPTED',
      rationale: 'Initial acceptance',
      recordedAt: '2026-01-01T00:00:00.000Z' as any
    });

    const baselineId = createRequirementsBaselineId(baselineIdStr);
    const baseline = createRequirementsBaseline({
      id: baselineId,
      requirements: [rev],
      createdBy: createReviewerId('reviewer-1')
    });
    await repo.saveRequirementsBaseline(baseline);

    const projection: ProjectionRecord = {
      id: projIdStr,
      baselineId,
      requirementRevisionIds: [rev.id],
      artifactType: 'process-diagram',
      content: 'graph TD; A-->B;',
      metadata: {
        baselineId: baselineIdStr,
        requirementRevisionIds: [rev.id],
        artifactType: 'process-diagram',
        declaredProvenance: {
          baselineId: baselineIdStr,
          requirementRevisionIds: [rev.id]
        },
        configuredExecution: {
          provider: 'agy',
          artifactType: 'process-diagram'
        },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'hash123',
          verifiedAt: '2026-01-01T00:00:00.000Z' as any
        }
      },
      createdAt: '2026-01-01T00:00:00.000Z' as any
    };
    await repo.saveProjectionRecord(projection);

    return { baseline, projection, rev };
  }

  describe('POST /api/requirements/discoveries', () => {
    it('returns 200 with RequirementRevisionDto on valid proposal discovery', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/discoveries',
        payload: {
          statement: 'Tenant purge must retain audit records for 90 days',
          category: 'business-rule',
          rationale: 'Discovered during SME interview with compliance team',
          actorId: 'reviewer-sme'
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      const parsed = RequirementRevisionDtoSchema.parse(data);
      expect(parsed.origin).toBe('REVIEWER_PROPOSAL');
      expect(parsed.reviewState).toBe('PENDING');
      expect(parsed.resolutionState).toBe('UNRESOLVED');
      expect(parsed.revision).toBe(1);
      expect(parsed.statement).toBe('Tenant purge must retain audit records for 90 days');
      expect(parsed.actorId).toBe('reviewer-sme');
    });

    it('works on aliased route POST /api/discoveries/requirements', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/discoveries/requirements',
        payload: {
          statement: 'Discovered statement via alias route',
          category: 'business-rule',
          rationale: 'Alias route test rationale'
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.origin).toBe('REVIEWER_PROPOSAL');
    });

    it('returns 400 VALIDATION_ERROR on empty or missing rationale', async () => {
      const resEmpty = await app.inject({
        method: 'POST',
        url: '/api/requirements/discoveries',
        payload: {
          statement: 'Valid statement',
          category: 'business-rule',
          rationale: '   '
        }
      });

      expect(resEmpty.statusCode).toBe(400);
      expect(resEmpty.json().code).toBe('VALIDATION_ERROR');

      const resMissing = await app.inject({
        method: 'POST',
        url: '/api/requirements/discoveries',
        payload: {
          statement: 'Valid statement',
          category: 'business-rule'
        }
      });

      expect(resMissing.statusCode).toBe(400);
      expect(resMissing.json().code).toBe('VALIDATION_ERROR');
    });

    it('returns 409 INVALID_TRANSITION when supplying an already existing requirementId', async () => {
      const { rev } = await seedBaselineAndProjection();

      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/discoveries',
        payload: {
          statement: 'Duplicate proposal',
          category: 'business-rule',
          rationale: 'Trying to reuse existing requirementId',
          requirementId: rev.requirementId
        }
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('INVALID_TRANSITION');
      expect(res.json().details?.requirementId).toBe(rev.requirementId);
    });

    it('returns 409 INVALID_TRANSITION on custom revisionId storage collision', async () => {
      const rev = createRequirementRevision({
        id: createRequirementRevisionId('REQ-COLLIDE-R1'),
        requirementId: createRequirementId('REQ-COLLIDE'),
        revision: 1,
        statement: 'Colliding revision',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'PENDING',
        resolutionState: 'UNRESOLVED',
        evidence: []
      });
      await repo.saveRequirementRevision(rev);

      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/discoveries',
        payload: {
          statement: 'New statement with colliding revision ID',
          category: 'business-rule',
          rationale: 'Colliding rationale',
          requirementId: 'REQ-NEW-DISTINCT',
          revisionId: 'REQ-COLLIDE-R1'
        }
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('INVALID_TRANSITION');
    });

    it('returns 404 BASELINE_NOT_FOUND on non-existent baseline ID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/discoveries',
        payload: {
          statement: 'Statement with bad baseline',
          category: 'business-rule',
          rationale: 'Valid rationale',
          baselineId: 'BASELINE-NONEXISTENT'
        }
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('BASELINE_NOT_FOUND');
      expect(res.json().details?.baselineId).toBe('BASELINE-NONEXISTENT');
    });

    it('returns 404 PROJECTION_NOT_FOUND on non-existent projection ID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/discoveries',
        payload: {
          statement: 'Statement with bad projection',
          category: 'business-rule',
          rationale: 'Valid rationale',
          originatingProjectionId: 'PROJ-NONEXISTENT'
        }
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('PROJECTION_NOT_FOUND');
      expect(res.json().details?.projectionId).toBe('PROJ-NONEXISTENT');
    });

    it('returns 400 VALIDATION_ERROR on projection/baseline mismatch', async () => {
      const { projection } = await seedBaselineAndProjection('BASELINE-REAL', 'PROJ-REAL');

      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/discoveries',
        payload: {
          statement: 'Statement with mismatch',
          category: 'business-rule',
          rationale: 'Valid rationale',
          baselineId: 'BASELINE-WRONG',
          originatingProjectionId: projection.id
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('backfills baselineId when originatingProjectionId is provided without baselineId', async () => {
      const { projection } = await seedBaselineAndProjection('BASELINE-BACKFILL', 'PROJ-BACKFILL');

      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/discoveries',
        payload: {
          statement: 'Statement with projection provenance only',
          category: 'business-rule',
          rationale: 'Reviewer clicked from diagram viewer',
          originatingProjectionId: projection.id
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.originatingProjectionId).toBe(projection.id);
      expect(data.baselineId).toBe('BASELINE-BACKFILL');
    });
  });

  describe('POST /api/findings/discoveries', () => {
    it('returns 200 with CandidateFindingDto on valid human finding discovery', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/findings/discoveries',
        payload: {
          type: 'missing-authorization',
          discoveredBy: 'human',
          rationale: 'Discovered during SME review that non-admins can access billing settings',
          actorId: 'sec-lead'
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      const parsed = CandidateFindingDtoSchema.parse(data);
      expect(parsed.type).toBe('missing-authorization');
      expect(parsed.discoveredBy).toBe('human');
      expect(parsed.disposition).toBe('OPEN');
      expect(parsed.actorId).toBe('sec-lead');
    });

    it('returns 200 with CandidateFindingDto on valid artifact-validation finding discovery', async () => {
      const { projection } = await seedBaselineAndProjection('BASELINE-ART', 'PROJ-ART');

      const res = await app.inject({
        method: 'POST',
        url: '/api/findings/discoveries',
        payload: {
          type: 'incomplete-state-machine',
          discoveredBy: 'artifact-validation',
          rationale: 'Diagram review showed unhandled transition',
          originatingProjectionId: projection.id
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.discoveredBy).toBe('artifact-validation');
      expect(data.disposition).toBe('OPEN');
      expect(data.baselineId).toBe('BASELINE-ART');
      expect(data.originatingProjectionId).toBe(projection.id);
    });

    it('works on aliased route POST /api/discoveries/findings', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/discoveries/findings',
        payload: {
          type: 'contradiction',
          discoveredBy: 'human',
          rationale: 'Contradiction found via alias endpoint'
        }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().discoveredBy).toBe('human');
    });

    it('returns 400 VALIDATION_ERROR on disallowed discoveredBy (e.g. model)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/findings/discoveries',
        payload: {
          type: 'contradiction',
          discoveredBy: 'model',
          rationale: 'Generated proposal'
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('returns 409 INVALID_TRANSITION on custom findingId storage collision', async () => {
      const finding = createCandidateFinding({
        id: createFindingId('FINDING-COLLIDE-1'),
        type: 'contradiction',
        discoveredBy: 'human',
        rationale: 'Existing finding'
      });
      await repo.saveCandidateFinding(finding);

      const res = await app.inject({
        method: 'POST',
        url: '/api/findings/discoveries',
        payload: {
          type: 'contradiction',
          discoveredBy: 'human',
          rationale: 'Colliding finding ID',
          findingId: 'FINDING-COLLIDE-1'
        }
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('INVALID_TRANSITION');
    });

    it('returns 404 REQUIREMENT_REVISION_NOT_FOUND on non-existent affected revision', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/findings/discoveries',
        payload: {
          type: 'missing-authorization',
          discoveredBy: 'human',
          rationale: 'Affects unknown revision',
          affectedRequirementRevisions: ['REQ-UNKNOWN-R99']
        }
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('REQUIREMENT_REVISION_NOT_FOUND');
    });
  });

  describe('Provenance Round-Trip via GET /api/requirements/review-state', () => {
    it('preserves exact baselineId, originatingProjectionId, actorId, and rationale in review state', async () => {
      const { projection, baseline, rev } = await seedBaselineAndProjection();

      // Record a requirement discovery linked to projection
      const reqRes = await app.inject({
        method: 'POST',
        url: '/api/requirements/discoveries',
        payload: {
          statement: 'Discovered rule during diagram review',
          category: 'business-rule',
          rationale: 'Diagram clearly lacks this path',
          actorId: 'reviewer-alice',
          originatingProjectionId: projection.id,
          dependencies: [rev.requirementId]
        }
      });
      expect(reqRes.statusCode).toBe(200);

      // Record a finding discovery linked to projection and rev
      const findingRes = await app.inject({
        method: 'POST',
        url: '/api/findings/discoveries',
        payload: {
          type: 'incomplete-state-machine',
          discoveredBy: 'artifact-validation',
          rationale: 'Deadlock transition in diagram',
          actorId: 'reviewer-bob',
          originatingProjectionId: projection.id,
          affectedRequirementRevisions: [rev.id]
        }
      });
      expect(findingRes.statusCode).toBe(200);

      // Query review state
      const reviewStateRes = await app.inject({
        method: 'GET',
        url: `/api/requirements/review-state?baselineId=${baseline.id}`
      });
      expect(reviewStateRes.statusCode).toBe(200);

      const reviewState = RequirementsReviewStateDtoSchema.parse(reviewStateRes.json());

      // Finding is in inScopeFindings
      const foundFinding = reviewState.findings.find((f) => f.id === findingRes.json().id);
      expect(foundFinding).toBeDefined();
      expect(foundFinding?.actorId).toBe('reviewer-bob');
      expect(foundFinding?.originatingProjectionId).toBe(projection.id);
      expect(foundFinding?.baselineId).toBe(baseline.id);
      expect(foundFinding?.rationale).toBe('Deadlock transition in diagram');

      // Now query review state without baselineId (workspace latest view)
      const workspaceRes = await app.inject({
        method: 'GET',
        url: '/api/requirements/review-state'
      });
      expect(workspaceRes.statusCode).toBe(200);

      const workspaceState = RequirementsReviewStateDtoSchema.parse(workspaceRes.json());
      const foundReq = workspaceState.requirementRevisions.find((r) => r.id === reqRes.json().id);
      expect(foundReq).toBeDefined();
      expect(foundReq?.actorId).toBe('reviewer-alice');
      expect(foundReq?.originatingProjectionId).toBe(projection.id);
      expect(foundReq?.baselineId).toBe(baseline.id);
      expect(foundReq?.rationale).toBe('Diagram clearly lacks this path');
    });
  });
});
