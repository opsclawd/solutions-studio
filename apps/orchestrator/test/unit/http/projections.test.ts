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
import { FakePrototypeValidatorGateway } from '../../fakes/FakePrototypeValidatorGateway.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';

describe('HTTP Boundary: Projections API', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let fakeGen: FakeGenerationGateway;
  let fakeLinter: FakeMermaidLinterGateway;
  let fakeValidator: FakePrototypeValidatorGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-proj-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    fakeGen = new FakeGenerationGateway();
    fakeLinter = new FakeMermaidLinterGateway();
    fakeValidator = new FakePrototypeValidatorGateway();
    const composed = composeOrchestratorHttpServer({
      repository: repo,
      generationGateway: fakeGen,
      linterGateway: fakeLinter,
      prototypeValidatorGateway: fakeValidator
    });
    app = composed.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function seedBaseline(
    baseId = 'BASE-001',
    reqId = `REQ-${baseId}`,
    revId = `REQ-${baseId}-R1`
  ) {
    const rev = createRequirementRevision({
      id: createRequirementRevisionId(revId),
      requirementId: createRequirementId(reqId),
      revision: 1,
      statement: `Audited requirement statement for ${baseId}`,
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

    it('generates prototype projection and returns 200 with verified metadata', async () => {
      await seedBaseline('BASE-001', 'REQ-001', 'REQ-001-R1');

      const validTsx = [
        '/**',
        ' * @baseline BASE-001',
        ' * @requirements REQ-001-R1',
        ' */',
        "import React, { useState } from 'react';",
        'export default function Component() { return <div>Proto</div>; }'
      ].join('\n');

      fakeGen.setDefaultResponse(validTsx);
      fakeValidator.setDefaultResult({ isValid: true });

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/projections',
        payload: {
          artifactType: 'prototype'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const validated = ProjectionRecordDtoSchema.parse(body);
      expect(validated.baselineId).toBe('BASE-001');
      expect(validated.artifactType).toBe('prototype');
      expect(validated.content).toContain('export default function Component()');
      expect(validated.metadata.declaredProvenance.baselineId).toBe('BASE-001');
      expect(validated.metadata.declaredProvenance.requirementRevisionIds).toEqual(['REQ-001-R1']);
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

    it('returns 502 ARTIFACT_GENERATION_FAILED when prototype repair retries are exhausted', async () => {
      await seedBaseline('BASE-001', 'REQ-001', 'REQ-001-R1');

      fakeGen.setDefaultResponse('broken code without provenance header');
      fakeValidator.setDefaultResult({ isValid: false, errorMessage: 'Invalid syntax' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/projections',
        payload: {
          artifactType: 'prototype'
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

  describe('GET /api/baselines/:baselineId/projections/:projectionId', () => {
    it('returns 200 with specific projection record', async () => {
      await seedBaseline('BASE-001');
      fakeGen.setDefaultResponse('graph TD;\n  A --> B;');
      fakeLinter.setDefaultResult({ isValid: true });

      const genRes = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/projections',
        payload: { artifactType: 'process-diagram' }
      });
      const generated = genRes.json();

      const res = await app.inject({
        method: 'GET',
        url: `/api/baselines/BASE-001/projections/${generated.id}`
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(generated.id);
      expect(body.baselineId).toBe('BASE-001');
      expect(body.artifactType).toBe('process-diagram');
    });

    it('returns 404 PROJECTION_NOT_FOUND when projection does not exist', async () => {
      await seedBaseline('BASE-001');

      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/BASE-001/projections/NONEXISTENT-PROJ'
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('PROJECTION_NOT_FOUND');
    });

    it('returns 404 PROJECTION_NOT_FOUND when projection belongs to another baseline', async () => {
      await seedBaseline('BASE-001');
      await seedBaseline('BASE-002');
      fakeGen.setDefaultResponse('graph TD;\n  A --> B;');
      fakeLinter.setDefaultResult({ isValid: true });

      const genRes = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/projections',
        payload: { artifactType: 'process-diagram' }
      });
      const proj1 = genRes.json();

      const res = await app.inject({
        method: 'GET',
        url: `/api/baselines/BASE-002/projections/${proj1.id}`
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('PROJECTION_NOT_FOUND');
    });
  });

  describe('Closed-loop repair & cross-baseline isolation', () => {
    it('succeeds with repairsNeeded = 1 and attemptCount = 2 when first attempt fails linter', async () => {
      await seedBaseline('BASE-001');
      fakeGen.queueResponse('invalid syntax');
      fakeGen.queueResponse('graph TD;\n  Fixed --> Done;');
      fakeLinter.setResultFor('invalid syntax', {
        isValid: false,
        errorMessage: 'Parse error line 1'
      });
      fakeLinter.setDefaultResult({ isValid: true });

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/projections',
        payload: { artifactType: 'process-diagram' }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.metadata.measuredVerification.repairsNeeded).toBe(1);
      expect(body.metadata.measuredVerification.attemptCount).toBe(2);
      expect(body.content).toContain('Fixed --> Done;');
    });

    it('guarantees projections remain strictly isolated across baselines', async () => {
      await seedBaseline('BASE-001');
      await seedBaseline('BASE-002');
      fakeGen.setDefaultResponse('graph TD;\n  Start --> Finish;');
      fakeLinter.setDefaultResult({ isValid: true });

      // Generate projection for BASE-001
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/projections',
        payload: { artifactType: 'process-diagram' }
      });
      const proj1 = res1.json();

      // Generate projection for BASE-002
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-002/projections',
        payload: { artifactType: 'state-diagram' }
      });
      const proj2 = res2.json();

      // BASE-001 list contains only proj1
      const list1Res = await app.inject({
        method: 'GET',
        url: '/api/baselines/BASE-001/projections'
      });
      const list1 = list1Res.json();
      expect(list1).toHaveLength(1);
      expect(list1[0].id).toBe(proj1.id);
      expect(list1[0].baselineId).toBe('BASE-001');

      // BASE-002 list contains only proj2
      const list2Res = await app.inject({
        method: 'GET',
        url: '/api/baselines/BASE-002/projections'
      });
      const list2 = list2Res.json();
      expect(list2).toHaveLength(1);
      expect(list2[0].id).toBe(proj2.id);
      expect(list2[0].baselineId).toBe('BASE-002');
    });
  });
});
