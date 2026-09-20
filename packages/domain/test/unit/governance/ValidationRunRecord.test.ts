import { describe, it, expect } from 'vitest';
import {
  createValidationRunRecord,
  createInstant,
  createActorId,
  EmptyValidationArtifactsError
} from '../../../src/index.js';

describe('ValidationRunRecord Domain Entity', () => {
  const validSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';
  const validDigest = 'b'.repeat(64);
  const artifactHash = 'c'.repeat(64);

  it('creates an immutable validation run with verified artifacts', () => {
    const run = createValidationRunRecord({
      id: 'RUN-001',
      candidateSha: validSha,
      executedAt: createInstant('2026-09-20T09:00:00Z'),
      executedBy: createActorId('RUNNER-01'),
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
      proposedDisposition: 'GO',
      summary: { totalTests: 15, passedTests: 15 }
    });

    expect(run.id).toBe('RUN-001');
    expect(run.candidateSha).toBe(validSha);
    expect(run.artifacts).toHaveLength(1);
    expect(run.artifacts[0].name).toBe('orders.sql');
    expect(run.evidenceDigest).toBe(validDigest);
    expect(run.proposedDisposition).toBe('GO');
    expect(run.summary).toEqual({ totalTests: 15, passedTests: 15 });
  });

  it('enforces non-empty artifacts invariant (artifacts.length >= 1)', () => {
    expect(() =>
      createValidationRunRecord({
        id: 'RUN-002',
        candidateSha: validSha,
        executedAt: createInstant('2026-09-20T09:00:00Z'),
        executedBy: createActorId('RUNNER-01'),
        phase: 'phase-3',
        executionMode: 'deterministic-ci',
        provider: 'fake',
        artifacts: [],
        evidenceDigest: validDigest
      })
    ).toThrow(EmptyValidationArtifactsError);
  });

  it('rejects invalid artifact content hash', () => {
    expect(() =>
      createValidationRunRecord({
        id: 'RUN-003',
        candidateSha: validSha,
        executedAt: createInstant('2026-09-20T09:00:00Z'),
        executedBy: createActorId('RUNNER-01'),
        phase: 'phase-3',
        executionMode: 'deterministic-ci',
        provider: 'fake',
        artifacts: [
          {
            name: 'orders.sql',
            artifactType: 'sql-ddl',
            contentHash: 'not-a-sha'
          }
        ],
        evidenceDigest: validDigest
      })
    ).toThrow(/contentHash/i);
  });
});
