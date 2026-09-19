import { describe, it, expect } from 'vitest';
import { computeExecutionStages } from '../../src/features/handoff/components/graphStages';
import type { StoryDependencyGraphDto } from '@solutions-studio/contracts';
import { createInstant } from '@solutions-studio/domain';

describe('computeExecutionStages', () => {
  const baseGraph: StoryDependencyGraphDto = {
    baselineId: 'BASE-001',
    nodes: [],
    edges: [],
    executionOrder: [],
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
    createdAt: createInstant('2026-09-19T00:00:00.000Z')
  };

  it('returns empty array when graph has no nodes', () => {
    const stages = computeExecutionStages(baseGraph);
    expect(stages).toEqual([]);
  });

  it('returns empty array when graph has cycles', () => {
    const cyclicGraph: StoryDependencyGraphDto = {
      ...baseGraph,
      hasCycles: true,
      isAcyclic: false,
      cycles: [['STORY-001', 'STORY-002', 'STORY-001']],
      validation: {
        ...baseGraph.validation,
        isValid: false,
        cycles: [['STORY-001', 'STORY-002', 'STORY-001']],
        errors: ['Cycle detected']
      }
    };
    const stages = computeExecutionStages(cyclicGraph);
    expect(stages).toEqual([]);
  });

  it('places independent root stories in Stage 1', () => {
    const graph: StoryDependencyGraphDto = {
      ...baseGraph,
      nodes: [
        {
          storyId: 'STORY-001',
          title: 'Story 1',
          requirementRevisionIds: ['REQ-001-R1'],
          dependencies: [],
          dependents: []
        },
        {
          storyId: 'STORY-002',
          title: 'Story 2',
          requirementRevisionIds: ['REQ-001-R1'],
          dependencies: [],
          dependents: []
        }
      ],
      executionOrder: ['STORY-001', 'STORY-002']
    };

    const stages = computeExecutionStages(graph);
    expect(stages).toHaveLength(1);
    expect(stages[0].stage).toBe(1);
    expect(stages[0].storyIds).toEqual(['STORY-001', 'STORY-002']);
  });

  it('computes multi-stage lanes based on prerequisite dependencies', () => {
    // STORY-001 (root) -> Stage 1
    // STORY-002 (depends on 001) -> Stage 2
    // STORY-003 (depends on 001) -> Stage 2
    // STORY-004 (depends on 002 and 003) -> Stage 3
    const graph: StoryDependencyGraphDto = {
      ...baseGraph,
      nodes: [
        {
          storyId: 'STORY-001',
          title: 'Story 1',
          requirementRevisionIds: ['REQ-001-R1'],
          dependencies: [],
          dependents: ['STORY-002', 'STORY-003']
        },
        {
          storyId: 'STORY-002',
          title: 'Story 2',
          requirementRevisionIds: ['REQ-001-R1'],
          dependencies: ['STORY-001'],
          dependents: ['STORY-004']
        },
        {
          storyId: 'STORY-003',
          title: 'Story 3',
          requirementRevisionIds: ['REQ-001-R1'],
          dependencies: ['STORY-001'],
          dependents: ['STORY-004']
        },
        {
          storyId: 'STORY-004',
          title: 'Story 4',
          requirementRevisionIds: ['REQ-001-R1'],
          dependencies: ['STORY-002', 'STORY-003'],
          dependents: []
        }
      ],
      edges: [
        { from: 'STORY-001', to: 'STORY-002' },
        { from: 'STORY-001', to: 'STORY-003' },
        { from: 'STORY-002', to: 'STORY-004' },
        { from: 'STORY-003', to: 'STORY-004' }
      ],
      executionOrder: ['STORY-001', 'STORY-002', 'STORY-003', 'STORY-004']
    };

    const stages = computeExecutionStages(graph);
    expect(stages).toHaveLength(3);
    expect(stages[0]).toEqual({
      stage: 1,
      storyIds: ['STORY-001']
    });
    expect(stages[1]).toEqual({
      stage: 2,
      storyIds: ['STORY-002', 'STORY-003']
    });
    expect(stages[2]).toEqual({
      stage: 3,
      storyIds: ['STORY-004']
    });
  });
});
