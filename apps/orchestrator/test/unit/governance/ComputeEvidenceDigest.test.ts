import { describe, it, expect } from 'vitest';
import { computeEvidenceDigest } from '../../../src/application/use-cases/governance/ComputeEvidenceDigest.js';

describe('computeEvidenceDigest', () => {
  const candidateSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';
  const artifact1 = {
    name: 'schema.sql',
    artifactType: 'sql-ddl',
    contentHash: 'a'.repeat(64)
  };
  const artifact2 = {
    name: 'openapi.yaml',
    artifactType: 'openapi-spec',
    contentHash: 'b'.repeat(64)
  };

  it('computes deterministic SHA-256 evidence digest regardless of artifact insertion order', () => {
    const digest1 = computeEvidenceDigest({
      candidateSha,
      phase: 'phase-3',
      executionMode: 'deterministic-ci',
      artifacts: [artifact1, artifact2],
      summary: { total: 10, passed: 10 }
    });

    const digest2 = computeEvidenceDigest({
      candidateSha,
      phase: 'phase-3',
      executionMode: 'deterministic-ci',
      artifacts: [artifact2, artifact1],
      summary: { passed: 10, total: 10 }
    });

    expect(digest1).toHaveLength(64);
    expect(digest1).toMatch(/^[a-f0-9]{64}$/);
    expect(digest1).toBe(digest2);
  });

  it('produces a different digest if an artifact hash changes', () => {
    const digest1 = computeEvidenceDigest({
      candidateSha,
      phase: 'phase-3',
      executionMode: 'deterministic-ci',
      artifacts: [artifact1]
    });

    const modifiedArtifact = { ...artifact1, contentHash: 'c'.repeat(64) };
    const digest2 = computeEvidenceDigest({
      candidateSha,
      phase: 'phase-3',
      executionMode: 'deterministic-ci',
      artifacts: [modifiedArtifact]
    });

    expect(digest1).not.toBe(digest2);
  });

  it('does not produce identical digests for collision-prone artifact delimiters (Finding F-80787d01)', () => {
    const artifactA = {
      name: 'report|type:generated',
      artifactType: 'json',
      contentHash: 'd'.repeat(64)
    };
    const artifactB = {
      name: 'report',
      artifactType: 'generated|type:json',
      contentHash: 'd'.repeat(64)
    };

    const digestA = computeEvidenceDigest({
      candidateSha,
      phase: 'phase-3',
      executionMode: 'deterministic-ci',
      artifacts: [artifactA]
    });

    const digestB = computeEvidenceDigest({
      candidateSha,
      phase: 'phase-3',
      executionMode: 'deterministic-ci',
      artifacts: [artifactB]
    });

    expect(digestA).not.toBe(digestB);
  });
});
