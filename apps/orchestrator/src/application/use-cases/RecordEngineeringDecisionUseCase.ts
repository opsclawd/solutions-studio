import { randomUUID } from 'node:crypto';
import {
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createPolicyConstraintRevisionId,
  createEngineeringDecisionId,
  createEngineeringDecision,
  DomainError,
  type EngineeringDecision
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../ports/persistence/IRequirementsRepository.js';
import {
  UnknownRequirementsBaselineError,
  UnknownEngineeringDecisionError
} from './ReconciliationErrors.js';

export interface RecordEngineeringDecisionInput {
  readonly id?: string;
  readonly baselineId: string;
  readonly statement: string;
  readonly rationale: string;
  readonly requirementRevisionIds?: readonly string[];
  readonly policyConstraintRevisionIds?: readonly string[];
  readonly createdBy: string;
  readonly supersedes?: string;
}

export class RecordEngineeringDecisionUseCase {
  constructor(private readonly repository: IRequirementsRepository) {}

  async execute(input: RecordEngineeringDecisionInput): Promise<EngineeringDecision> {
    const baselineId = createRequirementsBaselineId(input.baselineId);
    const baseline = await this.repository.getRequirementsBaseline(baselineId);
    if (!baseline) {
      throw new UnknownRequirementsBaselineError(baselineId);
    }

    const baselineReqSet = new Set(baseline.requirementRevisions);
    const reqRevisionIds = (input.requirementRevisionIds ?? []).map((id) =>
      createRequirementRevisionId(id)
    );
    for (const reqRevId of reqRevisionIds) {
      if (!baselineReqSet.has(reqRevId)) {
        throw new DomainError(
          `Linked requirement revision '${reqRevId}' is not part of baseline '${baselineId}'`
        );
      }
    }

    const baselinePolicySet = new Set(baseline.policyConstraintRevisions ?? []);
    const polRevisionIds = (input.policyConstraintRevisionIds ?? []).map((id) =>
      createPolicyConstraintRevisionId(id)
    );
    for (const polRevId of polRevisionIds) {
      if (!baselinePolicySet.has(polRevId)) {
        throw new DomainError(
          `Linked policy constraint revision '${polRevId}' is not part of baseline '${baselineId}'`
        );
      }
    }

    let supersedesId: ReturnType<typeof createEngineeringDecisionId> | undefined;
    if (input.supersedes) {
      supersedesId = createEngineeringDecisionId(input.supersedes);
      const superseded = await this.repository.getEngineeringDecision(supersedesId);
      if (!superseded) {
        throw new UnknownEngineeringDecisionError(supersedesId);
      }
    }

    const decisionId = input.id
      ? createEngineeringDecisionId(input.id)
      : createEngineeringDecisionId(`ED-${randomUUID()}`);

    // Non-authoritative starting state: forced to PROPOSED
    const decision = createEngineeringDecision({
      id: decisionId,
      baselineId,
      statement: input.statement,
      rationale: input.rationale,
      requirementRevisionIds: reqRevisionIds,
      policyConstraintRevisionIds: polRevisionIds,
      state: 'PROPOSED',
      createdBy: input.createdBy,
      supersedes: supersedesId
    });

    await this.repository.saveEngineeringDecision(decision);

    return decision;
  }
}
