import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createCandidateSha,
  createAuthenticatedActor,
  createCandidateApprovalRecord,
  createActorId,
  createInstant
} from '@solutions-studio/domain';
import { OptimisticConcurrencyConflictError } from '../../../src/application/use-cases/ReconciliationErrors.js';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { DefaultAuthorizationPolicy } from '../../../src/infrastructure/identity/DefaultAuthorizationPolicy.js';
import {
  RecordValidationRunUseCase,
  ApproveCandidateUseCase
} from '../../../src/application/use-cases/governance/index.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';
import { TestAuthenticator } from '../../../src/infrastructure/identity/TestAuthenticator.js';

describe('Governance Concurrency & Race Condition Invariant', () => {
  let tmpDir: string;
  let repo: FilesystemRequirementsRepository;
  let authorizer: DefaultAuthorizationPolicy;
  let recordRunUseCase: RecordValidationRunUseCase;
  let approveUseCase: ApproveCandidateUseCase;

  const candidateSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';
  const artifactHash = 'a'.repeat(64);

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gov-concurrency-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tmpDir });
    authorizer = new DefaultAuthorizationPolicy();
    recordRunUseCase = new RecordValidationRunUseCase(repo);
    approveUseCase = new ApproveCandidateUseCase(repo, authorizer);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('fails closed when two concurrent approvals race to approve the same candidate without supersedes', async () => {
    const run = await recordRunUseCase.execute({
      candidateSha,
      phase: 'phase-3',
      executionMode: 'deterministic-ci',
      provider: 'fake',
      artifacts: [
        {
          name: 'schema-ddl.sql',
          artifactType: 'sql-ddl',
          contentHash: artifactHash
        }
      ],
      proposedDisposition: 'GO',
      executedBy: 'runner:ci'
    });

    const reviewer1 = createAuthenticatedActor({
      id: 'rev-alice',
      name: 'Alice Reviewer',
      actorType: 'human',
      capabilities: ['candidate:approve']
    });

    const reviewer2 = createAuthenticatedActor({
      id: 'rev-bob',
      name: 'Bob Reviewer',
      actorType: 'human',
      capabilities: ['candidate:approve']
    });

    // Execute concurrent approval calls
    const results = await Promise.allSettled([
      approveUseCase.execute({
        candidateSha: createCandidateSha(candidateSha),
        validationRunId: run.id,
        evidenceDigest: run.evidenceDigest,
        decision: 'GO',
        rationale: 'Review by Alice',
        actor: reviewer1
      }),
      approveUseCase.execute({
        candidateSha: createCandidateSha(candidateSha),
        validationRunId: run.id,
        evidenceDigest: run.evidenceDigest,
        decision: 'GO',
        rationale: 'Review by Bob',
        actor: reviewer2
      })
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one approval must succeed, the other must fail closed with concurrency conflict
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejectedError = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectedError).toBeInstanceOf(OptimisticConcurrencyConflictError);
    expect(rejectedError.message).toMatch(
      /Candidate '.*' already has an active governance approval/i
    );

    // Verify storage invariant: exactly one active approval exists
    const active = await repo.getActiveGovernanceApproval(createCandidateSha(candidateSha));
    expect(active).toBeDefined();
    expect(active?.status).toBe('ACTIVE');

    const allApprovals = await repo.listGovernanceApprovals({
      candidateSha: createCandidateSha(candidateSha)
    });
    expect(allApprovals).toHaveLength(1);
  });

  it('HTTP server returns 409 CONFLICT on concurrent duplicate approval race', async () => {
    const composed = composeOrchestratorHttpServer({
      storeDir: tmpDir,
      repository: repo,
      authenticator: new TestAuthenticator({ allowAnonymousFallback: false }),
      fastifyOptions: { logger: false }
    });
    const app = composed.app;
    await app.ready();

    try {
      const run = await recordRunUseCase.execute({
        candidateSha,
        phase: 'phase-3',
        executionMode: 'deterministic-ci',
        provider: 'fake',
        artifacts: [
          {
            name: 'schema-ddl.sql',
            artifactType: 'sql-ddl',
            contentHash: artifactHash
          }
        ],
        proposedDisposition: 'GO',
        executedBy: 'runner:ci'
      });

      // Fire two HTTP approval requests concurrently
      const [res1, res2] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/api/governance/approvals',
          headers: { authorization: 'Bearer test:reviewer' },
          payload: {
            candidateSha,
            validationRunId: run.id,
            evidenceDigest: run.evidenceDigest,
            decision: 'GO',
            rationale: 'Review call 1'
          }
        }),
        app.inject({
          method: 'POST',
          url: '/api/governance/approvals',
          headers: { authorization: 'Bearer test:reviewer' },
          payload: {
            candidateSha,
            validationRunId: run.id,
            evidenceDigest: run.evidenceDigest,
            decision: 'GO',
            rationale: 'Review call 2'
          }
        })
      ]);

      const statusCodes = [res1.statusCode, res2.statusCode].sort();
      expect(statusCodes).toEqual([201, 409]);

      const conflictRes = res1.statusCode === 409 ? res1 : res2;
      const conflictBody = conflictRes.json();
      expect(conflictBody.code).toBe('CONCURRENCY_CONFLICT');
      expect(conflictBody.message).toMatch(
        /Candidate '.*' already has an active governance approval/i
      );
    } finally {
      await app.close();
    }
  });

  it('enforces single active approval across separate repository instances using cross-process file locks', async () => {
    const run = await recordRunUseCase.execute({
      candidateSha,
      phase: 'phase-3',
      executionMode: 'deterministic-ci',
      provider: 'fake',
      artifacts: [
        {
          name: 'schema-ddl.sql',
          artifactType: 'sql-ddl',
          contentHash: artifactHash
        }
      ],
      proposedDisposition: 'GO',
      executedBy: 'runner:ci'
    });

    const repoInstance1 = new FilesystemRequirementsRepository({ baseDir: tmpDir });
    const repoInstance2 = new FilesystemRequirementsRepository({ baseDir: tmpDir });

    const approveUseCase1 = new ApproveCandidateUseCase(repoInstance1, authorizer);
    const approveUseCase2 = new ApproveCandidateUseCase(repoInstance2, authorizer);

    const reviewer1 = createAuthenticatedActor({
      id: 'rev-instance-1',
      name: 'Reviewer One',
      actorType: 'human',
      capabilities: ['candidate:approve']
    });

    const reviewer2 = createAuthenticatedActor({
      id: 'rev-instance-2',
      name: 'Reviewer Two',
      actorType: 'human',
      capabilities: ['candidate:approve']
    });

    const results = await Promise.allSettled([
      approveUseCase1.execute({
        candidateSha: createCandidateSha(candidateSha),
        validationRunId: run.id,
        evidenceDigest: run.evidenceDigest,
        decision: 'GO',
        rationale: 'Review by Instance 1',
        actor: reviewer1
      }),
      approveUseCase2.execute({
        candidateSha: createCandidateSha(candidateSha),
        validationRunId: run.id,
        evidenceDigest: run.evidenceDigest,
        decision: 'GO',
        rationale: 'Review by Instance 2',
        actor: reviewer2
      })
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const active = await repo.getActiveGovernanceApproval(createCandidateSha(candidateSha));
    expect(active).toBeDefined();
    expect(active?.status).toBe('ACTIVE');
  });

  it('rolls back existing approval to ACTIVE state when new replacement approval write fails', async () => {
    const run = await recordRunUseCase.execute({
      candidateSha,
      phase: 'phase-3',
      executionMode: 'deterministic-ci',
      provider: 'fake',
      artifacts: [
        {
          name: 'schema-ddl.sql',
          artifactType: 'sql-ddl',
          contentHash: artifactHash
        }
      ],
      proposedDisposition: 'GO',
      executedBy: 'runner:ci'
    });

    const initialApprovalId = 'APPR-ROLLBACK-1';
    const initialApproval = createCandidateApprovalRecord({
      id: initialApprovalId,
      candidateSha,
      validationRunId: run.id,
      evidenceDigest: run.evidenceDigest,
      decision: 'GO',
      actor: {
        id: createActorId('rev-alice'),
        name: 'Alice Reviewer',
        actorType: 'human'
      },
      decidedAt: createInstant('2026-09-20T10:00:00Z'),
      rationale: 'Initial approval'
    });
    await repo.saveGovernanceApproval(initialApproval);

    const activeBefore = await repo.getActiveGovernanceApproval(createCandidateSha(candidateSha));
    expect(activeBefore?.id).toBe(initialApprovalId);
    expect(activeBefore?.status).toBe('ACTIVE');

    // Pre-create conflicting file for new approval so writeJsonExclusive fails with EEXIST
    const replacementApprovalId = 'APPR-ROLLBACK-2';
    const conflictingFilePath = path.join(
      tmpDir,
      'governance-approvals',
      `${replacementApprovalId}.json`
    );
    const conflictingRecord = createCandidateApprovalRecord({
      id: replacementApprovalId,
      candidateSha: '1111111111111111111111111111111111111111',
      validationRunId: run.id,
      evidenceDigest: run.evidenceDigest,
      decision: 'GO',
      actor: {
        id: createActorId('rev-charlie'),
        name: 'Charlie Reviewer',
        actorType: 'human'
      },
      decidedAt: createInstant('2026-09-20T10:02:00Z'),
      rationale: 'Pre-existing conflicting file'
    });
    await fs.writeFile(conflictingFilePath, JSON.stringify(conflictingRecord, null, 2), 'utf8');

    const replacementApproval = createCandidateApprovalRecord({
      id: replacementApprovalId,
      candidateSha,
      validationRunId: run.id,
      evidenceDigest: run.evidenceDigest,
      decision: 'GO',
      actor: {
        id: createActorId('rev-bob'),
        name: 'Bob Reviewer',
        actorType: 'human'
      },
      decidedAt: createInstant('2026-09-20T10:05:00Z'),
      rationale: 'Replacement approval',
      supersedes: initialApprovalId
    });

    // Attempt replacement, which should fail on writeJsonExclusive and trigger rollback
    await expect(
      repo.replaceGovernanceApproval(replacementApproval, initialApprovalId)
    ).rejects.toThrow();

    // Verify rollback: initial approval MUST still be ACTIVE, not left as SUPERSEDED!
    const activeAfter = await repo.getActiveGovernanceApproval(createCandidateSha(candidateSha));
    expect(activeAfter).toBeDefined();
    expect(activeAfter?.id).toBe(initialApprovalId);
    expect(activeAfter?.status).toBe('ACTIVE');

    const initialRecord = await repo.getGovernanceApproval(initialApprovalId);
    expect(initialRecord?.status).toBe('ACTIVE');
  });
});
