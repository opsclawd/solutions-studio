import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createRequirementId,
  createStoryId,
  createReviewerId,
  createAuthenticatedActor,
  StoryNotReadyForExportError,
  now
} from '@solutions-studio/domain';
import { ExportBacklogUseCase } from '../../src/application/use-cases/ExportBacklogUseCase.js';
import { FakeBacklogExportGateway } from '../fakes/FakeBacklogExportGateway.js';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { DefaultAuthorizationPolicy } from '../../src/infrastructure/identity/DefaultAuthorizationPolicy.js';
import { GetAuthorityBundleUseCase } from '../../src/application/use-cases/GetAuthorityBundleUseCase.js';
import { EvaluateStoryReadinessUseCase } from '../../src/application/use-cases/EvaluateStoryReadinessUseCase.js';
import { BuildStoryDependencyGraphUseCase } from '../../src/application/use-cases/BuildStoryDependencyGraphUseCase.js';
import { ForbiddenError } from '../../src/application/ports/identity/IdentityErrors.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('ExportBacklogUseCase Application Tests', () => {
  let tempDir: string;
  let repository: FilesystemRequirementsRepository;
  let fakeGateway: FakeBacklogExportGateway;
  let authorizer: DefaultAuthorizationPolicy;
  let getAuthorityBundleUseCase: GetAuthorityBundleUseCase;
  let evaluateStoryReadinessUseCase: EvaluateStoryReadinessUseCase;
  let buildStoryDependencyGraphUseCase: BuildStoryDependencyGraphUseCase;
  let useCase: ExportBacklogUseCase;

  const validActor = createAuthenticatedActor({
    id: 'export-operator',
    name: 'Export Operator',
    actorType: 'human',
    capabilities: ['backlog:export']
  });

  const unauthorizedActor = createAuthenticatedActor({
    id: 'read-only-user',
    name: 'Read Only',
    actorType: 'human',
    capabilities: []
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-uc-test-'));
    repository = new FilesystemRequirementsRepository({ baseDir: tempDir });
    fakeGateway = new FakeBacklogExportGateway();
    authorizer = new DefaultAuthorizationPolicy();

    getAuthorityBundleUseCase = new GetAuthorityBundleUseCase(repository);
    evaluateStoryReadinessUseCase = new EvaluateStoryReadinessUseCase(repository);
    buildStoryDependencyGraphUseCase = new BuildStoryDependencyGraphUseCase(
      repository,
      evaluateStoryReadinessUseCase
    );

    useCase = new ExportBacklogUseCase(
      repository,
      fakeGateway,
      authorizer,
      getAuthorityBundleUseCase,
      evaluateStoryReadinessUseCase,
      buildStoryDependencyGraphUseCase
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('rejects execution when actor lacks backlog:export capability', async () => {
    await expect(
      useCase.execute({
        baselineId: 'base-1',
        targetContainer: 'acme/repo',
        actor: unauthorizedActor
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it('handles first export, idempotent re-export, and modification update', async () => {
    // 1. Setup baseline & authority requirement
    const baselineId = createRequirementsBaselineId('BASE-EXPORT-1');
    const reqId = createRequirementId('REQ-001');
    const reqRevId = createRequirementRevisionId('REQ-001-R1');

    await repository.saveRequirementRevision({
      id: reqRevId,
      requirementId: reqId,
      revision: 1,
      statement: 'User must be able to log in securely.',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [],
      rationale: 'Core security'
    });

    await repository.saveRequirementsBaseline({
      id: baselineId,
      requirementRevisions: [reqRevId],
      policyConstraintRevisions: [],
      createdAt: now(),
      createdBy: createReviewerId('REVIEWER-1')
    });

    // 2. Setup story with projection
    const storyId = createStoryId('STORY-LOGIN-1');
    const gherkinText =
      'Feature: Login\nScenario: Valid credentials\nGiven user exists\nWhen user logs in\nThen user is authenticated';

    await repository.saveStory({
      id: storyId,
      baselineId,
      projectionId: 'proj-login',
      title: 'User Login',
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

    // 3. First Export: should create external item and persist mapping
    const res1 = await useCase.execute({
      baselineId,
      targetContainer: 'acme/repo',
      actor: validActor
    });

    expect(res1.summary.total).toBe(1);
    expect(res1.summary.created).toBe(1);
    expect(res1.summary.unchanged).toBe(0);
    expect(res1.items[0].status).toBe('created');
    expect(fakeGateway.createCalls).toHaveLength(1);

    const createdWorkItemId = (res1.items[0] as { externalWorkItemId: string }).externalWorkItemId;
    expect(createdWorkItemId).toBeDefined();

    // Verify mapping is persisted in repository
    const mapping = await repository.findBacklogExportMapping({
      provider: 'fake',
      externalContainer: 'acme/repo',
      storyId
    });
    expect(mapping).toBeDefined();
    expect(mapping?.externalWorkItemId).toBe(createdWorkItemId);

    // 4. Repeated Export without changes: must be IDEMPOTENT (0 provider calls)
    fakeGateway.reset();
    const res2 = await useCase.execute({
      baselineId,
      targetContainer: 'acme/repo',
      actor: validActor
    });

    expect(res2.summary.total).toBe(1);
    expect(res2.summary.created).toBe(0);
    expect(res2.summary.updated).toBe(0);
    expect(res2.summary.unchanged).toBe(1);
    expect(res2.items[0].status).toBe('unchanged');
    expect(fakeGateway.createCalls).toHaveLength(0);
    expect(fakeGateway.updateCalls).toHaveLength(0);

    // 5. Update story content: explicit re-export triggers updateWorkItem
    const updatedGherkin = gherkinText + '\n# Added comment to mutate content';
    await repository.updateStory({
      id: storyId,
      baselineId,
      projectionId: 'proj-login',
      title: 'User Login',
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
      gherkinText: updatedGherkin,
      metadata: {
        baselineId,
        requirementRevisionIds: [reqRevId],
        artifactType: 'stories',
        declaredProvenance: { baselineId, requirementRevisionIds: [reqRevId] },
        configuredExecution: { provider: 'fake', artifactType: 'stories' },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'h2',
          verifiedAt: now()
        }
      },
      createdAt: now()
    });

    const res3 = await useCase.execute({
      baselineId,
      targetContainer: 'acme/repo',
      actor: validActor
    });

    expect(res3.summary.total).toBe(1);
    expect(res3.summary.updated).toBe(1);
    expect(res3.items[0].status).toBe('updated');
    expect(fakeGateway.updateCalls).toHaveLength(1);

    const updatedMapping = await repository.findBacklogExportMapping({
      provider: 'fake',
      externalContainer: 'acme/repo',
      storyId
    });
    expect(updatedMapping?.exportContentHash).not.toBe(mapping?.exportContentHash);
  });

  it('rejects stories failing readiness gates and records rejection reasons', async () => {
    const baselineId = createRequirementsBaselineId('BASE-UNREADY-1');

    await repository.saveRequirementsBaseline({
      id: baselineId,
      requirementRevisions: [],
      policyConstraintRevisions: [],
      createdAt: now(),
      createdBy: createReviewerId('REVIEWER-1')
    });

    // Story referencing requirement not present in baseline fails readiness
    const unreadyStoryId = createStoryId('STORY-UNREADY-1');
    const missingReqRevId = createRequirementRevisionId('REQ-MISSING-1');
    await repository.saveStory({
      id: unreadyStoryId,
      baselineId,
      projectionId: 'proj-unready',
      title: 'Unready Story',
      narrative: { role: 'user', feature: 'feature', benefit: 'benefit' },
      requirementRevisionIds: [missingReqRevId],
      scenarios: [
        {
          title: 'Unready Scenario',
          requirementRevisionIds: [missingReqRevId],
          steps: [{ keyword: 'Given', text: 'something' }]
        }
      ],
      acceptanceCriteria: ['AC 1'],
      gherkinText: 'Feature: Unready\nScenario: Unready Scenario\nGiven something',
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

    // Batch export records item as rejected
    const batchRes = await useCase.execute({
      baselineId,
      targetContainer: 'acme/repo',
      actor: validActor
    });

    expect(batchRes.summary.total).toBe(1);
    expect(batchRes.summary.rejected).toBe(1);
    expect(batchRes.items[0].status).toBe('rejected');
    expect(fakeGateway.createCalls).toHaveLength(0);

    // Targeted export of unready story throws StoryNotReadyForExportError
    await expect(
      useCase.execute({
        baselineId,
        targetContainer: 'acme/repo',
        storyIds: [unreadyStoryId],
        actor: validActor
      })
    ).rejects.toThrow(StoryNotReadyForExportError);
  });

  it('handles provider failures safely without persisting corrupt mappings', async () => {
    const baselineId = createRequirementsBaselineId('BASE-FAIL-1');
    const reqRevId = createRequirementRevisionId('REQ-FAIL-R1');

    await repository.saveRequirementRevision({
      id: reqRevId,
      requirementId: createRequirementId('REQ-FAIL-1'),
      revision: 1,
      statement: 'Functional requirement',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [],
      rationale: 'rationale'
    });

    await repository.saveRequirementsBaseline({
      id: baselineId,
      requirementRevisions: [reqRevId],
      policyConstraintRevisions: [],
      createdAt: now(),
      createdBy: createReviewerId('REVIEWER-1')
    });

    const storyId = createStoryId('STORY-FAIL-1');
    await repository.saveStory({
      id: storyId,
      baselineId,
      projectionId: 'proj-fail',
      title: 'Story to fail',
      narrative: { role: 'user', feature: 'feature', benefit: 'benefit' },
      requirementRevisionIds: [reqRevId],
      scenarios: [
        {
          title: 'Scenario 1',
          requirementRevisionIds: [reqRevId],
          steps: [{ keyword: 'Given', text: 'step 1' }]
        }
      ],
      acceptanceCriteria: ['AC1'],
      gherkinText: 'Feature: Fail\nScenario: 1\nGiven step 1',
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

    // Queue simulated failure on gateway
    fakeGateway.queueError(new Error('Simulated upstream network timeout'));

    const result = await useCase.execute({
      baselineId,
      targetContainer: 'acme/repo',
      actor: validActor
    });

    expect(result.summary.failed).toBe(1);
    expect(result.items[0].status).toBe('failed');
    if (result.items[0].status === 'failed') {
      expect(result.items[0].errorMessage).toContain('Simulated upstream network timeout');
    }

    // Assert no corrupt mapping was saved in repository
    const mapping = await repository.findBacklogExportMapping({
      provider: 'fake',
      externalContainer: 'acme/repo',
      storyId
    });
    expect(mapping).toBeUndefined();
  });

  it('rejects execution when provider does not match gateway providerId', async () => {
    const baselineId = createRequirementsBaselineId('BASE-MISMATCH-1');
    await repository.saveRequirementsBaseline({
      id: baselineId,
      requirementRevisions: [],
      policyConstraintRevisions: [],
      createdAt: now(),
      createdBy: createReviewerId('REV-1')
    });

    await expect(
      useCase.execute({
        baselineId,
        targetContainer: 'acme/repo',
        provider: 'jira-cloud',
        actor: validActor
      })
    ).rejects.toThrow(
      "Gateway provider mismatch: requested 'jira-cloud' but gateway resolved to 'fake'"
    );
  });

  it('recovers unmapped work item created on provider after prior persistence failure', async () => {
    const baselineId = createRequirementsBaselineId('BASE-RECOVER-1');
    const reqRevId = createRequirementRevisionId('REQ-REC-R1');

    await repository.saveRequirementRevision({
      id: reqRevId,
      requirementId: createRequirementId('REQ-REC-1'),
      revision: 1,
      statement: 'Recoverable requirement',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [],
      rationale: 'Recovery test'
    });

    await repository.saveRequirementsBaseline({
      id: baselineId,
      requirementRevisions: [reqRevId],
      policyConstraintRevisions: [],
      createdAt: now(),
      createdBy: createReviewerId('REV-1')
    });

    const storyId = createStoryId('STORY-REC-1');
    await repository.saveStory({
      id: storyId,
      baselineId,
      projectionId: 'proj-rec',
      title: 'Story to recover',
      narrative: { role: 'user', feature: 'recovery', benefit: 'idempotency' },
      requirementRevisionIds: [reqRevId],
      scenarios: [
        {
          title: 'Recovery Scenario',
          requirementRevisionIds: [reqRevId],
          steps: [{ keyword: 'Given', text: 'item exists remotely' }]
        }
      ],
      acceptanceCriteria: ['Must recover cleanly'],
      gherkinText: 'Feature: Recovery\nScenario: Recovery Scenario\nGiven item exists remotely',
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

    // Simulate prior provider create succeeded (external issue 777 exists remotely),
    // but local mapping persistence had failed or died before saving.
    fakeGateway.existingRemoteItems.set(storyId, {
      externalWorkItemId: '777',
      externalUrl: 'https://fake-backlog.test/acme/repo/items/777',
      metadata: { remoteConfirmed: true }
    });

    // Execute export: should discover remote issue via findWorkItem, recover mapping,
    // and NOT call createWorkItem!
    const result = await useCase.execute({
      baselineId,
      targetContainer: 'acme/repo',
      actor: validActor
    });

    expect(fakeGateway.createCalls).toHaveLength(0);
    expect(result.summary.unchanged).toBe(1);
    expect(result.items[0].status).toBe('unchanged');
    expect((result.items[0] as { externalWorkItemId: string }).externalWorkItemId).toBe('777');

    // Verify mapping is now durably persisted in repository
    const mapping = await repository.findBacklogExportMapping({
      provider: 'fake',
      externalContainer: 'acme/repo',
      storyId
    });
    expect(mapping).toBeDefined();
    expect(mapping?.externalWorkItemId).toBe('777');
  });

  it('proves only one provider create occurs under concurrent export from two repository instances', async () => {
    const baselineId = createRequirementsBaselineId('BASE-CONC-1');
    const reqRevId = createRequirementRevisionId('REQ-CONC-R1');

    await repository.saveRequirementRevision({
      id: reqRevId,
      requirementId: createRequirementId('REQ-CONC-1'),
      revision: 1,
      statement: 'Concurrent export test',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [],
      rationale: 'Concurrency test'
    });

    await repository.saveRequirementsBaseline({
      id: baselineId,
      requirementRevisions: [reqRevId],
      policyConstraintRevisions: [],
      createdAt: now(),
      createdBy: createReviewerId('REV-1')
    });

    const storyId = createStoryId('STORY-CONC-1');
    await repository.saveStory({
      id: storyId,
      baselineId,
      projectionId: 'proj-conc',
      title: 'Concurrent Story',
      narrative: { role: 'user', feature: 'concurrent export', benefit: 'single creation' },
      requirementRevisionIds: [reqRevId],
      scenarios: [
        {
          title: 'Concurrent Scenario',
          requirementRevisionIds: [reqRevId],
          steps: [{ keyword: 'Given', text: 'two processes' }]
        }
      ],
      acceptanceCriteria: ['Single create only'],
      gherkinText: 'Feature: Concurrency\nScenario: Concurrent Scenario\nGiven two processes',
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

    // Create a second repository instance pointing to the exact same directory (simulating second process)
    const repository2 = new FilesystemRequirementsRepository({ baseDir: tempDir });
    const getAuthorityBundleUseCase2 = new GetAuthorityBundleUseCase(repository2);
    const evaluateStoryReadinessUseCase2 = new EvaluateStoryReadinessUseCase(repository2);
    const buildStoryDependencyGraphUseCase2 = new BuildStoryDependencyGraphUseCase(
      repository2,
      evaluateStoryReadinessUseCase2
    );

    const useCase2 = new ExportBacklogUseCase(
      repository2,
      fakeGateway,
      authorizer,
      getAuthorityBundleUseCase2,
      evaluateStoryReadinessUseCase2,
      buildStoryDependencyGraphUseCase2
    );

    // Launch both export use cases concurrently
    const [res1, res2] = await Promise.all([
      useCase.execute({
        baselineId,
        targetContainer: 'acme/repo',
        actor: validActor
      }),
      useCase2.execute({
        baselineId,
        targetContainer: 'acme/repo',
        actor: validActor
      })
    ]);

    // Exactly ONE provider create call must occur across both instances!
    expect(fakeGateway.createCalls).toHaveLength(1);

    const statuses = [res1.items[0].status, res2.items[0].status].sort();
    expect(statuses).toEqual(['created', 'unchanged']);
  });
});
