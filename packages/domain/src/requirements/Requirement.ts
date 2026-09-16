import type { RequirementId } from './ids.js';

export const REQUIREMENT_CATEGORIES = [
  'actors-permissions',
  'business-rule',
  'lifecycle-state',
  'data-constraint',
  'integration',
  'failure-behavior',
  'exception',
  'nfr'
] as const;

export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

export interface Requirement {
  readonly id: RequirementId;
}

export function createRequirement(id: RequirementId): Requirement {
  return Object.freeze({
    id
  });
}
