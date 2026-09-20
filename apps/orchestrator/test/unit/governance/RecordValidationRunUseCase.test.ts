import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { RecordValidationRunUseCase } from '../../../src/application/use-cases/governance/RecordValidationRunUseCase.js';
import { EmptyValidationArtifactsError } from '@solutions-studio/domain';

describe('RecordValidationRunUseCase', () => {
  let tmpDir: string;
  let repo: FilesystemRequirementsRepository;
  let useCase: RecordValidationRunUseCase;
  const candidateSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'val-run-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tmpDir });
    useCase = new RecordValidationRunUseCase(repo);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('records validation run with calculated evidence digest and persists to repository', async () => {
    const run = await useCase.execute({
      candidateSha,
      phase: 'phase-3',
      executionMode: 'deterministic-ci',
      provider: 'fake',
      artifacts: [
        {
          name: 'schema.sql',
          artifactType: 'sql-ddl',
          contentHash: 'a'.repeat(64)
        }
      ],
      proposedDisposition: 'GO',
      summary: { stepCount: 15 },
      executedBy: 'RUNNER-CI'
    });

    expect(run.id).toBeDefined();
    expect(run.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(run.proposedDisposition).toBe('GO');

    const fetched = await repo.getValidationRun(run.id);
    expect(fetched).toBeDefined();
    expect(fetched?.evidenceDigest).toBe(run.evidenceDigest);
  });

  it('rejects recording a run with empty evidence artifacts', async () => {
    await expect(
      useCase.execute({
        candidateSha,
        phase: 'phase-3',
        executionMode: 'deterministic-ci',
        provider: 'fake',
        artifacts: [],
        executedBy: 'RUNNER-CI'
      })
    ).rejects.toThrow(EmptyValidationArtifactsError);
  });

  it('verifies artifact content and rejects when contentHash does not match content', async () => {
    const rawSql = 'CREATE TABLE orders (id VARCHAR PRIMARY KEY);';
    const wrongHash = 'b'.repeat(64);

    await expect(
      useCase.execute({
        candidateSha,
        phase: 'phase-3',
        executionMode: 'deterministic-ci',
        provider: 'fake',
        artifacts: [
          {
            name: 'orders.sql',
            artifactType: 'sql-ddl',
            contentHash: wrongHash,
            content: rawSql
          }
        ],
        executedBy: 'RUNNER-CI'
      })
    ).rejects.toThrow(/content hash mismatch/i);
  });

  it('computes artifact contentHash automatically when content is provided', async () => {
    const rawSql = 'CREATE TABLE orders (id VARCHAR PRIMARY KEY);';
    const expectedHash = crypto.createHash('sha256').update(rawSql).digest('hex');

    const run = await useCase.execute({
      candidateSha,
      phase: 'phase-3',
      executionMode: 'deterministic-ci',
      provider: 'fake',
      artifacts: [
        {
          name: 'orders.sql',
          artifactType: 'sql-ddl',
          content: rawSql
        }
      ],
      executedBy: 'RUNNER-CI'
    });

    expect(run.artifacts[0].contentHash).toBe(expectedHash);
  });
});
