import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { ApproveCandidateUseCase } from '../../../src/application/use-cases/governance/ApproveCandidateUseCase.js';
import { RecordValidationRunUseCase } from '../../../src/application/use-cases/governance/RecordValidationRunUseCase.js';
import { DefaultAuthorizationPolicy } from '../../../src/infrastructure/identity/DefaultAuthorizationPolicy.js';
import {
  createAuthenticatedActor,
  HumanActorRequiredForApprovalError,
  ValidationEvidenceMismatchError,
  UnknownValidationRunError
} from '@solutions-studio/domain';
import { OptimisticConcurrencyConflictError } from '../../../src/application/use-cases/ReconciliationErrors.js';

describe('ApproveCandidateUseCase', () => {
  let tmpDir: string;
  let repo: FilesystemRequirementsRepository;
  let authPolicy: DefaultAuthorizationPolicy;
  let approveUseCase: ApproveCandidateUseCase;
  let recordRunUseCase: RecordValidationRunUseCase;
  const candidateSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';

  const humanReviewer = createAuthenticatedActor({
    id: 'ACTOR-HUMAN-01',
    name: 'Alice Reviewer',
    email: 'alice@example.com',
    actorType: 'human',
    capabilities: ['candidate:approve']
  });

  const agentActor = createAuthenticatedActor({
    id: 'ACTOR-AGENT-01',
    name: 'Code Agent',
    actorType: 'agent',
    capabilities: ['candidate:approve'] // Even if capability is erroneously present
  });

  const humanWithoutCapability = createAuthenticatedActor({
    id: 'ACTOR-HUMAN-02',
    name: 'Bob Observer',
    email: 'bob@example.com',
    actorType: 'human',
    capabilities: []
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'approve-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tmpDir });
    authPolicy = new DefaultAuthorizationPolicy();
    approveUseCase = new ApproveCandidateUseCase(repo, authPolicy);
    recordRunUseCase = new RecordValidationRunUseCase(repo);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createSampleRun(executedAt?: string) {
    return recordRunUseCase.execute({
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
      executedBy: 'RUNNER-CI',
      executedAt: executedAt ? (executedAt as any) : undefined
    });
  }

  it('creates an active approval when authenticated human has candidate:approve capability', async () => {
    const run = await createSampleRun();

    const approval = await approveUseCase.execute({
      candidateSha,
      validationRunId: run.id,
      evidenceDigest: run.evidenceDigest,
      decision: 'GO',
      rationale: 'All exit gate invariants verified.',
      actor: humanReviewer
    });

    expect(approval.status).toBe('ACTIVE');
    expect(approval.decision).toBe('GO');
    expect(approval.actor.id).toBe(humanReviewer.id);
    expect(approval.actor.actorType).toBe('human');
  });

  it('strictly rejects non-human actor even if token has candidate:approve (Double-Defense Invariant)', async () => {
    const run = await createSampleRun();

    await expect(
      approveUseCase.execute({
        candidateSha,
        validationRunId: run.id,
        evidenceDigest: run.evidenceDigest,
        decision: 'GO',
        rationale: 'Agent simulated approval',
        actor: agentActor
      })
    ).rejects.toThrow(HumanActorRequiredForApprovalError);
  });

  it('rejects human actor without candidate:approve capability', async () => {
    const run = await createSampleRun();

    await expect(
      approveUseCase.execute({
        candidateSha,
        validationRunId: run.id,
        evidenceDigest: run.evidenceDigest,
        decision: 'GO',
        rationale: 'Reviewer without capability',
        actor: humanWithoutCapability
      })
    ).rejects.toThrow(/capability/i);
  });

  it('rejects approval when evidence digest does not match validation run digest', async () => {
    const run = await createSampleRun();

    await expect(
      approveUseCase.execute({
        candidateSha,
        validationRunId: run.id,
        evidenceDigest: 'f'.repeat(64), // Altered digest
        decision: 'GO',
        rationale: 'Approval with stale digest',
        actor: humanReviewer
      })
    ).rejects.toThrow(ValidationEvidenceMismatchError);
  });

  it('rejects approval for non-existent validation run', async () => {
    await expect(
      approveUseCase.execute({
        candidateSha,
        validationRunId: 'RUN-DOES-NOT-EXIST',
        evidenceDigest: 'a'.repeat(64),
        decision: 'GO',
        rationale: 'Ghost run approval',
        actor: humanReviewer
      })
    ).rejects.toThrow(UnknownValidationRunError);
  });

  it('atomically supersedes prior active approval when supersedes matches active approval', async () => {
    const run = await createSampleRun();

    const approval1 = await approveUseCase.execute({
      candidateSha,
      validationRunId: run.id,
      evidenceDigest: run.evidenceDigest,
      decision: 'GO',
      rationale: 'Initial sign-off',
      actor: humanReviewer
    });

    const approval2 = await approveUseCase.execute({
      candidateSha,
      validationRunId: run.id,
      evidenceDigest: run.evidenceDigest,
      decision: 'GO',
      rationale: 'Superseding sign-off with updated rationale',
      supersedes: approval1.id,
      actor: humanReviewer
    });

    expect(approval2.id).not.toBe(approval1.id);
    expect(approval2.status).toBe('ACTIVE');

    const reloaded1 = await repo.getGovernanceApproval(approval1.id);
    expect(reloaded1?.status).toBe('SUPERSEDED');

    const active = await repo.getActiveGovernanceApproval(candidateSha);
    expect(active?.id).toBe(approval2.id);
  });

  it('rejects second active approval if supersedes is not provided', async () => {
    const run = await createSampleRun();

    await approveUseCase.execute({
      candidateSha,
      validationRunId: run.id,
      evidenceDigest: run.evidenceDigest,
      decision: 'GO',
      rationale: 'First approval',
      actor: humanReviewer
    });

    await expect(
      approveUseCase.execute({
        candidateSha,
        validationRunId: run.id,
        evidenceDigest: run.evidenceDigest,
        decision: 'GO',
        rationale: 'Attempting conflicting active approval',
        actor: humanReviewer
      })
    ).rejects.toThrow(OptimisticConcurrencyConflictError);
  });

  it('rejects approval on a stale validation run when a newer validation run exists', async () => {
    const run1 = await createSampleRun('2026-09-20T09:00:00.000Z');
    // Create successor run
    await recordRunUseCase.execute({
      candidateSha,
      phase: 'phase-3',
      executionMode: 'deterministic-ci',
      provider: 'fake',
      artifacts: [
        {
          name: 'schema.sql',
          artifactType: 'sql-ddl',
          contentHash: 'b'.repeat(64)
        }
      ],
      proposedDisposition: 'GO',
      summary: { stepCount: 16 },
      executedBy: 'RUNNER-CI',
      executedAt: '2026-09-20T09:05:00.000Z' as any
    });

    // Attempt to approve run1 (stale run)
    await expect(
      approveUseCase.execute({
        candidateSha,
        validationRunId: run1.id,
        evidenceDigest: run1.evidenceDigest,
        decision: 'GO',
        rationale: 'Approving outdated run',
        actor: humanReviewer
      })
    ).rejects.toThrow(ValidationEvidenceMismatchError);
  });
});
