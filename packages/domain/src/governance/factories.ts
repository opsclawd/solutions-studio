import { now } from '../requirements/ids.js';
import type { ActorId, Instant } from '../requirements/ids.js';
import {
  EmptyValidationArtifactsError,
  HumanActorRequiredForApprovalError,
  InvalidGovernanceApprovalStateError
} from './errors.js';
import { createCandidateSha, createValidationRunId, createGovernanceApprovalId } from './ids.js';
import type {
  ValidationArtifact,
  ValidationRunRecord,
  ApprovalActor,
  ApprovalRevocation,
  ActiveCandidateApprovalRecord,
  SupersededCandidateApprovalRecord,
  RevokedCandidateApprovalRecord,
  CandidateApprovalRecord,
  GovernanceDecision
} from './GovernanceTypes.js';

export interface CreateValidationRunRecordProps {
  readonly id: string;
  readonly candidateSha: string;
  readonly executedAt: Instant;
  readonly executedBy: ActorId | string;
  readonly phase: string;
  readonly executionMode: 'deterministic-ci' | 'real-provider';
  readonly provider: string;
  readonly model?: string;
  readonly artifacts: readonly ValidationArtifact[];
  readonly evidenceDigest: string;
  readonly proposedDisposition?: GovernanceDecision;
  readonly summary?: Record<string, unknown>;
  readonly payloadRef?: string;
}

export function createValidationRunRecord(
  props: CreateValidationRunRecordProps
): ValidationRunRecord {
  if (!props.artifacts || props.artifacts.length === 0) {
    throw new EmptyValidationArtifactsError();
  }

  const validatedArtifacts = props.artifacts.map((a) => {
    if (!a.name || a.name.trim().length === 0) {
      throw new Error('ValidationArtifact name must not be empty');
    }
    if (!a.artifactType || a.artifactType.trim().length === 0) {
      throw new Error('ValidationArtifact artifactType must not be empty');
    }
    if (!a.contentHash || !/^[a-f0-9]{64}$/i.test(a.contentHash)) {
      throw new Error(
        `ValidationArtifact contentHash must be a valid 64-character SHA-256 hex string, got '${a.contentHash}'`
      );
    }
    return Object.freeze({
      name: a.name.trim(),
      artifactType: a.artifactType.trim(),
      contentHash: a.contentHash.toLowerCase(),
      payloadRef: a.payloadRef
    });
  });

  if (!props.evidenceDigest || !/^[a-f0-9]{64}$/i.test(props.evidenceDigest)) {
    throw new Error(
      `ValidationRunRecord evidenceDigest must be a valid 64-character SHA-256 hex string, got '${props.evidenceDigest}'`
    );
  }

  return Object.freeze({
    id: createValidationRunId(props.id),
    candidateSha: createCandidateSha(props.candidateSha),
    executedAt: props.executedAt,
    executedBy: props.executedBy as ActorId,
    phase: props.phase,
    executionMode: props.executionMode,
    provider: props.provider,
    model: props.model,
    artifacts: validatedArtifacts as unknown as readonly [
      ValidationArtifact,
      ...ValidationArtifact[]
    ],
    evidenceDigest: props.evidenceDigest.toLowerCase(),
    proposedDisposition: props.proposedDisposition,
    summary: Object.freeze({ ...(props.summary ?? {}) }),
    payloadRef: props.payloadRef
  });
}

export interface CreateCandidateApprovalRecordProps {
  readonly id: string;
  readonly candidateSha: string;
  readonly validationRunId: string;
  readonly evidenceDigest: string;
  readonly decision: GovernanceDecision;
  readonly actor: ApprovalActor;
  readonly decidedAt: Instant;
  readonly rationale: string;
  readonly supersedes?: string;
}

export function createCandidateApprovalRecord(
  props: CreateCandidateApprovalRecordProps
): ActiveCandidateApprovalRecord {
  if (props.actor.actorType !== 'human') {
    throw new HumanActorRequiredForApprovalError(
      `Actor '${props.actor.id}' of type '${props.actor.actorType}' cannot approve candidates. Only authenticated human actors are permitted.`
    );
  }

  if (!props.rationale || props.rationale.trim().length === 0) {
    throw new Error('Governance approval rationale must not be empty.');
  }

  if (!props.evidenceDigest || !/^[a-f0-9]{64}$/i.test(props.evidenceDigest)) {
    throw new Error(
      `CandidateApprovalRecord evidenceDigest must be a valid 64-character SHA-256 hex string, got '${props.evidenceDigest}'`
    );
  }

  return Object.freeze({
    id: createGovernanceApprovalId(props.id),
    candidateSha: createCandidateSha(props.candidateSha),
    validationRunId: createValidationRunId(props.validationRunId),
    evidenceDigest: props.evidenceDigest.toLowerCase(),
    decision: props.decision,
    actor: Object.freeze({
      id: props.actor.id,
      name: props.actor.name.trim(),
      email: props.actor.email?.trim() || undefined,
      actorType: 'human' as const
    }),
    decidedAt: props.decidedAt,
    rationale: props.rationale.trim(),
    supersedes: props.supersedes ? createGovernanceApprovalId(props.supersedes) : undefined,
    status: 'ACTIVE' as const,
    revocation: undefined
  });
}

export function revokeCandidateApprovalRecord(
  existing: CandidateApprovalRecord,
  revokedBy: ApprovalActor,
  rationale: string,
  revokedAt?: Instant
): RevokedCandidateApprovalRecord {
  if (existing.status !== 'ACTIVE') {
    throw new InvalidGovernanceApprovalStateError(existing.id, existing.status, 'revoke');
  }

  if (revokedBy.actorType !== 'human') {
    throw new HumanActorRequiredForApprovalError(
      `Actor '${revokedBy.id}' of type '${revokedBy.actorType}' cannot revoke approvals. Only authenticated human actors are permitted.`
    );
  }

  if (!rationale || rationale.trim().length === 0) {
    throw new Error('Revocation rationale must not be empty.');
  }

  const revocation: ApprovalRevocation = Object.freeze({
    revokedAt: revokedAt ?? now(),
    revokedBy: Object.freeze({
      id: revokedBy.id,
      name: revokedBy.name.trim(),
      email: revokedBy.email?.trim() || undefined,
      actorType: 'human' as const
    }),
    rationale: rationale.trim()
  });

  return Object.freeze({
    id: existing.id,
    candidateSha: existing.candidateSha,
    validationRunId: existing.validationRunId,
    evidenceDigest: existing.evidenceDigest,
    decision: existing.decision,
    actor: existing.actor,
    decidedAt: existing.decidedAt,
    rationale: existing.rationale,
    supersedes: existing.supersedes,
    status: 'REVOKED' as const,
    revocation
  });
}

export function supersedeCandidateApprovalRecord(
  existing: CandidateApprovalRecord
): SupersededCandidateApprovalRecord {
  if (existing.status !== 'ACTIVE') {
    throw new InvalidGovernanceApprovalStateError(existing.id, existing.status, 'supersede');
  }

  return Object.freeze({
    id: existing.id,
    candidateSha: existing.candidateSha,
    validationRunId: existing.validationRunId,
    evidenceDigest: existing.evidenceDigest,
    decision: existing.decision,
    actor: existing.actor,
    decidedAt: existing.decidedAt,
    rationale: existing.rationale,
    supersedes: existing.supersedes,
    status: 'SUPERSEDED' as const,
    revocation: undefined
  });
}
