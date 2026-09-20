import type { StoryId, RequirementsBaselineId, Instant } from '../requirements/ids.js';
import type { Story } from '../requirements/Story.js';
import type { RequirementsBaseline } from '../requirements/RequirementsBaseline.js';
import type { StoryDependencyGraph } from '../requirements/StoryDependencyGraph.js';
import type { BacklogExportMapping, BacklogExportHistoryEntry } from './BacklogExportMapping.js';

export type ExportStalenessClassification = 'CURRENT' | 'STALE' | 'IMPACTED' | 'UNEXPORTED';

export type StalenessCauseCategory =
  | 'BASELINE_SUPERSEDED'
  | 'REQUIREMENT_REVISION_SUPERSEDED'
  | 'REQUIREMENT_REMOVED_FROM_BASELINE'
  | 'POLICY_CONSTRAINT_SUPERSEDED'
  | 'POLICY_CONSTRAINT_REMOVED_FROM_BASELINE'
  | 'STORY_VERSION_SUPERSEDED'
  | 'CONTENT_HASH_MISMATCH'
  | 'PREREQUISITE_STALE'
  | 'PREREQUISITE_VERSION_SUPERSEDED';

export interface StalenessCause {
  readonly category: StalenessCauseCategory;
  readonly message: string;
  readonly entityId: string;
  readonly exportedRevision?: string;
  readonly currentRevision?: string;
}

export interface ExportedStoryLineage {
  readonly baselineId: RequirementsBaselineId;
  readonly storyVersion: number;
  readonly exportVersion: number;
  readonly exportContentHash: string;
  readonly exportContentHashVersion?: number;
  readonly prerequisiteExportVersions?: Readonly<Record<string, number>>;
  readonly exportedAt: Instant;
  readonly externalWorkItemId: string;
  readonly externalUrl?: string;
}

export interface StoryExportStalenessReport {
  readonly storyId: StoryId;
  readonly classification: ExportStalenessClassification;
  readonly causes: readonly StalenessCause[];
  readonly exportedLineage?: ExportedStoryLineage;
  readonly impactedByPrerequisiteStoryIds: readonly StoryId[];
  readonly currentContentHash: string;
  readonly advisorySemanticImpact?: AdvisorySemanticImpactResult;
  readonly history?: readonly BacklogExportHistoryEntry[];
}

export interface BaselineExportStalenessReport {
  readonly baselineId: RequirementsBaselineId;
  readonly totalStories: number;
  readonly currentCount: number;
  readonly staleCount: number;
  readonly impactedCount: number;
  readonly unexportedCount: number;
  readonly stories: readonly StoryExportStalenessReport[];
}

export interface AdvisorySemanticImpactResult {
  readonly isAdvisoryOnly: true;
  readonly storyId: StoryId;
  readonly semanticRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly reasoning: string;
  readonly suggestedActions: readonly string[];
  readonly modelAssisted: boolean;
}

export interface EvaluateExportStalenessParams {
  readonly baseline: RequirementsBaseline;
  readonly stories: readonly Story[];
  readonly mappings: readonly BacklogExportMapping[];
  readonly dependencyGraph?: StoryDependencyGraph;
  readonly activeRequirementMap: ReadonlyMap<string, string>; // requirementId -> activeRevisionId
  readonly activePolicyConstraintMap: ReadonlyMap<string, string>; // policyConstraintId -> activeRevisionId
  readonly lookupRequirementRevision: (
    revId: string
  ) => { requirementId: string; revision: number; supersedes?: string } | undefined;
  readonly lookupPolicyConstraintRevision?: (
    revId: string
  ) => { policyConstraintId: string; revision: number } | undefined;
  readonly computeStoryHash: (story: Story) => string;
  readonly matchesStoryHash?: (mapping: BacklogExportMapping, story: Story) => boolean;
  readonly advisorySemanticImpacts?: ReadonlyMap<string, AdvisorySemanticImpactResult>;
  readonly targetStoryIds?: readonly (StoryId | string)[];
}

interface MutableStoryEvaluation {
  readonly story: Story;
  classification: ExportStalenessClassification;
  readonly causes: StalenessCause[];
  readonly exportedLineage?: ExportedStoryLineage;
  readonly impactedByPrerequisiteStoryIds: StoryId[];
  readonly currentContentHash: string;
}

export function evaluateExportStaleness(
  params: EvaluateExportStalenessParams
): BaselineExportStalenessReport {
  const mappingByStoryId = new Map<string, BacklogExportMapping>();
  for (const m of params.mappings) {
    mappingByStoryId.set(m.storyId, m);
  }

  const evaluations = new Map<string, MutableStoryEvaluation>();

  // Pass 1: Direct staleness classification
  for (const story of params.stories) {
    const currentContentHash = params.computeStoryHash(story);
    const mapping = mappingByStoryId.get(story.id);

    if (!mapping) {
      evaluations.set(story.id, {
        story,
        classification: 'UNEXPORTED',
        causes: [],
        impactedByPrerequisiteStoryIds: [],
        currentContentHash
      });
      continue;
    }

    const exportedLineage: ExportedStoryLineage = Object.freeze({
      baselineId: mapping.baselineId,
      storyVersion: mapping.storyVersion ?? 1,
      exportVersion: mapping.exportVersion ?? 1,
      exportContentHash: mapping.exportContentHash,
      exportContentHashVersion: mapping.exportContentHashVersion,
      prerequisiteExportVersions: mapping.prerequisiteExportVersions,
      exportedAt: mapping.exportedAt,
      externalWorkItemId: mapping.externalWorkItemId,
      externalUrl: mapping.externalUrl
    });

    const causes: StalenessCause[] = [];

    // 1. Story version supersession
    if (story.version !== undefined && story.version > (mapping.storyVersion ?? 1)) {
      causes.push(
        Object.freeze({
          category: 'STORY_VERSION_SUPERSEDED',
          message: `Story '${story.id}' version ${story.version} supersedes exported story version ${mapping.storyVersion}`,
          entityId: story.id,
          exportedRevision: String(mapping.storyVersion ?? 1),
          currentRevision: String(story.version)
        })
      );
    }

    // 2. Content hash mismatch
    const isHashMatched = params.matchesStoryHash
      ? params.matchesStoryHash(mapping, story)
      : mapping.exportContentHash.toLowerCase() === currentContentHash.toLowerCase();

    if (!isHashMatched) {
      causes.push(
        Object.freeze({
          category: 'CONTENT_HASH_MISMATCH',
          message: `Story '${story.id}' content hash mismatch: current '${currentContentHash}' does not match exported '${mapping.exportContentHash}'`,
          entityId: story.id,
          exportedRevision: mapping.exportContentHash,
          currentRevision: currentContentHash
        })
      );
    }

    // 3. Requirement revisions
    for (const exportedReqRevId of mapping.requirementRevisionIds) {
      const revInfo = params.lookupRequirementRevision(exportedReqRevId);
      const requirementId = revInfo ? revInfo.requirementId : exportedReqRevId;
      const activeRevisionId = params.activeRequirementMap.get(requirementId);

      if (activeRevisionId === undefined) {
        causes.push(
          Object.freeze({
            category: 'REQUIREMENT_REMOVED_FROM_BASELINE',
            message: `Requirement '${requirementId}' (exported revision '${exportedReqRevId}') is no longer included in target baseline '${params.baseline.id}'`,
            entityId: requirementId,
            exportedRevision: exportedReqRevId
          })
        );
      } else if (activeRevisionId !== exportedReqRevId) {
        causes.push(
          Object.freeze({
            category: 'REQUIREMENT_REVISION_SUPERSEDED',
            message: `Requirement '${requirementId}' revision '${exportedReqRevId}' is superseded by '${activeRevisionId}' in target baseline '${params.baseline.id}'`,
            entityId: requirementId,
            exportedRevision: exportedReqRevId,
            currentRevision: activeRevisionId
          })
        );
      }
    }

    // 4. Policy constraint revisions
    for (const exportedPolicyRevId of mapping.policyConstraintRevisionIds ?? []) {
      const polInfo = params.lookupPolicyConstraintRevision
        ? params.lookupPolicyConstraintRevision(exportedPolicyRevId)
        : undefined;
      const policyConstraintId = polInfo ? polInfo.policyConstraintId : exportedPolicyRevId;
      const activePolicyRevId = params.activePolicyConstraintMap.get(policyConstraintId);

      if (activePolicyRevId === undefined) {
        causes.push(
          Object.freeze({
            category: 'POLICY_CONSTRAINT_REMOVED_FROM_BASELINE',
            message: `Policy constraint '${policyConstraintId}' (exported revision '${exportedPolicyRevId}') is no longer included in target baseline '${params.baseline.id}'`,
            entityId: policyConstraintId,
            exportedRevision: exportedPolicyRevId
          })
        );
      } else if (activePolicyRevId !== exportedPolicyRevId) {
        causes.push(
          Object.freeze({
            category: 'POLICY_CONSTRAINT_SUPERSEDED',
            message: `Policy constraint '${policyConstraintId}' revision '${exportedPolicyRevId}' is superseded by '${activePolicyRevId}' in target baseline '${params.baseline.id}'`,
            entityId: policyConstraintId,
            exportedRevision: exportedPolicyRevId,
            currentRevision: activePolicyRevId
          })
        );
      }
    }

    const classification: ExportStalenessClassification = causes.length > 0 ? 'STALE' : 'CURRENT';

    evaluations.set(story.id, {
      story,
      classification,
      causes,
      exportedLineage,
      impactedByPrerequisiteStoryIds: [],
      currentContentHash
    });
  }

  // Pass 2: Propagate structural DAG dependency impact
  // Repeat iteratively until no new stories become IMPACTED
  let changed = true;
  while (changed) {
    changed = false;
    for (const [, ev] of evaluations) {
      if (ev.classification !== 'CURRENT') {
        continue;
      }

      const mapping = mappingByStoryId.get(ev.story.id);
      const dependencies = ev.story.dependencies ?? [];
      const stalePrereqs: StoryId[] = [];
      const versionChangedPrereqs: {
        depId: StoryId;
        recordedVersion: number;
        currentVersion: number;
      }[] = [];

      for (const depId of dependencies) {
        const depEv = evaluations.get(depId);
        if (depEv && (depEv.classification === 'STALE' || depEv.classification === 'IMPACTED')) {
          stalePrereqs.push(depId);
        }

        if (mapping?.prerequisiteExportVersions) {
          const recordedVersion = mapping.prerequisiteExportVersions[depId];
          const depMapping = mappingByStoryId.get(depId);
          if (
            recordedVersion !== undefined &&
            depMapping &&
            depMapping.exportVersion > recordedVersion
          ) {
            versionChangedPrereqs.push({
              depId,
              recordedVersion,
              currentVersion: depMapping.exportVersion
            });
          }
        }
      }

      if (stalePrereqs.length > 0 || versionChangedPrereqs.length > 0) {
        ev.classification = 'IMPACTED';
        for (const prereqId of stalePrereqs) {
          const prereqEv = evaluations.get(prereqId);
          ev.causes.push(
            Object.freeze({
              category: 'PREREQUISITE_STALE',
              message: `Prerequisite story '${prereqId}' has status '${prereqEv?.classification ?? 'STALE'}'`,
              entityId: prereqId
            })
          );
          if (!ev.impactedByPrerequisiteStoryIds.includes(prereqId)) {
            ev.impactedByPrerequisiteStoryIds.push(prereqId);
          }
        }
        for (const { depId, recordedVersion, currentVersion } of versionChangedPrereqs) {
          ev.causes.push(
            Object.freeze({
              category: 'PREREQUISITE_VERSION_SUPERSEDED',
              message: `Prerequisite story '${depId}' exported version v${currentVersion} supersedes recorded version v${recordedVersion}`,
              entityId: depId,
              exportedRevision: `v${recordedVersion}`,
              currentRevision: `v${currentVersion}`
            })
          );
          if (!ev.impactedByPrerequisiteStoryIds.includes(depId)) {
            ev.impactedByPrerequisiteStoryIds.push(depId);
          }
        }
        changed = true;
      }
    }
  }

  // Pass 3: Filter target stories if targetStoryIds provided, otherwise all
  const targetIdSet = params.targetStoryIds
    ? new Set(params.targetStoryIds.map(String))
    : undefined;

  const resultStories: StoryExportStalenessReport[] = [];
  for (const story of params.stories) {
    if (targetIdSet && !targetIdSet.has(story.id)) {
      continue;
    }
    const ev = evaluations.get(story.id);
    if (!ev) continue;

    const mapping = mappingByStoryId.get(ev.story.id);

    resultStories.push(
      Object.freeze({
        storyId: ev.story.id,
        classification: ev.classification,
        causes: Object.freeze([...ev.causes]),
        exportedLineage: ev.exportedLineage,
        impactedByPrerequisiteStoryIds: Object.freeze([...ev.impactedByPrerequisiteStoryIds]),
        currentContentHash: ev.currentContentHash,
        history: mapping?.history ?? Object.freeze([]),
        advisorySemanticImpact: params.advisorySemanticImpacts?.get(ev.story.id)
      })
    );
  }

  const currentCount = resultStories.filter((s) => s.classification === 'CURRENT').length;
  const staleCount = resultStories.filter((s) => s.classification === 'STALE').length;
  const impactedCount = resultStories.filter((s) => s.classification === 'IMPACTED').length;
  const unexportedCount = resultStories.filter((s) => s.classification === 'UNEXPORTED').length;

  return Object.freeze({
    baselineId: params.baseline.id,
    totalStories: resultStories.length,
    currentCount,
    staleCount,
    impactedCount,
    unexportedCount,
    stories: Object.freeze(resultStories)
  });
}
