import type {
  RequirementsBaselineId,
  RequirementRevisionId,
  RequirementId,
  PolicyConstraintRevisionId,
  PolicyConstraintId,
  ReviewerId,
  Instant
} from './ids.js';
import { now } from './ids.js';
import type { RequirementRevision } from './RequirementRevision.js';
import type { PolicyConstraintRevision } from './PolicyConstraintRevision.js';
import {
  InvalidBaselineMembershipError,
  EmptyBaselineError,
  type BaselineMembershipViolation as GenericBaselineMembershipViolation
} from './errors.js';

export interface RequirementsBaseline {
  readonly id: RequirementsBaselineId;
  readonly requirementRevisions: readonly RequirementRevisionId[];
  readonly policyConstraintRevisions: readonly PolicyConstraintRevisionId[];
  readonly createdAt: Instant;
  readonly createdBy: ReviewerId;
}

export type RequirementBaselineMembershipViolation = GenericBaselineMembershipViolation<
  RequirementRevisionId,
  RequirementId
>;

type BaselineMembershipViolation = RequirementBaselineMembershipViolation;

export type PolicyConstraintBaselineMembershipViolation = GenericBaselineMembershipViolation<
  PolicyConstraintRevisionId,
  PolicyConstraintId
>;

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

export function validatePolicyConstraintBaselineMembership(
  candidates: readonly PolicyConstraintRevision[]
): readonly PolicyConstraintBaselineMembershipViolation[] {
  const violations: PolicyConstraintBaselineMembershipViolation[] = [];
  const seenPolicyConstraintIds = new Map<PolicyConstraintId, PolicyConstraintRevisionId>();

  for (const candidate of candidates) {
    const reasons: string[] = [];

    // Rule 1: state must be ACCEPTED
    if (candidate.state !== 'ACCEPTED') {
      reasons.push(`Must have state=ACCEPTED (actual: ${candidate.state})`);
    }

    // Rule 2: non-empty authorityReference
    if (!candidate.authorityReference || candidate.authorityReference.trim().length === 0) {
      reasons.push('Policy constraint must have a non-empty authorityReference');
    }

    // Rule 3: Duplicate check - at most one revision per logical policy constraint in a baseline
    const previousRevision = seenPolicyConstraintIds.get(candidate.policyConstraintId);
    if (previousRevision) {
      reasons.push(
        `Duplicate policy constraint in baseline: revision ${candidate.id} conflicts with previously included revision ${previousRevision} for policy constraint ${candidate.policyConstraintId}`
      );
    } else {
      seenPolicyConstraintIds.set(candidate.policyConstraintId, candidate.id);
    }

    if (reasons.length > 0) {
      violations.push({
        revisionId: candidate.id,
        requirementId: candidate.policyConstraintId,
        reasons: Object.freeze(reasons)
      });
    }
  }

  return Object.freeze(violations);
}

export function createRequirementsBaseline(params: {
  id: RequirementsBaselineId;
  requirements: readonly RequirementRevision[];
  policyConstraints?: readonly PolicyConstraintRevision[];
  createdAt?: Instant;
  createdBy: ReviewerId;
}): RequirementsBaseline {
  if (!params.requirements || params.requirements.length === 0) {
    throw new EmptyBaselineError(
      'Cannot create requirements baseline: requirements list must not be empty'
    );
  }

  const reqViolations = validateBaselineMembership(params.requirements);
  const polViolations = params.policyConstraints
    ? validatePolicyConstraintBaselineMembership(params.policyConstraints)
    : [];

  const allViolations: readonly GenericBaselineMembershipViolation<string, string>[] = [
    ...reqViolations,
    ...polViolations
  ];

  if (allViolations.length > 0) {
    throw new InvalidBaselineMembershipError(allViolations);
  }

  const createdAt = params.createdAt ?? now();
  const requirementRevisions = Object.freeze(params.requirements.map((r) => r.id));
  const policyConstraintRevisions = Object.freeze(
    (params.policyConstraints ?? []).map((p) => p.id)
  );

  return Object.freeze({
    id: params.id,
    requirementRevisions,
    policyConstraintRevisions,
    createdAt,
    createdBy: params.createdBy
  });
}
