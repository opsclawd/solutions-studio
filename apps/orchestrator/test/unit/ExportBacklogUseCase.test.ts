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

    // Without allowUpdateExisting: true, re-export of modified story fails closed
    const resSkipped = await useCase.execute({
      baselineId,
      targetContainer: 'acme/repo',
      actor: validActor
    });

    expect(resSkipped.summary.total).toBe(1);
    expect(resSkipped.summary.skippedStale).toBe(1);
    expect(resSkipped.items[0].status).toBe('skipped-stale');
    expect(fakeGateway.updateCalls).toHaveLength(0);

    // With allowUpdateExisting: true, update succeeds, increments exportVersion and records history
    const res3 = await useCase.execute({
      baselineId,
      targetContainer: 'acme/repo',
      allowUpdateExisting: true,
      updateRationale: 'Step update',
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
    expect(updatedMapping?.exportVersion).toBe(2);
    expect(updatedMapping?.history).toHaveLength(1);
    expect(updatedMapping?.history?.[0].exportVersion).toBe(1);
    expect(updatedMapping?.history?.[0].updateRationale).toBe('Step update');
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

  it('filters export to only stale or impacted stories when propagateStaleOnly is true', async () => {
    const baselineId = createRequirementsBaselineId('BASE-STALE-FILTER');
    const reqRev1 = createRequirementRevisionId('REQ-F-1');
    const reqRev2 = createRequirementRevisionId('REQ-F-2');

    await repository.saveRequirementRevision({
      id: reqRev1,
      requirementId: createRequirementId('REQ-1'),
      revision: 1,
      statement: 'Req 1',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [],
      rationale: 'R1'
    });

    await repository.saveRequirementRevision({
      id: reqRev2,
      requirementId: createRequirementId('REQ-2'),
      revision: 1,
      statement: 'Req 2',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [],
      rationale: 'R2'
    });

    await repository.saveRequirementsBaseline({
      id: baselineId,
      requirementRevisions: [reqRev1, reqRev2],
      policyConstraintRevisions: [],
      createdAt: now(),
      createdBy: createReviewerId('REV-1')
    });

    const s1Id = createStoryId('STORY-F-1');
    const s2Id = createStoryId('STORY-F-2');

    await repository.saveStory({
      id: s1Id,
      baselineId,
      projectionId: 'proj-f1',
      title: 'Story 1',
      narrative: { role: 'user', feature: 'f1', benefit: 'b1' },
      acceptanceCriteria: ['AC1'],
      scenarios: [
        {
          id: 'sc1',
          title: 'S1',
          requirementRevisionIds: [reqRev1],
          steps: [{ keyword: 'Given', text: 'x' }]
        }
      ],
      gherkinText: 'Feature: F1\nScenario: S1\nGiven x',
      requirementRevisionIds: [reqRev1],
      metadata: {
        baselineId,
        requirementRevisionIds: [reqRev1],
        artifactType: 'stories',
        declaredProvenance: { baselineId, requirementRevisionIds: [reqRev1] },
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

    await repository.saveStory({
      id: s2Id,
      baselineId,
      projectionId: 'proj-f2',
      title: 'Story 2',
      narrative: { role: 'user', feature: 'f2', benefit: 'b2' },
      acceptanceCriteria: ['AC2'],
      scenarios: [
        {
          id: 'sc2',
          title: 'S2',
          requirementRevisionIds: [reqRev2],
          steps: [{ keyword: 'Given', text: 'y' }]
        }
      ],
      gherkinText: 'Feature: F2\nScenario: S2\nGiven y',
      requirementRevisionIds: [reqRev2],
      metadata: {
        baselineId,
        requirementRevisionIds: [reqRev2],
        artifactType: 'stories',
        declaredProvenance: { baselineId, requirementRevisionIds: [reqRev2] },
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

    // First export: both stories created
    const firstExport = await useCase.execute({
      baselineId,
      targetContainer: 'acme/filter-repo',
      actor: validActor
    });
    expect(firstExport.summary.created).toBe(2);

    // Modify only Story 1
    await repository.updateStory({
      id: s1Id,
      baselineId,
      projectionId: 'proj-f1',
      title: 'Story 1 Updated',
      narrative: { role: 'user', feature: 'f1 updated', benefit: 'b1' },
      acceptanceCriteria: ['AC1'],
      scenarios: [
        {
          id: 'sc1',
          title: 'S1',
          requirementRevisionIds: [reqRev1],
          steps: [{ keyword: 'Given', text: 'x modified' }]
        }
      ],
      gherkinText: 'Feature: F1\nScenario: S1\nGiven x modified',
      requirementRevisionIds: [reqRev1],
      metadata: {
        baselineId,
        requirementRevisionIds: [reqRev1],
        artifactType: 'stories',
        declaredProvenance: { baselineId, requirementRevisionIds: [reqRev1] },
        configuredExecution: { provider: 'fake', artifactType: 'stories' },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'h3',
          verifiedAt: now()
        }
      },
      createdAt: now()
    });

    // Export with propagateStaleOnly: true and allowUpdateExisting: true
    const staleExport = await useCase.execute({
      baselineId,
      targetContainer: 'acme/filter-repo',
      propagateStaleOnly: true,
      allowUpdateExisting: true,
      actor: validActor
    });

    // Only Story 1 should be exported (updated); Story 2 is untouched
    expect(staleExport.summary.total).toBe(1);
    expect(staleExport.items).toHaveLength(1);
    expect(staleExport.items[0].storyId).toBe(s1Id);
    expect(staleExport.items[0].status).toBe('updated');
  });

  it('fails closed when upstream prerequisite export version increases even if dependent story hash is unchanged, and updates with bumped version and recorded prerequisite versions upon explicit confirmation', async () => {
    const baselineId = createRequirementsBaselineId('BASE-PREREQ-TEST');
    const reqRev = createRequirementRevisionId('REQ-PREREQ-R1');

    await repository.saveRequirementRevision({
      id: reqRev,
      requirementId: createRequirementId('REQ-PREREQ'),
      revision: 1,
      statement: 'Prerequisite requirement statement.',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: []
    });

    await repository.saveRequirementsBaseline({
      id: baselineId,
      requirementRevisions: [reqRev],
      policyConstraintRevisions: [],
      createdAt: now(),
      createdBy: createReviewerId('REV-1')
    });

    const s1Id = createStoryId('STORY-UPSTREAM');
    const s2Id = createStoryId('STORY-DEPENDENT');

    // Upstream story 1
    await repository.saveStory({
      id: s1Id,
      baselineId,
      projectionId: 'proj-u1',
      title: 'Upstream Story',
      narrative: { role: 'user', feature: 'u1', benefit: 'b1' },
      acceptanceCriteria: ['AC1'],
      scenarios: [
        {
          id: 'sc1',
          title: 'U1',
          requirementRevisionIds: [reqRev],
          steps: [{ keyword: 'Given', text: 'u1 step' }]
        }
      ],
      gherkinText: 'Feature: U1\nScenario: U1\nGiven u1 step',
      requirementRevisionIds: [reqRev],
      metadata: {
        baselineId,
        requirementRevisionIds: [reqRev],
        artifactType: 'stories',
        declaredProvenance: { baselineId, requirementRevisionIds: [reqRev] },
        configuredExecution: { provider: 'fake', artifactType: 'stories' },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'hu1',
          verifiedAt: now()
        }
      },
      createdAt: now()
    });

    // Dependent story 2 (depends on upstream story 1)
    await repository.saveStory({
      id: s2Id,
      baselineId,
      projectionId: 'proj-d2',
      title: 'Dependent Story',
      narrative: { role: 'user', feature: 'd2', benefit: 'b2' },
      acceptanceCriteria: ['AC2'],
      dependencies: [s1Id],
      scenarios: [
        {
          id: 'sc2',
          title: 'D2',
          requirementRevisionIds: [reqRev],
          steps: [{ keyword: 'Given', text: 'd2 step' }]
        }
      ],
      gherkinText: 'Feature: D2\nScenario: D2\nGiven d2 step',
      requirementRevisionIds: [reqRev],
      metadata: {
        baselineId,
        requirementRevisionIds: [reqRev],
        artifactType: 'stories',
        declaredProvenance: { baselineId, requirementRevisionIds: [reqRev] },
        configuredExecution: { provider: 'fake', artifactType: 'stories' },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'hd2',
          verifiedAt: now()
        }
      },
      createdAt: now()
    });

    // 1. Initial export of both stories
    const initialExport = await useCase.execute({
      baselineId,
      targetContainer: 'acme/prereq-repo',
      actor: validActor
    });
    expect(initialExport.summary.created).toBe(2);

    const s1MappingV1 = await repository.findBacklogExportMapping({
      storyId: s1Id,
      provider: 'fake',
      externalContainer: 'acme/prereq-repo'
    });
    expect(s1MappingV1?.exportVersion).toBe(1);

    const s2MappingV1 = await repository.findBacklogExportMapping({
      storyId: s2Id,
      provider: 'fake',
      externalContainer: 'acme/prereq-repo'
    });
    expect(s2MappingV1?.exportVersion).toBe(1);
    expect(s2MappingV1?.prerequisiteExportVersions?.[s1Id]).toBe(1);

    // 2. Modify and re-export upstream story 1 with allowUpdateExisting: true -> exportVersion bumps to 2
    await repository.updateStory({
      id: s1Id,
      baselineId,
      projectionId: 'proj-u1',
      title: 'Upstream Story Bumped',
      narrative: { role: 'user', feature: 'u1 bumped', benefit: 'b1' },
      acceptanceCriteria: ['AC1 bumped'],
      scenarios: [
        {
          id: 'sc1',
          title: 'U1',
          requirementRevisionIds: [reqRev],
          steps: [{ keyword: 'Given', text: 'u1 bumped step' }]
        }
      ],
      gherkinText: 'Feature: U1\nScenario: U1\nGiven u1 bumped step',
      requirementRevisionIds: [reqRev],
      metadata: {
        baselineId,
        requirementRevisionIds: [reqRev],
        artifactType: 'stories',
        declaredProvenance: { baselineId, requirementRevisionIds: [reqRev] },
        configuredExecution: { provider: 'fake', artifactType: 'stories' },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'hu1-bumped',
          verifiedAt: now()
        }
      },
      createdAt: now()
    });

    const upstreamUpdateExport = await useCase.execute({
      baselineId,
      targetContainer: 'acme/prereq-repo',
      storyIds: [s1Id],
      allowUpdateExisting: true,
      updateRationale: 'Upstream requirements changed',
      actor: validActor
    });
    expect(upstreamUpdateExport.items[0].status).toBe('updated');

    const s1MappingV2 = await repository.findBacklogExportMapping({
      storyId: s1Id,
      provider: 'fake',
      externalContainer: 'acme/prereq-repo'
    });
    expect(s1MappingV2?.exportVersion).toBe(2);

    // 3. Attempt export of dependent story 2 without allowUpdateExisting:
    // Even though story 2's own content hash is identical to its existing mapping,
    // its upstream prerequisite version superseded from 1 to 2 -> classification is IMPACTED!
    // It MUST fail closed as 'skipped-stale' with 0 provider calls!
    const gatewayUpdateCallsBefore = fakeGateway.updateCalls.length;
    const gatewayCreateCallsBefore = fakeGateway.createCalls.length;

    const dependentBlockedExport = await useCase.execute({
      baselineId,
      targetContainer: 'acme/prereq-repo',
      storyIds: [s2Id],
      allowUpdateExisting: false,
      actor: validActor
    });

    expect(dependentBlockedExport.summary.skippedStale).toBe(1);
    expect(dependentBlockedExport.items[0].status).toBe('skipped-stale');
    expect(fakeGateway.updateCalls.length).toBe(gatewayUpdateCallsBefore);
    expect(fakeGateway.createCalls.length).toBe(gatewayCreateCallsBefore);

    // 4. Export dependent story 2 with explicit allowUpdateExisting: true
    const dependentUpdateExport = await useCase.execute({
      baselineId,
      targetContainer: 'acme/prereq-repo',
      storyIds: [s2Id],
      allowUpdateExisting: true,
      updateRationale: 'Aligning with upstream v2 export',
      actor: validActor
    });

    expect(dependentUpdateExport.summary.updated).toBe(1);
    expect(dependentUpdateExport.items[0].status).toBe('updated');

    const s2MappingV2 = await repository.findBacklogExportMapping({
      storyId: s2Id,
      provider: 'fake',
      externalContainer: 'acme/prereq-repo'
    });
    expect(s2MappingV2?.exportVersion).toBe(2);
    expect(s2MappingV2?.prerequisiteExportVersions?.[s1Id]).toBe(2);
    expect(s2MappingV2?.history).toHaveLength(1);
    expect(s2MappingV2?.history?.[0].exportVersion).toBe(1);
    expect(s2MappingV2?.history?.[0].updateRationale).toBe('Aligning with upstream v2 export');

    // 5. Subsequent export of dependent story 2 without forceUpdate is now idempotent (status: 'unchanged')
    const idempotentExport = await useCase.execute({
      baselineId,
      targetContainer: 'acme/prereq-repo',
      storyIds: [s2Id],
      actor: validActor
    });
    expect(idempotentExport.summary.unchanged).toBe(1);
    expect(idempotentExport.items[0].status).toBe('unchanged');
  });
});
