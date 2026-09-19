import { EmptyIdentifierError, InvalidInstantError } from './errors.js';

export type SourceId = string & { readonly __brand: 'SourceId' };
export type SourceRevisionId = string & { readonly __brand: 'SourceRevisionId' };
export type RequirementId = string & { readonly __brand: 'RequirementId' };
export type RequirementRevisionId = string & { readonly __brand: 'RequirementRevisionId' };
export type FindingId = string & { readonly __brand: 'FindingId' };
export type RequirementsBaselineId = string & { readonly __brand: 'RequirementsBaselineId' };
export type PolicyConstraintId = string & { readonly __brand: 'PolicyConstraintId' };
export type PolicyConstraintRevisionId = string & {
  readonly __brand: 'PolicyConstraintRevisionId';
};
export type EngineeringDecisionId = string & { readonly __brand: 'EngineeringDecisionId' };
export type StoryId = string & { readonly __brand: 'StoryId' };
export type ActorId = string & { readonly __brand: 'ActorId' };
export type ReviewerId = string & { readonly __brand: 'ReviewerId' };
export type Instant = string & { readonly __brand: 'Instant' };

function assertNonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EmptyIdentifierError(name);
  }
  return value.trim();
}

export function createSourceId(value: string): SourceId {
  return assertNonEmpty(value, 'SourceId') as SourceId;
}

export function createSourceRevisionId(value: string): SourceRevisionId {
  return assertNonEmpty(value, 'SourceRevisionId') as SourceRevisionId;
}

export function createRequirementId(value: string): RequirementId {
  return assertNonEmpty(value, 'RequirementId') as RequirementId;
}

export function createRequirementRevisionId(value: string): RequirementRevisionId {
  return assertNonEmpty(value, 'RequirementRevisionId') as RequirementRevisionId;
}

export function createFindingId(value: string): FindingId {
  return assertNonEmpty(value, 'FindingId') as FindingId;
}

export function createRequirementsBaselineId(value: string): RequirementsBaselineId {
  return assertNonEmpty(value, 'RequirementsBaselineId') as RequirementsBaselineId;
}

export function createPolicyConstraintId(value: string): PolicyConstraintId {
  return assertNonEmpty(value, 'PolicyConstraintId') as PolicyConstraintId;
}

export function createPolicyConstraintRevisionId(value: string): PolicyConstraintRevisionId {
  return assertNonEmpty(value, 'PolicyConstraintRevisionId') as PolicyConstraintRevisionId;
}

export function createEngineeringDecisionId(value: string): EngineeringDecisionId {
  return assertNonEmpty(value, 'EngineeringDecisionId') as EngineeringDecisionId;
}

export function createStoryId(value: string): StoryId {
  return assertNonEmpty(value, 'StoryId') as StoryId;
}

export function createActorId(value: string): ActorId {
  return assertNonEmpty(value, 'ActorId') as ActorId;
}

export function createReviewerId(value: string): ReviewerId {
  return assertNonEmpty(value, 'ReviewerId') as ReviewerId;
}

export function isValidInstant(value: unknown): value is Instant {
  if (typeof value !== 'string') {
    return false;
  }
  // RFC 3339 / ISO-8601 instant format requiring Z or offset (+/-HH:MM)
  const match =
    /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
      value
    );
  if (!match) {
    return false;
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > daysInMonth[month - 1]) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

export function createInstant(isoString: string): Instant {
  const trimmed = assertNonEmpty(isoString, 'Instant');
  if (!isValidInstant(trimmed)) {
    throw new InvalidInstantError(trimmed);
  }
  return trimmed;
}

export function now(): Instant {
  return new Date().toISOString() as Instant;
}
