import type { RequirementsBaseline } from './RequirementsBaseline.js';
import type { RequirementRevision } from './RequirementRevision.js';
import type { PolicyConstraintRevision } from './PolicyConstraintRevision.js';
import { DomainError } from './errors.js';

export interface AuthorityBundle {
  readonly baseline: RequirementsBaseline;
  readonly requirements: readonly RequirementRevision[];
  readonly policyConstraints: readonly PolicyConstraintRevision[];
}

export function createAuthorityBundle(params: {
  baseline: RequirementsBaseline;
  requirements: readonly RequirementRevision[];
  policyConstraints?: readonly PolicyConstraintRevision[];
}): AuthorityBundle {
  const requirements = params.requirements ?? [];
  const policyConstraints = params.policyConstraints ?? [];

  // Invariant 1: Exact set match for requirements
  const baselineReqIds = new Set(params.baseline.requirementRevisions);
  const bundleReqIds = new Set(requirements.map((r) => r.id));
  if (
    baselineReqIds.size !== bundleReqIds.size ||
    requirements.some((r) => !baselineReqIds.has(r.id))
  ) {
    throw new DomainError(
      'AuthorityBundle requirements must exactly match baseline requirementRevisions'
    );
  }

  // Invariant 2: Exact set match for policy constraints
  const baselinePolicyIds = new Set(params.baseline.policyConstraintRevisions ?? []);
  const bundlePolicyIds = new Set(policyConstraints.map((p) => p.id));
  if (
    baselinePolicyIds.size !== bundlePolicyIds.size ||
    policyConstraints.some((p) => !baselinePolicyIds.has(p.id))
  ) {
    throw new DomainError(
      'AuthorityBundle policyConstraints must exactly match baseline policyConstraintRevisions'
    );
  }

  // Invariant 3: Accepted authority validation
  for (const req of requirements) {
    if (req.reviewState !== 'ACCEPTED' || req.resolutionState !== 'CLEAR') {
      throw new DomainError(
        `Requirement revision ${req.id} in AuthorityBundle must have reviewState=ACCEPTED and resolutionState=CLEAR`
      );
    }
  }

  for (const pol of policyConstraints) {
    if (pol.state !== 'ACCEPTED') {
      throw new DomainError(
        `Policy constraint revision ${pol.id} in AuthorityBundle must have state=ACCEPTED`
      );
    }
  }

  return Object.freeze({
    baseline: params.baseline,
    requirements: Object.freeze([...requirements]),
    policyConstraints: Object.freeze([...policyConstraints])
  });
}
