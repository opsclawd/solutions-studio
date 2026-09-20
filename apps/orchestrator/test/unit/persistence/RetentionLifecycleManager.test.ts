import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  createRequirementsBaselineId,
  createReviewerId,
  createRequirementId,
  createRequirementRevisionId,
  createStoryId,
  createEvidenceLocator,
  createRequirementRevision,
  createInstant,
  now
} from '@solutions-studio/domain';
import { PGliteDatabaseClient } from '../../../src/infrastructure/persistence/postgres/PGliteDatabaseClient.js';
import { SchemaMigrationRunner } from '../../../src/infrastructure/persistence/postgres/SchemaMigrationRunner.js';
import { PostgresRequirementsRepository } from '../../../src/infrastructure/persistence/postgres/PostgresRequirementsRepository.js';
import { InMemoryObjectStore } from '../../../src/infrastructure/persistence/object-store/InMemoryObjectStore.js';
import { RetentionLifecycleManager } from '../../../src/infrastructure/persistence/lifecycle/RetentionLifecycleManager.js';

describe('RetentionLifecycleManager', () => {
  let pglite: PGlite;
  let dbClient: PGliteDatabaseClient;
  let repo: PostgresRequirementsRepository;
  let objectStore: InMemoryObjectStore;

  beforeEach(async () => {
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
  });

  it('prunes old evaluation runs beyond keep-last threshold and orphan projections while strictly protecting active baselines and stories', async () => {
    const nowDate = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // 1. Create 5 evaluation runs
    // Run 1: 100 days old (pruned in Horizon 2)
    // Run 2: 95 days old (pruned in Horizon 2)
    // Run 3: 30 days old (> 14d: raw fixtures pruned in Horizon 1; < 90d & keepLast = 3: summary preserved)
    // Run 4: 10 days old (< 14d: preserved completely)
    // Run 5: 1 day old (< 14d: preserved completely)
    const runDates = [
      new Date(nowDate - 100 * dayMs).toISOString(),
      new Date(nowDate - 95 * dayMs).toISOString(),
      new Date(nowDate - 30 * dayMs).toISOString(),
      new Date(nowDate - 10 * dayMs).toISOString(),
      new Date(nowDate - 1 * dayMs).toISOString()
    ];

    for (let i = 0; i < runDates.length; i++) {
      const id = `EVAL-RUN-${i + 1}`;

      const runFixtureResults = [
        {
          fixtureId: 'fixture-1',
          status: 'failed' as const,
          error: {
            name: 'Error',
            message: 'Test failure',
            phase: 'capture' as const
          }
        }
      ];

      await repo.saveEvaluationRun({
        id,
        corpusVersion: 'v1.0',
        executedAt: createInstant(runDates[i]),
        fixtureResults: runFixtureResults,
        report: {
          reportSchemaVersion: '1.0.0',
          runId: id,
          executedAt: createInstant(runDates[i]),
          corpusVersion: 'v1.0',
          corpusIdentity: 'test-corpus-identity-sha256',
          candidateSha: { status: 'available', value: 'cand-sha-123' },
          fixtureOrder: ['fixture-1'],
          fixtureResults: runFixtureResults,
          aggregateScores: {
            totalFixtures: 1,
            completedFixtures: 0,
            failedFixtures: 1,
            requirementsByCategory: {},
            findingsByCategory: {},
            unclassifiedFindingsCount: 0
          },
          reportArtifacts: {
            jsonReportPath: { status: 'available', value: 'reports/eval.json' },
            jsonReportDigest: { status: 'available', value: 'digest-1' },
            markdownReportPath: { status: 'unavailable', reason: 'None' },
            markdownReportDigest: { status: 'unavailable', reason: 'None' }
          },
          provenance: {
            requested: {
              candidateSha: { status: 'available', value: 'cand-sha-123' },
              providerMode: 'fixture-replay',
              providerName: 'fixture-replay',
              manifestPath: 'manifests/corpus.v1.json',
              outputReportPath: { status: 'available', value: 'reports/eval.json' },
              storeDir: { status: 'unavailable', reason: 'In-memory' }
            },
            declared: {
              manifestVersion: 'v1.0',
              manifestHash: 'manifest-hash-1',
              canonicalizationVersion: 'v1',
              corpusIdentity: 'test-corpus-identity-sha256',
              fixtureOrder: ['fixture-1'],
              fixtures: [
                {
                  fixtureId: 'fixture-1',
                  expectedJsonHash: 'hash-expected',
                  sources: [
                    {
                      sourceRevisionId: 'SRC-R1',
                      sourceId: 'SRC-01',
                      sourceType: 'sop' as const,
                      revision: 1,
                      contentHash: 'hash-src'
                    }
                  ]
                }
              ]
            },
            configured: {
              compilerVersion: '1.0.0',
              promptVersion: '1.0.0',
              gatewayConfig: {},
              nodeVersion: process.version,
              platform: process.platform,
              arch: process.arch
            },
            verified: {
              schemaValidation: true,
              corpusLineageValid: true,
              persistenceVerified: true,
              reportDigest: 'report-digest-1'
            }
          }
        }
      });
    }

    // 2. Create an active baseline with projection and story (Class A & B)
    const baseId = createRequirementsBaselineId('BASE-ACTIVE-001');
    const reqId = createRequirementId('REQ-ACT-001');
    const reqRevId = createRequirementRevisionId('REQ-ACT-001-R1');
    const reqRev = createRequirementRevision({
      id: reqRevId,
      requirementId: reqId,
      revision: 1,
      statement: 'Active requirement statement',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [{ sourceRevisionId: 'SRC-1' as any, locator: createEvidenceLocator('sec#1') }],
      rationale: 'Active baseline requirement'
    });
    await repo.saveRequirementRevision(reqRev);

    await repo.saveRequirementsBaseline({
      id: baseId,
      requirementRevisions: [reqRevId],
      policyConstraintRevisions: [],
      createdAt: now(),
      createdBy: createReviewerId('LEAD-1')
    });

    const activeProjId = 'PROJ-ACTIVE-001';
    await repo.saveProjectionRecord({
      id: activeProjId,
      baselineId: baseId,
      requirementRevisionIds: [reqRevId],
      artifactType: 'stories',
      content: 'Active projection content',
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
          contentHash: 'hash-act',
          verifiedAt: now()
        }
      },
      createdAt: now()
    });

    const storyId = createStoryId('STORY-ACTIVE-001');
    await repo.saveStory({
      id: storyId,
      baselineId: baseId,
      projectionId: activeProjId,
      title: 'Active Story',
      narrative: { role: 'User', feature: 'Active', benefit: 'Integrity' },
      requirementRevisionIds: [reqRevId],
      scenarios: [],
      acceptanceCriteria: ['Valid'],
      gherkinText: 'Feature: Active',
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
          contentHash: 'hash-act',
          verifiedAt: now()
        }
      },
      createdAt: now(),
      dependencies: []
    });

    // 3. Create an orphan projection not linked to any active baseline or story (Class D)
    const orphanProjId = 'PROJ-ORPHAN-001';
    const orphanBlobKey = `projections/${orphanProjId}.artifact`;
    await objectStore.putObject(orphanBlobKey, 'Orphan content');
    await dbClient.query(
      `INSERT INTO projections (
         id, baseline_id, requirement_revision_ids, artifact_type, content, payload_ref, metadata, created_at, version
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1);`,
      [
        orphanProjId,
        'BASE-DELETED-UNKNOWN',
        JSON.stringify([]),
        'stories',
        'Orphan content',
        orphanBlobKey,
        JSON.stringify({}),
        new Date()
      ]
    );

    // 4. Run Retention Lifecycle Manager with 14-day fixture and 90-day summary horizons
    const manager = new RetentionLifecycleManager(dbClient, objectStore, {
      maxRawFixtureAgeDays: 14,
      maxEvaluationRunSummaryAgeDays: 90,
      keepLastEvaluationRuns: 3,
      pruneTransientProjections: true,
      dryRun: false
    });

    const report = await manager.prune();

    // 5. Verify pruning report
    expect(report.evaluationRunsScanned).toBe(5);
    expect(report.rawFixturesPruned).toBe(1);
    expect(report.rawFixtureRunIdsPruned).toEqual(['EVAL-RUN-3']);
    expect(report.evaluationRunsPruned).toBe(2);
    expect(report.evaluationRunIdsPruned).toEqual(
      expect.arrayContaining(['EVAL-RUN-1', 'EVAL-RUN-2'])
    );
    expect(report.projectionsPruned).toBe(1);
    expect(report.projectionIdsPruned).toEqual([orphanProjId]);
    expect(report.safetyVerification).toBe('passed');

    // 6. Verify database records
    const remainingRuns = await repo.listEvaluationRuns();
    expect(remainingRuns).toHaveLength(3);
    const remainingRunIds = remainingRuns.map((r) => r.id);
    expect(remainingRunIds).toContain('EVAL-RUN-3');
    expect(remainingRunIds).toContain('EVAL-RUN-4');
    expect(remainingRunIds).toContain('EVAL-RUN-5');

    // Horizon 1 check: Run 3 raw fixtures cleared in database and object store, but summary metrics preserved
    const dbCheck = await dbClient.query<{ fixture_results: unknown; payload_ref: string | null }>(
      `SELECT fixture_results, payload_ref FROM evaluation_runs WHERE id = $1;`,
      ['EVAL-RUN-3']
    );
    expect(dbCheck.rows[0].fixture_results).toEqual([]);
    expect(dbCheck.rows[0].payload_ref).toBeNull();

    const run3 = await repo.getEvaluationRun('EVAL-RUN-3');
    expect(run3).toBeDefined();
    expect(run3?.report.runId).toBe('EVAL-RUN-3');

    // 7. Verify object store deletions
    expect(await objectStore.hasObject('evaluation-runs/EVAL-RUN-1/report.json')).toBe(false);
    expect(await objectStore.hasObject('evaluation-runs/EVAL-RUN-2/report.json')).toBe(false);
    expect(await objectStore.hasObject('evaluation-runs/EVAL-RUN-3/report.json')).toBe(false);
    expect(await objectStore.hasObject(orphanBlobKey)).toBe(false);

    // Preserved blobs (< 14 days old)
    expect(await objectStore.hasObject('evaluation-runs/EVAL-RUN-4/report.json')).toBe(true);
    expect(await objectStore.hasObject('evaluation-runs/EVAL-RUN-5/report.json')).toBe(true);

    // 8. Inviolable check: Active baseline, projection, and story remain intact
    const activeBase = await repo.getRequirementsBaseline(baseId);
    expect(activeBase).toBeDefined();

    const activeProj = await repo.getProjectionRecord(activeProjId);
    expect(activeProj).toBeDefined();

    const activeStory = await repo.getStory(storyId);
    expect(activeStory).toBeDefined();
  }, 30000);

  it('enforces executable safety checks and throws if Class A baseline is pruned', async () => {
    const manager = new RetentionLifecycleManager(dbClient, objectStore);
    const initialCounts = await manager.verifyRetentionSafety();

    // Verification passes when counts match
    await expect(manager.verifyRetentionSafety(initialCounts)).resolves.toEqual(initialCounts);

    // If expected baseline count is higher than actual, throws RetentionSafetyViolationError
    const tamperedExpected = {
      ...initialCounts,
      baselines: initialCounts.baselines + 1
    };
    await expect(manager.verifyRetentionSafety(tamperedExpected)).rejects.toThrow(
      /Retention safety violation: Class A records were modified or pruned/
    );
  });
});
