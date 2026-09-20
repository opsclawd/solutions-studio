import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import {
  createSourceId,
  createSourceRevisionId,
  createRequirementId,
  createRequirementRevisionId,
  createFindingId,
  createRequirementsBaselineId,
  createActorId,
  createReviewerId,
  createEngineeringDecisionId,
  createStoryId,
  createEvidenceLocator,
  createRequirementRevision,
  createCandidateFinding,
  createEngineeringDecision,
  createValidationRunRecord,
  createCandidateApprovalRecord,
  revokeCandidateApprovalRecord,
  createBacklogExportMapping,
  createBacklogExportMappingId,
  createInstant,
  now
} from '@solutions-studio/domain';
import { PGliteDatabaseClient } from '../../../src/infrastructure/persistence/postgres/PGliteDatabaseClient.js';
import { SchemaMigrationRunner } from '../../../src/infrastructure/persistence/postgres/SchemaMigrationRunner.js';
import { PostgresRequirementsRepository } from '../../../src/infrastructure/persistence/postgres/PostgresRequirementsRepository.js';
import { InMemoryObjectStore } from '../../../src/infrastructure/persistence/object-store/InMemoryObjectStore.js';
import { BackupService } from '../../../src/infrastructure/persistence/backup/BackupService.js';
import {
  RestoreService,
  BackupChecksumMismatchError
} from '../../../src/infrastructure/persistence/backup/RestoreService.js';

describe('Disaster Recovery: BackupService & RestoreService', () => {
  let tempDir: string;
  let pglite: PGlite;
  let dbClient: PGliteDatabaseClient;
  let repo: PostgresRequirementsRepository;
  let objectStore: InMemoryObjectStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dr-test-'));
    pglite = new PGlite();
    dbClient = new PGliteDatabaseClient({ pgliteInstance: pglite });
    const runner = new SchemaMigrationRunner({ db: dbClient });
    await runner.migrate();

    objectStore = new InMemoryObjectStore();
    repo = new PostgresRequirementsRepository({
      db: dbClient,
      objectStore
    });
  }, 30000);

  afterEach(async () => {
    await dbClient.close().catch(() => {});
    await pglite.close().catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('performs full backup and restore with tamper checksum protection and post-restore lineage verification', async () => {
    // 1. Populate database & object store
    const sourceId = createSourceId('SRC-DR-001');
    const sourceRevId = createSourceRevisionId('SRC-DR-001-R1');
    const rawText = '# Disaster Recovery SOP\nAll systems must be recoverable.';
    const locator = createEvidenceLocator('sec#1');

    await repo.captureSourceRevision({
      sourceId,
      sourceType: 'sop',
      markdownText: rawText
    });

    const reqId = createRequirementId('REQ-DR-001');
    const reqRevId = createRequirementRevisionId('REQ-DR-001-R1');
    const reqRev = createRequirementRevision({
      id: reqRevId,
      requirementId: reqId,
      revision: 1,
      statement: 'Database must withstand complete disk failure with zero committed loss.',
      category: 'nfr',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [{ sourceRevisionId: sourceRevId, locator }],
      rationale: 'Disaster recovery specification'
    });
    await repo.saveRequirementRevision(reqRev);

    const findingId = createFindingId('FIND-DR-001');
    const finding = createCandidateFinding({
      id: findingId,
      type: 'missing-failure-recovery',
      affectedRequirementRevisions: [reqRevId],
      evidence: [{ sourceRevisionId: sourceRevId, locator }],
      discoveredBy: 'heuristic',
      disposition: 'OPEN'
    });
    await repo.saveCandidateFinding(finding);

    const baseId = createRequirementsBaselineId('BASE-DR-001');
    await repo.saveRequirementsBaseline({
      id: baseId,
      requirementRevisions: [reqRevId],
      policyConstraintRevisions: [],
      createdAt: now(),
      createdBy: createReviewerId('DR-LEAD')
    });

    const decId = createEngineeringDecisionId('DEC-DR-001');
    const decision = createEngineeringDecision({
      id: decId,
      baselineId: baseId,
      statement: 'Implement automated snapshotting and object store replication',
      rationale: 'Ensures RPO < 5min',
      requirementRevisionIds: [reqRevId],
      policyConstraintRevisionIds: [],
      state: 'PROPOSED',
      createdAt: now(),
      createdBy: createActorId('ARCHITECT')
    });
    await repo.saveEngineeringDecision(decision);

    const projId = 'PROJ-DR-001';
    await repo.saveProjectionRecord({
      id: projId,
      baselineId: baseId,
      requirementRevisionIds: [reqRevId],
      artifactType: 'stories',
      content: 'Stories for DR verification',
      metadata: {
        baselineId: baseId,
        requirementRevisionIds: [reqRevId],
        artifactType: 'stories',
        declaredProvenance: {
          baselineId: baseId,
          requirementRevisionIds: [reqRevId]
        },
        configuredExecution: {
          provider: 'fake',
          artifactType: 'stories'
        },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'hash-dr-1',
          verifiedAt: now()
        }
      },
      createdAt: now()
    });

    const storyId = createStoryId('STORY-DR-001');
    await repo.saveStory({
      id: storyId,
      baselineId: baseId,
      projectionId: projId,
      title: 'Disaster Recovery Drill',
      narrative: {
        role: 'Site Reliability Engineer',
        feature: 'Automated Restore',
        benefit: 'Zero data corruption'
      },
      requirementRevisionIds: [reqRevId],
      scenarios: [],
      acceptanceCriteria: ['Passes tamper check'],
      gherkinText: 'Feature: DR Drill',
      metadata: {
        baselineId: baseId,
        requirementRevisionIds: [reqRevId],
        artifactType: 'stories',
        declaredProvenance: {
          baselineId: baseId,
          requirementRevisionIds: [reqRevId]
        },
        configuredExecution: {
          provider: 'fake',
          artifactType: 'stories'
        },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'hash-dr-1',
          verifiedAt: now()
        }
      },
      createdAt: now(),
      dependencies: []
    });

    const runId = 'RUN-DR-001';
    const candidateSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';
    const evidenceDigest = 'e'.repeat(64);
    const valRun = createValidationRunRecord({
      id: runId,
      candidateSha,
      executedAt: createInstant('2026-09-20T10:00:00Z'),
      executedBy: createActorId('RUNNER-DR'),
      phase: 'phase-4',
      executionMode: 'deterministic-ci',
      provider: 'fake',
      artifacts: [
        {
          name: 'schema-ddl.sql',
          artifactType: 'sql-ddl',
          contentHash: 'a'.repeat(64)
        }
      ],
      evidenceDigest
    });
    await repo.saveValidationRun(valRun);

    const approvalId = 'APPR-DR-001';
    const approval = createCandidateApprovalRecord({
      id: approvalId,
      candidateSha,
      validationRunId: runId,
      evidenceDigest,
      decision: 'GO',
      actor: {
        id: createActorId('LEAD-REVIEWER'),
        name: 'Lead Reviewer',
        email: 'reviewer@solutions-studio.test',
        actorType: 'human'
      },
      decidedAt: createInstant('2026-09-20T10:05:00Z'),
      rationale: 'DR sign-off'
    });
    await repo.saveGovernanceApproval(approval);

    // Supersede APPR-DR-001 with APPR-DR-002
    const approvalId2 = 'APPR-DR-002';
    const approval2 = createCandidateApprovalRecord({
      id: approvalId2,
      candidateSha,
      validationRunId: runId,
      evidenceDigest,
      decision: 'GO',
      actor: {
        id: createActorId('SEC-REVIEWER'),
        name: 'Security Reviewer',
        email: 'sec@solutions-studio.test',
        actorType: 'human'
      },
      decidedAt: createInstant('2026-09-20T10:10:00Z'),
      rationale: 'Updated DR sign-off with security audit',
      supersedes: approvalId
    });
    await repo.replaceGovernanceApproval(approval2, approvalId);

    // Add a second candidate with a revoked approval
    const candidateSha2 = 'e6bcf92bd3cb6bde8c8de33d941f14f3369b74c5';
    const runId2 = 'RUN-DR-002';
    const valRun2 = createValidationRunRecord({
      id: runId2,
      candidateSha: candidateSha2,
      executedAt: createInstant('2026-09-20T10:15:00Z'),
      executedBy: createActorId('RUNNER-DR'),
      phase: 'phase-4',
      executionMode: 'deterministic-ci',
      provider: 'fake',
      artifacts: [
        {
          name: 'schema-ddl.sql',
          artifactType: 'sql-ddl',
          contentHash: 'b'.repeat(64)
        }
      ],
      evidenceDigest: 'f'.repeat(64)
    });
    await repo.saveValidationRun(valRun2);

    const approvalId3 = 'APPR-DR-003';
    const approval3 = createCandidateApprovalRecord({
      id: approvalId3,
      candidateSha: candidateSha2,
      validationRunId: runId2,
      evidenceDigest: 'f'.repeat(64),
      decision: 'GO',
      actor: {
        id: createActorId('LEAD-REVIEWER'),
        name: 'Lead Reviewer',
        email: 'reviewer@solutions-studio.test',
        actorType: 'human'
      },
      decidedAt: createInstant('2026-09-20T10:20:00Z'),
      rationale: 'Initial sign-off for candidate 2'
    });
    await repo.saveGovernanceApproval(approval3);
    const revoked3 = revokeCandidateApprovalRecord(
      approval3,
      {
        id: createActorId('LEAD-REVIEWER'),
        name: 'Lead Reviewer',
        actorType: 'human'
      },
      'Found critical defect during drill'
    );
    await repo.updateGovernanceApproval(revoked3, 'ACTIVE');

    const mappingId = createBacklogExportMappingId('BMAP-DR-001');
    const mapping = createBacklogExportMapping({
      id: mappingId,
      storyId,
      baselineId: baseId,
      provider: 'github-issues',
      externalContainer: 'acme/solutions-studio',
      externalWorkItemId: '42',
      externalUrl: 'https://github.com/acme/solutions-studio/issues/42',
      exportContentHash: 'a'.repeat(64),
      exportedAt: createInstant('2026-09-20T10:25:00Z'),
      exportedBy: createActorId('LEAD-REVIEWER'),
      metadata: { targetBranch: 'main' }
    });
    await repo.saveBacklogExportMapping(mapping);

    // 2. Perform backup
    const backupDir = path.join(tempDir, 'backup-1');
    const backupService = new BackupService({
      db: dbClient,
      objectStore,
      targetDir: backupDir
    });

    const manifest = await backupService.createBackup();
    expect(manifest.tables.baselines.count).toBe(1);
    expect(manifest.tables.requirement_revisions.count).toBe(1);
    expect(manifest.tables.stories.count).toBe(1);
    expect(manifest.tables.backlog_export_mappings.count).toBe(1);
    expect(manifest.tables.validation_runs.count).toBe(2);
    expect(manifest.tables.governance_approvals.count).toBe(3);
    expect(manifest.blobs.length).toBeGreaterThan(0);
    expect(manifest.sha256Attestation).toBeDefined();

    // 3. Tamper verification
    const tamperedDir = path.join(tempDir, 'backup-tampered');
    await fs.cp(backupDir, tamperedDir, { recursive: true });

    // Corrupt one table file in tamperedDir
    const baselinesFile = path.join(tamperedDir, 'tables', 'baselines.json');
    await fs.writeFile(baselinesFile, '[{"corrupted": true}]', 'utf8');

    const tamperedRestore = new RestoreService({
      db: dbClient,
      objectStore,
      backupDir: tamperedDir,
      repo
    });

    await expect(tamperedRestore.restore()).rejects.toThrow(BackupChecksumMismatchError);

    // 4. Restore onto fresh database and object store
    const freshPglite = new PGlite();
    const freshDbClient = new PGliteDatabaseClient({ pgliteInstance: freshPglite });
    const freshRunner = new SchemaMigrationRunner({ db: freshDbClient });
    await freshRunner.migrate();

    const freshObjectStore = new InMemoryObjectStore();
    const freshRepo = new PostgresRequirementsRepository({
      db: freshDbClient,
      objectStore: freshObjectStore
    });

    const restoreService = new RestoreService({
      db: freshDbClient,
      objectStore: freshObjectStore,
      backupDir,
      repo: freshRepo
    });

    const restoreResult = await restoreService.restore();
    expect(restoreResult.verified).toBe(true);
    expect(restoreResult.checksumsVerified).toBe(true);
    expect(restoreResult.baselineCount).toBe(1);
    expect(restoreResult.errors).toHaveLength(0);

    // 5. Post-restore query verification
    const restoredBaseline = await freshRepo.getRequirementsBaseline(baseId);
    expect(restoredBaseline).toBeDefined();
    expect(restoredBaseline?.id).toBe(baseId);
    expect(restoredBaseline?.requirementRevisions).toEqual([reqRevId]);

    const restoredReqRev = await freshRepo.getRequirementRevision(reqRevId);
    expect(restoredReqRev).toBeDefined();
    expect(restoredReqRev?.statement).toBe(reqRev.statement);

    const restoredStory = await freshRepo.getStory(storyId);
    expect(restoredStory).toBeDefined();
    expect(restoredStory?.title).toBe('Disaster Recovery Drill');

    const restoredProj = await freshRepo.getProjectionRecord(projId);
    expect(restoredProj).toBeDefined();
    expect(restoredProj?.content).toBe('Stories for DR verification');

    const restoredRun = await freshRepo.getValidationRun(runId);
    expect(restoredRun).toBeDefined();
    expect(restoredRun?.evidenceDigest).toBe(evidenceDigest);

    const restoredRun2 = await freshRepo.getValidationRun(runId2);
    expect(restoredRun2).toBeDefined();
    expect(restoredRun2?.evidenceDigest).toBe('f'.repeat(64));

    // Superseded approval
    const restoredApproval1 = await freshRepo.getGovernanceApproval(approvalId);
    expect(restoredApproval1).toBeDefined();
    expect(restoredApproval1?.status).toBe('SUPERSEDED');
    expect(restoredApproval1?.rationale).toBe('DR sign-off');

    // Active replacement approval with supersedes linkage
    const restoredApproval2 = await freshRepo.getGovernanceApproval(approvalId2);
    expect(restoredApproval2).toBeDefined();
    expect(restoredApproval2?.status).toBe('ACTIVE');
    expect(restoredApproval2?.supersedes).toBe(approvalId);
    expect(restoredApproval2?.rationale).toBe('Updated DR sign-off with security audit');
    expect(restoredApproval2?.actor.email).toBe('sec@solutions-studio.test');

    // Revoked approval with revocation details
    const restoredApproval3 = await freshRepo.getGovernanceApproval(approvalId3);
    expect(restoredApproval3).toBeDefined();
    expect(restoredApproval3?.status).toBe('REVOKED');
    expect(restoredApproval3?.revocation).toBeDefined();
    expect(restoredApproval3?.revocation?.rationale).toBe('Found critical defect during drill');
    expect(restoredApproval3?.revocation?.revokedBy.id).toBe(createActorId('LEAD-REVIEWER'));

    expect(restoreResult.verifiedValidationRuns).toHaveLength(2);
    expect(restoreResult.verifiedGovernanceApprovals).toHaveLength(3);
    expect(restoreResult.verifiedBacklogExportMappings).toHaveLength(1);

    const restoredMapping = await freshRepo.getBacklogExportMapping(mappingId);
    expect(restoredMapping).toBeDefined();
    expect(restoredMapping?.externalWorkItemId).toBe('42');
    expect(restoredMapping?.externalContainer).toBe('acme/solutions-studio');
    expect(restoredMapping?.exportContentHash).toBe('a'.repeat(64));

    await freshDbClient.close().catch(() => {});
    await freshPglite.close().catch(() => {});
  }, 30000);
});
