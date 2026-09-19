import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createStoryId,
  createRequirementsBaseline,
  createRequirementRevision,
  createCandidateFinding,
  now
} from '@solutions-studio/domain';
import { GetEngineeringHandoffBundleUseCase } from '../../src/application/use-cases/GetEngineeringHandoffBundleUseCase.js';
import type {
  IRequirementsRepository,
  ProjectionRecord,
  StoryRecord
} from '../../src/application/ports/persistence/IRequirementsRepository.js';
import type { GetAuthorityBundleUseCase } from '../../src/application/use-cases/GetAuthorityBundleUseCase.js';
import type { EvaluateStoryReadinessUseCase } from '../../src/application/use-cases/EvaluateStoryReadinessUseCase.js';
import type { ComputeRequirementCoverageUseCase } from '../../src/application/use-cases/ComputeRequirementCoverageUseCase.js';
import type { BuildStoryDependencyGraphUseCase } from '../../src/application/use-cases/BuildStoryDependencyGraphUseCase.js';
import { UnknownRequirementsBaselineError } from '../../src/application/use-cases/ReconciliationErrors.js';
import type { ProjectionMetadataDto } from '@solutions-studio/contracts';

describe('GetEngineeringHandoffBundleUseCase', () => {
  const baselineId = createRequirementsBaselineId('BASE-001');
  const req1 = createRequirementRevisionId('REQ-001-R1');

  const storyGherkin = 'Feature: 1\n  Scenario: S1\n    Given step';
  const storyHash = createHash('sha256').update(storyGherkin).digest('hex');

  const mockMetadata: ProjectionMetadataDto = {
    baselineId: baselineId as string,
    requirementRevisionIds: [req1 as string],
    artifactType: 'stories',
    declaredProvenance: {
      baselineId: baselineId as string,
      requirementRevisionIds: [req1 as string]
    },
    configuredExecution: { provider: 'fake', artifactType: 'stories' },
    measuredVerification: {
      attemptCount: 1,
      repairsNeeded: 0,
      contentHash: storyHash,
      verifiedAt: now()
    }
  };

  let mockRepository: Partial<IRequirementsRepository>;
  let mockGetAuthority: Partial<GetAuthorityBundleUseCase>;
  let mockEvaluateReadiness: Partial<EvaluateStoryReadinessUseCase>;
  let mockCoverage: Partial<ComputeRequirementCoverageUseCase>;
  let mockBuildGraph: Partial<BuildStoryDependencyGraphUseCase>;
  let useCase: GetEngineeringHandoffBundleUseCase;
  let lockAcquired = false;

  const reqRev = createRequirementRevision({
    id: req1,
    requirementId: 'REQ-001' as any,
    revision: 1,
    statement: 'Login must work',
    category: 'business-rule',
    origin: 'ASSUMED',
    reviewState: 'ACCEPTED',
    resolutionState: 'CLEAR',
    evidence: []
  });

  const baseline = createRequirementsBaseline({
    id: baselineId,
    requirements: [reqRev],
    policyConstraints: [],
    createdBy: 'reviewer-1' as any,
    createdAt: now()
  });

  const storiesProjection: ProjectionRecord = {
    id: 'PROJ-001',
    baselineId,
    requirementRevisionIds: [req1],
    artifactType: 'stories',
    content: storyGherkin,
    metadata: mockMetadata,
    createdAt: now()
  };

  const storyRecord: StoryRecord = {
    id: createStoryId('STORY-001'),
    baselineId,
    projectionId: 'PROJ-001',
    title: 'Story 1',
    narrative: { role: 'user', feature: 'feature 1', benefit: 'benefit 1' },
    requirementRevisionIds: [req1],
    policyConstraintRevisionIds: [],
    scenarios: [
      {
        title: 'S1',
        requirementRevisionIds: [req1],
        steps: [{ keyword: 'Given', text: 'step' }]
      }
    ],
    acceptanceCriteria: ['AC1'],
    gherkinText: storyGherkin,
    dependencies: [],
    metadata: mockMetadata,
    createdAt: now()
  };

  beforeEach(() => {
    lockAcquired = false;
    mockRepository = {
      withBaselineLock: async (_bId, fn) => {
        lockAcquired = true;
        return fn();
      },
      getRequirementsBaseline: async (id) => (id === baselineId ? baseline : undefined),
      getProjectionRecord: async (id) => (id === 'PROJ-001' ? storiesProjection : undefined),
      listStories: async () => [storyRecord],
      listCandidateFindings: async () => [],
      listEngineeringDecisions: async () => [],
      listProjectionRecords: async () => [storiesProjection]
    };

    mockGetAuthority = {
      execute: async () => ({
        baseline,
        requirements: [reqRev],
        policyConstraints: [],
        acceptedDecisions: []
      })
    };

    mockEvaluateReadiness = {
      executeForBaseline: async () => [
        {
          storyId: createStoryId('STORY-001'),
          baselineId,
          isReady: true,
          status: 'implementation-ready' as any,
          blockingRuleIds: [],
          ruleEvaluations: [],
          failures: [],
          passedRules: [],
          evaluatedAt: now()
        }
      ],
      execute: async () => ({
        storyId: createStoryId('STORY-001'),
        baselineId,
        isReady: true,
        status: 'implementation-ready' as any,
        blockingRuleIds: [],
        ruleEvaluations: [],
        failures: [],
        passedRules: [],
        evaluatedAt: now()
      })
    };

    mockCoverage = {
      execute: async () => ({
        baselineId,
        totalRequirements: 1,
        coveredCount: 1,
        uncoveredCount: 0,
        multiCoveredCount: 0,
        coveredRequirements: [],
        uncoveredRequirementRevisionIds: [],
        multiCoveredRequirements: [],
        isFullyCovered: true,
        computedAt: now()
      })
    };

    mockBuildGraph = {
      execute: async () => ({
        baselineId,
        nodes: [
          {
            storyId: createStoryId('STORY-001'),
            title: 'Story 1',
            requirementRevisionIds: [req1],
            dependencies: [],
            dependents: [],
            isReady: true,
            readinessStatus: 'implementation-ready' as any
          }
        ],
        edges: [],
        executionOrder: [createStoryId('STORY-001')],
        isAcyclic: true,
        hasCycles: false,
        cycles: [],
        validation: {
          isValid: true,
          missingNodeIds: [],
          selfDependencies: [],
          cycles: [],
          errors: []
        },
        createdAt: now()
      })
    };

    useCase = new GetEngineeringHandoffBundleUseCase(
      mockRepository as IRequirementsRepository,
      mockGetAuthority as GetAuthorityBundleUseCase,
      mockEvaluateReadiness as EvaluateStoryReadinessUseCase,
      mockCoverage as ComputeRequirementCoverageUseCase,
      mockBuildGraph as BuildStoryDependencyGraphUseCase
    );
  });

  it('throws UnknownRequirementsBaselineError if baseline does not exist', async () => {
    await expect(useCase.execute({ baselineId: 'NON-EXISTENT' })).rejects.toThrow(
      UnknownRequirementsBaselineError
    );
  });

  it('returns handoff bundle with isHandoffReady = true when all conditions pass', async () => {
    const bundle = await useCase.execute({ baselineId: baselineId as string });
    expect(lockAcquired).toBe(true);
    expect(bundle.summary.isHandoffReady).toBe(true);
    expect(bundle.summary.openBlockingFindings).toBe(0);
    expect(bundle.summary.readyStories).toBe(1);
    expect(bundle.summary.totalStories).toBe(1);
    expect(bundle.dependencyGraph.hasCycles).toBe(false);
    expect(bundle.sqlProjection).toBeUndefined();
    expect(bundle.openApiProjection).toBeUndefined();
    expect(bundle.stories).toHaveLength(1);
    expect(bundle.dependencyGraph.executionOrder).toEqual(['STORY-001']);
  });

  it('evaluates isHandoffReady = false if there are blocking findings', async () => {
    mockRepository.listCandidateFindings = async () => [
      createCandidateFinding({
        id: 'FIND-001' as any,
        type: 'contradiction',
        affectedRequirementRevisions: [req1],
        discoveredBy: 'human',
        disposition: 'OPEN',
        rationale: 'Conflict',
        baselineId
      })
    ];

    const bundle = await useCase.execute({ baselineId: baselineId as string });
    expect(bundle.summary.isHandoffReady).toBe(false);
    expect(bundle.summary.openBlockingFindings).toBe(1);
  });

  it('evaluates isHandoffReady = false if there are unready stories or cycles', async () => {
    mockBuildGraph.execute = async () => ({
      baselineId,
      nodes: [
        {
          storyId: createStoryId('STORY-001'),
          title: 'Story 1',
          requirementRevisionIds: [req1],
          dependencies: [createStoryId('STORY-001')],
          dependents: [createStoryId('STORY-001')],
          isReady: false,
          readinessStatus: 'not-ready' as any
        }
      ],
      edges: [],
      executionOrder: [],
      isAcyclic: false,
      hasCycles: true,
      cycles: [[createStoryId('STORY-001')]],
      validation: {
        isValid: false,
        missingNodeIds: [],
        selfDependencies: [createStoryId('STORY-001')],
        cycles: [[createStoryId('STORY-001')]],
        errors: ['Self-dependency detected']
      },
      createdAt: now()
    });

    const bundle = await useCase.execute({ baselineId: baselineId as string });
    expect(bundle.summary.isHandoffReady).toBe(false);
    expect(bundle.dependencyGraph.hasCycles).toBe(true);
  });

  it('evaluates isHandoffReady = false if SQL projection hash is invalid', async () => {
    const sqlProj: ProjectionRecord = {
      id: 'PROJ-SQL-001',
      baselineId,
      requirementRevisionIds: [req1],
      artifactType: 'sql-schema',
      content: 'CREATE TABLE test (id INT);',
      metadata: {
        baselineId: baselineId as string,
        requirementRevisionIds: [req1 as string],
        artifactType: 'sql-schema',
        declaredProvenance: {
          baselineId: baselineId as string,
          requirementRevisionIds: [req1 as string]
        },
        configuredExecution: { provider: 'fake', artifactType: 'sql-schema' },
        measuredVerification: {
          attemptCount: 1,
          repairsNeeded: 0,
          contentHash: 'fabricated-bad-hash',
          verifiedAt: now()
        }
      },
      createdAt: now()
    };
    mockRepository.listProjectionRecords = async () => [storiesProjection, sqlProj];

    const bundle = await useCase.execute({ baselineId: baselineId as string });
    expect(bundle.summary.isHandoffReady).toBe(false);
  });

  it('evaluates isHandoffReady = false if OpenAPI projection hash is invalid', async () => {
    const oasProj: ProjectionRecord = {
      id: 'PROJ-OAS-001',
      baselineId,
      requirementRevisionIds: [req1],
      artifactType: 'openapi',
      content: 'openapi: 3.0.0',
      metadata: {
        baselineId: baselineId as string,
        requirementRevisionIds: [req1 as string],
        artifactType: 'openapi',
        declaredProvenance: {
          baselineId: baselineId as string,
          requirementRevisionIds: [req1 as string]
        },
        configuredExecution: { provider: 'fake', artifactType: 'openapi' },
        measuredVerification: {
          attemptCount: 1,
          repairsNeeded: 0,
          contentHash: 'fabricated-bad-hash',
          verifiedAt: now()
        }
      },
      createdAt: now()
    };
    mockRepository.listProjectionRecords = async () => [storiesProjection, oasProj];

    const bundle = await useCase.execute({ baselineId: baselineId as string });
    expect(bundle.summary.isHandoffReady).toBe(false);
  });

  it('evaluates isHandoffReady = false if story content hash does not match Gherkin text', async () => {
    const badStory: StoryRecord = {
      ...storyRecord,
      metadata: {
        ...storyRecord.metadata,
        measuredVerification: {
          ...storyRecord.metadata.measuredVerification,
          contentHash: 'mismatched-story-hash'
        }
      }
    };
    mockRepository.listStories = async () => [badStory];

    const bundle = await useCase.execute({ baselineId: baselineId as string });
    expect(bundle.summary.isHandoffReady).toBe(false);
  });

  it('evaluates isHandoffReady = false if story references a dangling projection ID', async () => {
    const danglingStory: StoryRecord = {
      ...storyRecord,
      projectionId: 'PROJ-DOES-NOT-EXIST'
    };
    mockRepository.listStories = async () => [danglingStory];

    const bundle = await useCase.execute({ baselineId: baselineId as string });
    expect(bundle.summary.isHandoffReady).toBe(false);
  });
});
