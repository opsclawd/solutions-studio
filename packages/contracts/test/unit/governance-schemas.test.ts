import { describe, it, expect } from 'vitest';
import {
  ValidationArtifactDtoSchema,
  ValidationRunRecordDtoSchema,
  CandidateApprovalRecordDtoSchema
} from '../../src/index.js';

describe('Governance Contracts Zod Schemas', () => {
  const validSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';
  const validDigest = 'a'.repeat(64);
  const artifactHash = 'b'.repeat(64);

  const humanActor = {
    id: 'ACTOR-001',
    name: 'Alice Human',
    email: 'alice@example.com',
    actorType: 'human' as const
  };

  it('validates a correct ValidationArtifactDto', () => {
    const parsed = ValidationArtifactDtoSchema.parse({
      name: 'orders.sql',
      artifactType: 'sql-ddl',
      contentHash: artifactHash
    });
    expect(parsed.name).toBe('orders.sql');
  });

  it('rejects an invalid ValidationArtifactDto with malformed hash', () => {
    expect(() =>
      ValidationArtifactDtoSchema.parse({
        name: 'orders.sql',
        artifactType: 'sql-ddl',
        contentHash: 'short-hash'
      })
    ).toThrow();
  });

  it('validates a correct ValidationRunRecordDto with non-empty artifacts', () => {
    const parsed = ValidationRunRecordDtoSchema.parse({
      id: 'RUN-001',
      candidateSha: validSha,
      executedAt: '2026-09-20T09:00:00Z',
      executedBy: 'RUNNER-01',
      phase: 'phase-3',
      executionMode: 'deterministic-ci',
      provider: 'fake',
      artifacts: [
        {
          name: 'orders.sql',
          artifactType: 'sql-ddl',
          contentHash: artifactHash
        }
      ],
      evidenceDigest: validDigest,
      summary: {}
    });
    expect(parsed.id).toBe('RUN-001');
  });

  it('rejects ValidationRunRecordDto with empty artifacts array', () => {
    expect(() =>
      ValidationRunRecordDtoSchema.parse({
        id: 'RUN-001',
        candidateSha: validSha,
        executedAt: '2026-09-20T09:00:00Z',
        executedBy: 'RUNNER-01',
        phase: 'phase-3',
        executionMode: 'deterministic-ci',
        provider: 'fake',
        artifacts: [],
        evidenceDigest: validDigest,
        summary: {}
      })
    ).toThrow(/at least one/i);
  });

  it('validates ACTIVE CandidateApprovalRecordDto without revocation', () => {
    const parsed = CandidateApprovalRecordDtoSchema.parse({
      id: 'APPR-001',
      candidateSha: validSha,
      validationRunId: 'RUN-001',
      evidenceDigest: validDigest,
      decision: 'GO',
      actor: humanActor,
      decidedAt: '2026-09-20T10:00:00Z',
      rationale: 'Looks good',
      status: 'ACTIVE'
    });
    expect(parsed.status).toBe('ACTIVE');
  });

  it('validates REVOKED CandidateApprovalRecordDto with required revocation', () => {
    const parsed = CandidateApprovalRecordDtoSchema.parse({
      id: 'APPR-001',
      candidateSha: validSha,
      validationRunId: 'RUN-001',
      evidenceDigest: validDigest,
      decision: 'GO',
      actor: humanActor,
      decidedAt: '2026-09-20T10:00:00Z',
      rationale: 'Looks good',
      status: 'REVOKED',
      revocation: {
        revokedAt: '2026-09-20T11:00:00Z',
        revokedBy: humanActor,
        rationale: 'Revoked due to security audit'
      }
    });
    expect(parsed.status).toBe('REVOKED');
  });

  it('rejects REVOKED CandidateApprovalRecordDto without revocation metadata', () => {
    expect(() =>
      CandidateApprovalRecordDtoSchema.parse({
        id: 'APPR-001',
        candidateSha: validSha,
        validationRunId: 'RUN-001',
        evidenceDigest: validDigest,
        decision: 'GO',
        actor: humanActor,
        decidedAt: '2026-09-20T10:00:00Z',
        rationale: 'Looks good',
        status: 'REVOKED'
      })
    ).toThrow();
  });

  it('rejects non-human actor in approval schema', () => {
    expect(() =>
      CandidateApprovalRecordDtoSchema.parse({
        id: 'APPR-001',
        candidateSha: validSha,
        validationRunId: 'RUN-001',
        evidenceDigest: validDigest,
        decision: 'GO',
        actor: {
          id: 'AGENT-01',
          name: 'Bot',
          actorType: 'agent'
        },
        decidedAt: '2026-09-20T10:00:00Z',
        rationale: 'Automated check passed',
        status: 'ACTIVE'
      })
    ).toThrow();
  });
});
