import type { RequirementId, RequirementRevisionId, ActorId } from './ids.js';
import type { EvidenceReference } from './EvidenceReference.js';
import type { RequirementCategory } from './Requirement.js';
import { REQUIREMENT_CATEGORIES } from './Requirement.js';
import type { RequirementOrigin } from './RequirementOrigin.js';
import { REQUIREMENT_ORIGINS } from './RequirementOrigin.js';
import type { RequirementReviewState } from './RequirementReviewState.js';
import { REQUIREMENT_REVIEW_STATES } from './RequirementReviewState.js';
import type { RequirementResolutionState } from './RequirementResolutionState.js';
import { REQUIREMENT_RESOLUTION_STATES } from './RequirementResolutionState.js';
import { DomainError, InvalidRevisionNumberError } from './errors.js';

export interface RequirementRevision {
  readonly id: RequirementRevisionId;
  readonly requirementId: RequirementId;
  readonly revision: number;
  readonly statement: string;
  readonly category: RequirementCategory;
  readonly origin: RequirementOrigin;
  readonly reviewState: RequirementReviewState;
  readonly resolutionState: RequirementResolutionState;
  readonly evidence: readonly EvidenceReference[];
  readonly rationale?: string;
  readonly affectedActors?: readonly ActorId[];
  readonly dependencies?: readonly RequirementId[];
  readonly supersedes?: RequirementRevisionId;
}

export function createRequirementRevision(params: {
  id: RequirementRevisionId;
  requirementId: RequirementId;
  revision: number;
  statement: string;
  category: RequirementCategory;
  origin: RequirementOrigin;
  reviewState?: RequirementReviewState;
  resolutionState?: RequirementResolutionState;
  evidence?: readonly EvidenceReference[];
  rationale?: string;
  affectedActors?: readonly ActorId[];
  dependencies?: readonly RequirementId[];
  supersedes?: RequirementRevisionId;
}): RequirementRevision {
  if (!Number.isInteger(params.revision) || params.revision < 1) {
    throw new InvalidRevisionNumberError(params.revision);
  }

  if (typeof params.statement !== 'string' || params.statement.trim().length === 0) {
    throw new DomainError('RequirementRevision statement must be a non-empty string');
  }

  if (!REQUIREMENT_CATEGORIES.includes(params.category)) {
    throw new DomainError(`Invalid RequirementCategory: '${String(params.category)}'`);
  }

  if (!REQUIREMENT_ORIGINS.includes(params.origin)) {
    throw new DomainError(`Invalid RequirementOrigin: '${String(params.origin)}'`);
  }

  const reviewState = params.reviewState ?? 'PENDING';
  if (!REQUIREMENT_REVIEW_STATES.includes(reviewState)) {
    throw new DomainError(`Invalid RequirementReviewState: '${String(reviewState)}'`);
  }

  const resolutionState = params.resolutionState ?? 'UNRESOLVED';
  if (!REQUIREMENT_RESOLUTION_STATES.includes(resolutionState)) {
    throw new DomainError(`Invalid RequirementResolutionState: '${String(resolutionState)}'`);
  }

  const evidence = Object.freeze(
    params.evidence
      ? params.evidence.map((ref) =>
          Object.freeze({
            sourceRevisionId: ref.sourceRevisionId,
            locator: ref.locator
          })
        )
      : []
  );

  const affectedActors = params.affectedActors
    ? Object.freeze([...params.affectedActors])
    : undefined;

  const dependencies = params.dependencies ? Object.freeze([...params.dependencies]) : undefined;

  return Object.freeze({
    id: params.id,
    requirementId: params.requirementId,
    revision: params.revision,
    statement: params.statement.trim(),
    category: params.category,
    origin: params.origin,
    reviewState,
    resolutionState,
    evidence,
    ...(params.rationale !== undefined ? { rationale: params.rationale } : {}),
    ...(affectedActors !== undefined ? { affectedActors } : {}),
    ...(dependencies !== undefined ? { dependencies } : {}),
    ...(params.supersedes !== undefined ? { supersedes: params.supersedes } : {})
  });
}

export function reviseRequirement(
  previous: RequirementRevision,
  changes: {
    id: RequirementRevisionId;
    statement?: string;
    category?: RequirementCategory;
    origin?: RequirementOrigin;
    reviewState?: RequirementReviewState;
    resolutionState?: RequirementResolutionState;
    evidence?: readonly EvidenceReference[];
    rationale?: string;
    affectedActors?: readonly ActorId[];
    dependencies?: readonly RequirementId[];
  }
): RequirementRevision {
  if (changes.id === previous.id) {
    throw new DomainError(
      `Successor revision ID cannot be identical to previous revision ID: '${changes.id}'`
    );
  }

  const statementChanged =
    changes.statement !== undefined && changes.statement.trim() !== previous.statement;
  const categoryChanged = changes.category !== undefined && changes.category !== previous.category;
  const originChanged = changes.origin !== undefined && changes.origin !== previous.origin;
  const evidenceChanged = changes.evidence !== undefined;

  const meaningOrProvenanceChanged =
    statementChanged || categoryChanged || originChanged || evidenceChanged;

  const reviewState =
    changes.reviewState ?? (meaningOrProvenanceChanged ? 'PENDING' : previous.reviewState);
  const resolutionState =
    changes.resolutionState ??
    (meaningOrProvenanceChanged ? 'UNRESOLVED' : previous.resolutionState);

  return createRequirementRevision({
    id: changes.id,
    requirementId: previous.requirementId,
    revision: previous.revision + 1,
    statement: changes.statement ?? previous.statement,
    category: changes.category ?? previous.category,
    origin: changes.origin ?? previous.origin,
    reviewState,
    resolutionState,
    evidence: changes.evidence ?? previous.evidence,
    rationale: changes.rationale !== undefined ? changes.rationale : previous.rationale,
    affectedActors: changes.affectedActors ?? previous.affectedActors,
    dependencies: changes.dependencies ?? previous.dependencies,
    supersedes: previous.id
  });
}
