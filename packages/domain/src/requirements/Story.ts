import type {
  StoryId,
  RequirementsBaselineId,
  RequirementRevisionId,
  PolicyConstraintRevisionId,
  Instant
} from './ids.js';
import {
  now,
  createStoryId,
  createRequirementsBaselineId,
  createRequirementRevisionId
} from './ids.js';
import { DomainError } from './errors.js';

export class StoryInvariantViolationError extends DomainError {
  constructor(message: string) {
    super(`Story invariant violation: ${message}`);
  }
}

export interface StoryNarrative {
  readonly role: string;
  readonly feature: string;
  readonly benefit: string;
  readonly rawText?: string;
}

export const GHERKIN_STEP_KEYWORDS = ['Given', 'When', 'Then', 'And', 'But'] as const;
export type GherkinStepKeyword = (typeof GHERKIN_STEP_KEYWORDS)[number];

export interface GherkinStep {
  readonly keyword: GherkinStepKeyword;
  readonly text: string;
}

export interface GherkinScenario {
  readonly id?: string;
  readonly title: string;
  readonly requirementRevisionIds: readonly RequirementRevisionId[];
  readonly policyConstraintRevisionIds?: readonly PolicyConstraintRevisionId[];
  readonly steps: readonly GherkinStep[];
  readonly rawText?: string;
}

export interface Story {
  readonly id: StoryId;
  readonly baselineId: RequirementsBaselineId;
  readonly title: string;
  readonly narrative: StoryNarrative;
  readonly requirementRevisionIds: readonly RequirementRevisionId[];
  readonly policyConstraintRevisionIds?: readonly PolicyConstraintRevisionId[];
  readonly scenarios: readonly GherkinScenario[];
  readonly acceptanceCriteria: readonly string[];
  readonly gherkinText: string;
  readonly createdAt: Instant;
}

export interface CreateStoryParams {
  readonly id: StoryId | string;
  readonly baselineId: RequirementsBaselineId | string;
  readonly title: string;
  readonly narrative: {
    readonly role: string;
    readonly feature: string;
    readonly benefit: string;
    readonly rawText?: string;
  };
  readonly requirementRevisionIds: readonly (RequirementRevisionId | string)[];
  readonly policyConstraintRevisionIds?: readonly (PolicyConstraintRevisionId | string)[];
  readonly scenarios: readonly {
    readonly id?: string;
    readonly title: string;
    readonly requirementRevisionIds: readonly (RequirementRevisionId | string)[];
    readonly policyConstraintRevisionIds?: readonly (PolicyConstraintRevisionId | string)[];
    readonly steps: readonly {
      readonly keyword: GherkinStepKeyword | string;
      readonly text: string;
    }[];
    readonly rawText?: string;
  }[];
  readonly acceptanceCriteria?: readonly string[];
  readonly gherkinText: string;
  readonly createdAt?: Instant;
}

export function createStory(params: CreateStoryParams): Story {
  if (!params.id || typeof params.id !== 'string' || params.id.trim().length === 0) {
    throw new StoryInvariantViolationError('Story id must be a non-empty string');
  }
  const storyId = createStoryId(params.id);

  if (
    !params.baselineId ||
    typeof params.baselineId !== 'string' ||
    params.baselineId.trim().length === 0
  ) {
    throw new StoryInvariantViolationError('Story baselineId must be a non-empty string');
  }
  const baselineId = createRequirementsBaselineId(params.baselineId);

  if (!params.title || typeof params.title !== 'string' || params.title.trim().length === 0) {
    throw new StoryInvariantViolationError('Story title must be a non-empty string');
  }
  const title = params.title.trim();

  if (!params.narrative) {
    throw new StoryInvariantViolationError('Story narrative is required');
  }
  if (!params.narrative.role || params.narrative.role.trim().length === 0) {
    throw new StoryInvariantViolationError('Story narrative role must be a non-empty string');
  }
  if (!params.narrative.feature || params.narrative.feature.trim().length === 0) {
    throw new StoryInvariantViolationError('Story narrative feature must be a non-empty string');
  }
  if (!params.narrative.benefit || params.narrative.benefit.trim().length === 0) {
    throw new StoryInvariantViolationError('Story narrative benefit must be a non-empty string');
  }

  const narrative: StoryNarrative = Object.freeze({
    role: params.narrative.role.trim(),
    feature: params.narrative.feature.trim(),
    benefit: params.narrative.benefit.trim(),
    rawText: params.narrative.rawText
  });

  if (!params.requirementRevisionIds || params.requirementRevisionIds.length === 0) {
    throw new StoryInvariantViolationError(
      'Story requirementRevisionIds must contain at least one requirement revision'
    );
  }

  const storyReqIds: RequirementRevisionId[] = [];
  for (const rid of params.requirementRevisionIds) {
    if (typeof rid !== 'string' || rid.trim().length === 0) {
      throw new StoryInvariantViolationError(
        'Story requirementRevisionIds must not contain empty identifiers'
      );
    }
    storyReqIds.push(createRequirementRevisionId(rid));
  }
  const storyReqSet = new Set<string>(storyReqIds);

  let storyPolicyIds: PolicyConstraintRevisionId[] | undefined;
  const storyPolicySet = new Set<string>();
  if (params.policyConstraintRevisionIds) {
    storyPolicyIds = [];
    for (const pid of params.policyConstraintRevisionIds) {
      if (typeof pid !== 'string' || pid.trim().length === 0) {
        throw new StoryInvariantViolationError(
          'Story policyConstraintRevisionIds must not contain empty identifiers'
        );
      }
      storyPolicyIds.push(pid as PolicyConstraintRevisionId);
      storyPolicySet.add(pid);
    }
  }

  if (!params.scenarios || params.scenarios.length === 0) {
    throw new StoryInvariantViolationError(
      'Story scenarios must contain at least one Gherkin scenario'
    );
  }

  const scenarios: GherkinScenario[] = [];
  for (let i = 0; i < params.scenarios.length; i++) {
    const s = params.scenarios[i];
    if (!s.title || typeof s.title !== 'string' || s.title.trim().length === 0) {
      throw new StoryInvariantViolationError(`Scenario at index ${i} must have a non-empty title`);
    }

    if (!s.steps || s.steps.length === 0) {
      throw new StoryInvariantViolationError(`Scenario '${s.title}' must have at least one step`);
    }

    const steps: GherkinStep[] = [];
    for (let j = 0; j < s.steps.length; j++) {
      const step = s.steps[j];
      if (!GHERKIN_STEP_KEYWORDS.includes(step.keyword as GherkinStepKeyword)) {
        throw new StoryInvariantViolationError(
          `Scenario '${s.title}' step at index ${j} has invalid keyword '${step.keyword}'`
        );
      }
      if (!step.text || typeof step.text !== 'string' || step.text.trim().length === 0) {
        throw new StoryInvariantViolationError(
          `Scenario '${s.title}' step at index ${j} must have non-empty text`
        );
      }
      steps.push(
        Object.freeze({
          keyword: step.keyword as GherkinStepKeyword,
          text: step.text.trim()
        })
      );
    }

    if (!s.requirementRevisionIds || s.requirementRevisionIds.length === 0) {
      throw new StoryInvariantViolationError(
        `Scenario '${s.title}' must declare at least one requirement revision reference`
      );
    }

    const scReqIds: RequirementRevisionId[] = [];
    for (const rId of s.requirementRevisionIds) {
      if (typeof rId !== 'string' || rId.trim().length === 0) {
        throw new StoryInvariantViolationError(
          `Scenario '${s.title}' requirement revision reference must not be empty`
        );
      }
      if (!storyReqSet.has(rId)) {
        throw new StoryInvariantViolationError(
          `Scenario '${s.title}' references requirement revision '${rId}' which is not in story requirement revisions`
        );
      }
      scReqIds.push(createRequirementRevisionId(rId));
    }

    let scPolicyIds: PolicyConstraintRevisionId[] | undefined;
    if (s.policyConstraintRevisionIds && s.policyConstraintRevisionIds.length > 0) {
      scPolicyIds = [];
      for (const pId of s.policyConstraintRevisionIds) {
        if (typeof pId !== 'string' || pId.trim().length === 0) {
          throw new StoryInvariantViolationError(
            `Scenario '${s.title}' policy constraint revision reference must not be empty`
          );
        }
        if (!storyPolicySet.has(pId)) {
          throw new StoryInvariantViolationError(
            `Scenario '${s.title}' references policy constraint revision '${pId}' which is not in story policy constraints`
          );
        }
        scPolicyIds.push(pId as PolicyConstraintRevisionId);
      }
    }

    scenarios.push(
      Object.freeze({
        id: s.id,
        title: s.title.trim(),
        requirementRevisionIds: Object.freeze(scReqIds),
        policyConstraintRevisionIds: scPolicyIds ? Object.freeze(scPolicyIds) : undefined,
        steps: Object.freeze(steps),
        rawText: s.rawText
      })
    );
  }

  if (
    !params.gherkinText ||
    typeof params.gherkinText !== 'string' ||
    params.gherkinText.trim().length === 0
  ) {
    throw new StoryInvariantViolationError('Story gherkinText must be a non-empty string');
  }

  const acceptanceCriteria =
    params.acceptanceCriteria && params.acceptanceCriteria.length > 0
      ? Object.freeze([...params.acceptanceCriteria])
      : Object.freeze(scenarios.map((s) => s.title));

  const createdAt = params.createdAt ?? now();

  return Object.freeze({
    id: storyId,
    baselineId,
    title,
    narrative,
    requirementRevisionIds: Object.freeze(storyReqIds),
    policyConstraintRevisionIds: storyPolicyIds ? Object.freeze(storyPolicyIds) : undefined,
    scenarios: Object.freeze(scenarios),
    acceptanceCriteria,
    gherkinText: params.gherkinText.trim(),
    createdAt
  });
}
