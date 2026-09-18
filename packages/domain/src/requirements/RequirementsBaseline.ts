import type {
  RequirementsBaselineId,
  RequirementRevisionId,
  RequirementId,
  ReviewerId,
  Instant
} from './ids.js';
import { now } from './ids.js';
import type { RequirementRevision } from './RequirementRevision.js';
import { InvalidBaselineMembershipError, EmptyBaselineError } from './errors.js';

export interface RequirementsBaseline {
  readonly id: RequirementsBaselineId;
  readonly requirementRevisions: readonly RequirementRevisionId[];
  readonly createdAt: Instant;
  readonly createdBy: ReviewerId;
}

export interface BaselineMembershipViolation {
  readonly revisionId: RequirementRevisionId;
  readonly requirementId: RequirementId;
  readonly reasons: readonly string[];
}

export function validateBaselineMembership(
  candidates: readonly RequirementRevision[]
): readonly BaselineMembershipViolation[] {
  const violations: BaselineMembershipViolation[] = [];
  const seenRequirementIds = new Map<RequirementId, RequirementRevisionId>();

  for (const candidate of candidates) {
    const reasons: string[] = [];

    // Rule 1: reviewState must be ACCEPTED
    if (candidate.reviewState !== 'ACCEPTED') {
      reasons.push(`Must have reviewState=ACCEPTED (actual: ${candidate.reviewState})`);
    }

    // Rule 2: resolutionState must be CLEAR
    if (candidate.resolutionState !== 'CLEAR') {
      reasons.push(`Must have resolutionState=CLEAR (actual: ${candidate.resolutionState})`);
    }

    // Rule 3: Provenance requirement:
    // EXPLICIT or INFERRED requirements must have evidence references.
    // ASSUMED, GENERATED_PROPOSAL, REVIEWER_PROPOSAL represent accepted assumptions/proposals,
    // which may not have direct source evidence references, but EXPLICIT/INFERRED must.
    if (
      (candidate.origin === 'EXPLICIT' || candidate.origin === 'INFERRED') &&
      candidate.evidence.length === 0
    ) {
      reasons.push(
        `Requirements with origin=${candidate.origin} must have at least one evidence reference`
      );
    }

    // Rule 4: Duplicate check - at most one revision per logical requirement in a baseline
    const previousRevision = seenRequirementIds.get(candidate.requirementId);
    if (previousRevision) {
      reasons.push(
        `Duplicate requirement in baseline: revision ${candidate.id} conflicts with previously included revision ${previousRevision} for requirement ${candidate.requirementId}`
      );
    } else {
      seenRequirementIds.set(candidate.requirementId, candidate.id);
    }

    if (reasons.length > 0) {
      violations.push({
        revisionId: candidate.id,
        requirementId: candidate.requirementId,
        reasons: Object.freeze(reasons)
      });
    }
  }

  return Object.freeze(violations);
}

export function createRequirementsBaseline(params: {
  id: RequirementsBaselineId;
  requirements: readonly RequirementRevision[];
  createdAt?: Instant;
  createdBy: ReviewerId;
}): RequirementsBaseline {
  if (!params.requirements || params.requirements.length === 0) {
    throw new EmptyBaselineError(
      'Cannot create requirements baseline: requirements list must not be empty'
    );
  }

  const violations = validateBaselineMembership(params.requirements);
  if (violations.length > 0) {
    throw new InvalidBaselineMembershipError(violations);
  }

  const createdAt = params.createdAt ?? now();
  const requirementRevisions = Object.freeze(params.requirements.map((r) => r.id));

  return Object.freeze({
    id: params.id,
    requirementRevisions,
    createdAt,
    createdBy: params.createdBy
  });
}
