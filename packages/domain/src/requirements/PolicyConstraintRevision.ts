import type { PolicyConstraintId, PolicyConstraintRevisionId, Instant } from './ids.js';
import { createPolicyConstraintRevisionId, now } from './ids.js';
import { DomainError, InvalidRevisionNumberError } from './errors.js';

export const POLICY_CONSTRAINT_STATES = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;
export type PolicyConstraintState = (typeof POLICY_CONSTRAINT_STATES)[number];

export interface PolicyConstraintRevision {
  readonly id: PolicyConstraintRevisionId;
  readonly policyConstraintId: PolicyConstraintId;
  readonly revision: number;
  readonly statement: string;
  readonly authorityReference: string;
  readonly state: PolicyConstraintState;
  readonly createdAt: Instant;
  readonly createdBy: string;
  readonly supersedes?: PolicyConstraintRevisionId;
}

export interface CreatePolicyConstraintRevisionParams {
  readonly id?: PolicyConstraintRevisionId;
  readonly policyConstraintId: PolicyConstraintId;
  readonly revision: number;
  readonly statement: string;
  readonly authorityReference: string;
  readonly state?: PolicyConstraintState;
  readonly createdAt?: Instant;
  readonly createdBy: string;
  readonly supersedes?: PolicyConstraintRevisionId;
}

export function createPolicyConstraintRevision(
  params: CreatePolicyConstraintRevisionParams
): PolicyConstraintRevision {
  if (!Number.isInteger(params.revision) || params.revision < 1) {
    throw new InvalidRevisionNumberError(params.revision);
  }
  if (typeof params.statement !== 'string' || params.statement.trim().length === 0) {
    throw new DomainError('Policy constraint revision statement must be a non-empty string');
  }
  if (
    typeof params.authorityReference !== 'string' ||
    params.authorityReference.trim().length === 0
  ) {
    throw new DomainError(
      'Policy constraint revision authorityReference must be a non-empty string'
    );
  }
  if (typeof params.createdBy !== 'string' || params.createdBy.trim().length === 0) {
    throw new DomainError('Policy constraint revision createdBy must be a non-empty string');
  }

  const state = params.state ?? 'ACCEPTED';
  if (!POLICY_CONSTRAINT_STATES.includes(state)) {
    throw new DomainError(`Invalid policy constraint state: '${state}'`);
  }

  const id =
    params.id ??
    createPolicyConstraintRevisionId(`${params.policyConstraintId}@r${params.revision}`);

  return Object.freeze({
    id,
    policyConstraintId: params.policyConstraintId,
    revision: params.revision,
    statement: params.statement.trim(),
    authorityReference: params.authorityReference.trim(),
    state,
    createdAt: params.createdAt ?? now(),
    createdBy: params.createdBy.trim(),
    supersedes: params.supersedes
  });
}

export function revisePolicyConstraint(
  previous: PolicyConstraintRevision,
  changes: {
    readonly statement?: string;
    readonly authorityReference?: string;
    readonly state?: PolicyConstraintState;
    readonly createdBy: string;
    readonly createdAt?: Instant;
  }
): PolicyConstraintRevision {
  const revision = previous.revision + 1;
  return createPolicyConstraintRevision({
    policyConstraintId: previous.policyConstraintId,
    revision,
    statement: changes.statement ?? previous.statement,
    authorityReference: changes.authorityReference ?? previous.authorityReference,
    state: changes.state ?? previous.state,
    createdBy: changes.createdBy,
    createdAt: changes.createdAt,
    supersedes: previous.id
  });
}
