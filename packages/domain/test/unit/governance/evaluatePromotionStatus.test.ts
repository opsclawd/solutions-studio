import { describe, it, expect } from 'vitest';
import {
  evaluatePromotionStatus,
  createValidationRunRecord,
  createCandidateApprovalRecord,
  revokeCandidateApprovalRecord,
  supersedeCandidateApprovalRecord,
  createCandidateSha,
  createInstant,
  createActorId
} from '../../../src/index.js';

describe('evaluatePromotionStatus Domain Service', () => {
  const candidateSha = createCandidateSha('d5adf81ac2ba5acd7b7cd22c830f03e2258a63b4');
  const evidenceDigest = 'a'.repeat(64);
  const artifactHash = 'b'.repeat(64);

  const humanActor = {
    id: createActorId('ACTOR-001'),
    name: 'Ops Reviewer',
    email: 'ops@example.com',
    actorType: 'human' as const
  };

  const sampleRun = createValidationRunRecord({
    id: 'RUN-001',
    candidateSha,
    executedAt: createInstant('2026-09-20T09:00:00Z'),
    executedBy: createActorId('RUNNER-01'),
    phase: 'phase-3',
    executionMode: 'deterministic-ci',
    provider: 'fake',
    artifacts: [
      {
        name: 'openapi.yaml',
        artifactType: 'openapi-spec',
        contentHash: artifactHash
      }
    ],
    evidenceDigest,
    proposedDisposition: 'GO',
    summary: { testsPassed: true }
  });

  const sampleApproval = createCandidateApprovalRecord({
    id: 'APPR-001',
    candidateSha,
    validationRunId: 'RUN-001',
    evidenceDigest,
    decision: 'GO',
    actor: humanActor,
    decidedAt: createInstant('2026-09-20T10:00:00Z'),
    rationale: 'Validation passed successfully'
  });

  it('evaluates to APPROVED when active GO approval matches candidate and evidence', () => {
    const status = evaluatePromotionStatus({
      candidateSha,
      latestValidationRun: sampleRun,
      activeApproval: sampleApproval
    });

    expect(status.isApproved).toBe(true);
    expect(status.disposition).toBe('APPROVED');
    expect(status.diagnosticCode).toBe('PROMOTION_READY');
  });

  it('evaluates to UNAPPROVED (NO_VALIDATION_RUN) when no validation run exists', () => {
    const status = evaluatePromotionStatus({
      candidateSha,
      latestValidationRun: undefined,
      activeApproval: sampleApproval
    });

    expect(status.isApproved).toBe(false);
    expect(status.disposition).toBe('UNAPPROVED');
    expect(status.diagnosticCode).toBe('NO_VALIDATION_RUN');
  });

  it('evaluates to UNAPPROVED (AWAITING_APPROVAL) when no approval exists', () => {
    const status = evaluatePromotionStatus({
      candidateSha,
      latestValidationRun: sampleRun,
      activeApproval: undefined
    });

    expect(status.isApproved).toBe(false);
    expect(status.disposition).toBe('UNAPPROVED');
    expect(status.diagnosticCode).toBe('AWAITING_APPROVAL');
  });

  it('evaluates to STALE_APPROVAL (CANDIDATE_SHA_MISMATCH) when candidate SHA changes', () => {
    const differentSha = createCandidateSha('1111111ac2ba5acd7b7cd22c830f03e2258a63b4');
    const status = evaluatePromotionStatus({
      candidateSha: differentSha,
      latestValidationRun: sampleRun,
      activeApproval: sampleApproval
    });

    expect(status.isApproved).toBe(false);
    expect(status.disposition).toBe('STALE_APPROVAL');
    expect(status.diagnosticCode).toBe('CANDIDATE_SHA_MISMATCH');
  });

  it('evaluates to STALE_APPROVAL (EVIDENCE_DIGEST_MISMATCH) when evidence changes', () => {
    const alteredDigest = 'f'.repeat(64);
    const alteredRun = createValidationRunRecord({
      ...sampleRun,
      id: 'RUN-002',
      evidenceDigest: alteredDigest
    });

    const status = evaluatePromotionStatus({
      candidateSha,
      latestValidationRun: alteredRun,
      activeApproval: sampleApproval
    });

    expect(status.isApproved).toBe(false);
    expect(status.disposition).toBe('STALE_APPROVAL');
    expect(status.diagnosticCode).toBe('EVIDENCE_DIGEST_MISMATCH');
  });

  it('evaluates to UNAPPROVED (APPROVAL_REVOKED) when approval was revoked', () => {
    const revoked = revokeCandidateApprovalRecord(
      sampleApproval,
      humanActor,
      'Evidence invalidated post sign-off'
    );

    const status = evaluatePromotionStatus({
      candidateSha,
      latestValidationRun: sampleRun,
      activeApproval: revoked
    });

    expect(status.isApproved).toBe(false);
    expect(status.disposition).toBe('UNAPPROVED');
    expect(status.diagnosticCode).toBe('APPROVAL_REVOKED');
  });

  it('evaluates to UNAPPROVED (APPROVAL_SUPERSEDED) when approval was superseded', () => {
    const superseded = supersedeCandidateApprovalRecord(sampleApproval);

    const status = evaluatePromotionStatus({
      candidateSha,
      latestValidationRun: sampleRun,
      activeApproval: superseded
    });

    expect(status.isApproved).toBe(false);
    expect(status.disposition).toBe('UNAPPROVED');
    expect(status.diagnosticCode).toBe('APPROVAL_SUPERSEDED');
  });

  it('evaluates to DESIGN_CHANGE_REQUIRED when human reviewer chose DESIGN_CHANGE', () => {
    const designChangeApproval = createCandidateApprovalRecord({
      id: 'APPR-002',
      candidateSha,
      validationRunId: 'RUN-001',
      evidenceDigest,
      decision: 'DESIGN_CHANGE',
      actor: humanActor,
      decidedAt: createInstant('2026-09-20T10:00:00Z'),
      rationale: 'Payment edge case not handled in schema'
    });

    const status = evaluatePromotionStatus({
      candidateSha,
      latestValidationRun: sampleRun,
      activeApproval: designChangeApproval
    });

    expect(status.isApproved).toBe(false);
    expect(status.disposition).toBe('DESIGN_CHANGE_REQUIRED');
    expect(status.diagnosticCode).toBe('HUMAN_DESIGN_CHANGE_REQUESTED');
  });

  it('evaluates to STALE_APPROVAL (VALIDATION_RUN_MISMATCH) when successor validation run has same digest but different run ID', () => {
    const successorRun = createValidationRunRecord({
      ...sampleRun,
      id: 'RUN-002'
    });

    const status = evaluatePromotionStatus({
      candidateSha,
      latestValidationRun: successorRun,
      activeApproval: sampleApproval
    });

    expect(status.isApproved).toBe(false);
    expect(status.disposition).toBe('STALE_APPROVAL');
    expect(status.diagnosticCode).toBe('VALIDATION_RUN_MISMATCH');
  });
});
