import type { StoryId, RequirementsBaselineId, RequirementRevisionId, Instant } from './ids.js';
import { createRequirementsBaselineId, createStoryId } from './ids.js';
import type { Story } from './Story.js';
import {
  StoryDependencyGraphError,
  MissingStoryDependencyNodeError,
  StorySelfDependencyError,
  StoryDependencyCycleError
} from './errors.js';

export type StoryDependencyGraphReadinessStatus = 'implementation-ready' | 'not-ready';

export interface StoryReadinessReportLike {
  readonly storyId: StoryId;
  readonly status: StoryDependencyGraphReadinessStatus;
  readonly isReady: boolean;
}

export interface StoryDependencyGraphNode {
  readonly storyId: StoryId;
  readonly title: string;
  readonly requirementRevisionIds: readonly RequirementRevisionId[];
  readonly dependencies: readonly StoryId[];
  readonly dependents: readonly StoryId[];
  readonly readinessStatus?: StoryDependencyGraphReadinessStatus;
  readonly isReady?: boolean;
}

export interface StoryDependencyGraphEdge {
  /** The prerequisite / upstream story that must execute first. */
  readonly from: StoryId;
  /** The dependent / downstream story that depends on the prerequisite. */
  readonly to: StoryId;
}

export interface StoryDependencyGraphValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly missingNodeIds: readonly StoryId[];
  readonly selfDependencies: readonly StoryId[];
  readonly cycles: readonly (readonly StoryId[])[];
}

export interface StoryDependencyGraph {
  readonly baselineId: RequirementsBaselineId;
  readonly nodes: readonly StoryDependencyGraphNode[];
  readonly edges: readonly StoryDependencyGraphEdge[];
  readonly executionOrder: readonly StoryId[];
  readonly isAcyclic: boolean;
  readonly hasCycles: boolean;
  readonly cycles: readonly (readonly StoryId[])[];
  readonly validation: StoryDependencyGraphValidationResult;
  readonly createdAt: Instant;
}

export interface BuildStoryDependencyGraphParams {
  readonly baselineId: RequirementsBaselineId | string;
  readonly stories: readonly Story[];
  readonly readinessReports?: readonly StoryReadinessReportLike[];
  readonly strict?: boolean;
  readonly createdAt?: Instant;
}

/**
 * Normalizes a detected cycle path so that its representation is deterministic.
 * For example, ['B', 'A', 'B'] normalizes to ['A', 'B', 'A'].
 */
export function normalizeCycle(rawCycle: readonly StoryId[]): readonly StoryId[] {
  if (rawCycle.length <= 1) {
    return rawCycle;
  }
  const nodes = rawCycle.slice(0, -1);
  if (nodes.length <= 1) {
    return rawCycle;
  }

  // Find index of lexicographically smallest node
  let minIdx = 0;
  for (let i = 1; i < nodes.length; i++) {
    if (nodes[i].localeCompare(nodes[minIdx]) < 0) {
      minIdx = i;
    }
  }

  const rotated = [...nodes.slice(minIdx), ...nodes.slice(0, minIdx)];
  return Object.freeze([...rotated, rotated[0]]);
}

/**
 * Computes all Strongly Connected Components (SCCs) in the story dependency graph using Tarjan's algorithm.
 * Edges represent prerequisite -> dependent (from -> to).
 */
export function findStronglyConnectedComponents(
  stories: readonly Story[]
): readonly (readonly StoryId[])[] {
  const storyMap = new Map<string, Story>();
  for (const s of stories) {
    storyMap.set(s.id, s);
  }

  const adjacency = new Map<string, string[]>();
  for (const s of stories) {
    adjacency.set(s.id, []);
  }

  for (const s of stories) {
    for (const depId of s.dependencies ?? []) {
      if (storyMap.has(depId)) {
        adjacency.get(depId)!.push(s.id);
      }
    }
  }

  // Sort neighbors for deterministic traversal
  for (const [, neighbors] of adjacency.entries()) {
    neighbors.sort((a, b) => a.localeCompare(b));
  }

  const allStoryIds = Array.from(storyMap.keys()).sort((a, b) => a.localeCompare(b));

  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Map<string, boolean>();
  const stack: string[] = [];
  const sccs: StoryId[][] = [];

  function strongConnect(u: string) {
    indices.set(u, index);
    lowlink.set(u, index);
    index++;
    stack.push(u);
    onStack.set(u, true);

    const neighbors = adjacency.get(u) ?? [];
    for (const v of neighbors) {
      if (!indices.has(v)) {
        strongConnect(v);
        lowlink.set(u, Math.min(lowlink.get(u)!, lowlink.get(v)!));
      } else if (onStack.get(v)) {
        lowlink.set(u, Math.min(lowlink.get(u)!, indices.get(v)!));
      }
    }

    if (lowlink.get(u) === indices.get(u)) {
      const scc: StoryId[] = [];
      while (true) {
        const w = stack.pop()!;
        onStack.set(w, false);
        scc.push(createStoryId(w));
        if (w === u) break;
      }
      scc.sort((a, b) => a.localeCompare(b));
      sccs.push(scc);
    }
  }

  for (const id of allStoryIds) {
    if (!indices.has(id)) {
      strongConnect(id);
    }
  }

  sccs.sort((a, b) => a[0].localeCompare(b[0]));
  return Object.freeze(sccs.map((c) => Object.freeze(c)));
}

/**
 * Identifies every story ID that participates in a dependency cycle using SCC analysis.
 * An SCC represents a cycle if it contains more than one vertex, or if a single vertex
 * has an edge to itself (self-loop).
 */
export function findCyclicStoryIds(stories: readonly Story[]): ReadonlySet<StoryId> {
  const storyMap = new Map<string, Story>();
  for (const s of stories) {
    storyMap.set(s.id, s);
  }

  const sccs = findStronglyConnectedComponents(stories);
  const cyclicSet = new Set<StoryId>();

  for (const scc of sccs) {
    if (scc.length > 1) {
      for (const id of scc) {
        cyclicSet.add(id);
      }
    } else if (scc.length === 1) {
      const id = scc[0];
      const story = storyMap.get(id);
      if (story?.dependencies?.includes(id)) {
        cyclicSet.add(id);
      }
    }
  }

  return cyclicSet;
}

/**
 * Finds a representative directed cycle containing the given story ID.
 * Returns undefined if the story does not participate in any cycle.
 */
export function findCycleForStory(
  storyId: StoryId,
  stories: readonly Story[]
): readonly StoryId[] | undefined {
  const storyMap = new Map<string, Story>();
  for (const s of stories) {
    storyMap.set(s.id, s);
  }

  const cyclicIds = findCyclicStoryIds(stories);
  if (!cyclicIds.has(storyId)) {
    return undefined;
  }

  const story = storyMap.get(storyId);
  if (story?.dependencies?.includes(storyId)) {
    return Object.freeze([storyId, storyId]);
  }

  // BFS from storyId to find shortest path back to storyId among cyclic nodes
  // Edge: dep -> story (prerequisite to dependent)
  const adjacency = new Map<string, string[]>();
  for (const s of stories) {
    if (!adjacency.has(s.id)) adjacency.set(s.id, []);
  }
  for (const s of stories) {
    for (const depId of s.dependencies ?? []) {
      if (storyMap.has(depId)) {
        adjacency.get(depId)!.push(s.id);
      }
    }
  }
  for (const [, neighbors] of adjacency.entries()) {
    neighbors.sort((a, b) => a.localeCompare(b));
  }

  const queue: { current: string; path: string[] }[] = [];
  const startNeighbors = adjacency.get(storyId) ?? [];
  for (const n of startNeighbors) {
    if (n === storyId) {
      return Object.freeze([storyId, storyId]);
    }
    if (cyclicIds.has(createStoryId(n))) {
      queue.push({ current: n, path: [storyId, n] });
    }
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const { current, path } = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = adjacency.get(current) ?? [];
    for (const next of neighbors) {
      if (next === storyId) {
        return normalizeCycle([...path, storyId].map(createStoryId));
      }
      if (!visited.has(next) && cyclicIds.has(createStoryId(next))) {
        queue.push({ current: next, path: [...path, next] });
      }
    }
  }

  return undefined;
}

/**
 * Detects directed cycles in the story dependency graph.
 * Uses SCC analysis to guarantee every cyclic component and vertex is represented.
 */
export function detectCycles(stories: readonly Story[]): readonly (readonly StoryId[])[] {
  const cyclicIds = findCyclicStoryIds(stories);
  if (cyclicIds.size === 0) {
    return Object.freeze([]);
  }

  const seenCycleKeys = new Set<string>();
  const detectedCycles: (readonly StoryId[])[] = [];

  const sortedCyclicIds = Array.from(cyclicIds).sort((a, b) => a.localeCompare(b));
  for (const id of sortedCyclicIds) {
    const cycle = findCycleForStory(id, stories);
    if (cycle) {
      const key = cycle.join('->');
      if (!seenCycleKeys.has(key)) {
        seenCycleKeys.add(key);
        detectedCycles.push(cycle);
      }
    }
  }

  detectedCycles.sort((a, b) => a.join('->').localeCompare(b.join('->')));
  return Object.freeze(detectedCycles);
}

/**
 * Validates dependencies across the baseline stories.
 * Checks for missing node references, self-dependencies, and cycles.
 */
export function validateStoryDependencies(
  stories: readonly Story[]
): StoryDependencyGraphValidationResult {
  const storyMap = new Map<string, Story>();
  for (const s of stories) {
    storyMap.set(s.id, s);
  }

  const missingNodeIdsSet = new Set<StoryId>();
  const selfDependenciesSet = new Set<StoryId>();
  const errors: string[] = [];

  for (const s of stories) {
    for (const depId of s.dependencies ?? []) {
      if (depId === s.id) {
        selfDependenciesSet.add(s.id);
        errors.push(`Story '${s.id}' cannot declare a dependency on itself`);
      } else if (!storyMap.has(depId)) {
        missingNodeIdsSet.add(depId as StoryId);
        errors.push(`Story '${s.id}' references unknown dependency story '${depId}'`);
      }
    }
  }

  const cycles = detectCycles(stories);
  for (const c of cycles) {
    errors.push(`Dependency cycle detected: [${c.join(' -> ')}]`);
  }

  const missingNodeIds = Object.freeze(
    Array.from(missingNodeIdsSet).sort((a, b) => a.localeCompare(b))
  );
  const selfDependencies = Object.freeze(
    Array.from(selfDependenciesSet).sort((a, b) => a.localeCompare(b))
  );

  const isValid =
    missingNodeIds.length === 0 && selfDependencies.length === 0 && cycles.length === 0;

  return Object.freeze({
    isValid,
    errors: Object.freeze(errors.sort()),
    missingNodeIds,
    selfDependencies,
    cycles
  });
}

/**
 * Computes topological execution order using Kahn's algorithm with deterministic lexicographical tie-breaking.
 * Prerequisite stories (with 0 unsatisfied dependencies) are scheduled first.
 *
 * Strict Invariant: If validation fails or any cycle exists, executionOrder MUST be returned as an empty array [].
 */
export function computeTopologicalExecutionOrder(
  stories: readonly Story[],
  validation: StoryDependencyGraphValidationResult
): readonly StoryId[] {
  if (!validation.isValid || validation.cycles.length > 0 || stories.length === 0) {
    return Object.freeze([]);
  }

  const storyMap = new Map<string, Story>();
  for (const s of stories) {
    storyMap.set(s.id, s);
  }

  // in-degree: count of unsatisfied prerequisites
  const inDegree = new Map<string, number>();
  // adjacency: prerequisite (from) -> dependents (to)
  const adjacency = new Map<string, string[]>();

  for (const s of stories) {
    adjacency.set(s.id, []);
    inDegree.set(s.id, 0);
  }

  for (const s of stories) {
    const deps = s.dependencies ?? [];
    for (const depId of deps) {
      if (storyMap.has(depId)) {
        adjacency.get(depId)!.push(s.id);
        inDegree.set(s.id, (inDegree.get(s.id) ?? 0) + 1);
      }
    }
  }

  // Ready queue: all nodes with inDegree === 0 (0 unsatisfied prerequisites)
  const readyQueue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      readyQueue.push(id);
    }
  }
  readyQueue.sort((a, b) => a.localeCompare(b));

  const executionOrder: StoryId[] = [];

  while (readyQueue.length > 0) {
    const current = readyQueue.shift()!;
    executionOrder.push(createStoryId(current));

    const dependents = adjacency.get(current) ?? [];
    for (const dep of dependents) {
      const remaining = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, remaining);
      if (remaining === 0) {
        readyQueue.push(dep);
        readyQueue.sort((a, b) => a.localeCompare(b));
      }
    }
  }

  if (executionOrder.length !== stories.length) {
    return Object.freeze([]);
  }

  return Object.freeze(executionOrder);
}

/**
 * Derives a stable creation timestamp from baseline stories for reproducible serialization.
 */
function deriveStableCreatedAt(stories: readonly Story[]): Instant {
  if (stories.length === 0) {
    return '1970-01-01T00:00:00.000Z' as Instant;
  }
  const timestamps = stories
    .map((s) => s.createdAt)
    .filter((t): t is Instant => Boolean(t))
    .sort();
  if (timestamps.length > 0) {
    return timestamps[timestamps.length - 1];
  }
  return '1970-01-01T00:00:00.000Z' as Instant;
}

/**
 * Builds a deterministic, baseline-scoped StoryDependencyGraph.
 */
export function buildStoryDependencyGraph(
  params: BuildStoryDependencyGraphParams
): StoryDependencyGraph {
  const baselineId = createRequirementsBaselineId(params.baselineId);
  const stories = params.stories;
  const createdAt = params.createdAt ?? deriveStableCreatedAt(params.stories);

  const validation = validateStoryDependencies(stories);

  if (params.strict && !validation.isValid) {
    if (validation.missingNodeIds.length > 0) {
      const firstMissing = validation.missingNodeIds[0];
      const referrer = stories.find((s) => s.dependencies?.includes(firstMissing))?.id ?? 'unknown';
      throw new MissingStoryDependencyNodeError(referrer, firstMissing);
    }
    if (validation.selfDependencies.length > 0) {
      throw new StorySelfDependencyError(validation.selfDependencies[0]);
    }
    if (validation.cycles.length > 0) {
      throw new StoryDependencyCycleError(validation.cycles[0]);
    }
    throw new StoryDependencyGraphError(
      `Story dependency graph validation failed: ${validation.errors.join('; ')}`
    );
  }

  // Build map of readiness reports by story ID
  const readinessMap = new Map<string, StoryReadinessReportLike>();
  if (params.readinessReports) {
    for (const r of params.readinessReports) {
      readinessMap.set(r.storyId, r);
    }
  }

  // Build story map
  const storyMap = new Map<string, Story>();
  for (const s of stories) {
    storyMap.set(s.id, s);
  }

  // Compute dependents for each story
  const dependentsMap = new Map<string, Set<StoryId>>();
  for (const s of stories) {
    dependentsMap.set(s.id, new Set<StoryId>());
  }

  for (const s of stories) {
    for (const depId of s.dependencies ?? []) {
      if (dependentsMap.has(depId)) {
        dependentsMap.get(depId)!.add(s.id);
      }
    }
  }

  // Construct nodes, sorted ascending by storyId
  // Ensure array properties are deduplicated and sorted for canonical stability
  const sortedStories = [...stories].sort((a, b) => a.id.localeCompare(b.id));
  const nodes: StoryDependencyGraphNode[] = sortedStories.map((s) => {
    const report = readinessMap.get(s.id);
    const deps = Array.from(new Set(s.dependencies ?? []))
      .filter((d) => storyMap.has(d))
      .sort((a, b) => a.localeCompare(b))
      .map((d) => createStoryId(d));
    const depList = Array.from(new Set(dependentsMap.get(s.id) ?? []))
      .sort((a, b) => a.localeCompare(b))
      .map((d) => createStoryId(d));
    const reqIds = Array.from(new Set(s.requirementRevisionIds)).sort((a, b) => a.localeCompare(b));

    return Object.freeze({
      storyId: s.id,
      title: s.title,
      requirementRevisionIds: Object.freeze(reqIds),
      dependencies: Object.freeze(deps),
      dependents: Object.freeze(depList),
      readinessStatus: report?.status,
      isReady: report?.isReady
    });
  });

  // Construct edges: from prerequisite -> to dependent
  const edgeSet = new Set<string>();
  const edges: StoryDependencyGraphEdge[] = [];

  for (const s of stories) {
    for (const depId of s.dependencies ?? []) {
      if (storyMap.has(depId) && depId !== s.id) {
        const edgeKey = `${depId}->${s.id}`;
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey);
          edges.push(
            Object.freeze({
              from: depId as StoryId,
              to: s.id
            })
          );
        }
      }
    }
  }

  // Sort edges deterministically: from asc, then to asc
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const executionOrder = computeTopologicalExecutionOrder(stories, validation);
  const isAcyclic = validation.cycles.length === 0;
  const hasCycles = !isAcyclic;

  return Object.freeze({
    baselineId,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    executionOrder,
    isAcyclic,
    hasCycles,
    cycles: validation.cycles,
    validation,
    createdAt
  });
}

/**
 * Deterministically serializes a StoryDependencyGraph to a JSON string.
 */
export function serializeStoryDependencyGraph(graph: StoryDependencyGraph): string {
  return JSON.stringify(graph, null, 2);
}
