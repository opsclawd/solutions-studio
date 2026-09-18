import { describe, it, expect } from 'vitest';
import type { RequirementsReviewStateDto, ProjectionRecordDto } from '@solutions-studio/contracts';
import { createInstant } from '@solutions-studio/domain';
import { reviewReducer, type ReviewState } from '../../src/features/review/state/useReviewState';

describe('reviewReducer', () => {
  const createMockProjection = (
    id: string,
    baselineId: string,
    artifactType: 'process-diagram' | 'state-diagram' = 'process-diagram'
  ): ProjectionRecordDto => ({
    id,
    baselineId,
    requirementRevisionIds: ['REQ-001-R1'],
    artifactType,
    content: 'graph TD\n  A --> B',
    metadata: {
      baselineId,
      requirementRevisionIds: ['REQ-001-R1'],
      artifactType,
      declaredProvenance: {
        baselineId,
        requirementRevisionIds: ['REQ-001-R1']
      },
      configuredExecution: {
        provider: 'fake',
        artifactType
      },
      measuredVerification: {
        repairsNeeded: 0,
        attemptCount: 1,
        contentHash: 'hash-123',
        verifiedAt: createInstant('2026-09-18T12:00:00.000Z')
      }
    },
    createdAt: createInstant('2026-09-18T12:00:00.000Z')
  });

  const createReviewStateFixture = (
    baselineId: string,
    projections: ProjectionRecordDto[]
  ): RequirementsReviewStateDto => ({
    baseline: {
      id: baselineId,
      requirementRevisions: ['REQ-001-R1'],
      createdAt: createInstant('2026-09-18T10:00:00.000Z'),
      createdBy: 'test-user'
    },
    requirementRevisions: [
      {
        id: 'REQ-001-R1',
        requirementId: 'REQ-001',
        revision: 1,
        statement: 'Sample requirement',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: []
      }
    ],
    findings: [],
    reconciliationHistory: [],
    evidenceExcerpts: [],
    projections,
    revisionLineage: [{ revisionId: 'REQ-001-R1', requirementId: 'REQ-001' }]
  });

  it('preserves existing projections when refreshed with the same baselineId', () => {
    const projA1 = createMockProjection('PROJ-A1', 'BASE-A');
    const projA2 = createMockProjection('PROJ-A2', 'BASE-A');

    const initialState: ReviewState = {
      status: 'ready',
      data: createReviewStateFixture('BASE-A', [projA1, projA2]),
      selectedProjectionId: 'PROJ-A2',
      findingsView: 'projections'
    };

    // Incoming fresh state from server only contains projA1 so far
    const incomingData = createReviewStateFixture('BASE-A', [projA1]);

    const nextState = reviewReducer(initialState, {
      type: 'FETCH_SUCCESS',
      payload: incomingData
    });

    expect(nextState.data?.projections.map((p) => p.id)).toEqual(['PROJ-A1', 'PROJ-A2']);
    expect(nextState.selectedProjectionId).toBe('PROJ-A2');
  });

  it('strictly isolates projections when switching to a different baselineId', () => {
    const projA = createMockProjection('PROJ-A1', 'BASE-A');
    const projB = createMockProjection('PROJ-B1', 'BASE-B');

    const initialState: ReviewState = {
      status: 'ready',
      data: createReviewStateFixture('BASE-A', [projA]),
      selectedProjectionId: 'PROJ-A1',
      findingsView: 'projections'
    };

    // Component receives fresh data for BASE-B
    const incomingData = createReviewStateFixture('BASE-B', [projB]);

    const nextState = reviewReducer(initialState, {
      type: 'FETCH_SUCCESS',
      payload: incomingData
    });

    // Projections from BASE-A must NOT linger in BASE-B
    expect(nextState.data?.projections.map((p) => p.id)).toEqual(['PROJ-B1']);
    // selectedProjectionId should reset to the first projection of BASE-B
    expect(nextState.selectedProjectionId).toBe('PROJ-B1');
  });

  it('filters out mismatched baseline projections if state.data.projections contains an unexpected baseline', () => {
    const projA = createMockProjection('PROJ-A1', 'BASE-A');
    const corruptedProj = createMockProjection('PROJ-CORRUPT', 'BASE-OTHER');

    const initialState: ReviewState = {
      status: 'ready',
      data: {
        ...createReviewStateFixture('BASE-A', [projA]),
        projections: [projA, corruptedProj]
      },
      selectedProjectionId: 'PROJ-A1',
      findingsView: 'projections'
    };

    const incomingData = createReviewStateFixture('BASE-A', [projA]);

    const nextState = reviewReducer(initialState, {
      type: 'FETCH_SUCCESS',
      payload: incomingData
    });

    expect(nextState.data?.projections.map((p) => p.id)).toEqual(['PROJ-A1']);
  });

  it('handles SELECT_BASELINE and resets selected entities', () => {
    const initialState: ReviewState = {
      status: 'ready',
      selectedBaselineId: 'BASE-001',
      selectedRequirementId: 'REQ-001',
      selectedProjectionId: 'PROJ-001',
      selectedFindingId: 'FIND-001',
      availableBaselines: ['BASE-001', 'BASE-002'],
      findingsView: 'byRequirement'
    };

    const nextState = reviewReducer(initialState, {
      type: 'SELECT_BASELINE',
      payload: 'BASE-002'
    });

    expect(nextState.selectedBaselineId).toBe('BASE-002');
    expect(nextState.selectedRequirementId).toBeUndefined();
    expect(nextState.selectedProjectionId).toBeUndefined();
    expect(nextState.selectedFindingId).toBeUndefined();
  });

  it('handles SET_CREATING_BASELINE', () => {
    const initialState: ReviewState = {
      status: 'ready',
      isCreatingBaseline: false,
      findingsView: 'byRequirement'
    };

    const nextState = reviewReducer(initialState, {
      type: 'SET_CREATING_BASELINE',
      payload: true
    });

    expect(nextState.isCreatingBaseline).toBe(true);

    const closedState = reviewReducer(nextState, {
      type: 'SET_CREATING_BASELINE',
      payload: false
    });

    expect(closedState.isCreatingBaseline).toBe(false);
  });

  it('stores availableBaselines from incoming review state', () => {
    const initialState: ReviewState = {
      status: 'ready',
      findingsView: 'byRequirement'
    };

    const incomingData: RequirementsReviewStateDto = {
      ...createReviewStateFixture('BASE-002', []),
      availableBaselines: ['BASE-001', 'BASE-002']
    };

    const nextState = reviewReducer(initialState, {
      type: 'FETCH_SUCCESS',
      payload: incomingData
    });

    expect(nextState.availableBaselines).toEqual(['BASE-001', 'BASE-002']);
    expect(nextState.selectedBaselineId).toBe('BASE-002');
  });
});
