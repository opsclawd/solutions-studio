import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createRequirementId,
  createStoryId,
  createReviewerId,
  createAuthenticatedActor,
  createBacklogExportMapping,
  createBacklogExportMappingId,
  now
} from '@solutions-studio/domain';
import { EvaluateExportStalenessUseCase } from '../../src/application/use-cases/EvaluateExportStalenessUseCase.js';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { DefaultAuthorizationPolicy } from '../../src/infrastructure/identity/DefaultAuthorizationPolicy.js';
import { GetAuthorityBundleUseCase } from '../../src/application/use-cases/GetAuthorityBundleUseCase.js';
import { BuildStoryDependencyGraphUseCase } from '../../src/application/use-cases/BuildStoryDependencyGraphUseCase.js';
import { computeStoryContentHash } from '../../src/application/ports/backlog/computeStoryContentHash.js';
import { ForbiddenError } from '../../src/application/ports/identity/IdentityErrors.js';
import { UnknownRequirementsBaselineError } from '../../src/application/use-cases/ReconciliationErrors.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('EvaluateExportStalenessUseCase Application Tests', () => {
  let tempDir: string;
  let repository: FilesystemRequirementsRepository;
  let authorizer: DefaultAuthorizationPolicy;
  let getAuthorityBundleUseCase: GetAuthorityBundleUseCase;
  let buildStoryDependencyGraphUseCase: BuildStoryDependencyGraphUseCase;
  let useCase: EvaluateExportStalenessUseCase;

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
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'staleness-uc-test-'));
    repository = new FilesystemRequirementsRepository({ baseDir: tempDir });
    authorizer = new DefaultAuthorizationPolicy();
    getAuthorityBundleUseCase = new GetAuthorityBundleUseCase(repository);
    buildStoryDependencyGraphUseCase = new BuildStoryDependencyGraphUseCase(repository);

    useCase = new EvaluateExportStalenessUseCase(
      repository,
      getAuthorityBundleUseCase,
      buildStoryDependencyGraphUseCase,
      authorizer
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const createTestMetadata = (bId: any, rIds: any) => ({
    baselineId: bId,
    requirementRevisionIds: rIds,
    artifactType: 'stories' as const,
    declaredProvenance: { baselineId: bId, requirementRevisionIds: rIds },
    configuredExecution: { provider: 'fake', artifactType: 'stories' },
    measuredVerification: {
      repairsNeeded: 0,
      attemptCount: 1,
      contentHash: 'hash',
      verifiedAt: now()
    }
  });

  it('rejects execution when actor lacks backlog:export capability', async () => {
    await expect(
      useCase.execute({
        baselineId: 'BASE-1',
        targetContainer: 'acme/repo',
        actor: unauthorizedActor
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws UnknownRequirementsBaselineError if baseline does not exist', async () => {
    await expect(
      useCase.execute({
        baselineId: 'NON-EXISTENT',
        targetContainer: 'acme/repo',
        actor: validActor
      })
    ).rejects.toThrow(UnknownRequirementsBaselineError);
  });

  it('evaluates UNEXPORTED, CURRENT, STALE, and IMPACTED stories correctly', async () => {
    const baselineId = createRequirementsBaselineId('BASE-100');
    const reqId1 = createRequirementId('REQ-1');
    const reqRevId1_v1 = createRequirementRevisionId('REQ-1-R1');
    const reqRevId1_v2 = createRequirementRevisionId('REQ-1-R2');

    const reqId2 = createRequirementId('REQ-2');
    const reqRevId2_v1 = createRequirementRevisionId('REQ-2-R1');

    await repository.saveRequirementRevision({
      id: reqRevId1_v1,
      requirementId: reqId1,
      revision: 1,
      statement: 'Original statement',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [],
      rationale: 'Initial'
    });

    await repository.saveRequirementRevision({
      id: reqRevId1_v2,
      requirementId: reqId1,
      revision: 2,
      supersedes: reqRevId1_v1,
      statement: 'Updated statement',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [],
      rationale: 'Updated'
    });

    await repository.saveRequirementRevision({
      id: reqRevId2_v1,
      requirementId: reqId2,
      revision: 1,
      statement: 'Req 2 statement',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [],
      rationale: 'Req 2'
    });

    // Active baseline has REQ-1-R2 and REQ-2-R1
    await repository.saveRequirementsBaseline({
      id: baselineId,
      requirementRevisions: [reqRevId1_v2, reqRevId2_v1],
      policyConstraintRevisions: [],
      createdAt: now(),
      createdBy: createReviewerId('REV-1')
    });

    // Story 1: Login (exported against REQ-1-R1 -> STALE because REQ-1 superseded by R2)
    const story1Id = createStoryId('STORY-1');
    const story1 = {
      id: story1Id,
      baselineId,
      projectionId: 'proj-1',
      title: 'Login',
      narrative: { role: 'user', feature: 'login', benefit: 'access' },
      acceptanceCriteria: ['Valid login works'],
      scenarios: [
        {
          title: 'Success',
          requirementRevisionIds: [reqRevId1_v2],
          steps: [{ keyword: 'Given' as const, text: 'user exists' }]
        }
      ],
      gherkinText: 'Feature: Login',
      requirementRevisionIds: [reqRevId1_v2],
      version: 1,
      createdAt: now(),
      metadata: createTestMetadata(baselineId, [reqRevId1_v2])
    };
    await repository.saveStory(story1);

    // Story 2: Dependent on Story 1 (exported against REQ-2-R1 -> CURRENT on its own, but IMPACTED by Story 1)
    const story2Id = createStoryId('STORY-2');
    const story2Hash = computeStoryContentHash({
      story: {
        id: story2Id,
        title: 'Profile',
        narrative: { role: 'user', feature: 'view profile', benefit: 'info' },
        acceptanceCriteria: ['Profile visible'],
        scenarios: [
          {
            title: 'View',
            requirementRevisionIds: [reqRevId2_v1],
            steps: [{ keyword: 'Given' as const, text: 'logged in' }]
          }
        ],
        gherkinText: 'Feature: Profile',
        requirementRevisionIds: [reqRevId2_v1]
      },
      prerequisites: [{ storyId: story1Id, externalWorkItemId: '101', title: 'Login' }]
    });

    const story2 = {
      id: story2Id,
      baselineId,
      projectionId: 'proj-2',
      title: 'Profile',
      narrative: { role: 'user', feature: 'view profile', benefit: 'info' },
      acceptanceCriteria: ['Profile visible'],
      scenarios: [
        {
          title: 'View',
          requirementRevisionIds: [reqRevId2_v1],
          steps: [{ keyword: 'Given' as const, text: 'logged in' }]
        }
      ],
      gherkinText: 'Feature: Profile',
      requirementRevisionIds: [reqRevId2_v1],
      dependencies: [story1Id],
      version: 1,
      createdAt: now(),
      metadata: createTestMetadata(baselineId, [reqRevId2_v1])
    };
    await repository.saveStory(story2);

    // Story 3: Unexported story
    const story3Id = createStoryId('STORY-3');
    const story3 = {
      id: story3Id,
      baselineId,
      projectionId: 'proj-3',
      title: 'Settings',
      narrative: { role: 'user', feature: 'settings', benefit: 'manage' },
      acceptanceCriteria: ['Settings work'],
      scenarios: [],
      gherkinText: 'Feature: Settings',
      requirementRevisionIds: [reqRevId2_v1],
      version: 1,
      createdAt: now(),
      metadata: createTestMetadata(baselineId, [reqRevId2_v1])
    };
    await repository.saveStory(story3);

    // Existing mapping for Story 1 (pointing to superseded REQ-1-R1)
    await repository.saveBacklogExportMapping(
      createBacklogExportMapping({
        id: createBacklogExportMappingId('map-1'),
        baselineId: createRequirementsBaselineId('BASE-OLD'),
        storyId: story1Id,
        storyVersion: 1,
        exportVersion: 1,
        provider: 'github-issues',
        externalContainer: 'acme/repo',
        externalWorkItemId: '101',
        exportContentHash: 'a'.repeat(64),
        requirementRevisionIds: [reqRevId1_v1],
        policyConstraintRevisionIds: [],
        exportedBy: 'operator-1',
        exportedAt: now()
      })
    );

    // Existing mapping for Story 2 (exact match hash & revision, but depends on Story 1)
    await repository.saveBacklogExportMapping(
      createBacklogExportMapping({
        id: createBacklogExportMappingId('map-2'),
        baselineId,
        storyId: story2Id,
        storyVersion: 1,
        exportVersion: 1,
        provider: 'github-issues',
        externalContainer: 'acme/repo',
        externalWorkItemId: '102',
        exportContentHash: story2Hash,
        requirementRevisionIds: [reqRevId2_v1],
        policyConstraintRevisionIds: [],
        exportedBy: 'operator-1',
        exportedAt: now()
      })
    );

    const report = await useCase.execute({
      baselineId,
      targetContainer: 'acme/repo',
      actor: validActor
    });

    expect(report.totalStories).toBe(3);
    expect(report.currentCount).toBe(0);
    expect(report.staleCount).toBe(1);
    expect(report.impactedCount).toBe(1);
    expect(report.unexportedCount).toBe(1);

    const s1Report = report.stories.find((s) => s.storyId === story1Id);
    expect(s1Report?.classification).toBe('STALE');
    expect(s1Report?.causes.some((c) => c.category === 'REQUIREMENT_REVISION_SUPERSEDED')).toBe(
      true
    );

    const s2Report = report.stories.find((s) => s.storyId === story2Id);
    expect(s2Report?.classification).toBe('IMPACTED');
    expect(s2Report?.causes.some((c) => c.category === 'PREREQUISITE_STALE')).toBe(true);
    expect(s2Report?.impactedByPrerequisiteStoryIds).toEqual([story1Id]);

    const s3Report = report.stories.find((s) => s.storyId === story3Id);
    expect(s3Report?.classification).toBe('UNEXPORTED');
  });

  it('supports filtering report to specific storyIds while evaluating dependencies', async () => {
    const baselineId = createRequirementsBaselineId('BASE-100');
    const reqId1 = createRequirementId('REQ-1');
    const reqRevId1_v1 = createRequirementRevisionId('REQ-1-R1');
    const reqRevId1_v2 = createRequirementRevisionId('REQ-1-R2');

    await repository.saveRequirementRevision({
      id: reqRevId1_v1,
      requirementId: reqId1,
      revision: 1,
      statement: 'Statement 1',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [],
      rationale: 'Initial'
    });

    await repository.saveRequirementRevision({
      id: reqRevId1_v2,
      requirementId: reqId1,
      revision: 2,
      supersedes: reqRevId1_v1,
      statement: 'Statement 2',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [],
      rationale: 'Updated'
    });

    await repository.saveRequirementsBaseline({
      id: baselineId,
      requirementRevisions: [reqRevId1_v2],
      policyConstraintRevisions: [],
      createdAt: now(),
      createdBy: createReviewerId('REV-1')
    });

    const story1Id = createStoryId('STORY-1');
    await repository.saveStory({
      id: story1Id,
      baselineId,
      projectionId: 'proj-1',
      title: 'Login',
      narrative: { role: 'user', feature: 'login', benefit: 'access' },
      acceptanceCriteria: ['Login works'],
      scenarios: [],
      gherkinText: 'Feature: Login',
      requirementRevisionIds: [reqRevId1_v2],
      version: 1,
      createdAt: now(),
      metadata: createTestMetadata(baselineId, [reqRevId1_v2])
    });

    const story2Id = createStoryId('STORY-2');
    const scenarios2 = [
      {
        title: 'View',
        requirementRevisionIds: [reqRevId1_v2],
        steps: [{ keyword: 'Given' as const, text: 'logged in' }]
      }
    ];
    const story2Hash = computeStoryContentHash({
      story: {
        id: story2Id,
        title: 'Profile',
        narrative: { role: 'user', feature: 'profile', benefit: 'info' },
        acceptanceCriteria: ['Profile works'],
        scenarios: scenarios2,
        gherkinText: 'Feature: Profile',
        requirementRevisionIds: [reqRevId1_v2]
      },
      prerequisites: [{ storyId: story1Id, externalWorkItemId: '101', title: 'Login' }]
    });

    await repository.saveStory({
      id: story2Id,
      baselineId,
      projectionId: 'proj-2',
      title: 'Profile',
      narrative: { role: 'user', feature: 'profile', benefit: 'info' },
      acceptanceCriteria: ['Profile works'],
      scenarios: scenarios2,
      gherkinText: 'Feature: Profile',
      requirementRevisionIds: [reqRevId1_v2],
      dependencies: [story1Id],
      version: 1,
      createdAt: now(),
      metadata: createTestMetadata(baselineId, [reqRevId1_v2])
    });

    await repository.saveBacklogExportMapping(
      createBacklogExportMapping({
        id: createBacklogExportMappingId('map-1'),
        baselineId: createRequirementsBaselineId('BASE-OLD'),
        storyId: story1Id,
        storyVersion: 1,
        exportVersion: 1,
        provider: 'github-issues',
        externalContainer: 'acme/repo',
        externalWorkItemId: '101',
        exportContentHash: 'a'.repeat(64),
        requirementRevisionIds: [reqRevId1_v1],
        policyConstraintRevisionIds: [],
        exportedBy: 'operator-1',
        exportedAt: now()
      })
    );

    await repository.saveBacklogExportMapping(
      createBacklogExportMapping({
        id: createBacklogExportMappingId('map-2'),
        baselineId,
        storyId: story2Id,
        storyVersion: 1,
        exportVersion: 1,
        provider: 'github-issues',
        externalContainer: 'acme/repo',
        externalWorkItemId: '102',
        exportContentHash: story2Hash,
        requirementRevisionIds: [reqRevId1_v2],
        policyConstraintRevisionIds: [],
        exportedBy: 'operator-1',
        exportedAt: now()
      })
    );

    // Query staleness ONLY for Story 2
    const report = await useCase.execute({
      baselineId,
      targetContainer: 'acme/repo',
      storyIds: [story2Id],
      actor: validActor
    });

    expect(report.totalStories).toBe(1);
    expect(report.stories).toHaveLength(1);
    expect(report.stories[0].storyId).toBe(story2Id);
    expect(report.stories[0].classification).toBe('IMPACTED');
    expect(report.stories[0].impactedByPrerequisiteStoryIds).toEqual([story1Id]);
  });
});
