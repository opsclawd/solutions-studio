import type { GherkinValidationErrorDetails } from '../ports/validation/IGherkinValidatorGateway.js';

export class StoryProvenanceValidationError extends Error {
  constructor(
    message: string,
    public readonly baselineId: string,
    public readonly invalidRequirementRevisionIds?: readonly string[],
    public readonly allowedRequirementRevisionIds?: readonly string[],
    public readonly invalidPolicyConstraintRevisionIds?: readonly string[],
    public readonly allowedPolicyConstraintRevisionIds?: readonly string[]
  ) {
    super(message);
    this.name = 'StoryProvenanceValidationError';
  }
}

export class GherkinSyntaxValidationError extends Error {
  constructor(
    message: string,
    public readonly errorDetails?: readonly GherkinValidationErrorDetails[]
  ) {
    super(message);
    this.name = 'GherkinSyntaxValidationError';
  }
}

export class UnknownStoryError extends Error {
  constructor(public readonly storyId: string) {
    super(`Story '${storyId}' not found`);
    this.name = 'UnknownStoryError';
  }
}
