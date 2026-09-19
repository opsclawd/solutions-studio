import { describe, it, expect } from 'vitest';
import {
  createStoryId,
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createStory,
  buildStoryDependencyGraph,
  validateStoryDependencies,
  detectCycles,
  computeTopologicalExecutionOrder,
  serializeStoryDependencyGraph,
  MissingStoryDependencyNodeError,
  StorySelfDependencyError,
  StoryDependencyCycleError,
  evaluateStoryReadiness,
  type Story
} from '../../src/index.js';

describe('StoryDependencyGraph', () => {
  const baselineId = createRequirementsBaselineId('BASE-001');
  const req1 = createRequirementRevisionId('REQ-001-R1');

  function makeStory(id: string, dependencies: string[] = []): Story {
    return createStory({
      id: createStoryId(id),
      baselineId,
      title: `Story ${id}`,
      narrative: {
        role: 'Developer',
        feature: `Feature ${id}`,
        benefit: `Benefit ${id}`
      },
      requirementRevisionIds: [req1],
      scenarios: [
        {
          id: `SCENARIO-${id}`,
          title: `Scenario for ${id}`,
          requirementRevisionIds: [req1],
          steps: [{ keyword: 'Given', text: 'initial state' }]
        }
      ],
      gherkinText: `Feature: Story ${id}\n  Scenario: Scenario for ${id}\n    Given initial state`,
      dependencies: dependencies.length > 0 ? dependencies.map((d) => createStoryId(d)) : undefined
    });
  }

  it('Witness Scenario 1: Diamond DAG produces deterministic prerequisite-first topological execution sequence', () => {
    // STORY-001: root (no dependencies)
    // STORY-002: depends on STORY-001
    // STORY-003: depends on STORY-001
    // STORY-004: depends on both STORY-002 and STORY-003
    const s1 = makeStory('STORY-001', []);
    const s2 = makeStory('STORY-002', ['STORY-001']);
    const s3 = makeStory('STORY-003', ['STORY-001']);
    const s4 = makeStory('STORY-004', ['STORY-003', 'STORY-002']);

    const graph = buildStoryDependencyGraph({
      baselineId,
      stories: [s4, s3, s2, s1], // Intentionally unordered
      strict: true
    });

    expect(graph.validation.isValid).toBe(true);
    expect(graph.isAcyclic).toBe(true);
    expect(graph.hasCycles).toBe(false);
    expect(graph.validation.cycles).toEqual([]);

    // Execution sequence must be prerequisite-first with deterministic tie-breaking (STORY-002 before STORY-003)
    expect(graph.executionOrder).toEqual(['STORY-001', 'STORY-002', 'STORY-003', 'STORY-004']);

    // Edges are directed from prerequisite -> dependent
    expect(graph.edges).toEqual([
      { from: 'STORY-001', to: 'STORY-002' },
      { from: 'STORY-001', to: 'STORY-003' },
      { from: 'STORY-002', to: 'STORY-004' },
      { from: 'STORY-003', to: 'STORY-004' }
    ]);

    // Nodes are sorted ascending by storyId
    expect(graph.nodes.map((n) => n.storyId)).toEqual([
      'STORY-001',
      'STORY-002',
      'STORY-003',
      'STORY-004'
    ]);

    // Node dependents and dependencies
    const node1 = graph.nodes.find((n) => n.storyId === 'STORY-001')!;
    expect(node1.dependencies).toEqual([]);
    expect(node1.dependents).toEqual(['STORY-002', 'STORY-003']);

    const node4 = graph.nodes.find((n) => n.storyId === 'STORY-004')!;
    expect(node4.dependencies).toEqual(['STORY-002', 'STORY-003']);
    expect(node4.dependents).toEqual([]);
  });

  it('performs deterministic lexicographical tie-breaking for disjoint root stories', () => {
    const sC = makeStory('STORY-C', []);
    const sA = makeStory('STORY-A', []);
    const sB = makeStory('STORY-B', []);

    const graph = buildStoryDependencyGraph({
      baselineId,
      stories: [sC, sA, sB]
    });

    expect(graph.executionOrder).toEqual(['STORY-A', 'STORY-B', 'STORY-C']);
  });

  it('Witness Scenario 2: Cycle isolation detects 2-node and multi-node cycles and returns empty executionOrder', () => {
    // 2-node cycle: STORY-001 <-> STORY-002
    const s1 = makeStory('STORY-001', ['STORY-002']);
    const s2 = makeStory('STORY-002', ['STORY-001']);

    const validation = validateStoryDependencies([s1, s2]);
    expect(validation.isValid).toBe(false);
    expect(validation.cycles.length).toBe(1);
    expect(validation.cycles[0]).toEqual(['STORY-001', 'STORY-002', 'STORY-001']);

    const graph = buildStoryDependencyGraph({
      baselineId,
      stories: [s1, s2],
      strict: false
    });

    expect(graph.isAcyclic).toBe(false);
    expect(graph.hasCycles).toBe(true);
    expect(graph.cycles).toEqual([['STORY-001', 'STORY-002', 'STORY-001']]);
    // CRITICAL INVARIANT: executionOrder MUST be empty on cyclic graph
    expect(graph.executionOrder).toEqual([]);

    // Strict mode throws StoryDependencyCycleError
    expect(() =>
      buildStoryDependencyGraph({
        baselineId,
        stories: [s1, s2],
        strict: true
      })
    ).toThrow(StoryDependencyCycleError);

    // 3-node cycle: A -> B -> C -> A
    const sA = makeStory('STORY-A', ['STORY-C']);
    const sB = makeStory('STORY-B', ['STORY-A']);
    const sC = makeStory('STORY-C', ['STORY-B']);

    const graph3 = buildStoryDependencyGraph({
      baselineId,
      stories: [sA, sB, sC]
    });

    expect(graph3.hasCycles).toBe(true);
    expect(graph3.executionOrder).toEqual([]);
    expect(graph3.cycles.length).toBe(1);
    expect(graph3.cycles[0]).toEqual(['STORY-A', 'STORY-B', 'STORY-C', 'STORY-A']);
  });

  it('Witness Scenario 3: Missing node rejection identifies non-existent dependencies and returns empty executionOrder', () => {
    const s1 = makeStory('STORY-001', ['STORY-999']);

    const validation = validateStoryDependencies([s1]);
    expect(validation.isValid).toBe(false);
    expect(validation.missingNodeIds).toEqual(['STORY-999']);

    const graph = buildStoryDependencyGraph({
      baselineId,
      stories: [s1],
      strict: false
    });

    expect(graph.validation.isValid).toBe(false);
    expect(graph.validation.missingNodeIds).toEqual(['STORY-999']);
    expect(graph.executionOrder).toEqual([]);

    expect(() =>
      buildStoryDependencyGraph({
        baselineId,
        stories: [s1],
        strict: true
      })
    ).toThrow(MissingStoryDependencyNodeError);
  });

  it('Witness Scenario 4: Self-dependency rejection rejects stories that depend on themselves and returns empty executionOrder', () => {
    const s1 = makeStory('STORY-001', ['STORY-001']);

    const validation = validateStoryDependencies([s1]);
    expect(validation.isValid).toBe(false);
    expect(validation.selfDependencies).toEqual(['STORY-001']);

    const graph = buildStoryDependencyGraph({
      baselineId,
      stories: [s1],
      strict: false
    });

    expect(graph.validation.isValid).toBe(false);
    expect(graph.validation.selfDependencies).toEqual(['STORY-001']);
    expect(graph.executionOrder).toEqual([]);

    expect(() =>
      buildStoryDependencyGraph({
        baselineId,
        stories: [s1],
        strict: true
      })
    ).toThrow(StorySelfDependencyError);
  });

  it('normalizes duplicate edges between stories deterministically', () => {
    const s1 = makeStory('STORY-001', []);
    // Duplicate references in story parameters
    const s2 = createStory({
      id: createStoryId('STORY-002'),
      baselineId,
      title: 'Story 2',
      narrative: { role: 'Dev', feature: 'F', benefit: 'B' },
      requirementRevisionIds: [req1],
      scenarios: [
        {
          id: 'SC-1',
          title: 'Sc',
          requirementRevisionIds: [req1],
          steps: [{ keyword: 'Given', text: 'ok' }]
        }
      ],
      gherkinText: 'Feature: F\n  Scenario: Sc\n    Given ok',
      dependencies: ['STORY-001', 'STORY-001']
    });

    const graph = buildStoryDependencyGraph({
      baselineId,
      stories: [s1, s2]
    });

    expect(graph.validation.isValid).toBe(true);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual({ from: 'STORY-001', to: 'STORY-002' });
  });

  it('produces byte-for-byte canonical JSON serialization across independent builds with permuted inputs and duplicate declarations', () => {
    const fixedTime = '2026-09-19T00:00:00.000Z' as any;
    const s1 = createStory({
      id: createStoryId('STORY-001'),
      baselineId,
      title: 'Story STORY-001',
      narrative: { role: 'Dev', feature: 'F', benefit: 'B' },
      requirementRevisionIds: [req1],
      scenarios: [
        {
          id: 'SC-1',
          title: 'Sc',
          requirementRevisionIds: [req1],
          steps: [{ keyword: 'Given', text: 'ok' }]
        }
      ],
      gherkinText: 'Feature: F\n  Scenario: Sc\n    Given ok',
      dependencies: [],
      createdAt: fixedTime
    });

    const s2WithDuplicates = createStory({
      id: createStoryId('STORY-002'),
      baselineId,
      title: 'Story STORY-002',
      narrative: { role: 'Dev', feature: 'F', benefit: 'B' },
      requirementRevisionIds: [req1, req1], // duplicate req
      scenarios: [
        {
          id: 'SC-2',
          title: 'Sc',
          requirementRevisionIds: [req1],
          steps: [{ keyword: 'Given', text: 'ok' }]
        }
      ],
      gherkinText: 'Feature: F\n  Scenario: Sc\n    Given ok',
      dependencies: ['STORY-001', 'STORY-001'], // duplicate dep
      createdAt: fixedTime
    });

    const s2Clean = createStory({
      id: createStoryId('STORY-002'),
      baselineId,
      title: 'Story STORY-002',
      narrative: { role: 'Dev', feature: 'F', benefit: 'B' },
      requirementRevisionIds: [req1],
      scenarios: [
        {
          id: 'SC-2',
          title: 'Sc',
          requirementRevisionIds: [req1],
          steps: [{ keyword: 'Given', text: 'ok' }]
        }
      ],
      gherkinText: 'Feature: F\n  Scenario: Sc\n    Given ok',
      dependencies: ['STORY-001'],
      createdAt: fixedTime
    });

    // Build graph 1: permuted order [s2, s1] with duplicate declarations, no createdAt injected
    const graph1 = buildStoryDependencyGraph({
      baselineId,
      stories: [s2WithDuplicates, s1]
    });

    // Build graph 2: order [s1, s2Clean] without duplicates, no createdAt injected
    const graph2 = buildStoryDependencyGraph({
      baselineId,
      stories: [s1, s2Clean]
    });

    const json1 = serializeStoryDependencyGraph(graph1);
    const json2 = serializeStoryDependencyGraph(graph2);
    expect(json1).toBe(json2);

    const parsed = JSON.parse(json1);
    expect(parsed.baselineId).toBe('BASE-001');
    expect(parsed.nodes).toHaveLength(2);
    // Node dependencies must be deduplicated
    expect(parsed.nodes.find((n: any) => n.storyId === 'STORY-002').dependencies).toEqual([
      'STORY-001'
    ]);
    expect(parsed.edges).toEqual([{ from: 'STORY-001', to: 'STORY-002' }]);
  });

  it('fails Story Definition of Ready (Rule 10) when story participates in a cycle', () => {
    const s1 = makeStory('STORY-001', ['STORY-002']);
    const s2 = makeStory('STORY-002', ['STORY-001']);

    const report1 = evaluateStoryReadiness({
      story: s1,
      requirementRevisions: [],
      baselineStoryIds: ['STORY-001' as any, 'STORY-002' as any],
      baselineStories: [s1, s2]
    });

    const rule10Failure = report1.failures.find((f) => f.ruleId === 'story-dependencies-exist');
    expect(rule10Failure).toBeDefined();
    expect(rule10Failure?.message).toContain('participates in a dependency cycle');
    expect(report1.isReady).toBe(false);
  });

  it('passes Story Definition of Ready (Rule 10) when story has valid acyclic dependencies', () => {
    const s1 = makeStory('STORY-001', []);
    const s2 = makeStory('STORY-002', ['STORY-001']);

    const report2 = evaluateStoryReadiness({
      story: s2,
      requirementRevisions: [],
      baselineStoryIds: ['STORY-001' as any, 'STORY-002' as any],
      baselineStories: [s1, s2]
    });

    const rule10Failure = report2.failures.find((f) => f.ruleId === 'story-dependencies-exist');
    expect(rule10Failure).toBeUndefined();
    expect(report2.passedRules).toContain('story-dependencies-exist');
  });

  it('detectCycles identifies cycles correctly', () => {
    const s1 = makeStory('STORY-001', ['STORY-002']);
    const s2 = makeStory('STORY-002', ['STORY-001']);
    const cycles = detectCycles([s1, s2]);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('computeTopologicalExecutionOrder orders stories topologically', () => {
    const s1 = makeStory('STORY-001', []);
    const s2 = makeStory('STORY-002', ['STORY-001']);
    const validation = validateStoryDependencies([s2, s1]);
    const order = computeTopologicalExecutionOrder([s2, s1], validation);
    expect(order).toEqual(['STORY-001', 'STORY-002']);
  });

  it('detects every participating story in overlapping cycles using SCC (Rule 10)', () => {
    // Prerequisite edges: A->B, B->C, C->A, A->D, D->C
    // B depends on A
    // C depends on B and D
    // A depends on C
    // D depends on A
    const sA = makeStory('STORY-A', ['STORY-C']);
    const sB = makeStory('STORY-B', ['STORY-A']);
    const sC = makeStory('STORY-C', ['STORY-B', 'STORY-D']);
    const sD = makeStory('STORY-D', ['STORY-A']);

    const allStories = [sA, sB, sC, sD];
    const validation = validateStoryDependencies(allStories);
    expect(validation.isValid).toBe(false);
    expect(validation.cycles.length).toBeGreaterThanOrEqual(2);

    // Rule 10 must fail for every story participating in overlapping cycles
    for (const story of allStories) {
      const report = evaluateStoryReadiness({
        story,
        requirementRevisions: [],
        baselineStoryIds: ['STORY-A' as any, 'STORY-B' as any, 'STORY-C' as any, 'STORY-D' as any],
        baselineStories: allStories
      });

      const rule10Failure = report.failures.find((f) => f.ruleId === 'story-dependencies-exist');
      expect(rule10Failure).toBeDefined();
      expect(rule10Failure?.message).toContain('participates in a dependency cycle');
      expect(report.isReady).toBe(false);
    }
  });
});
