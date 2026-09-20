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
  createStoryId,
  createBacklogExportMapping,
  createBacklogExportMappingId,
  createActorId,
  now
} from '@solutions-studio/domain';
import {
  ExportBacklogResponseDtoSchema,
  BacklogExportMappingListResponseDtoSchema
} from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeBacklogExportGateway } from '../../fakes/FakeBacklogExportGateway.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { FakePrototypeValidatorGateway } from '../../fakes/FakePrototypeValidatorGateway.js';
import { FakeSqlValidatorGateway } from '../../fakes/FakeSqlValidatorGateway.js';
import { FakeGherkinValidatorGateway } from '../../fakes/FakeGherkinValidatorGateway.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';
import { TestAuthenticator } from '../../../src/infrastructure/identity/TestAuthenticator.js';

describe('HTTP Boundary: Backlog Export API', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let fakeGateway: FakeBacklogExportGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-backlog-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    fakeGateway = new FakeBacklogExportGateway();

    const composed = composeOrchestratorHttpServer({
      repository: repo,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway(),
      prototypeValidatorGateway: new FakePrototypeValidatorGateway(),
      sqlValidatorGateway: new FakeSqlValidatorGateway(),
      gherkinValidatorGateway: new FakeGherkinValidatorGateway(),
      authenticator: new TestAuthenticator({ allowAnonymousFallback: true }),
      backlogGatewayFactory: {
        getGateway: () => fakeGateway
      } as any
    });
    app = composed.app;
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function seedBaselineAndStory(baselineIdStr = 'BASE-EXPORT-01') {
    const baselineId = createRequirementsBaselineId(baselineIdStr);
    const reqRevId = createRequirementRevisionId('REQ-001-R1');

    await repo.saveRequirementRevision({
      id: reqRevId,
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'User logs in securely',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [],
      rationale: 'Security requirement'
    });

    await repo.saveRequirementsBaseline({
      id: baselineId,
      requirementRevisions: [reqRevId],
      policyConstraintRevisions: [],
      createdAt: now(),
      createdBy: createReviewerId('REVIEWER-1')
    });

    const storyId = createStoryId('STORY-LOGIN-1');
    const gherkinText =
      'Feature: Login\nScenario: Valid credentials\nGiven user exists\nWhen user logs in\nThen user is authenticated';

    await repo.saveStory({
      id: storyId,
      baselineId,
      projectionId: 'proj-1',
      title: 'User Login Story',
      narrative: { role: 'user', feature: 'login', benefit: 'access' },
      requirementRevisionIds: [reqRevId],
      scenarios: [
        {
          title: 'Valid credentials',
          requirementRevisionIds: [reqRevId],
          steps: [
            { keyword: 'Given', text: 'user exists' },
            { keyword: 'When', text: 'user logs in' },
            { keyword: 'Then', text: 'user is authenticated' }
          ]
        }
      ],
      acceptanceCriteria: ['Valid credentials authenticated'],
      gherkinText,
      metadata: {
        baselineId,
        requirementRevisionIds: [reqRevId],
        artifactType: 'stories',
        declaredProvenance: { baselineId, requirementRevisionIds: [reqRevId] },
        configuredExecution: { provider: 'fake', artifactType: 'stories' },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'h1',
          verifiedAt: now()
        }
      },
      createdAt: now()
    });

    return { baselineId, storyId };
  }

  describe('POST /api/baselines/:baselineId/export/backlog', () => {
    it('rejects anonymous fallback caller with 401 UNAUTHENTICATED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/export/backlog',
        payload: {
          targetContainer: 'acme/repo'
        }
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.code).toBe('UNAUTHENTICATED');
    });

    it('rejects caller lacking backlog:export capability with 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/export/backlog',
        headers: {
          authorization: 'Bearer test:viewer'
        },
        payload: {
          targetContainer: 'acme/repo'
        }
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.code).toBe('FORBIDDEN');
    });

    it('returns 404 when baseline does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/NONEXISTENT-BASE/export/backlog',
        headers: {
          authorization: 'Bearer test:exporter'
        },
        payload: {
          targetContainer: 'acme/repo'
        }
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.code).toBe('BASELINE_NOT_FOUND');
    });

    it('successfully exports backlog and returns 200 with schema compliance', async () => {
      const { baselineId } = await seedBaselineAndStory('BASE-EXPORT-01');

      const res = await app.inject({
        method: 'POST',
        url: `/api/baselines/${baselineId}/export/backlog`,
        headers: {
          authorization: 'Bearer test:exporter'
        },
        payload: {
          provider: 'fake',
          targetContainer: 'acme/repo'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const validated = ExportBacklogResponseDtoSchema.parse(body);
      expect(validated.baselineId).toBe(baselineId);
      expect(validated.summary.total).toBe(1);
      expect(validated.summary.created).toBe(1);
      expect(validated.items[0].status).toBe('created');
    });

    it('returns 400 STORY_NOT_READY_FOR_EXPORT when targeted story fails readiness', async () => {
      const { baselineId } = await seedBaselineAndStory('BASE-EXPORT-02');
      const unreadyStoryId = createStoryId('STORY-UNREADY-99');
      const missingReqRevId = createRequirementRevisionId('REQ-MISSING-REV');

      await repo.saveStory({
        id: unreadyStoryId,
        baselineId,
        projectionId: 'proj-unready',
        title: 'Unready Story',
        narrative: { role: 'user', feature: 'unready', benefit: 'none' },
        requirementRevisionIds: [missingReqRevId],
        scenarios: [
          {
            title: 'Unready Scenario',
            requirementRevisionIds: [missingReqRevId],
            steps: [{ keyword: 'Given', text: 'something' }]
          }
        ],
        acceptanceCriteria: ['Criteria'],
        gherkinText: 'Feature: Unready',
        metadata: {
          baselineId,
          requirementRevisionIds: [missingReqRevId],
          artifactType: 'stories',
          declaredProvenance: { baselineId, requirementRevisionIds: [missingReqRevId] },
          configuredExecution: { provider: 'fake', artifactType: 'stories' },
          measuredVerification: {
            repairsNeeded: 0,
            attemptCount: 1,
            contentHash: 'h1',
            verifiedAt: now()
          }
        },
        createdAt: now()
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/baselines/${baselineId}/export/backlog`,
        headers: {
          authorization: 'Bearer test:exporter'
        },
        payload: {
          provider: 'fake',
          targetContainer: 'acme/repo',
          storyIds: [unreadyStoryId]
        }
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('STORY_NOT_READY_FOR_EXPORT');
      expect(body.details.storyId).toBe(unreadyStoryId);
    });
  });

  describe('GET /api/baselines/:baselineId/export/backlog/mappings', () => {
    it('rejects anonymous fallback caller with 401 UNAUTHENTICATED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/BASE-001/export/backlog/mappings'
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.code).toBe('UNAUTHENTICATED');
    });

    it('rejects caller lacking capability with 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/BASE-001/export/backlog/mappings',
        headers: {
          authorization: 'Bearer test:viewer'
        }
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.code).toBe('FORBIDDEN');
    });

    it('returns 200 with mapped items for authorized caller', async () => {
      const baselineId = createRequirementsBaselineId('BASE-MAP-01');
      const storyId = createStoryId('STORY-MAP-01');

      const mapping = createBacklogExportMapping({
        id: createBacklogExportMappingId('MAP-001'),
        storyId,
        baselineId,
        provider: 'fake',
        externalContainer: 'acme/repo',
        externalWorkItemId: '999',
        externalUrl: 'https://fake.test/acme/repo/999',
        exportContentHash: 'a'.repeat(64),
        exportedAt: now(),
        exportedBy: createActorId('exporter-1')
      });
      await repo.saveBacklogExportMapping(mapping);

      const res = await app.inject({
        method: 'GET',
        url: `/api/baselines/${baselineId}/export/backlog/mappings`,
        headers: {
          authorization: 'Bearer test:exporter'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const validated = BacklogExportMappingListResponseDtoSchema.parse(body);
      expect(validated.items).toHaveLength(1);
      expect(validated.items[0].id).toBe('MAP-001');
      expect(validated.items[0].externalWorkItemId).toBe('999');
    });
  });
});
