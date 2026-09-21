import { createHash } from 'node:crypto';
import type { Story } from '@solutions-studio/domain';

export interface StoryExportProjectionParams {
  readonly story: Pick<
    Story,
    | 'id'
    | 'title'
    | 'narrative'
    | 'acceptanceCriteria'
    | 'scenarios'
    | 'gherkinText'
    | 'requirementRevisionIds'
  > & {
    readonly baselineId?: string;
    readonly policyConstraintRevisionIds?: readonly string[];
  };
  readonly baselineId?: string;
  readonly engineeringDecisionIds?: readonly string[];
  readonly prerequisites?: readonly {
    readonly storyId: string;
    readonly externalWorkItemId?: string;
    readonly title?: string;
  }[];
}

export interface CanonicalStoryExportProjectionV1 {
  readonly version: 1;
  readonly storyId: string;
  readonly title: string;
  readonly narrative: {
    readonly role: string;
    readonly feature: string;
    readonly benefit: string;
  };
  readonly acceptanceCriteria: readonly string[];
  readonly scenarios: readonly {
    readonly title: string;
    readonly steps: readonly { readonly keyword: string; readonly text: string }[];
  }[];
  readonly gherkinText: string;
  readonly baselineId: string;
  readonly requirementRevisionIds: readonly string[];
  readonly policyConstraintRevisionIds: readonly string[];
  readonly engineeringDecisionIds: readonly string[];
  readonly prerequisites: readonly {
    readonly storyId: string;
    readonly externalWorkItemId?: string;
    readonly title?: string;
  }[];
}

export interface CanonicalStoryExportProjectionV2 {
  readonly version: 2;
  readonly storyId: string;
  readonly title: string;
  readonly narrative: {
    readonly role: string;
    readonly feature: string;
    readonly benefit: string;
  };
  readonly acceptanceCriteria: readonly string[];
  readonly scenarios: readonly {
    readonly title: string;
    readonly steps: readonly { readonly keyword: string; readonly text: string }[];
  }[];
  readonly gherkinText: string;
  readonly requirementRevisionIds: readonly string[];
  readonly policyConstraintRevisionIds: readonly string[];
  readonly prerequisites: readonly {
    readonly storyId: string;
    readonly externalWorkItemId?: string;
    readonly title?: string;
  }[];
}

export type CanonicalStoryExportProjection = CanonicalStoryExportProjectionV2;

export type ComputeStoryContentHashInput = StoryExportProjectionParams | Pick<Story, 'gherkinText'>;

function isFullProjectionParams(
  input: ComputeStoryContentHashInput
): input is StoryExportProjectionParams {
  return 'story' in input && Boolean(input.story);
}

/**
 * Computes a canonical, deterministic SHA-256 hash representing a story's exported projection.
 *
 * For full export projections (containing story, etc.), this includes every stable
 * attribute of the story's own specification:
 * - Story ID and title
 * - Narrative (role, feature, benefit)
 * - Acceptance criteria
 * - Structured scenarios (titles and steps)
 * - Gherkin text
 * - Requirement revision IDs (sorted)
 * - Policy constraint revision IDs (sorted)
 * - Resolved prerequisite references (story ID, external issue ID, title, sorted)
 *
 * Note: Baseline container ID and global baseline-wide engineering decision IDs are strictly
 * excluded in version 2 to ensure that unrelated baseline updates do not alter the story's specification hash.
 * Volatile measurement fields (such as exportedAt timestamps) are also strictly excluded.
 * For simple objects containing only gherkinText, hashes gherkinText directly.
 */
export function computeStoryContentHash(
  input: ComputeStoryContentHashInput,
  options?: { readonly version?: 1 | 2 }
): string {
  const version = options?.version ?? 2;
  if (isFullProjectionParams(input)) {
    const story = input.story;

    if (version === 1) {
      const canonicalV1: CanonicalStoryExportProjectionV1 = {
        version: 1,
        storyId: story.id,
        title: story.title,
        narrative: {
          role: story.narrative.role,
          feature: story.narrative.feature,
          benefit: story.narrative.benefit
        },
        acceptanceCriteria: [...story.acceptanceCriteria],
        scenarios: story.scenarios.map((sc) => ({
          title: sc.title,
          steps: sc.steps.map((st) => ({ keyword: st.keyword, text: st.text }))
        })),
        gherkinText: story.gherkinText,
        baselineId: input.baselineId ?? story.baselineId ?? '',
        requirementRevisionIds: [...story.requirementRevisionIds].sort(),
        policyConstraintRevisionIds: [...(story.policyConstraintRevisionIds ?? [])].sort(),
        engineeringDecisionIds: [...(input.engineeringDecisionIds ?? [])].sort(),
        prerequisites: [...(input.prerequisites ?? [])]
          .map((p) => ({
            storyId: p.storyId,
            externalWorkItemId: p.externalWorkItemId,
            title: p.title
          }))
          .sort((a, b) => a.storyId.localeCompare(b.storyId))
      };

      const serialized = JSON.stringify(canonicalV1);
      return createHash('sha256').update(serialized).digest('hex');
    }

    const canonical: CanonicalStoryExportProjectionV2 = {
      version: 2,
      storyId: story.id,
      title: story.title,
      narrative: {
        role: story.narrative.role,
        feature: story.narrative.feature,
        benefit: story.narrative.benefit
      },
      acceptanceCriteria: [...story.acceptanceCriteria],
      scenarios: story.scenarios.map((sc) => ({
        title: sc.title,
        steps: sc.steps.map((st) => ({ keyword: st.keyword, text: st.text }))
      })),
      gherkinText: story.gherkinText,
      requirementRevisionIds: [...story.requirementRevisionIds].sort(),
      policyConstraintRevisionIds: [...(story.policyConstraintRevisionIds ?? [])].sort(),
      prerequisites: [...(input.prerequisites ?? [])]
        .map((p) => ({
          storyId: p.storyId,
          externalWorkItemId: p.externalWorkItemId,
          title: p.title
        }))
        .sort((a, b) => a.storyId.localeCompare(b.storyId))
    };

    const serialized = JSON.stringify(canonical);
    return createHash('sha256').update(serialized).digest('hex');
  }

  return createHash('sha256').update(input.gherkinText).digest('hex');
}

export function computeStoryContentHashV1(input: ComputeStoryContentHashInput): string {
  return computeStoryContentHash(input, { version: 1 });
}

export function computeStoryContentHashV2(input: ComputeStoryContentHashInput): string {
  return computeStoryContentHash(input, { version: 2 });
}

export function matchesStoryContentHash(params: {
  readonly mappingHash: string;
  readonly mappingHashVersion?: number;
  readonly currentStory: Pick<
    Story,
    | 'id'
    | 'title'
    | 'narrative'
    | 'acceptanceCriteria'
    | 'scenarios'
    | 'gherkinText'
    | 'requirementRevisionIds'
  > & {
    readonly baselineId?: string;
    readonly policyConstraintRevisionIds?: readonly string[];
  };
  readonly mappingBaselineId?: string;
  readonly currentBaselineId?: string;
  readonly engineeringDecisionIds?: readonly string[];
  readonly prerequisites?: readonly {
    readonly storyId: string;
    readonly externalWorkItemId?: string;
    readonly title?: string;
  }[];
}): boolean {
  const version = params.mappingHashVersion ?? 1;
  if (version === 1) {
    const v1Hash = computeStoryContentHash(
      {
        story: params.currentStory,
        baselineId:
          params.mappingBaselineId ??
          params.currentBaselineId ??
          params.currentStory.baselineId ??
          '',
        engineeringDecisionIds: params.engineeringDecisionIds ?? [],
        prerequisites: params.prerequisites
      },
      { version: 1 }
    );
    if (v1Hash.toLowerCase() === params.mappingHash.toLowerCase()) {
      return true;
    }
  }

  const v2Hash = computeStoryContentHash(
    {
      story: params.currentStory,
      prerequisites: params.prerequisites
    },
    { version: 2 }
  );
  return v2Hash.toLowerCase() === params.mappingHash.toLowerCase();
}
