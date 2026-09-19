import {
  createEngineeringDecisionId,
  createRequirementsBaselineId,
  type EngineeringDecision,
  type EngineeringDecisionState
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../ports/persistence/IRequirementsRepository.js';
import { UnknownEngineeringDecisionError } from './ReconciliationErrors.js';

export interface GetEngineeringDecisionsInput {
  readonly baselineId?: string;
  readonly state?: EngineeringDecisionState;
  readonly decisionId?: string;
}

export class GetEngineeringDecisionsUseCase {
  constructor(private readonly repository: IRequirementsRepository) {}

  async getById(decisionId: string): Promise<EngineeringDecision> {
    const id = createEngineeringDecisionId(decisionId);
    const decision = await this.repository.getEngineeringDecision(id);
    if (!decision) {
      throw new UnknownEngineeringDecisionError(id);
    }
    return decision;
  }

  async list(filter?: {
    baselineId?: string;
    state?: EngineeringDecisionState;
  }): Promise<readonly EngineeringDecision[]> {
    return this.repository.listEngineeringDecisions({
      baselineId: filter?.baselineId ? createRequirementsBaselineId(filter.baselineId) : undefined,
      state: filter?.state
    });
  }

  async execute(
    input: GetEngineeringDecisionsInput
  ): Promise<readonly EngineeringDecision[] | EngineeringDecision> {
    if (input.decisionId) {
      return this.getById(input.decisionId);
    }
    return this.list({
      baselineId: input.baselineId,
      state: input.state
    });
  }
}
