import type { PolicyConstraintId } from './ids.js';

export interface PolicyConstraint {
  readonly id: PolicyConstraintId;
}

export function createPolicyConstraint(id: PolicyConstraintId): PolicyConstraint {
  return Object.freeze({
    id
  });
}
