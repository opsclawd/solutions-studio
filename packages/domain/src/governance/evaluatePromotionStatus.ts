import { now } from '../requirements/ids.js';
import type { Instant } from '../requirements/ids.js';
import type {
  CandidateSha,
  ValidationRunRecord,
  CandidateApprovalRecord,
  CandidatePromotionStatus
} from './GovernanceTypes.js';

export interface EvaluatePromotionStatusProps {
  readonly candidateSha: CandidateSha;
  readonly latestValidationRun?: ValidationRunRecord;
  readonly activeApproval?: CandidateApprovalRecord;
  readonly currentEvidenceDigest?: string;
  readonly evaluatedAt?: Instant;
}

export function evaluatePromotionStatus(
  props: EvaluatePromotionStatusProps
): CandidatePromotionStatus {
  const evaluatedAt = props.evaluatedAt ?? now();
  const { candidateSha, latestValidationRun, activeApproval } = props;

  // 1. Validation Run existence check
  if (!latestValidationRun) {
    return {
      candidateSha,
      isApproved: false,
      disposition: 'UNAPPROVED',
      diagnosticCode: 'NO_VALIDATION_RUN',
      message: `No validation run found for candidate SHA '${candidateSha}'. Candidate cannot be promoted without validation evidence.`,
      evaluatedAt
    };
  }

  // 2. Non-empty artifacts invariant check
  if (!latestValidationRun.artifacts || latestValidationRun.artifacts.length === 0) {
    return {
      candidateSha,
      isApproved: false,
      disposition: 'UNAPPROVED',
      diagnosticCode: 'EMPTY_EVIDENCE',
      message: `Validation run '${latestValidationRun.id}' contains empty evidence artifacts. Approval cannot bind to empty evidence.`,
      validationRun: latestValidationRun,
      evaluatedAt
    };
  }

  // 3. Active approval check
  if (!activeApproval) {
    return {
      candidateSha,
      isApproved: false,
      disposition: 'UNAPPROVED',
      diagnosticCode: 'AWAITING_APPROVAL',
      message: `Candidate SHA '${candidateSha}' has not been approved by an authenticated human reviewer. Candidate is awaiting approval.`,
      validationRun: latestValidationRun,
      evaluatedAt
    };
  }

  // 4. Candidate SHA matching
  if (activeApproval.candidateSha.toLowerCase() !== candidateSha.toLowerCase()) {
    return {
      candidateSha,
      isApproved: false,
      disposition: 'STALE_APPROVAL',
      diagnosticCode: 'CANDIDATE_SHA_MISMATCH',
      message: `Approval target candidate SHA '${activeApproval.candidateSha}' does not match evaluated candidate SHA '${candidateSha}'.`,
      validationRun: latestValidationRun,
      activeApproval,
      evaluatedAt
    };
  }

  // 5. Evidence Digest matching
  const expectedDigest = (
    props.currentEvidenceDigest ?? latestValidationRun.evidenceDigest
  ).toLowerCase();
  if (activeApproval.evidenceDigest.toLowerCase() !== expectedDigest) {
    return {
      candidateSha,
      isApproved: false,
      disposition: 'STALE_APPROVAL',
      diagnosticCode: 'EVIDENCE_DIGEST_MISMATCH',
      message: `Validation evidence changed after approval was granted. Approval digest '${activeApproval.evidenceDigest}' does not match current evidence digest '${expectedDigest}'.`,
      validationRun: latestValidationRun,
      activeApproval,
      evaluatedAt
    };
  }

  // 6. Validation Run Identity matching
  if (activeApproval.validationRunId !== latestValidationRun.id) {
    return {
      candidateSha,
      isApproved: false,
      disposition: 'STALE_APPROVAL',
      diagnosticCode: 'VALIDATION_RUN_MISMATCH',
      message: `Approval is bound to validation run '${activeApproval.validationRunId}', but current latest validation run is '${latestValidationRun.id}'. A new validation run requires independent human approval.`,
      validationRun: latestValidationRun,
      activeApproval,
      evaluatedAt
    };
  }

  // 7. Actor isolation check (must be human)
  if (activeApproval.actor.actorType !== 'human') {
    return {
      candidateSha,
      isApproved: false,
      disposition: 'UNAPPROVED',
      diagnosticCode: 'NON_HUMAN_ACTOR',
      message: `Approval record '${activeApproval.id}' was authored by non-human actor '${activeApproval.actor.id}'. Approvals require an authenticated human.`,
      validationRun: latestValidationRun,
      activeApproval,
      evaluatedAt
    };
  }

  // 7. Lifecycle status check
  if (activeApproval.status === 'REVOKED') {
    return {
      candidateSha,
      isApproved: false,
      disposition: 'UNAPPROVED',
      diagnosticCode: 'APPROVAL_REVOKED',
      message: `Approval '${activeApproval.id}' was revoked by ${activeApproval.revocation.revokedBy.name}: ${activeApproval.revocation.rationale}`,
      validationRun: latestValidationRun,
      activeApproval,
      evaluatedAt
    };
  }

  if (activeApproval.status === 'SUPERSEDED') {
    return {
      candidateSha,
      isApproved: false,
      disposition: 'UNAPPROVED',
      diagnosticCode: 'APPROVAL_SUPERSEDED',
      message: `Approval '${activeApproval.id}' has been superseded by a subsequent approval record.`,
      validationRun: latestValidationRun,
      activeApproval,
      evaluatedAt
    };
  }

  // 8. Human Decision check
  if (activeApproval.decision === 'DESIGN_CHANGE') {
    return {
      candidateSha,
      isApproved: false,
      disposition: 'DESIGN_CHANGE_REQUIRED',
      diagnosticCode: 'HUMAN_DESIGN_CHANGE_REQUESTED',
      message: `Human reviewer requested DESIGN CHANGE for candidate '${candidateSha}': ${activeApproval.rationale}`,
      validationRun: latestValidationRun,
      activeApproval,
      evaluatedAt
    };
  }

  // 9. Promotion Ready GO
  return {
    candidateSha,
    isApproved: true,
    disposition: 'APPROVED',
    diagnosticCode: 'PROMOTION_READY',
    message: `Candidate '${candidateSha}' is promotion-ready with active human GO approval from ${activeApproval.actor.name}.`,
    validationRun: latestValidationRun,
    activeApproval,
    evaluatedAt
  };
}
