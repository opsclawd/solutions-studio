import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createPolicyConstraintRevisionId,
  createRequirementsBaseline,
  createRequirementRevision,
  createPolicyConstraintRevision,
  createStory,
  now
} from '@solutions-studio/domain';
import { ComputeRequirementCoverageUseCase } from '../../src/application/use-cases/ComputeRequirementCoverageUseCase.js';
import type {
  IRequirementsRepository,
  StoryRecord
} from '../../src/application/ports/persistence/IRequirementsRepository.js';
import { UnknownRequirementsBaselineError } from '../../src/application/use-cases/ReconciliationErrors.js';

describe('ComputeRequirementCoverageUseCase', () => {
  const baselineId = createRequirementsBaselineId('BASE-001');
  const req1 = createRequirementRevisionId('REQ-001-R1');
  const req2 = createRequirementRevisionId('REQ-002-R1');
  const req3 = createRequirementRevisionId('REQ-003-R1');
  const pol1 = createPolicyConstraintRevisionId('POL-001-R1');

  let mockRepository: Partial<IRequirementsRepository>;
  let useCase: ComputeRequirementCoverageUseCase;

  const validReqRev1 = createRequirementRevision({
    id: req1,
    requirementId: 'REQ-001' as any,
    revision: 1,
    statement: 'Req 1',
    category: 'business-rule',
    origin: 'EXPLICIT',
    reviewState: 'ACCEPTED',
    resolutionState: 'CLEAR',
    evidence: [{ sourceRevisionId: 'SRC-001-R1' as any, locator: 'loc-1' as any }]
  });

  const validReqRev2 = createRequirementRevision({
    id: req2,
    requirementId: 'REQ-002' as any,
    revision: 1,
    statement: 'Req 2',
    category: 'business-rule',
    origin: 'EXPLICIT',
    reviewState: 'ACCEPTED',
    resolutionState: 'CLEAR',
    evidence: [{ sourceRevisionId: 'SRC-001-R1' as any, locator: 'loc-1' as any }]
  });

  const validReqRev3 = createRequirementRevision({
    id: req3,
    requirementId: 'REQ-003' as any,
    revision: 1,
    statement: 'Req 3',
    category: 'business-rule',
    origin: 'EXPLICIT',
    reviewState: 'ACCEPTED',
    resolutionState: 'CLEAR',
    evidence: [{ sourceRevisionId: 'SRC-001-R1' as any, locator: 'loc-1' as any }]
  });

  const validPolRev1 = createPolicyConstraintRevision({
    id: pol1,
    policyConstraintId: 'POL-001' as any,
    revision: 1,
    statement: 'Policy 1',
    authorityReference: 'AUTH-1',
    state: 'ACCEPTED',
    createdBy: 'sec'
  });

  const validBaseline = createRequirementsBaseline({
    id: baselineId,
    requirements: [validReqRev1, validReqRev2, validReqRev3],
    policyConstraints: [validPolRev1],
    createdBy: 'lead-pm' as any
  });

  const createStoryRecord = (id: string, coveredReqs: string[]): StoryRecord => {
    const story = createStory({
      id,
      baselineId,
      title: `Story ${id}`,
      narrative: { role: 'User', feature: 'F', benefit: 'B' },
      requirementRevisionIds: coveredReqs,
      scenarios: coveredReqs.map((r) => ({
        title: `Scenario for ${r}`,
        requirementRevisionIds: [r],
        steps: [{ keyword: 'Given', text: 'step' }]
      })),
      gherkinText: 'Feature: F'
    });

    return {
      id: story.id,
      baselineId: story.baselineId,
      projectionId: `PROJ-${story.id}`,
      title: story.title,
      narrative: story.narrative,
      requirementRevisionIds: story.requirementRevisionIds,
      policyConstraintRevisionIds: story.policyConstraintRevisionIds,
      scenarios: story.scenarios,
      acceptanceCriteria: story.acceptanceCriteria,
      gherkinText: story.gherkinText,
      metadata: {
        baselineId: story.baselineId,
        requirementRevisionIds: [...story.requirementRevisionIds],
        artifactType: 'stories',
        declaredProvenance: {
          baselineId: story.baselineId,
          requirementRevisionIds: [...story.requirementRevisionIds]
        },
        configuredExecution: { provider: 'test', artifactType: 'stories' },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'hash',
          verifiedAt: now()
        }
      },
      createdAt: story.createdAt
    };
  };

  beforeEach(() => {
    mockRepository = {
      getRequirementsBaseline: async (id) => (id === baselineId ? validBaseline : undefined),
      listStories: async () => []
    };

    useCase = new ComputeRequirementCoverageUseCase(mockRepository as IRequirementsRepository);
  });

  it('throws UnknownRequirementsBaselineError when baseline does not exist', async () => {
    await expect(useCase.execute({ baselineId: 'NON-EXISTENT' })).rejects.toThrow(
      UnknownRequirementsBaselineError
    );
  });

  it('computes coverage when some requirements are uncovered (AC-6)', async () => {
    const story1 = createStoryRecord('STORY-1', ['REQ-001-R1']);
    mockRepository.listStories = async () => [story1];

    const coverage = await useCase.execute({ baselineId: 'BASE-001' });
    expect(coverage.totalRequirements).toBe(3);
    expect(coverage.coveredCount).toBe(1);
    expect(coverage.uncoveredCount).toBe(2);
    expect(coverage.uncoveredRequirementRevisionIds).toEqual(['REQ-002-R1', 'REQ-003-R1']);
    expect(coverage.isFullyCovered).toBe(false);
  });

  it('computes coverage with multiple stories covering common requirements (AC-7)', async () => {
    const story1 = createStoryRecord('STORY-1', ['REQ-001-R1']);
    const story2 = createStoryRecord('STORY-2', ['REQ-001-R1', 'REQ-002-R1', 'REQ-003-R1']);
    mockRepository.listStories = async () => [story1, story2];

    const coverage = await useCase.execute({ baselineId: 'BASE-001' });
    expect(coverage.totalRequirements).toBe(3);
    expect(coverage.coveredCount).toBe(3);
    expect(coverage.uncoveredCount).toBe(0);
    expect(coverage.multiCoveredCount).toBe(1);
    expect(coverage.multiCoveredRequirements[0].requirementRevisionId).toBe('REQ-001-R1');
    expect(coverage.multiCoveredRequirements[0].coverageCount).toBe(2);
    expect(coverage.multiCoveredRequirements[0].coveringStoryIds).toEqual(['STORY-1', 'STORY-2']);
    expect(coverage.isFullyCovered).toBe(true);
  });
});
