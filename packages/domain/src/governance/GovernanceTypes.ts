import type { ActorId, Instant } from '../requirements/ids.js';

export type CandidateSha = string & { readonly __brand: 'CandidateSha' };
export type ValidationRunId = string & { readonly __brand: 'ValidationRunId' };
export type GovernanceApprovalId = string & { readonly __brand: 'GovernanceApprovalId' };

export const GOVERNANCE_DECISIONS = ['GO', 'DESIGN_CHANGE'] as const;
export type GovernanceDecision = (typeof GOVERNANCE_DECISIONS)[number];

export const GOVERNANCE_APPROVAL_STATUSES = ['ACTIVE', 'SUPERSEDED', 'REVOKED'] as const;
export type GovernanceApprovalStatus = (typeof GOVERNANCE_APPROVAL_STATUSES)[number];

export const PROMOTION_DISPOSITIONS = [
  'APPROVED',
  'UNAPPROVED',
  'STALE_APPROVAL',
  'DESIGN_CHANGE_REQUIRED'
] as const;
export type PromotionDisposition = (typeof PROMOTION_DISPOSITIONS)[number];

export const PROMOTION_DIAGNOSTIC_CODES = [
  'NO_VALIDATION_RUN',
  'EMPTY_EVIDENCE',
  'AWAITING_APPROVAL',
  'CANDIDATE_SHA_MISMATCH',
  'EVIDENCE_DIGEST_MISMATCH',
  'VALIDATION_RUN_MISMATCH',
  'NON_HUMAN_ACTOR',
  'APPROVAL_REVOKED',
  'APPROVAL_SUPERSEDED',
  'HUMAN_DESIGN_CHANGE_REQUESTED',
  'PROMOTION_READY'
] as const;
export type PromotionDiagnosticCode = (typeof PROMOTION_DIAGNOSTIC_CODES)[number];

export interface ValidationArtifact {
  readonly name: string;
  readonly artifactType: string;
  readonly contentHash: string; // SHA-256 hex string (64 characters)
  readonly payloadRef?: string;
  readonly content?: string;
}

export interface ValidationRunRecord {
  readonly id: ValidationRunId;
  readonly candidateSha: CandidateSha;
  readonly executedAt: Instant;
  readonly executedBy: ActorId;
  readonly phase: string;
  readonly executionMode: 'deterministic-ci' | 'real-provider';
  readonly provider: string;
  readonly model?: string;
  readonly artifacts: readonly [ValidationArtifact, ...ValidationArtifact[]]; // Invariant: length >= 1
  readonly evidenceDigest: string; // Composite SHA-256
  readonly proposedDisposition?: GovernanceDecision;
  readonly summary: Record<string, unknown>;
  readonly payloadRef?: string;
}

export interface ApprovalActor {
  readonly id: ActorId;
  readonly name: string;
  readonly email?: string;
  readonly actorType: 'human';
}

export interface ApprovalRevocation {
  readonly revokedAt: Instant;
  readonly revokedBy: ApprovalActor;
  readonly rationale: string;
}

interface BaseCandidateApprovalRecord {
  readonly id: GovernanceApprovalId;
  readonly candidateSha: CandidateSha;
  readonly validationRunId: ValidationRunId;
  readonly evidenceDigest: string;
  readonly decision: GovernanceDecision;
  readonly actor: ApprovalActor;
  readonly decidedAt: Instant;
  readonly rationale: string;
  readonly supersedes?: GovernanceApprovalId;
}

export interface ActiveCandidateApprovalRecord extends BaseCandidateApprovalRecord {
  readonly status: 'ACTIVE';
  readonly revocation?: undefined;
}

export interface SupersededCandidateApprovalRecord extends BaseCandidateApprovalRecord {
  readonly status: 'SUPERSEDED';
  readonly revocation?: undefined;
}

export interface RevokedCandidateApprovalRecord extends BaseCandidateApprovalRecord {
  readonly status: 'REVOKED';
  readonly revocation: ApprovalRevocation;
}

export type CandidateApprovalRecord =
  | ActiveCandidateApprovalRecord
  | SupersededCandidateApprovalRecord
  | RevokedCandidateApprovalRecord;

export interface CandidatePromotionStatus {
  readonly candidateSha: CandidateSha;
  readonly isApproved: boolean;
  readonly disposition: PromotionDisposition;
  readonly diagnosticCode: PromotionDiagnosticCode;
  readonly message: string;
  readonly validationRun?: ValidationRunRecord;
  readonly activeApproval?: CandidateApprovalRecord;
  readonly evaluatedAt: Instant;
}
