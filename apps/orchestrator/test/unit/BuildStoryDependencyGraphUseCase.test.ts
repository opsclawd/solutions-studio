import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRequirementsBaselineId,
  createStoryId,
  createRequirementRevisionId,
  createRequirementsBaseline,
  createRequirementRevision,
  now
} from '@solutions-studio/domain';
import { BuildStoryDependencyGraphUseCase } from '../../src/application/use-cases/BuildStoryDependencyGraphUseCase.js';
import type {
  IRequirementsRepository,
  StoryRecord
} from '../../src/application/ports/persistence/IRequirementsRepository.js';
import { UnknownRequirementsBaselineError } from '../../src/application/use-cases/ReconciliationErrors.js';
import type { EvaluateStoryReadinessUseCase } from '../../src/application/use-cases/EvaluateStoryReadinessUseCase.js';
import type { ProjectionMetadataDto } from '@solutions-studio/contracts';

describe('BuildStoryDependencyGraphUseCase', () => {
  const baselineId = createRequirementsBaselineId('BASE-001');
  const req1 = createRequirementRevisionId('REQ-001-R1');

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
      contentHash: 'hash-init',
      verifiedAt: now()
    }
  };

  let mockRepository: Partial<IRequirementsRepository>;
  let mockEvaluateReadiness: Partial<EvaluateStoryReadinessUseCase>;
  let useCase: BuildStoryDependencyGraphUseCase;

  const rev = createRequirementRevision({
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
    requirements: [rev],
    policyConstraints: [],
    createdBy: 'reviewer-1' as any,
    createdAt: now()
  });

  beforeEach(() => {
    mockRepository = {
      getRequirementsBaseline: async (id) => (id === baselineId ? baseline : undefined),
      listStories: async () => []
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
      ]
    };
    useCase = new BuildStoryDependencyGraphUseCase(
      mockRepository as IRequirementsRepository,
      mockEvaluateReadiness as EvaluateStoryReadinessUseCase
    );
  });

  it('throws UnknownRequirementsBaselineError if baseline does not exist', async () => {
    await expect(useCase.execute({ baselineId: 'NON-EXISTENT' })).rejects.toThrow(
      UnknownRequirementsBaselineError
    );
  });

  it('returns empty graph for baseline with no stories', async () => {
    const graph = await useCase.execute({ baselineId: baselineId as string });
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.executionOrder).toEqual([]);
    expect(graph.hasCycles).toBe(false);
    expect(graph.validation.isValid).toBe(true);
  });

  it('builds dependency graph and Kahn topological execution order for valid stories', async () => {
    const storyA: StoryRecord = {
      id: createStoryId('STORY-001'),
      baselineId,
      projectionId: 'PROJ-001',
      title: 'Story A',
      narrative: { role: 'user', feature: 'A', benefit: 'val' },
      requirementRevisionIds: [req1],
      policyConstraintRevisionIds: [],
      scenarios: [
        {
          title: 'S1',
          requirementRevisionIds: [req1],
          steps: [{ keyword: 'Given', text: 'x' }]
        }
      ],
      acceptanceCriteria: ['AC1'],
      gherkinText: 'Feature: A',
      dependencies: [],
      metadata: mockMetadata,
      createdAt: now()
    };
    const storyB: StoryRecord = {
      id: createStoryId('STORY-002'),
      baselineId,
      projectionId: 'PROJ-001',
      title: 'Story B',
      narrative: { role: 'user', feature: 'B', benefit: 'val' },
      requirementRevisionIds: [req1],
      policyConstraintRevisionIds: [],
      scenarios: [
        {
          title: 'S2',
          requirementRevisionIds: [req1],
          steps: [{ keyword: 'Given', text: 'y' }]
        }
      ],
      acceptanceCriteria: ['AC1'],
      gherkinText: 'Feature: B\n# @depends-on: STORY-001',
      dependencies: [createStoryId('STORY-001')],
      metadata: mockMetadata,
      createdAt: now()
    };

    mockRepository.listStories = async () => [storyB, storyA];

    const graph = await useCase.execute({
      baselineId: baselineId as string,
      includeReadiness: true
    });

    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual({
      from: 'STORY-001',
      to: 'STORY-002'
    });
    // Topological execution order: prerequisite STORY-001 first, then dependent STORY-002
    expect(graph.executionOrder).toEqual(['STORY-001', 'STORY-002']);
    expect(graph.hasCycles).toBe(false);
    expect(graph.validation.isValid).toBe(true);
    expect(graph.nodes.find((n) => n.storyId === 'STORY-001')?.isReady).toBe(true);
  });

  it('detects cycles and returns empty execution order', async () => {
    const storyA: StoryRecord = {
      id: createStoryId('STORY-001'),
      baselineId,
      projectionId: 'PROJ-001',
      title: 'Story A',
      narrative: { role: 'user', feature: 'A', benefit: 'val' },
      requirementRevisionIds: [req1],
      policyConstraintRevisionIds: [],
      scenarios: [
        {
          title: 'S1',
          requirementRevisionIds: [req1],
          steps: [{ keyword: 'Given', text: 'x' }]
        }
      ],
      acceptanceCriteria: [],
      gherkinText: 'Feature: A\n# @depends-on: STORY-002',
      dependencies: [createStoryId('STORY-002')],
      metadata: mockMetadata,
      createdAt: now()
    };
    const storyB: StoryRecord = {
      id: createStoryId('STORY-002'),
      baselineId,
      projectionId: 'PROJ-001',
      title: 'Story B',
      narrative: { role: 'user', feature: 'B', benefit: 'val' },
      requirementRevisionIds: [req1],
      policyConstraintRevisionIds: [],
      scenarios: [
        {
          title: 'S2',
          requirementRevisionIds: [req1],
          steps: [{ keyword: 'Given', text: 'y' }]
        }
      ],
      acceptanceCriteria: [],
      gherkinText: 'Feature: B\n# @depends-on: STORY-001',
      dependencies: [createStoryId('STORY-001')],
      metadata: mockMetadata,
      createdAt: now()
    };

    mockRepository.listStories = async () => [storyA, storyB];

    const graph = await useCase.execute({
      baselineId: baselineId as string,
      strict: false
    });

    expect(graph.hasCycles).toBe(true);
    expect(graph.cycles).toHaveLength(1);
    expect(graph.cycles[0]).toContain('STORY-001');
    expect(graph.cycles[0]).toContain('STORY-002');
    expect(graph.executionOrder).toEqual([]);
    expect(graph.validation.isValid).toBe(false);
  });
});
