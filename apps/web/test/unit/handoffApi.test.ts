import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getEngineeringHandoffBundle,
  getStoryDependencyGraph,
  updateStoryDependencies,
  listAvailableBaselines
} from '../../src/features/handoff/api/handoffApi';
import { createInstant } from '@solutions-studio/domain';
import type {
  EngineeringHandoffBundleDto,
  StoryDependencyGraphDto,
  StoryDto
} from '@solutions-studio/contracts';

describe('handoffApi', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const sampleGraph: StoryDependencyGraphDto = {
    baselineId: 'BASE-001',
    nodes: [
      {
        storyId: 'STORY-001',
        title: 'Story 1',
        requirementRevisionIds: ['REQ-001-R1'],
        dependencies: [],
        dependents: ['STORY-002'],
        readinessStatus: 'implementation-ready',
        isReady: true
      },
      {
        storyId: 'STORY-002',
        title: 'Story 2',
        requirementRevisionIds: ['REQ-001-R1'],
        dependencies: ['STORY-001'],
        dependents: [],
        readinessStatus: 'implementation-ready',
        isReady: true
      }
    ],
    edges: [
      {
        from: 'STORY-001',
        to: 'STORY-002'
      }
    ],
    executionOrder: ['STORY-001', 'STORY-002'],
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

  const sampleStory: StoryDto = {
    id: 'STORY-001',
    baselineId: 'BASE-001',
    title: 'Story 1',
    narrative: {
      role: 'user',
      feature: 'feature',
      benefit: 'benefit'
    },
    requirementRevisionIds: ['REQ-001-R1'],
    scenarios: [
      {
        title: 'S1',
        requirementRevisionIds: ['REQ-001-R1'],
        steps: [{ keyword: 'Given', text: 'x' }]
      }
    ],
    acceptanceCriteria: ['AC1'],
    gherkinText: 'Feature: 1\nScenario: S1\nGiven x',
    dependencies: [],
    createdAt: createInstant('2026-09-19T00:00:00.000Z')
  };

  const sampleBundle: EngineeringHandoffBundleDto = {
    baseline: {
      id: 'BASE-001',
      requirementRevisions: ['REQ-001-R1'],
      policyConstraintRevisions: [],
      createdAt: createInstant('2026-09-19T00:00:00.000Z'),
      createdBy: 'reviewer-1'
    },
    authorityBundle: {
      baseline: {
        id: 'BASE-001',
        requirementRevisions: ['REQ-001-R1'],
        policyConstraintRevisions: [],
        createdAt: createInstant('2026-09-19T00:00:00.000Z'),
        createdBy: 'reviewer-1'
      },
      requirements: [
        {
          id: 'REQ-001-R1',
          requirementId: 'REQ-001',
          revision: 1,
          statement: 'Requirement 1',
          category: 'business-rule',
          origin: 'EXPLICIT',
          reviewState: 'ACCEPTED',
          resolutionState: 'CLEAR',
          evidence: []
        }
      ],
      policyConstraints: []
    },
    engineeringDecisions: [],
    stories: [sampleStory],
    readinessReports: [
      {
        storyId: 'STORY-001',
        baselineId: 'BASE-001',
        status: 'implementation-ready',
        isReady: true,
        failures: [],
        passedRules: ['RULE_01_PROJECTION_EXISTS'],
        evaluatedAt: createInstant('2026-09-19T00:00:00.000Z')
      }
    ],
    coverage: {
      baselineId: 'BASE-001',
      totalRequirements: 1,
      coveredCount: 1,
      uncoveredCount: 0,
      multiCoveredCount: 0,
      coveredRequirements: [
        {
          requirementRevisionId: 'REQ-001-R1',
          coveringStoryIds: ['STORY-001'],
          coverageCount: 1
        }
      ],
      uncoveredRequirementRevisionIds: [],
      multiCoveredRequirements: [],
      isFullyCovered: true,
      computedAt: createInstant('2026-09-19T00:00:00.000Z')
    },
    dependencyGraph: sampleGraph,
    blockingFindings: [],
    unresolvedRequirements: [],
    summary: {
      totalStories: 1,
      readyStories: 1,
      nonReadyStories: 0,
      totalRequirements: 1,
      coveredRequirements: 1,
      openBlockingFindings: 0,
      isHandoffReady: true
    }
  };

  it('getEngineeringHandoffBundle fetches and parses bundle successfully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleBundle
    } as Response);

    const bundle = await getEngineeringHandoffBundle('BASE-001');
    expect(bundle.baseline.id).toBe('BASE-001');
    expect(bundle.summary.isHandoffReady).toBe(true);
    expect(bundle.dependencyGraph.executionOrder).toEqual(['STORY-001', 'STORY-002']);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/baselines/BASE-001/handoff'),
      expect.any(Object)
    );
  });

  it('getStoryDependencyGraph fetches and parses graph with query options', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleGraph
    } as Response);

    const graph = await getStoryDependencyGraph('BASE-001', {
      includeReadiness: true,
      strict: true
    });

    expect(graph.baselineId).toBe('BASE-001');
    expect(graph.nodes).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/baselines/BASE-001/dependency-graph?includeReadiness=true&strict=true'
      ),
      expect.any(Object)
    );
  });

  it('updateStoryDependencies sends PUT request and parses updated story', async () => {
    const updatedStory: StoryDto = {
      ...sampleStory,
      dependencies: ['STORY-002']
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => updatedStory
    } as Response);

    const result = await updateStoryDependencies('STORY-001', ['STORY-002']);
    expect(result.dependencies).toEqual(['STORY-002']);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/stories/STORY-001/dependencies'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ dependencies: ['STORY-002'] })
      })
    );
  });

  it('listAvailableBaselines returns list of baseline IDs', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 'BASE-001',
          requirementRevisions: ['REQ-001-R1'],
          policyConstraintRevisions: [],
          createdAt: '2026-09-19T00:00:00.000Z',
          createdBy: 'reviewer-1'
        },
        {
          id: 'BASE-002',
          requirementRevisions: ['REQ-001-R1'],
          policyConstraintRevisions: [],
          createdAt: '2026-09-19T00:00:00.000Z',
          createdBy: 'reviewer-1'
        }
      ]
    } as Response);

    const ids = await listAvailableBaselines();
    expect(ids).toEqual(['BASE-001', 'BASE-002']);
  });
});
