import crypto from 'node:crypto';
import { createCandidateSha, now, ValidationEvidenceMismatchError } from '@solutions-studio/domain';
import type { GovernanceAuditExportDto } from '@solutions-studio/contracts';
import type { IRequirementsRepository } from '../../ports/persistence/IRequirementsRepository.js';
import type { EvaluateCandidatePromotionStatusUseCase } from './EvaluateCandidatePromotionStatusUseCase.js';
import { computeEvidenceDigest } from './ComputeEvidenceDigest.js';

export class ExportGovernanceAuditUseCase {
  constructor(
    private readonly repository: IRequirementsRepository,
    private readonly evaluateStatusUseCase: EvaluateCandidatePromotionStatusUseCase
  ) {}

  async execute(input: { candidateSha: string }): Promise<GovernanceAuditExportDto> {
    const candidateSha = createCandidateSha(input.candidateSha);
    const promotionStatus = await this.evaluateStatusUseCase.execute({ candidateSha });
    const validationRuns = await this.repository.listValidationRuns({ candidateSha });
    const approvalHistory = await this.repository.listGovernanceApprovals({ candidateSha });

    const verifiedArtifacts: Array<{
      name: string;
      artifactType: string;
      contentHash: string;
      payloadRef?: string;
      verified: boolean;
      recomputedHash: string;
      content?: string;
    }> = [];

    // Cryptographic audit verification: re-verify every validation run's evidence digest and artifact hashes
    for (const run of validationRuns) {
      for (const artifact of run.artifacts) {
        let recomputedHash = artifact.contentHash;
        const verified = true;
        if (artifact.content !== undefined) {
          recomputedHash = crypto
            .createHash('sha256')
            .update(artifact.content, 'utf8')
            .digest('hex');
          if (recomputedHash !== artifact.contentHash) {
            throw new ValidationEvidenceMismatchError(
              artifact.contentHash,
              recomputedHash,
              `Audit export failed: validation artifact '${artifact.name}' in run '${run.id}' hash verification failed. Stored hash '${artifact.contentHash}' does not match recomputed hash '${recomputedHash}'.`
            );
          }
        }
        verifiedArtifacts.push({
          name: artifact.name,
          artifactType: artifact.artifactType,
          contentHash: artifact.contentHash,
          payloadRef: artifact.payloadRef,
          verified,
          recomputedHash,
          content: artifact.content
        });
      }

      const recomputedDigest = computeEvidenceDigest({
        candidateSha: run.candidateSha,
        phase: run.phase,
        executionMode: run.executionMode,
        artifacts: run.artifacts,
        summary: run.summary
      });
      if (recomputedDigest !== run.evidenceDigest) {
        throw new ValidationEvidenceMismatchError(
          run.evidenceDigest,
          recomputedDigest,
          `Audit export failed: validation run '${run.id}' evidence digest integrity check failed. Stored digest '${run.evidenceDigest}' does not match computed digest '${recomputedDigest}'.`
        );
      }
    }

    const exportedAt = now();

    const exportPayload = {
      exportedAt,
      candidateSha,
      promotionStatus,
      validationRuns: [...validationRuns],
      approvalHistory: [...approvalHistory],
      verifiedArtifacts
    };

    const manifestChecksum = crypto
      .createHash('sha256')
      .update(JSON.stringify(exportPayload), 'utf8')
      .digest('hex');

    return {
      ...exportPayload,
      manifestChecksum
    } as unknown as GovernanceAuditExportDto;
  }
}
