import {
  createPolicyConstraintRevisionId,
  type PolicyConstraintRevision
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../ports/persistence/IRequirementsRepository.js';
import { UnknownPolicyConstraintRevisionError } from './ReconciliationErrors.js';

export interface GetPolicyConstraintRevisionInput {
  readonly revisionId: string;
}

export class GetPolicyConstraintRevisionUseCase {
  constructor(private readonly repository: IRequirementsRepository) {}

  async execute(input: GetPolicyConstraintRevisionInput): Promise<PolicyConstraintRevision> {
    const revId = createPolicyConstraintRevisionId(input.revisionId);
    const revision = await this.repository.getPolicyConstraintRevision(revId);
    if (!revision) {
      throw new UnknownPolicyConstraintRevisionError(revId);
    }
    return revision;
  }
}
