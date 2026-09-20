import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { EvaluateCandidatePromotionStatusUseCase } from '../../../src/application/use-cases/governance/EvaluateCandidatePromotionStatusUseCase.js';
import { RecordValidationRunUseCase } from '../../../src/application/use-cases/governance/RecordValidationRunUseCase.js';
import { ApproveCandidateUseCase } from '../../../src/application/use-cases/governance/ApproveCandidateUseCase.js';
import { DefaultAuthorizationPolicy } from '../../../src/infrastructure/identity/DefaultAuthorizationPolicy.js';
import { createAuthenticatedActor } from '@solutions-studio/domain';

describe('EvaluateCandidatePromotionStatusUseCase', () => {
  let tmpDir: string;
  let repo: FilesystemRequirementsRepository;
  let authPolicy: DefaultAuthorizationPolicy;
  let statusUseCase: EvaluateCandidatePromotionStatusUseCase;
  let approveUseCase: ApproveCandidateUseCase;
  let recordRunUseCase: RecordValidationRunUseCase;
  const candidateSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';

  const humanReviewer = createAuthenticatedActor({
    id: 'ACTOR-HUMAN-01',
    name: 'Alice Reviewer',
    actorType: 'human',
    capabilities: ['candidate:approve']
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'status-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tmpDir });
    authPolicy = new DefaultAuthorizationPolicy();
    statusUseCase = new EvaluateCandidatePromotionStatusUseCase(repo);
    approveUseCase = new ApproveCandidateUseCase(repo, authPolicy);
    recordRunUseCase = new RecordValidationRunUseCase(repo);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('evaluates status to APPROVED when valid human GO approval exists', async () => {
    const run = await recordRunUseCase.execute({
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
      executedBy: 'RUNNER-CI'
    });

    await approveUseCase.execute({
      candidateSha,
      validationRunId: run.id,
      evidenceDigest: run.evidenceDigest,
      decision: 'GO',
      rationale: 'Looks ready for production',
      actor: humanReviewer
    });

    const status = await statusUseCase.execute({ candidateSha });
    expect(status.isApproved).toBe(true);
    expect(status.disposition).toBe('APPROVED');
    expect(status.diagnosticCode).toBe('PROMOTION_READY');
  });

  it('evaluates status to UNAPPROVED (AWAITING_APPROVAL) when run exists but no approval created', async () => {
    await recordRunUseCase.execute({
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
      executedBy: 'RUNNER-CI'
    });

    const status = await statusUseCase.execute({ candidateSha });
    expect(status.isApproved).toBe(false);
    expect(status.disposition).toBe('UNAPPROVED');
    expect(status.diagnosticCode).toBe('AWAITING_APPROVAL');
  });
});
