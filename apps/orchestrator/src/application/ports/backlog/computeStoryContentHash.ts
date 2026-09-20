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

export interface CanonicalStoryExportProjection {
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

export type ComputeStoryContentHashInput = StoryExportProjectionParams | Pick<Story, 'gherkinText'>;

function isFullProjectionParams(
  input: ComputeStoryContentHashInput
): input is StoryExportProjectionParams {
  return 'story' in input && Boolean(input.story);
}

/**
 * Computes a canonical, deterministic SHA-256 hash representing a story's exported projection.
 *
 * For full export projections (containing story, baselineId, etc.), this includes every stable
 * attribute that influences the external work item:
 * - Story ID and title
 * - Narrative (role, feature, benefit)
 * - Acceptance criteria
 * - Structured scenarios (titles and steps)
 * - Gherkin text
 * - Baseline ID
 * - Requirement revision IDs
 * - Policy constraint revision IDs
 * - Engineering decision IDs
 * - Resolved prerequisite references (story ID, external issue ID, title)
 *
 * Volatile measurement fields (such as exportedAt timestamps) are strictly excluded.
 * For simple objects containing only gherkinText, hashes gherkinText directly.
 */
export function computeStoryContentHash(input: ComputeStoryContentHashInput): string {
  if (isFullProjectionParams(input)) {
    const story = input.story;
    const baselineId = input.baselineId ?? story.baselineId ?? '';

    const canonical: CanonicalStoryExportProjection = {
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
      baselineId,
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

    const serialized = JSON.stringify(canonical);
    return createHash('sha256').update(serialized).digest('hex');
  }

  return createHash('sha256').update(input.gherkinText).digest('hex');
}
