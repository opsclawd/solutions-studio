import {
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createPolicyConstraintRevisionId,
  createAuthorityBundle,
  type AuthorityBundle,
  type RequirementRevision,
  type PolicyConstraintRevision
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../ports/persistence/IRequirementsRepository.js';
import {
  UnknownRequirementsBaselineError,
  UnknownRequirementRevisionError,
  UnknownPolicyConstraintRevisionError
} from './ReconciliationErrors.js';

export interface GetAuthorityBundleInput {
  readonly baselineId: string;
}

export class GetAuthorityBundleUseCase {
  constructor(private readonly repository: IRequirementsRepository) {}

  async execute(input: GetAuthorityBundleInput): Promise<AuthorityBundle> {
    const baselineId = createRequirementsBaselineId(input.baselineId);
    const baseline = await this.repository.getRequirementsBaseline(baselineId);
    if (!baseline) {
      throw new UnknownRequirementsBaselineError(baselineId);
    }

    const requirements: RequirementRevision[] = [];
    for (const reqRevId of baseline.requirementRevisions) {
      const rev = await this.repository.getRequirementRevision(
        createRequirementRevisionId(reqRevId)
      );
      if (!rev) {
        throw new UnknownRequirementRevisionError(reqRevId);
      }
      requirements.push(rev);
    }

    const policyConstraints: PolicyConstraintRevision[] = [];
    for (const polRevId of baseline.policyConstraintRevisions ?? []) {
      const pol = await this.repository.getPolicyConstraintRevision(
        createPolicyConstraintRevisionId(polRevId)
      );
      if (!pol) {
        throw new UnknownPolicyConstraintRevisionError(polRevId);
      }
      policyConstraints.push(pol);
    }

    return createAuthorityBundle({
      baseline,
      requirements,
      policyConstraints
    });
  }
}
