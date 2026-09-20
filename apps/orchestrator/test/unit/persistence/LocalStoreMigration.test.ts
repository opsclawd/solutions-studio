import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import {
  createSourceId,
  createRequirementId,
  createRequirementRevisionId,
  createFindingId,
  createRequirementsBaselineId,
  createActorId,
  createReviewerId,
  createEngineeringDecisionId,
  createPolicyConstraintId,
  createPolicyConstraintRevisionId,
  createStoryId,
  createEvidenceLocator,
  createRequirementRevision,
  createCandidateFinding,
  createEngineeringDecision,
  createPolicyConstraintRevision,
  now
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { PGliteDatabaseClient } from '../../../src/infrastructure/persistence/postgres/PGliteDatabaseClient.js';
import { SchemaMigrationRunner } from '../../../src/infrastructure/persistence/postgres/SchemaMigrationRunner.js';
import { PostgresRequirementsRepository } from '../../../src/infrastructure/persistence/postgres/PostgresRequirementsRepository.js';
import { InMemoryObjectStore } from '../../../src/infrastructure/persistence/object-store/InMemoryObjectStore.js';
import { LocalStoreMigrationService } from '../../../src/infrastructure/persistence/migration/LocalStoreMigrationService.js';

describe('LocalStoreMigrationService', () => {
  let tempDir: string;
  let sourceRepo: FilesystemRequirementsRepository;
  let pglite: PGlite;
  let dbClient: PGliteDatabaseClient;
  let targetRepo: PostgresRequirementsRepository;
  let objectStore: InMemoryObjectStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-test-'));
    sourceRepo = new FilesystemRequirementsRepository({ baseDir: tempDir });

    pglite = new PGlite();
    dbClient = new PGliteDatabaseClient({ pgliteInstance: pglite });
    const runner = new SchemaMigrationRunner({ db: dbClient });
    await runner.migrate();

    objectStore = new InMemoryObjectStore();
    targetRepo = new PostgresRequirementsRepository({
      db: dbClient,
      objectStore
    });
  }, 30000);

  afterEach(async () => {
    await dbClient.close().catch(() => {});
    await pglite.close().catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('migrates all data from filesystem store to relational and object store idempotently', async () => {
    // 1. Populate source filesystem repository
    const sourceId = createSourceId('SRC-001');
    const rawText = '# Header\nThis is a sample document text.';

    const sourceRevRec = await sourceRepo.captureSourceRevision({
      sourceId,
      sourceType: 'sop',
      markdownText: rawText
    });
    const sourceRevId = sourceRevRec.revision.id;
    const locator = sourceRevRec.locatorIndex[0]?.locator ?? createEvidenceLocator('header#1.1');

    const reqId = createRequirementId('REQ-001');
    const reqRevId = createRequirementRevisionId('REQ-001-R1');
    const reqRev = createRequirementRevision({
      id: reqRevId,
      requirementId: reqId,
      revision: 1,
      statement: 'System shall ensure data durability.',
      category: 'data-constraint',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [{ sourceRevisionId: sourceRevId, locator }],
      rationale: 'Core enterprise requirement'
    });
    await sourceRepo.saveRequirementRevision(reqRev);

    const findingId = createFindingId('FINDING-001');
    const finding = createCandidateFinding({
      id: findingId,
      type: 'contradiction',
      affectedRequirementRevisions: [reqRevId],
      evidence: [{ sourceRevisionId: sourceRevId, locator }],
      discoveredBy: 'heuristic',
      disposition: 'OPEN'
    });
    await sourceRepo.saveCandidateFinding(finding);

    // Reconcile finding to RESOLVED
    const updatedFinding = {
      ...finding,
      disposition: 'RESOLVED' as const,
      rationale: 'Addressed in REQ-001-R1'
    };
    await sourceRepo.transitionCandidateFinding(
      updatedFinding,
      {
        id: 'AUD-F-001',
        entityType: 'finding',
        entityId: findingId,
        previousDisposition: 'OPEN',
        newDisposition: 'RESOLVED',
        rationale: 'Addressed in REQ-001-R1',
        recordedAt: now(),
        actorId: createActorId('ACTOR-1')
      },
      'OPEN'
    );

    // Policy Constraint
    const polId = createPolicyConstraintId('POL-001');
    const polRevId = createPolicyConstraintRevisionId('POL-001-R1');
    const polRev = createPolicyConstraintRevision({
      id: polRevId,
      policyConstraintId: polId,
      revision: 1,
      statement: 'Must be ISO compliant',
      authorityReference: 'ISO-27001',
      state: 'ACCEPTED',
      createdAt: now(),
      createdBy: createActorId('AUDITOR-1')
    });
    await sourceRepo.savePolicyConstraintRevision(polRev);

    // Baseline
    const baseId = createRequirementsBaselineId('BASE-001');
    await sourceRepo.saveRequirementsBaseline({
      id: baseId,
      requirementRevisions: [reqRevId],
      policyConstraintRevisions: [polRevId],
      createdAt: now(),
      createdBy: createReviewerId('LEAD-1')
    });

    // Engineering Decision
    const decId = createEngineeringDecisionId('DEC-001');
    const decision = createEngineeringDecision({
      id: decId,
      baselineId: baseId,
      statement: 'Use PostgreSQL for ACID durability',
      rationale: 'PostgreSQL provides transactional integrity',
      requirementRevisionIds: [reqRevId],
      policyConstraintRevisionIds: [polRevId],
      state: 'PROPOSED',
      createdAt: now(),
      createdBy: createActorId('ARCHITECT-1')
    });
    await sourceRepo.saveEngineeringDecision(decision);

    // Projection & Story
    const projId = 'PROJ-001';
    await sourceRepo.saveProjectionRecord({
      id: projId,
      baselineId: baseId,
      requirementRevisionIds: [reqRevId],
      artifactType: 'stories',
      content: 'Story projection markdown text',
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
          contentHash: 'hash123',
          verifiedAt: now()
        }
      },
      createdAt: now()
    });

    const storyId = createStoryId('STORY-001');
    await sourceRepo.saveStory({
      id: storyId,
      baselineId: baseId,
      projectionId: projId,
      title: 'Durable Storage Story',
      narrative: {
        role: 'Operator',
        feature: 'Persistent Store',
        benefit: 'Zero data loss'
      },
      requirementRevisionIds: [reqRevId],
      scenarios: [],
      acceptanceCriteria: ['Passes integrity checks'],
      gherkinText: 'Feature: Durable Storage\nScenario: Verify',
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
          contentHash: 'hash123',
          verifiedAt: now()
        }
      },
      createdAt: now(),
      dependencies: []
    });

    // 2. Perform Migration
    const migration = new LocalStoreMigrationService({
      sourceDir: tempDir,
      targetRepo,
      targetDb: dbClient,
      targetObjectStore: objectStore
    });

    const report = await migration.migrate();

    expect(report.verified).toBe(true);
    expect(report.recordCounts.sources).toBe(1);
    expect(report.recordCounts.sourceRevisions).toBe(1);
    expect(report.recordCounts.requirements).toBe(1);
    expect(report.recordCounts.requirementRevisions).toBe(1);
    expect(report.recordCounts.findings).toBe(1);
    expect(report.recordCounts.baselines).toBe(1);
    expect(report.recordCounts.policyConstraints).toBe(1);
    expect(report.recordCounts.policyConstraintRevisions).toBe(1);
    expect(report.recordCounts.engineeringDecisions).toBe(1);
    expect(report.recordCounts.projections).toBe(1);
    expect(report.recordCounts.stories).toBe(1);

    // 3. Verify target records
    const migratedBaseline = await targetRepo.getRequirementsBaseline(baseId);
    expect(migratedBaseline).toBeDefined();
    expect(migratedBaseline?.requirementRevisions).toEqual([reqRevId]);

    const migratedReq = await targetRepo.getRequirementRevision(reqRevId);
    expect(migratedReq).toBeDefined();
    expect(migratedReq?.statement).toBe(reqRev.statement);

    const migratedDecision = await targetRepo.getEngineeringDecision(decId);
    expect(migratedDecision).toBeDefined();
    expect(migratedDecision?.statement).toBe(decision.statement);

    const migratedStory = await targetRepo.getStory(storyId);
    expect(migratedStory).toBeDefined();
    expect(migratedStory?.title).toBe('Durable Storage Story');

    // 4. Verify object store contents
    const sourceBlob = await objectStore.getObjectString(`sources/${sourceId}/${sourceRevId}.md`);
    expect(sourceBlob).toBe(rawText);

    // 5. Test idempotency: re-running migration should succeed without duplicate errors
    const secondReport = await migration.migrate();
    expect(secondReport.verified).toBe(true);
  }, 30000);
});
