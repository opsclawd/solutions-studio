import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { RevokeGovernanceApprovalUseCase } from '../../../src/application/use-cases/governance/RevokeGovernanceApprovalUseCase.js';
import { ApproveCandidateUseCase } from '../../../src/application/use-cases/governance/ApproveCandidateUseCase.js';
import { RecordValidationRunUseCase } from '../../../src/application/use-cases/governance/RecordValidationRunUseCase.js';
import { DefaultAuthorizationPolicy } from '../../../src/infrastructure/identity/DefaultAuthorizationPolicy.js';
import {
  createAuthenticatedActor,
  HumanActorRequiredForApprovalError,
  InvalidGovernanceApprovalStateError
} from '@solutions-studio/domain';

describe('RevokeGovernanceApprovalUseCase', () => {
  let tmpDir: string;
  let repo: FilesystemRequirementsRepository;
  let authPolicy: DefaultAuthorizationPolicy;
  let revokeUseCase: RevokeGovernanceApprovalUseCase;
  let approveUseCase: ApproveCandidateUseCase;
  let recordRunUseCase: RecordValidationRunUseCase;
  const candidateSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';

  const humanReviewer = createAuthenticatedActor({
    id: 'ACTOR-HUMAN-01',
    name: 'Alice Reviewer',
    actorType: 'human',
    capabilities: ['candidate:approve']
  });

  const agentActor = createAuthenticatedActor({
    id: 'ACTOR-AGENT-01',
    name: 'Revoke Bot',
    actorType: 'agent',
    capabilities: ['candidate:approve']
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'revoke-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tmpDir });
    authPolicy = new DefaultAuthorizationPolicy();
    revokeUseCase = new RevokeGovernanceApprovalUseCase(repo, authPolicy);
    approveUseCase = new ApproveCandidateUseCase(repo, authPolicy);
    recordRunUseCase = new RecordValidationRunUseCase(repo);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('revokes active approval and records attribution and rationale', async () => {
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

    const approval = await approveUseCase.execute({
      candidateSha,
      validationRunId: run.id,
      evidenceDigest: run.evidenceDigest,
      decision: 'GO',
      rationale: 'Initial sign-off',
      actor: humanReviewer
    });

    const revoked = await revokeUseCase.execute({
      approvalId: approval.id,
      rationale: 'Post-approval regression found in security scan',
      actor: humanReviewer
    });

    expect(revoked.status).toBe('REVOKED');
    expect(revoked.revocation.rationale).toBe('Post-approval regression found in security scan');
    expect(revoked.revocation.revokedBy.id).toBe(humanReviewer.id);

    const reloaded = await repo.getGovernanceApproval(approval.id);
    expect(reloaded?.status).toBe('REVOKED');
  });

  it('rejects revocation by automated agent', async () => {
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

    const approval = await approveUseCase.execute({
      candidateSha,
      validationRunId: run.id,
      evidenceDigest: run.evidenceDigest,
      decision: 'GO',
      rationale: 'Initial sign-off',
      actor: humanReviewer
    });

    await expect(
      revokeUseCase.execute({
        approvalId: approval.id,
        rationale: 'Automated revoke',
        actor: agentActor
      })
    ).rejects.toThrow(HumanActorRequiredForApprovalError);
  });

  it('rejects revocation of already revoked approval', async () => {
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

    const approval = await approveUseCase.execute({
      candidateSha,
      validationRunId: run.id,
      evidenceDigest: run.evidenceDigest,
      decision: 'GO',
      rationale: 'Initial sign-off',
      actor: humanReviewer
    });

    await revokeUseCase.execute({
      approvalId: approval.id,
      rationale: 'First revocation',
      actor: humanReviewer
    });

    await expect(
      revokeUseCase.execute({
        approvalId: approval.id,
        rationale: 'Second revocation attempt',
        actor: humanReviewer
      })
    ).rejects.toThrow(InvalidGovernanceApprovalStateError);
  });
});
