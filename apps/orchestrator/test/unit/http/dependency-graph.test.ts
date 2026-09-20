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
import { StoryDependencyGraphDtoSchema, StoryDtoSchema } from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { FakePrototypeValidatorGateway } from '../../fakes/FakePrototypeValidatorGateway.js';
import { FakeSqlValidatorGateway } from '../../fakes/FakeSqlValidatorGateway.js';
import { FakeGherkinValidatorGateway } from '../../fakes/FakeGherkinValidatorGateway.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';

describe('HTTP Boundary: Dependency Graph and Dependencies API', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-dep-graph-test-'));
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

  async function seedBaselineWithStories(baseId = 'BASE-001') {
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

    const story1 = {
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
    const story2 = {
      id: createStoryId('STORY-002'),
      baselineId: baseline.id,
      projectionId: 'PROJ-002',
      title: 'Story 2',
      narrative: { role: 'user', feature: 'feature 2', benefit: 'benefit 2' },
      requirementRevisionIds: [rev.id],
      policyConstraintRevisionIds: [],
      scenarios: [
        {
          title: 'S2',
          requirementRevisionIds: [rev.id],
          steps: [{ keyword: 'Given' as const, text: 'B' }]
        }
      ],
      acceptanceCriteria: ['AC2'],
      gherkinText:
        'Feature: Story 2\n# @requirements REQ-001-R1\n# @depends-on: STORY-001\nScenario: S2\nGiven B',
      dependencies: [createStoryId('STORY-001')],
      metadata: mockMetadata,
      createdAt: now()
    };

    await repo.saveProjectionRecord({
      id: 'PROJ-001',
      baselineId: baseline.id,
      requirementRevisionIds: [rev.id],
      artifactType: 'stories',
      content: story1.gherkinText,
      metadata: mockMetadata,
      createdAt: now()
    });

    await repo.saveProjectionRecord({
      id: 'PROJ-002',
      baselineId: baseline.id,
      requirementRevisionIds: [rev.id],
      artifactType: 'stories',
      content: story2.gherkinText,
      metadata: mockMetadata,
      createdAt: now()
    });

    await repo.saveStory(story1);
    await repo.saveStory(story2);

    return { baseline, story1, story2 };
  }

  describe('GET /api/baselines/:baselineId/dependency-graph', () => {
    it('returns 404 for unknown baseline', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/UNKNOWN-BASE/dependency-graph'
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 200 with StoryDependencyGraphDto schema', async () => {
      await seedBaselineWithStories('BASE-001');

      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/BASE-001/dependency-graph?includeReadiness=true'
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const validated = StoryDependencyGraphDtoSchema.parse(body);
      expect(validated.baselineId).toBe('BASE-001');
      expect(validated.nodes).toHaveLength(2);
      expect(validated.edges).toHaveLength(1);
      expect(validated.edges[0]).toEqual({
        from: 'STORY-001',
        to: 'STORY-002'
      });
      expect(validated.executionOrder).toEqual(['STORY-001', 'STORY-002']);
      expect(validated.hasCycles).toBe(false);
      expect(validated.validation.isValid).toBe(true);
    });
  });

  describe('PUT /api/stories/:storyId/dependencies', () => {
    it('returns 404 for unknown story', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/stories/UNKNOWN-STORY/dependencies',
        payload: {
          dependencies: []
        }
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 or 422 for self-dependency', async () => {
      await seedBaselineWithStories('BASE-001');

      const res = await app.inject({
        method: 'PUT',
        url: '/api/stories/STORY-001/dependencies',
        payload: {
          dependencies: ['STORY-001']
        }
      });
      expect([400, 422]).toContain(res.statusCode);
    });

    it('returns 400 or 422 for cycle creation', async () => {
      await seedBaselineWithStories('BASE-001');

      // STORY-002 depends on STORY-001. Making STORY-001 depend on STORY-002 creates cycle.
      const res = await app.inject({
        method: 'PUT',
        url: '/api/stories/STORY-001/dependencies',
        payload: {
          dependencies: ['STORY-002']
        }
      });
      expect([400, 422]).toContain(res.statusCode);
    });

    it('returns 200 and updates story dependencies and gherkin content', async () => {
      await seedBaselineWithStories('BASE-001');

      const res = await app.inject({
        method: 'PUT',
        url: '/api/stories/STORY-002/dependencies',
        payload: {
          dependencies: []
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const validated = StoryDtoSchema.parse(body);
      expect(validated.dependencies).toEqual([]);
      expect(validated.gherkinText).not.toContain('# @depends-on');
    });
  });
});
