import {
  createPolicyConstraintId,
  createPolicyConstraintRevisionId,
  createPolicyConstraintRevision,
  DomainError,
  type PolicyConstraintRevision,
  type PolicyConstraintState
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../ports/persistence/IRequirementsRepository.js';
import {
  StaleRevisionTargetError,
  UnknownPolicyConstraintRevisionError
} from './ReconciliationErrors.js';

export interface RecordPolicyConstraintRevisionInput {
  readonly policyConstraintId: string;
  readonly statement: string;
  readonly authorityReference: string;
  readonly state?: PolicyConstraintState;
  readonly createdBy: string;
  readonly supersedes?: string;
}

export class RecordPolicyConstraintRevisionUseCase {
  constructor(private readonly repository: IRequirementsRepository) {}

  async execute(input: RecordPolicyConstraintRevisionInput): Promise<PolicyConstraintRevision> {
    if (
      typeof input.policyConstraintId !== 'string' ||
      input.policyConstraintId.trim().length === 0
    ) {
      throw new DomainError('Policy constraint ID must be a non-empty string');
    }
    if (typeof input.statement !== 'string' || input.statement.trim().length === 0) {
      throw new DomainError('Policy constraint statement must be a non-empty string');
    }
    if (
      typeof input.authorityReference !== 'string' ||
      input.authorityReference.trim().length === 0
    ) {
      throw new DomainError('Policy constraint authorityReference must be a non-empty string');
    }
    if (typeof input.createdBy !== 'string' || input.createdBy.trim().length === 0) {
      throw new DomainError('Policy constraint createdBy must be a non-empty string');
    }

    const policyConstraintId = createPolicyConstraintId(input.policyConstraintId.trim());
    const existingRevisions =
      await this.repository.listPolicyConstraintRevisions(policyConstraintId);
    const latestRevision =
      existingRevisions.length > 0 ? existingRevisions[existingRevisions.length - 1] : undefined;

    let revisionNumber: number;
    let supersedesRevId: ReturnType<typeof createPolicyConstraintRevisionId> | undefined;

    if (input.supersedes) {
      const supersedesTargetId = createPolicyConstraintRevisionId(input.supersedes.trim());
      const superseded = await this.repository.getPolicyConstraintRevision(supersedesTargetId);
      if (!superseded) {
        throw new UnknownPolicyConstraintRevisionError(supersedesTargetId);
      }
      if (superseded.policyConstraintId !== policyConstraintId) {
        throw new DomainError(
          `Superseded revision '${supersedesTargetId}' belongs to '${superseded.policyConstraintId}', not '${policyConstraintId}'`
        );
      }
      if (!latestRevision || latestRevision.id !== supersedesTargetId) {
        throw new StaleRevisionTargetError(supersedesTargetId, latestRevision?.id ?? 'none');
      }
      revisionNumber = superseded.revision + 1;
      supersedesRevId = superseded.id;
    } else {
      if (latestRevision) {
        revisionNumber = latestRevision.revision + 1;
        supersedesRevId = latestRevision.id;
      } else {
        revisionNumber = 1;
        supersedesRevId = undefined;
      }
    }

    const revision = createPolicyConstraintRevision({
      policyConstraintId,
      revision: revisionNumber,
      statement: input.statement.trim(),
      authorityReference: input.authorityReference.trim(),
      state: input.state,
      createdBy: input.createdBy.trim(),
      supersedes: supersedesRevId
    });

    await this.repository.savePolicyConstraintRevision(revision);

    return revision;
  }
}
