import {
  createCandidateSha,
  evaluatePromotionStatus,
  type CandidatePromotionStatus
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../../ports/persistence/IRequirementsRepository.js';

export class EvaluateCandidatePromotionStatusUseCase {
  constructor(private readonly repository: IRequirementsRepository) {}

  async execute(input: { candidateSha: string }): Promise<CandidatePromotionStatus> {
    const candidateSha = createCandidateSha(input.candidateSha);
    const latestValidationRun = await this.repository.getLatestValidationRun(candidateSha);
    let approval = await this.repository.getActiveGovernanceApproval(candidateSha);
    if (!approval) {
      const approvals = await this.repository.listGovernanceApprovals({ candidateSha });
      if (approvals.length > 0) {
        approval = approvals[0];
      }
    }

    return evaluatePromotionStatus({
      candidateSha,
      latestValidationRun,
      activeApproval: approval
    });
  }
}
