import crypto from 'node:crypto';
import {
  createValidationRunRecord,
  now,
  EmptyValidationArtifactsError,
  ValidationEvidenceMismatchError,
  type ValidationArtifact,
  type ValidationRunRecord,
  type GovernanceDecision,
  type ActorId,
  type Instant
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../../ports/persistence/IRequirementsRepository.js';
import { computeEvidenceDigest } from './ComputeEvidenceDigest.js';

export interface ValidationArtifactInput {
  readonly name: string;
  readonly artifactType: string;
  readonly contentHash?: string;
  readonly content?: string | Buffer;
  readonly payloadRef?: string;
}

export interface RecordValidationRunInput {
  readonly id?: string;
  readonly candidateSha: string;
  readonly phase: string;
  readonly executionMode: 'deterministic-ci' | 'real-provider';
  readonly provider: string;
  readonly model?: string;
  readonly artifacts: readonly ValidationArtifactInput[];
  readonly proposedDisposition?: GovernanceDecision;
  readonly summary?: Record<string, unknown>;
  readonly payloadRef?: string;
  readonly executedBy: ActorId | string;
  readonly executedAt?: Instant;
}

export class RecordValidationRunUseCase {
  constructor(private readonly repository: IRequirementsRepository) {}

  async execute(input: RecordValidationRunInput): Promise<ValidationRunRecord> {
    if (!input.artifacts || input.artifacts.length === 0) {
      throw new EmptyValidationArtifactsError();
    }

    const verifiedArtifacts: ValidationArtifact[] = input.artifacts.map((a) => {
      let resolvedHash = a.contentHash?.toLowerCase();
      if (a.content !== undefined) {
        const computed = crypto.createHash('sha256').update(a.content).digest('hex');
        if (resolvedHash && resolvedHash !== computed) {
          throw new ValidationEvidenceMismatchError(
            resolvedHash,
            computed,
            `Validation artifact '${a.name}' content hash mismatch: claimed '${resolvedHash}', computed '${computed}'.`
          );
        }
        resolvedHash = computed;
      }
      if (!resolvedHash || !/^[a-f0-9]{64}$/i.test(resolvedHash)) {
        throw new ValidationEvidenceMismatchError(
          '64-character SHA-256 hash',
          resolvedHash ?? 'undefined',
          `Validation artifact '${a.name}' is missing a valid 64-character SHA-256 contentHash or content.`
        );
      }
      return {
        name: a.name,
        artifactType: a.artifactType,
        contentHash: resolvedHash,
        payloadRef: a.payloadRef,
        content:
          a.content !== undefined
            ? typeof a.content === 'string'
              ? a.content
              : a.content.toString('utf8')
            : undefined
      };
    });

    const evidenceDigest = computeEvidenceDigest({
      candidateSha: input.candidateSha,
      phase: input.phase,
      executionMode: input.executionMode,
      artifacts: verifiedArtifacts,
      summary: input.summary
    });

    const runId = input.id ?? `RUN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const run = createValidationRunRecord({
      id: runId,
      candidateSha: input.candidateSha,
      executedAt: input.executedAt ?? now(),
      executedBy: input.executedBy,
      phase: input.phase,
      executionMode: input.executionMode,
      provider: input.provider,
      model: input.model,
      artifacts: verifiedArtifacts as unknown as readonly [
        ValidationArtifact,
        ...ValidationArtifact[]
      ],
      evidenceDigest,
      proposedDisposition: input.proposedDisposition,
      summary: input.summary,
      payloadRef: input.payloadRef
    });

    await this.repository.saveValidationRun(run);
    return run;
  }
}
