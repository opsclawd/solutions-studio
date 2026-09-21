import { describe, it, expect } from 'vitest';
import {
  createCandidateApprovalRecord,
  revokeCandidateApprovalRecord,
  supersedeCandidateApprovalRecord,
  createInstant,
  createActorId,
  HumanActorRequiredForApprovalError,
  InvalidGovernanceApprovalStateError
} from '../../../src/index.js';

describe('CandidateApprovalRecord Domain Entity', () => {
  const validSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';
  const validDigest = 'a'.repeat(64);
  const humanActor = {
    id: createActorId('ACTOR-001'),
    name: 'Alice Reviewer',
    email: 'alice@example.com',
    actorType: 'human' as const
  };

  it('creates an active approval record bound to candidate SHA and evidence digest', () => {
    const approval = createCandidateApprovalRecord({
      id: 'APPR-001',
      candidateSha: validSha,
      validationRunId: 'RUN-001',
      evidenceDigest: validDigest,
      decision: 'GO',
      actor: humanActor,
      decidedAt: createInstant('2026-09-20T10:00:00Z'),
      rationale: 'All exit-gate criteria verified independently.'
    });

    expect(approval.id).toBe('APPR-001');
    expect(approval.candidateSha).toBe(validSha);
    expect(approval.validationRunId).toBe('RUN-001');
    expect(approval.evidenceDigest).toBe(validDigest);
    expect(approval.decision).toBe('GO');
    expect(approval.status).toBe('ACTIVE');
    expect(approval.revocation).toBeUndefined();
    expect(approval.actor.name).toBe('Alice Reviewer');
  });

  it('rejects approval creation when actor is non-human (Agent Isolation Invariant)', () => {
    expect(() =>
      createCandidateApprovalRecord({
        id: 'APPR-002',
        candidateSha: validSha,
        validationRunId: 'RUN-001',
        evidenceDigest: validDigest,
        decision: 'GO',
        actor: {
          id: createActorId('AGENT-BOT'),
          name: 'Automated Agent',
          actorType: 'agent' as unknown as 'human'
        },
        decidedAt: createInstant('2026-09-20T10:00:00Z'),
        rationale: 'Bot simulated sign-off'
      })
    ).toThrow(HumanActorRequiredForApprovalError);
  });

  it('rejects empty rationale', () => {
    expect(() =>
      createCandidateApprovalRecord({
        id: 'APPR-003',
        candidateSha: validSha,
        validationRunId: 'RUN-001',
        evidenceDigest: validDigest,
        decision: 'GO',
        actor: humanActor,
        decidedAt: createInstant('2026-09-20T10:00:00Z'),
        rationale: '   '
      })
    ).toThrow(/rationale/i);
  });

  it('transitions active approval to REVOKED with mandatory revocation metadata', () => {
    const approval = createCandidateApprovalRecord({
      id: 'APPR-004',
      candidateSha: validSha,
      validationRunId: 'RUN-001',
      evidenceDigest: validDigest,
      decision: 'GO',
      actor: humanActor,
      decidedAt: createInstant('2026-09-20T10:00:00Z'),
      rationale: 'Approved initially'
    });

    const revoked = revokeCandidateApprovalRecord(
      approval,
      humanActor,
      'Flaw discovered in test suite after sign-off',
      createInstant('2026-09-20T11:00:00Z')
    );

    expect(revoked.status).toBe('REVOKED');
    expect(revoked.revocation).toBeDefined();
    expect(revoked.revocation.rationale).toBe('Flaw discovered in test suite after sign-off');
    expect(revoked.revocation.revokedBy.name).toBe('Alice Reviewer');
  });

  it('rejects revoking an already revoked approval', () => {
    const approval = createCandidateApprovalRecord({
      id: 'APPR-005',
      candidateSha: validSha,
      validationRunId: 'RUN-001',
      evidenceDigest: validDigest,
      decision: 'GO',
      actor: humanActor,
      decidedAt: createInstant('2026-09-20T10:00:00Z'),
      rationale: 'Approved initially'
    });

    const revoked = revokeCandidateApprovalRecord(approval, humanActor, 'First revocation');

    expect(() => revokeCandidateApprovalRecord(revoked, humanActor, 'Second revocation')).toThrow(
      InvalidGovernanceApprovalStateError
    );
  });

  it('transitions active approval to SUPERSEDED', () => {
    const approval = createCandidateApprovalRecord({
      id: 'APPR-006',
      candidateSha: validSha,
      validationRunId: 'RUN-001',
      evidenceDigest: validDigest,
      decision: 'GO',
      actor: humanActor,
      decidedAt: createInstant('2026-09-20T10:00:00Z'),
      rationale: 'Approved initially'
    });

    const superseded = supersedeCandidateApprovalRecord(approval);
    expect(superseded.status).toBe('SUPERSEDED');
    expect(superseded.revocation).toBeUndefined();
  });
});
