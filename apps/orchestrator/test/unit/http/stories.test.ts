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
  createPolicyConstraintRevision,
  createPolicyConstraintId,
  createPolicyConstraintRevisionId,
  now
} from '@solutions-studio/domain';
import { StoryDtoSchema, ProjectionRecordDtoSchema } from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { FakePrototypeValidatorGateway } from '../../fakes/FakePrototypeValidatorGateway.js';
import { FakeSqlValidatorGateway } from '../../fakes/FakeSqlValidatorGateway.js';
import { FakeGherkinValidatorGateway } from '../../fakes/FakeGherkinValidatorGateway.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';

describe('HTTP Boundary: Stories API', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let fakeGen: FakeGenerationGateway;
  let fakeLinter: FakeMermaidLinterGateway;
  let fakeValidator: FakePrototypeValidatorGateway;
  let fakeSqlValidator: FakeSqlValidatorGateway;
  let fakeGherkinValidator: FakeGherkinValidatorGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-stories-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    fakeGen = new FakeGenerationGateway();
    fakeLinter = new FakeMermaidLinterGateway();
    fakeValidator = new FakePrototypeValidatorGateway();
    fakeSqlValidator = new FakeSqlValidatorGateway();
    fakeGherkinValidator = new FakeGherkinValidatorGateway();

    const composed = composeOrchestratorHttpServer({
      repository: repo,
      generationGateway: fakeGen,
      linterGateway: fakeLinter,
      prototypeValidatorGateway: fakeValidator,
      sqlValidatorGateway: fakeSqlValidator,
      gherkinValidatorGateway: fakeGherkinValidator
    });
    app = composed.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createValidGherkin(
    baselineId: string,
    reqIds: string[],
    options?: { polIds?: string[]; edIds?: string[]; extraComments?: string[] }
  ): string {
    const lines = [`# @baseline ${baselineId}`, `# @requirements ${reqIds.join(', ')}`];
    if (options?.polIds && options.polIds.length > 0) {
      lines.push(`# @policy-constraints ${options.polIds.join(', ')}`);
    }
    if (options?.edIds && options.edIds.length > 0) {
      lines.push(`# @engineering-decisions ${options.edIds.join(', ')}`);
    }
    if (options?.extraComments) {
      lines.push(...options.extraComments);
    }

    const polTag =
      options?.polIds && options.polIds.length > 0
        ? ` @policy-constraints:${options.polIds[0]}`
        : '';

    lines.push(
      '',
      'Feature: User Account Provisioning',
      '  As a verified actor',
      '  I want to create an account',
      '  So that I can access the system',
      '',
      `  @requirements:${reqIds[0]}${polTag}`,
      '  Scenario: Successful account creation',
      '    Given valid user details',
      '    When the account registration is submitted',
      '    Then the account is created successfully'
    );

    return lines.join('\n');
  }

  async function seedBaseline(
    baseId = 'BASE-001',
    reqId = `REQ-${baseId}`,
    revId = `REQ-${baseId}-R1`,
    polId?: string,
    polRevId?: string
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

    let policyConstraints: any[] = [];
    if (polId && polRevId) {
      const polRev = createPolicyConstraintRevision({
        id: createPolicyConstraintRevisionId(polRevId),
        policyConstraintId: createPolicyConstraintId(polId),
        revision: 1,
        statement: 'Records must be preserved for audit',
        authorityReference: 'REF-1',
        state: 'ACCEPTED',
        createdBy: 'sec-lead'
      });
      await repo.savePolicyConstraintRevision(polRev);
      policyConstraints = [polRev];
    }

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId(baseId),
      requirements: [rev],
      policyConstraints,
      createdBy: createReviewerId('reviewer-1'),
      createdAt: now()
    });
    await repo.saveRequirementsBaseline(baseline);
    return baseline;
  }

  describe('POST /api/baselines/:baselineId/stories', () => {
    it('generates story and returns 201 with StoryDto', async () => {
      await seedBaseline('BASE-001', 'REQ-001', 'REQ-001-R1');

      fakeGen.setDefaultResponse(createValidGherkin('BASE-001', ['REQ-001-R1']));

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/stories',
        payload: {
          prompt: 'User Account Provisioning'
        }
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      const validated = StoryDtoSchema.parse(body);
      expect(validated.baselineId).toBe('BASE-001');
      expect(validated.title).toBe('User Account Provisioning');
      expect(validated.requirementRevisionIds).toContain('REQ-001-R1');
      expect(validated.scenarios).toHaveLength(1);
      expect(validated.scenarios[0].requirementRevisionIds).toContain('REQ-001-R1');

      // Verify persistence in repo
      const stored = await repo.getStory(validated.id as any);
      expect(stored).not.toBeNull();
      expect(stored?.title).toBe('User Account Provisioning');
    });

    it('records discovered findings and engineering decisions from Gherkin comments', async () => {
      await seedBaseline('BASE-001', 'REQ-001', 'REQ-001-R1');

      const gherkin = createValidGherkin('BASE-001', ['REQ-001-R1'], {
        extraComments: [
          '# @finding: missing-constraint | MFA rate limiting is not specified in requirements | REQ-001-R1',
          '# @decision: Use Redis for rate limiting | High performance and TTL support'
        ]
      });
      fakeGen.setDefaultResponse(gherkin);

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/stories',
        payload: {}
      });

      expect(res.statusCode).toBe(201);

      // Verify findings were recorded
      const findings = await repo.listCandidateFindings();
      expect(
        findings.some((f) => f.rationale?.includes('MFA rate limiting is not specified'))
      ).toBe(true);

      // Verify decisions were recorded
      const decisions = await repo.listEngineeringDecisions();
      expect(decisions.some((d) => d.statement.includes('Use Redis for rate limiting'))).toBe(true);
    });

    it('returns 502 when story references ungrounded requirements and repair exhausts retries', async () => {
      await seedBaseline('BASE-001', 'REQ-001', 'REQ-001-R1');

      // LLM produces scenario referencing an ungrounded requirement revision and doesn't fix it
      fakeGen.setDefaultResponse(`
# @baseline BASE-001
# @requirements REQ-UNKNOWN-R99

Feature: Ungrounded Feature
  @requirements:REQ-UNKNOWN-R99
  Scenario: Ungrounded scenario
    Given something
    When something happens
    Then something is observed
`);

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/stories',
        payload: {}
      });

      expect(res.statusCode).toBe(502);
      const body = res.json();
      expect(body.code).toBe('ARTIFACT_GENERATION_FAILED');
    });

    it('returns 404 when baseline does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/NON_EXISTENT/stories',
        payload: {}
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.code).toBe('BASELINE_NOT_FOUND');
    });
  });

  describe('GET /api/baselines/:baselineId/stories', () => {
    it('returns 200 with empty list when no stories exist for baseline', async () => {
      await seedBaseline('BASE-001', 'REQ-001', 'REQ-001-R1');

      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/BASE-001/stories'
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual([]);
    });

    it('returns 200 with list of stories for baseline', async () => {
      await seedBaseline('BASE-001', 'REQ-001', 'REQ-001-R1');

      fakeGen.setDefaultResponse(createValidGherkin('BASE-001', ['REQ-001-R1']));

      // Generate first story
      await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/stories',
        payload: { prompt: 'Story 1' }
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/BASE-001/stories'
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(1);
      expect(body[0].baselineId).toBe('BASE-001');
    });

    it('returns 404 when baseline does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/baselines/NON_EXISTENT/stories'
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.code).toBe('BASELINE_NOT_FOUND');
    });
  });

  describe('GET /api/stories/:storyId', () => {
    it('returns 200 with story when it exists', async () => {
      await seedBaseline('BASE-001', 'REQ-001', 'REQ-001-R1');

      fakeGen.setDefaultResponse(createValidGherkin('BASE-001', ['REQ-001-R1']));

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/stories',
        payload: {}
      });
      const created = createRes.json();

      const res = await app.inject({
        method: 'GET',
        url: `/api/stories/${created.id}`
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const validated = StoryDtoSchema.parse(body);
      expect(validated.id).toBe(created.id);
      expect(validated.baselineId).toBe('BASE-001');
    });

    it('returns 404 when story does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/stories/STORY-NON_EXISTENT'
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.code).toBe('STORY_NOT_FOUND');
    });
  });

  describe('POST /api/baselines/:baselineId/projections with artifactType: stories', () => {
    it('generates story projection and returns 200 with ProjectionRecordDto', async () => {
      await seedBaseline('BASE-001', 'REQ-001', 'REQ-001-R1');

      fakeGen.setDefaultResponse(createValidGherkin('BASE-001', ['REQ-001-R1']));

      const res = await app.inject({
        method: 'POST',
        url: '/api/baselines/BASE-001/projections',
        payload: {
          artifactType: 'stories'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const validated = ProjectionRecordDtoSchema.parse(body);
      expect(validated.baselineId).toBe('BASE-001');
      expect(validated.artifactType).toBe('stories');
      expect(validated.content).toContain('Feature: User Account Provisioning');

      // Verify stories were also persisted
      const stories = await repo.listStories('BASE-001' as any);
      expect(stories).toHaveLength(1);
    });
  });
});
