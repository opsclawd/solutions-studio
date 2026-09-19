import type {
  EngineeringDecisionId,
  RequirementsBaselineId,
  RequirementRevisionId,
  PolicyConstraintRevisionId,
  ReviewerId,
  Instant
} from './ids.js';
import { createReviewerId, now } from './ids.js';
import { DomainError } from './errors.js';

export const ENGINEERING_DECISION_STATES = ['PROPOSED', 'ACCEPTED', 'REJECTED'] as const;
export type EngineeringDecisionState = (typeof ENGINEERING_DECISION_STATES)[number];

export interface EngineeringDecision {
  readonly id: EngineeringDecisionId;
  readonly baselineId: RequirementsBaselineId;
  readonly statement: string;
  readonly rationale: string;
  readonly requirementRevisionIds: readonly RequirementRevisionId[];
  readonly policyConstraintRevisionIds: readonly PolicyConstraintRevisionId[];
  readonly state: EngineeringDecisionState;
  readonly createdAt: Instant;
  readonly createdBy: string;
  readonly acceptedBy?: ReviewerId;
  readonly acceptedAt?: Instant;
  readonly supersedes?: EngineeringDecisionId;
  readonly transitionRationale?: string;
}

export interface CreateEngineeringDecisionParams {
  readonly id: EngineeringDecisionId;
  readonly baselineId: RequirementsBaselineId;
  readonly statement: string;
  readonly rationale: string;
  readonly requirementRevisionIds?: readonly RequirementRevisionId[];
  readonly policyConstraintRevisionIds?: readonly PolicyConstraintRevisionId[];
  readonly state?: EngineeringDecisionState;
  readonly createdAt?: Instant;
  readonly createdBy: string;
  readonly acceptedBy?: ReviewerId;
  readonly acceptedAt?: Instant;
  readonly supersedes?: EngineeringDecisionId;
  readonly transitionRationale?: string;
}

export function createEngineeringDecision(
  params: CreateEngineeringDecisionParams
): EngineeringDecision {
  if (typeof params.statement !== 'string' || params.statement.trim().length === 0) {
    throw new DomainError('Engineering decision statement must be a non-empty string');
  }
  if (typeof params.rationale !== 'string' || params.rationale.trim().length === 0) {
    throw new DomainError('Engineering decision rationale must be a non-empty string');
  }
  if (typeof params.createdBy !== 'string' || params.createdBy.trim().length === 0) {
    throw new DomainError('Engineering decision createdBy must be a non-empty string');
  }

  const state = params.state ?? 'PROPOSED';
  if (!ENGINEERING_DECISION_STATES.includes(state)) {
    throw new DomainError(`Invalid engineering decision state: '${state}'`);
  }

  if (state === 'ACCEPTED') {
    if (!params.acceptedBy) {
      throw new DomainError('Accepted engineering decision must specify acceptedBy');
    }
    if (!params.acceptedAt) {
      throw new DomainError('Accepted engineering decision must specify acceptedAt');
    }
  } else {
    if (params.acceptedBy !== undefined || params.acceptedAt !== undefined) {
      throw new DomainError(
        `Engineering decision in state '${state}' cannot have acceptedBy or acceptedAt set`
      );
    }
  }

  return Object.freeze({
    id: params.id,
    baselineId: params.baselineId,
    statement: params.statement.trim(),
    rationale: params.rationale.trim(),
    requirementRevisionIds: Object.freeze([...(params.requirementRevisionIds ?? [])]),
    policyConstraintRevisionIds: Object.freeze([...(params.policyConstraintRevisionIds ?? [])]),
    state,
    createdAt: params.createdAt ?? now(),
    createdBy: params.createdBy.trim(),
    acceptedBy: params.acceptedBy,
    acceptedAt: params.acceptedAt,
    supersedes: params.supersedes,
    transitionRationale: params.transitionRationale?.trim()
  });
}

export function isEngineeringDecisionAuthoritative(decision: EngineeringDecision): boolean {
  return decision.state === 'ACCEPTED';
}

export function transitionEngineeringDecision(
  decision: EngineeringDecision,
  params: {
    readonly newState: EngineeringDecisionState;
    readonly rationale: string;
    readonly actorId: ReviewerId | string;
    readonly transitionedAt?: Instant;
  }
): EngineeringDecision {
  if (!ENGINEERING_DECISION_STATES.includes(params.newState)) {
    throw new DomainError(`Invalid engineering decision state: '${params.newState}'`);
  }
  if (decision.state === params.newState) {
    throw new DomainError(
      `Engineering decision '${decision.id}' is already in state '${params.newState}'`
    );
  }
  if (typeof params.rationale !== 'string' || params.rationale.trim().length === 0) {
    throw new DomainError(
      'A non-empty rationale is required to transition an engineering decision'
    );
  }
  if (typeof params.actorId !== 'string' || params.actorId.trim().length === 0) {
    throw new DomainError(
      'An authorized actorId is required to transition an engineering decision'
    );
  }

  const acceptedBy = params.newState === 'ACCEPTED' ? createReviewerId(params.actorId) : undefined;
  const acceptedAt = params.newState === 'ACCEPTED' ? (params.transitionedAt ?? now()) : undefined;

  return Object.freeze({
    ...decision,
    state: params.newState,
    rationale: decision.rationale,
    transitionRationale: params.rationale.trim(),
    acceptedBy,
    acceptedAt
  });
}
