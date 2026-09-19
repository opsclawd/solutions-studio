import {
  createEngineeringDecisionId,
  transitionEngineeringDecision,
  type EngineeringDecision,
  type EngineeringDecisionState
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../ports/persistence/IRequirementsRepository.js';
import {
  UnknownEngineeringDecisionError,
  InvalidEngineeringDecisionStateError
} from './ReconciliationErrors.js';

export interface TransitionEngineeringDecisionInput {
  readonly decisionId: string;
  readonly newState: EngineeringDecisionState;
  readonly rationale: string;
  readonly actorId: string;
}

export class TransitionEngineeringDecisionUseCase {
  constructor(private readonly repository: IRequirementsRepository) {}

  async execute(input: TransitionEngineeringDecisionInput): Promise<EngineeringDecision> {
    const decisionId = createEngineeringDecisionId(input.decisionId);
    const existing = await this.repository.getEngineeringDecision(decisionId);
    if (!existing) {
      throw new UnknownEngineeringDecisionError(decisionId);
    }

    if (existing.state === input.newState) {
      throw new InvalidEngineeringDecisionStateError(
        `Engineering decision '${decisionId}' is already in state '${input.newState}'`
      );
    }

    const updated = transitionEngineeringDecision(existing, {
      newState: input.newState,
      rationale: input.rationale,
      actorId: input.actorId
    });

    await this.repository.updateEngineeringDecision(updated, existing.state);

    return updated;
  }
}
