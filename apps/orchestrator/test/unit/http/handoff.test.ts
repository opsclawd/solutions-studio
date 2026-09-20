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
  createStoryId,
  now
} from '@solutions-studio/domain';
import { EngineeringHandoffBundleDtoSchema } from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { FakePrototypeValidatorGateway } from '../../fakes/FakePrototypeValidatorGateway.js';
import { FakeSqlValidatorGateway } from '../../fakes/FakeSqlValidatorGateway.js';
import { FakeGherkinValidatorGateway } from '../../fakes/FakeGherkinValidatorGateway.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';

describe('HTTP Boundary: Handoff API', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-handoff-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });

    const composed = composeOrchestratorHttpServer({
      repository: repo,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway(),
      prototypeValidatorGateway: new FakePrototypeValidatorGateway(),
      sqlValidatorGateway: new FakeSqlValidatorGateway(),
      gherkinValidatorGateway: new FakeGherkinValidatorGateway()
    });
    app = composed.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function seedFullBaseline(baseId = 'BASE-001') {
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
      policyConstraints: [],
      createdBy: createReviewerId('reviewer-1'),
      createdAt: now()
    });
    await repo.saveRequirementsBaseline(baseline);

    const mockMetadata = {
      baselineId: baseline.id as string,
      requirementRevisionIds: [rev.id as string],
      artifactType: 'stories',
      declaredProvenance: {
        baselineId: baseline.id as string,
        requirementRevisionIds: [rev.id as string]
      },
      configuredExecution: { provider: 'fake', artifactType: 'stories' },
      measuredVerification: {
        attemptCount: 1,
        repairsNeeded: 0,
        contentHash: 'hash-init',
        verifiedAt: now()
      }
    };

    const story = {
      id: createStoryId('STORY-001'),
      baselineId: baseline.id,
      projectionId: 'PROJ-001',
      title: 'Story 1',
      narrative: { role: 'user', feature: 'feature 1', benefit: 'benefit 1' },
      requirementRevisionIds: [rev.id],
      policyConstraintRevisionIds: [],
      scenarios: [
        {
          title: 'S1',
          requirementRevisionIds: [rev.id],
          steps: [{ keyword: 'Given' as const, text: 'A' }]
        }
      ],
      acceptanceCriteria: ['AC1'],
      gherkinText: 'Feature: Story 1\n# @requirements REQ-001-R1\nScenario: S1\nGiven A',
      dependencies: [],
      metadata: mockMetadata,
      createdAt: now()
    };
    await repo.saveStory(story);

    await repo.saveProjectionRecord({
      id: 'PROJ-001',
      baselineId: baseline.id,
      requirementRevisionIds: [rev.id],
      artifactType: 'stories',
      content: story.gherkinText,
      metadata: mockMetadata,
      createdAt: now()
    });

    return { baseline, story };
  }

  describe('GET /api/baselines/:baselineId/handoff', () => {
    it('returns 404 for unknown baseline', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/UNKNOWN-BASE/handoff'
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 200 with EngineeringHandoffBundleDto schema when baseline is seeded', async () => {
      await seedFullBaseline('BASE-001');

      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/BASE-001/handoff'
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const validated = EngineeringHandoffBundleDtoSchema.parse(body);
      expect(validated.authorityBundle.baseline.id).toBe('BASE-001');
      expect(validated.stories).toHaveLength(1);
      expect(validated.dependencyGraph.nodes).toHaveLength(1);
      expect(validated.coverage.totalRequirements).toBe(1);
      expect(typeof validated.summary.isHandoffReady).toBe('boolean');
    });
  });
});
