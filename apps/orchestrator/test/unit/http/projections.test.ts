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
  createRequirementRevision,
  createRequirementsBaseline,
  now
} from '@solutions-studio/domain';
import { ProjectionRecordDtoSchema } from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';

describe('HTTP Boundary: Projections API', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let fakeGen: FakeGenerationGateway;
  let fakeLinter: FakeMermaidLinterGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-proj-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    fakeGen = new FakeGenerationGateway();
    fakeLinter = new FakeMermaidLinterGateway();
    const composed = composeOrchestratorHttpServer({
      repository: repo,
      generationGateway: fakeGen,
      linterGateway: fakeLinter
    });
    app = composed.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function seedBaseline(baseId = 'BASE-001') {
    const rev = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Audited requirement statement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: []
    });
    await repo.saveRequirementRevision(rev);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId(baseId),
      requirements: [rev],
      createdBy: createReviewerId('reviewer-1'),
      createdAt: now()
    });
    await repo.saveRequirementsBaseline(baseline);
    return baseline;
  }

  describe('POST /api/baselines/:baselineId/projections', () => {
    it('generates projection and returns 200 with projection record', async () => {
      await seedBaseline('BASE-001');

      fakeGen.setDefaultResponse('graph TD;\n  A[Start] --> B[Finish];');
      fakeLinter.setDefaultResult({ isValid: true });

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/projections',
        payload: {
          artifactType: 'process-diagram'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const validated = ProjectionRecordDtoSchema.parse(body);
      expect(validated.baselineId).toBe('BASE-001');
      expect(validated.artifactType).toBe('process-diagram');
      expect(validated.content).toContain('graph TD;');
      expect(validated.metadata.measuredVerification.repairsNeeded).toBe(0);
    });

    it('returns 400 VALIDATION_ERROR on invalid artifactType', async () => {
      await seedBaseline('BASE-001');

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/projections',
        payload: {
          artifactType: 'unsupported-type'
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 BASELINE_NOT_FOUND when baseline does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/NONEXISTENT/projections',
        payload: {
          artifactType: 'process-diagram'
        }
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('BASELINE_NOT_FOUND');
    });

    it('returns 502 ARTIFACT_GENERATION_FAILED when repair retries are exhausted', async () => {
      await seedBaseline('BASE-001');

      fakeGen.setDefaultResponse('invalid mermaid code');
      fakeLinter.setDefaultResult({ isValid: false, errorMessage: 'Syntax error' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/projections',
        payload: {
          artifactType: 'process-diagram'
        }
      });

      expect(res.statusCode).toBe(502);
      const body = res.json();
      expect(body.code).toBe('ARTIFACT_GENERATION_FAILED');
      expect(body.details.errors).toBeDefined();
    });
  });

  describe('GET /api/baselines/:baselineId/projections', () => {
    it('returns 200 with list of projection records', async () => {
      await seedBaseline('BASE-001');

      fakeGen.setDefaultResponse('graph TD;\n  A --> B;');
      fakeLinter.setDefaultResult({ isValid: true });

      // Generate one projection
      await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/projections',
        payload: { artifactType: 'process-diagram' }
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/BASE-001/projections'
      });

      expect(res.statusCode).toBe(200);
      const list = res.json();
      expect(Array.isArray(list)).toBe(true);
      expect(list).toHaveLength(1);
      expect(list[0].baselineId).toBe('BASE-001');
      expect(list[0].artifactType).toBe('process-diagram');
    });
  });
});
