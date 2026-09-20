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

    await freshDbClient.close().catch(() => {});
    await freshPglite.close().catch(() => {});
  }, 30000);
});
