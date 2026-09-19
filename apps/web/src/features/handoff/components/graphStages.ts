import type { StoryDependencyGraphDto } from '@solutions-studio/contracts';

export interface StageLane {
  readonly stage: number;
  readonly storyIds: readonly string[];
}

/**
 * Computes parallel execution stages (lanes) based on prerequisite dependencies.
 * Roots (0 prerequisites) are Stage 1. Dependent nodes are 1 + max(prerequisite stage).
 * If the graph has cycles or is empty, returns an empty array.
 */
export function computeExecutionStages(graph: StoryDependencyGraphDto): readonly StageLane[] {
  if (graph.hasCycles || graph.nodes.length === 0 || !graph.validation.isValid) {
    return Object.freeze([]);
  }

  const nodeMap = new Map<string, (typeof graph.nodes)[number]>();
  for (const n of graph.nodes) {
    nodeMap.set(n.storyId, n);
  }

  const stageMap = new Map<string, number>();

  // Iteratively compute stage for all nodes in executionOrder
  for (const storyId of graph.executionOrder) {
    const node = nodeMap.get(storyId);
    if (!node || node.dependencies.length === 0) {
      stageMap.set(storyId, 1);
    } else {
      let maxPrereqStage = 0;
      for (const dep of node.dependencies) {
        const s = stageMap.get(dep) ?? 1;
        if (s > maxPrereqStage) {
          maxPrereqStage = s;
        }
      }
      stageMap.set(storyId, maxPrereqStage + 1);
    }
  }

  const stageGroups = new Map<number, string[]>();
  for (const [storyId, stage] of stageMap.entries()) {
    if (!stageGroups.has(stage)) {
      stageGroups.set(stage, []);
    }
    stageGroups.get(stage)!.push(storyId);
  }

  const sortedStages = Array.from(stageGroups.keys()).sort((a, b) => a - b);
  return Object.freeze(
    sortedStages.map((stage) =>
      Object.freeze({
        stage,
        storyIds: Object.freeze(stageGroups.get(stage)!.sort((a, b) => a.localeCompare(b)))
      })
    )
  );
}
