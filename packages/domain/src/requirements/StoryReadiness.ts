import type {
  StoryId,
  RequirementsBaselineId,
  RequirementRevisionId,
  PolicyConstraintRevisionId,
  Instant
} from './ids.js';
import { now } from './ids.js';
import type { Story } from './Story.js';
import type { RequirementsBaseline } from './RequirementsBaseline.js';
import type { RequirementRevision } from './RequirementRevision.js';
import type { PolicyConstraintRevision } from './PolicyConstraintRevision.js';
import { FINDING_TYPES, type CandidateFinding, type FindingType } from './CandidateFinding.js';
import type { EngineeringDecision } from './EngineeringDecision.js';
import { detectCycles, findCyclicStoryIds, findCycleForStory } from './StoryDependencyGraph.js';

export const STORY_READINESS_RULE_IDS = [
  'baseline-exists',
  'requirement-revisions-belong-to-baseline',
  'requirements-accepted-and-clear',
  'policy-constraints-valid',
  'no-blocking-open-findings',
  'story-traceability-declared',
  'engineering-decisions-accepted-or-deferred',
  'sql-projection-valid',
  'openapi-projection-valid',
  'story-dependencies-exist'
] as const;

export type StoryReadinessRuleId = (typeof STORY_READINESS_RULE_IDS)[number];

export interface StoryReadinessFailure {
  readonly ruleId: StoryReadinessRuleId;
  readonly message: string;
  readonly affectedIds: readonly string[];
  readonly details?: Record<string, unknown>;
}

export type StoryReadinessStatus = 'implementation-ready' | 'not-ready';

export interface StoryReadinessPolicy {
  readonly requireSqlProjection?: boolean;
  readonly requireOpenApiProjection?: boolean;
  readonly allowDeferredEngineeringDecisions?: boolean;
  readonly blockingFindingTypes?: readonly FindingType[];
}

export interface StoryReadinessEvaluationContext {
  readonly story: Story;
  readonly baseline?: RequirementsBaseline;
  readonly requirementRevisions: readonly RequirementRevision[];
  readonly policyConstraintRevisions?: readonly PolicyConstraintRevision[];
  readonly candidateFindings?: readonly CandidateFinding[];
  readonly engineeringDecisions?: readonly EngineeringDecision[];
  readonly sqlProjectionValidation?: {
    readonly exists: boolean;
    readonly isValid: boolean;
    readonly errorMessage?: string;
    readonly id?: string;
  };
  readonly openApiProjectionValidation?: {
    readonly exists: boolean;
    readonly isValid: boolean;
    readonly errorMessage?: string;
    readonly id?: string;
  };
  readonly baselineStoryIds?: readonly StoryId[];
  readonly baselineStories?: readonly Story[];
}

export interface StoryReadinessReport {
  readonly storyId: StoryId;
  readonly baselineId: RequirementsBaselineId;
  readonly status: StoryReadinessStatus;
  readonly isReady: boolean;
  readonly evaluatedAt: Instant;
  readonly failures: readonly StoryReadinessFailure[];
  readonly passedRules: readonly StoryReadinessRuleId[];
  readonly policy?: StoryReadinessPolicy;
}

export interface RequirementCoverageEntry {
  readonly requirementRevisionId: RequirementRevisionId;
  readonly coveringStoryIds: readonly StoryId[];
  readonly coverageCount: number;
}

export interface BaselineRequirementCoverage {
  readonly baselineId: RequirementsBaselineId;
  readonly totalRequirements: number;
  readonly coveredCount: number;
  readonly uncoveredCount: number;
  readonly multiCoveredCount: number;
  readonly coveredRequirements: readonly RequirementCoverageEntry[];
  readonly uncoveredRequirementRevisionIds: readonly RequirementRevisionId[];
  readonly multiCoveredRequirements: readonly RequirementCoverageEntry[];
  readonly isFullyCovered: boolean;
  readonly computedAt: Instant;
}

export function evaluateStoryReadiness(
  context: StoryReadinessEvaluationContext,
  policy?: StoryReadinessPolicy,
  evaluatedAt?: Instant
): StoryReadinessReport {
  const failures: StoryReadinessFailure[] = [];
  const passedRules: StoryReadinessRuleId[] = [];

  const story = context.story;
  const baseline = context.baseline;

  // Collect all requirement revisions referenced by story and its scenarios
  const allStoryReqIds = new Set<RequirementRevisionId>(story.requirementRevisionIds);
  for (const sc of story.scenarios) {
    for (const r of sc.requirementRevisionIds) {
      allStoryReqIds.add(r);
    }
  }

  // Collect all policy constraint revisions referenced by story and its scenarios
  const allStoryPolIds = new Set<PolicyConstraintRevisionId>(
    story.policyConstraintRevisionIds ?? []
  );
  for (const sc of story.scenarios) {
    for (const p of sc.policyConstraintRevisionIds ?? []) {
      allStoryPolIds.add(p);
    }
  }

  // --------------------------------------------------------------------------
  // Rule 1: baseline-exists
  // --------------------------------------------------------------------------
  if (!baseline) {
    failures.push({
      ruleId: 'baseline-exists',
      message: `Referenced baseline '${story.baselineId}' does not exist`,
      affectedIds: Object.freeze([story.baselineId])
    });
  } else {
    passedRules.push('baseline-exists');
  }

  // --------------------------------------------------------------------------
  // Rule 2: requirement-revisions-belong-to-baseline
  // --------------------------------------------------------------------------
  if (!baseline) {
    const sortedStoryReqs = Array.from(allStoryReqIds).sort();
    failures.push({
      ruleId: 'requirement-revisions-belong-to-baseline',
      message: `Cannot verify requirement revision baseline membership: baseline '${story.baselineId}' does not exist`,
      affectedIds: Object.freeze(sortedStoryReqs)
    });
  } else {
    const baselineReqSet = new Set<string>(baseline.requirementRevisions);
    const offendingReqIds = Array.from(allStoryReqIds)
      .filter((id) => !baselineReqSet.has(id))
      .sort();

    if (offendingReqIds.length > 0) {
      failures.push({
        ruleId: 'requirement-revisions-belong-to-baseline',
        message: `Requirement revision(s) [${offendingReqIds.join(', ')}] do not belong to baseline '${baseline.id}'`,
        affectedIds: Object.freeze(offendingReqIds)
      });
    } else {
      passedRules.push('requirement-revisions-belong-to-baseline');
    }
  }

  // --------------------------------------------------------------------------
  // Rule 3: requirements-accepted-and-clear
  // --------------------------------------------------------------------------
  const reqRevMap = new Map(context.requirementRevisions.map((r) => [r.id as string, r]));
  const unacceptedOrUnclearReqIds: string[] = [];

  for (const rId of allStoryReqIds) {
    const rev = reqRevMap.get(rId);
    if (!rev || rev.reviewState !== 'ACCEPTED' || rev.resolutionState !== 'CLEAR') {
      unacceptedOrUnclearReqIds.push(rId);
    }
  }
  unacceptedOrUnclearReqIds.sort();

  if (unacceptedOrUnclearReqIds.length > 0) {
    failures.push({
      ruleId: 'requirements-accepted-and-clear',
      message: `Requirement revision(s) [${unacceptedOrUnclearReqIds.join(', ')}] are not in ACCEPTED review state and CLEAR resolution state`,
      affectedIds: Object.freeze(unacceptedOrUnclearReqIds)
    });
  } else {
    passedRules.push('requirements-accepted-and-clear');
  }

  // --------------------------------------------------------------------------
  // Rule 4: policy-constraints-valid
  // --------------------------------------------------------------------------
  if (allStoryPolIds.size === 0) {
    passedRules.push('policy-constraints-valid');
  } else if (!baseline) {
    const sortedStoryPols = Array.from(allStoryPolIds).sort();
    failures.push({
      ruleId: 'policy-constraints-valid',
      message: `Cannot verify policy constraint membership: baseline '${story.baselineId}' does not exist`,
      affectedIds: Object.freeze(sortedStoryPols)
    });
  } else {
    const baselinePolSet = new Set<string>(baseline.policyConstraintRevisions ?? []);
    const polRevMap = new Map(
      (context.policyConstraintRevisions ?? []).map((p) => [p.id as string, p])
    );
    const offendingPolIds: string[] = [];

    for (const pId of allStoryPolIds) {
      if (!baselinePolSet.has(pId)) {
        offendingPolIds.push(pId);
      } else {
        const polRev = polRevMap.get(pId);
        if (!polRev || polRev.state !== 'ACCEPTED') {
          offendingPolIds.push(pId);
        }
      }
    }
    offendingPolIds.sort();

    if (offendingPolIds.length > 0) {
      failures.push({
        ruleId: 'policy-constraints-valid',
        message: `Policy constraint revision(s) [${offendingPolIds.join(', ')}] are not valid accepted members of baseline '${baseline.id}'`,
        affectedIds: Object.freeze(offendingPolIds)
      });
    } else {
      passedRules.push('policy-constraints-valid');
    }
  }

  // --------------------------------------------------------------------------
  // Rule 5: no-blocking-open-findings
  // --------------------------------------------------------------------------
  const candidateFindings = context.candidateFindings ?? [];
  const blockingTypes = new Set<FindingType>(policy?.blockingFindingTypes ?? FINDING_TYPES);
  const storyReqSet = new Set<string>(allStoryReqIds);
  const blockingFindingIds: string[] = [];

  for (const finding of candidateFindings) {
    if (finding.disposition !== 'OPEN') {
      continue;
    }
    if (!blockingTypes.has(finding.type)) {
      continue;
    }

    const overlaps = finding.affectedRequirementRevisions.some((r) => storyReqSet.has(r));
    const isBaselineWide =
      finding.baselineId === story.baselineId && finding.affectedRequirementRevisions.length === 0;

    if (overlaps || isBaselineWide) {
      blockingFindingIds.push(finding.id);
    }
  }
  blockingFindingIds.sort();

  if (blockingFindingIds.length > 0) {
    failures.push({
      ruleId: 'no-blocking-open-findings',
      message: `Blocking open candidate finding(s) [${blockingFindingIds.join(', ')}] affect story authority lineage`,
      affectedIds: Object.freeze(blockingFindingIds)
    });
  } else {
    passedRules.push('no-blocking-open-findings');
  }

  // --------------------------------------------------------------------------
  // Rule 6: story-traceability-declared
  // --------------------------------------------------------------------------
  const untraceableIds: string[] = [];
  if (!story.scenarios || story.scenarios.length === 0) {
    untraceableIds.push(story.id);
  } else {
    const storyDeclaredReqSet = new Set<string>(story.requirementRevisionIds);
    const storyDeclaredPolSet = new Set<string>(story.policyConstraintRevisionIds ?? []);

    for (let i = 0; i < story.scenarios.length; i++) {
      const sc = story.scenarios[i];
      const scIdentifier = sc.id ?? sc.title ?? `Scenario-${i + 1}`;

      if (!sc.steps || sc.steps.length === 0) {
        untraceableIds.push(scIdentifier);
      }
      if (!sc.requirementRevisionIds || sc.requirementRevisionIds.length === 0) {
        untraceableIds.push(scIdentifier);
      } else {
        for (const r of sc.requirementRevisionIds) {
          if (!storyDeclaredReqSet.has(r)) {
            untraceableIds.push(scIdentifier);
          }
        }
      }
      if (sc.policyConstraintRevisionIds && sc.policyConstraintRevisionIds.length > 0) {
        for (const p of sc.policyConstraintRevisionIds) {
          if (!storyDeclaredPolSet.has(p)) {
            untraceableIds.push(scIdentifier);
          }
        }
      }
    }
  }

  const uniqueUntraceable = Array.from(new Set(untraceableIds)).sort();
  if (uniqueUntraceable.length > 0) {
    failures.push({
      ruleId: 'story-traceability-declared',
      message: `Story or scenario(s) [${uniqueUntraceable.join(', ')}] lack required normative traceability or scenario steps`,
      affectedIds: Object.freeze(uniqueUntraceable)
    });
  } else {
    passedRules.push('story-traceability-declared');
  }

  // --------------------------------------------------------------------------
  // Rule 7: engineering-decisions-accepted-or-deferred
  // --------------------------------------------------------------------------
  const allowDeferred = policy?.allowDeferredEngineeringDecisions !== false;
  const engineeringDecisions = context.engineeringDecisions ?? [];
  const failingDecisionIds: string[] = [];

  for (const decision of engineeringDecisions) {
    if (decision.baselineId !== story.baselineId) {
      continue;
    }
    const isBaselineWide = decision.requirementRevisionIds.length === 0;
    const overlaps = decision.requirementRevisionIds.some((r) => storyReqSet.has(r));

    if (!isBaselineWide && !overlaps) {
      continue;
    }

    if (decision.state === 'REJECTED') {
      failingDecisionIds.push(decision.id);
    } else if (decision.state === 'PROPOSED' && !allowDeferred) {
      failingDecisionIds.push(decision.id);
    }
  }
  failingDecisionIds.sort();

  if (failingDecisionIds.length > 0) {
    failures.push({
      ruleId: 'engineering-decisions-accepted-or-deferred',
      message: `Engineering decision(s) [${failingDecisionIds.join(', ')}] affecting story are rejected or unresolved`,
      affectedIds: Object.freeze(failingDecisionIds)
    });
  } else {
    passedRules.push('engineering-decisions-accepted-or-deferred');
  }

  // --------------------------------------------------------------------------
  // Rule 8: sql-projection-valid
  // --------------------------------------------------------------------------
  const requireSql = policy?.requireSqlProjection === true;
  const sqlVal = context.sqlProjectionValidation;

  if (requireSql) {
    if (!sqlVal || !sqlVal.exists) {
      failures.push({
        ruleId: 'sql-projection-valid',
        message: `SQL projection is required for baseline '${story.baselineId}' but does not exist`,
        affectedIds: Object.freeze([story.baselineId])
      });
    } else if (!sqlVal.isValid) {
      const affectedId = sqlVal.id ?? story.baselineId;
      failures.push({
        ruleId: 'sql-projection-valid',
        message: `SQL projection '${affectedId}' failed validation: ${sqlVal.errorMessage ?? 'Invalid SQL projection'}`,
        affectedIds: Object.freeze([affectedId])
      });
    } else {
      passedRules.push('sql-projection-valid');
    }
  } else {
    if (sqlVal?.exists && !sqlVal.isValid) {
      const affectedId = sqlVal.id ?? story.baselineId;
      failures.push({
        ruleId: 'sql-projection-valid',
        message: `SQL projection '${affectedId}' failed validation: ${sqlVal.errorMessage ?? 'Invalid SQL projection'}`,
        affectedIds: Object.freeze([affectedId])
      });
    } else {
      passedRules.push('sql-projection-valid');
    }
  }

  // --------------------------------------------------------------------------
  // Rule 9: openapi-projection-valid
  // --------------------------------------------------------------------------
  const requireOpenApi = policy?.requireOpenApiProjection === true;
  const openApiVal = context.openApiProjectionValidation;

  if (requireOpenApi) {
    if (!openApiVal || !openApiVal.exists) {
      failures.push({
        ruleId: 'openapi-projection-valid',
        message: `OpenAPI projection is required for baseline '${story.baselineId}' but does not exist`,
        affectedIds: Object.freeze([story.baselineId])
      });
    } else if (!openApiVal.isValid) {
      const affectedId = openApiVal.id ?? story.baselineId;
      failures.push({
        ruleId: 'openapi-projection-valid',
        message: `OpenAPI projection '${affectedId}' failed validation: ${openApiVal.errorMessage ?? 'Invalid OpenAPI projection'}`,
        affectedIds: Object.freeze([affectedId])
      });
    } else {
      passedRules.push('openapi-projection-valid');
    }
  } else {
    if (openApiVal?.exists && !openApiVal.isValid) {
      const affectedId = openApiVal.id ?? story.baselineId;
      failures.push({
        ruleId: 'openapi-projection-valid',
        message: `OpenAPI projection '${affectedId}' failed validation: ${openApiVal.errorMessage ?? 'Invalid OpenAPI projection'}`,
        affectedIds: Object.freeze([affectedId])
      });
    } else {
      passedRules.push('openapi-projection-valid');
    }
  }

  // --------------------------------------------------------------------------
  // Rule 10: story-dependencies-exist
  // --------------------------------------------------------------------------
  const dependencies = story.dependencies ?? [];
  if (dependencies.length === 0) {
    passedRules.push('story-dependencies-exist');
  } else {
    const knownStoryIds = new Set<string>([
      ...(context.baselineStoryIds ?? []),
      ...(context.baselineStories?.map((s) => s.id as string) ?? [])
    ]);
    const offendingDepIds: string[] = [];

    for (const depId of dependencies) {
      if (depId === story.id) {
        offendingDepIds.push(depId);
      } else if (!knownStoryIds.has(depId)) {
        offendingDepIds.push(depId);
      }
    }
    offendingDepIds.sort();

    if (offendingDepIds.length > 0) {
      failures.push({
        ruleId: 'story-dependencies-exist',
        message: `Story dependencies [${offendingDepIds.join(', ')}] are invalid: dependencies must exist, cannot self-reference, and must belong to baseline '${story.baselineId}'`,
        affectedIds: Object.freeze(offendingDepIds)
      });
    } else if (context.baselineStories) {
      const cyclicStoryIds = findCyclicStoryIds(context.baselineStories);
      if (cyclicStoryIds.has(story.id)) {
        const cycles = detectCycles(context.baselineStories);
        const participatingCycle =
          cycles.find((c) => c.includes(story.id)) ??
          findCycleForStory(story.id, context.baselineStories) ??
          ([story.id, story.id] as const);
        failures.push({
          ruleId: 'story-dependencies-exist',
          message: `Story '${story.id}' participates in a dependency cycle: [${participatingCycle.join(' -> ')}]`,
          affectedIds: Object.freeze([...participatingCycle])
        });
      } else {
        passedRules.push('story-dependencies-exist');
      }
    } else {
      passedRules.push('story-dependencies-exist');
    }
  }

  const isReady = failures.length === 0;
  const status: StoryReadinessStatus = isReady ? 'implementation-ready' : 'not-ready';

  return Object.freeze({
    storyId: story.id,
    baselineId: story.baselineId,
    status,
    isReady,
    evaluatedAt: evaluatedAt ?? now(),
    failures: Object.freeze(failures),
    passedRules: Object.freeze([...passedRules].sort()),
    policy: policy ? Object.freeze({ ...policy }) : undefined
  });
}

export function computeRequirementCoverage(
  baseline: RequirementsBaseline,
  stories: readonly Story[],
  computedAt?: Instant
): BaselineRequirementCoverage {
  const coveredRequirements: RequirementCoverageEntry[] = [];
  const uncoveredRequirementRevisionIds: RequirementRevisionId[] = [];
  const multiCoveredRequirements: RequirementCoverageEntry[] = [];

  for (const reqRevId of baseline.requirementRevisions) {
    const coveringStories = stories.filter((story) => {
      if (story.requirementRevisionIds.includes(reqRevId)) {
        return true;
      }
      return story.scenarios.some((sc) => sc.requirementRevisionIds.includes(reqRevId));
    });

    const coveringStoryIds = coveringStories.map((s) => s.id as string).sort();

    if (coveringStoryIds.length === 0) {
      uncoveredRequirementRevisionIds.push(reqRevId);
    } else {
      const entry: RequirementCoverageEntry = Object.freeze({
        requirementRevisionId: reqRevId,
        coveringStoryIds: Object.freeze(coveringStoryIds as StoryId[]),
        coverageCount: coveringStoryIds.length
      });
      coveredRequirements.push(entry);
      if (coveringStoryIds.length > 1) {
        multiCoveredRequirements.push(entry);
      }
    }
  }

  coveredRequirements.sort((a, b) =>
    a.requirementRevisionId.localeCompare(b.requirementRevisionId)
  );
  uncoveredRequirementRevisionIds.sort((a, b) => a.localeCompare(b));
  multiCoveredRequirements.sort((a, b) =>
    a.requirementRevisionId.localeCompare(b.requirementRevisionId)
  );

  const totalRequirements = baseline.requirementRevisions.length;
  const isFullyCovered = totalRequirements > 0 && uncoveredRequirementRevisionIds.length === 0;

  return Object.freeze({
    baselineId: baseline.id,
    totalRequirements,
    coveredCount: coveredRequirements.length,
    uncoveredCount: uncoveredRequirementRevisionIds.length,
    multiCoveredCount: multiCoveredRequirements.length,
    coveredRequirements: Object.freeze(coveredRequirements),
    uncoveredRequirementRevisionIds: Object.freeze(uncoveredRequirementRevisionIds),
    multiCoveredRequirements: Object.freeze(multiCoveredRequirements),
    isFullyCovered,
    computedAt: computedAt ?? now()
  });
}
