import type { ISqlDatabaseClient } from '../../../application/ports/persistence/ISqlDatabaseClient.js';
import type { IObjectStore } from '../../../application/ports/persistence/IObjectStore.js';

export class RetentionSafetyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetentionSafetyViolationError';
  }
}

export interface ClassACounts {
  readonly baselines: number;
  readonly sourceRevisions: number;
  readonly requirementRevisions: number;
  readonly reconciliationRecords: number;
}

export interface RetentionPolicyOptions {
  /** Maximum age in days for raw fixture blobs and fixture results (default: 14) */
  readonly maxRawFixtureAgeDays?: number;
  /** Maximum age in days for evaluation run summary metrics rows (default: 90) */
  readonly maxEvaluationRunSummaryAgeDays?: number;
  /** @deprecated use maxRawFixtureAgeDays or maxEvaluationRunSummaryAgeDays */
  readonly maxEvaluationRunAgeDays?: number;
  /** Minimum number of most recent evaluation runs unconditionally preserved (default: 10) */
  readonly keepLastEvaluationRuns?: number;
  readonly pruneTransientProjections?: boolean;
  readonly dryRun?: boolean;
}

export interface RetentionPruneReport {
  readonly timestamp: string;
  readonly dryRun: boolean;
  readonly evaluationRunsScanned: number;
  readonly rawFixturesPruned: number;
  readonly rawFixtureRunIdsPruned: readonly string[];
  readonly evaluationRunsPruned: number;
  readonly evaluationRunIdsPruned: readonly string[];
  readonly projectionsPruned: number;
  readonly projectionIdsPruned: readonly string[];
  readonly blobsDeleted: readonly string[];
  readonly safetyVerification: 'passed';
}

export class RetentionLifecycleManager {
  private readonly db: ISqlDatabaseClient;
  private readonly objectStore: IObjectStore;
  readonly maxRawFixtureAgeDays: number;
  readonly maxEvaluationRunSummaryAgeDays: number;
  readonly keepLastEvaluationRuns: number;
  readonly pruneTransientProjections: boolean;
  readonly dryRun: boolean;

  constructor(db: ISqlDatabaseClient, objectStore: IObjectStore, options?: RetentionPolicyOptions) {
    this.db = db;
    this.objectStore = objectStore;

    // Horizon 1: default 14 days for raw fixtures
    this.maxRawFixtureAgeDays =
      options?.maxRawFixtureAgeDays ??
      (options?.maxEvaluationRunAgeDays !== undefined ? options.maxEvaluationRunAgeDays : 14);

    // Horizon 2: default 90 days for summary metrics
    this.maxEvaluationRunSummaryAgeDays =
      options?.maxEvaluationRunSummaryAgeDays ?? options?.maxEvaluationRunAgeDays ?? 90;

    this.keepLastEvaluationRuns = options?.keepLastEvaluationRuns ?? 10;
    this.pruneTransientProjections = options?.pruneTransientProjections ?? true;
    this.dryRun = options?.dryRun ?? false;
  }

  /**
   * Executable safety check verifying that Tier 1 Class A immutable records
   * (baselines, source revisions, requirement revisions, reconciliation audit records)
   * are never deleted or pruned.
   */
  async verifyRetentionSafety(expectedCounts?: ClassACounts): Promise<ClassACounts> {
    const baselinesRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM baselines;`
    );
    const sourcesRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM source_revisions;`
    );
    const reqsRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM requirement_revisions;`
    );
    const recRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM reconciliation_records;`
    );

    const currentCounts: ClassACounts = {
      baselines: parseInt(baselinesRes.rows[0]?.count ?? '0', 10),
      sourceRevisions: parseInt(sourcesRes.rows[0]?.count ?? '0', 10),
      requirementRevisions: parseInt(reqsRes.rows[0]?.count ?? '0', 10),
      reconciliationRecords: parseInt(recRes.rows[0]?.count ?? '0', 10)
    };

    if (expectedCounts) {
      if (
        currentCounts.baselines < expectedCounts.baselines ||
        currentCounts.sourceRevisions < expectedCounts.sourceRevisions ||
        currentCounts.requirementRevisions < expectedCounts.requirementRevisions ||
        currentCounts.reconciliationRecords < expectedCounts.reconciliationRecords
      ) {
        throw new RetentionSafetyViolationError(
          `Retention safety violation: Class A records were modified or pruned! ` +
            `Expected at least ${JSON.stringify(expectedCounts)}, but found ${JSON.stringify(currentCounts)}`
        );
      }
    }

    return currentCounts;
  }

  async prune(): Promise<RetentionPruneReport> {
    const preSafetyCounts = await this.verifyRetentionSafety();

    const timestamp = new Date().toISOString();
    const now = Date.now();
    const rawFixtureMaxAgeMs = this.maxRawFixtureAgeDays * 24 * 60 * 60 * 1000;
    const summaryMaxAgeMs = this.maxEvaluationRunSummaryAgeDays * 24 * 60 * 60 * 1000;

    // 1. Evaluation Runs (Class C)
    const evalResult = await this.db.query<{
      id: string;
      executed_at: string | Date;
      payload_ref: string | null;
      fixture_results: unknown;
    }>(
      `SELECT id, executed_at, payload_ref, fixture_results FROM evaluation_runs ORDER BY executed_at DESC;`
    );

    const allRuns = evalResult.rows;
    const blobsDeleted: string[] = [];

    // Horizon 2 candidates: runs outside keepLastEvaluationRuns older than maxEvaluationRunSummaryAgeDays
    const horizon2Candidates = allRuns.slice(this.keepLastEvaluationRuns);
    const toPruneSummaryRuns: { id: string; payloadRef: string | null }[] = [];
    const horizon2Ids = new Set<string>();

    for (const run of horizon2Candidates) {
      const executedTime =
        run.executed_at instanceof Date
          ? run.executed_at.getTime()
          : new Date(run.executed_at).getTime();
      if (now - executedTime > summaryMaxAgeMs) {
        toPruneSummaryRuns.push({ id: run.id, payloadRef: run.payload_ref });
        horizon2Ids.add(run.id);
      }
    }

    // Horizon 1 candidates: runs not pruned in Horizon 2, but older than maxRawFixtureAgeDays
    const toPruneRawFixtures: { id: string; payloadRef: string | null }[] = [];
    for (const run of allRuns) {
      if (horizon2Ids.has(run.id)) continue;
      const executedTime =
        run.executed_at instanceof Date
          ? run.executed_at.getTime()
          : new Date(run.executed_at).getTime();
      if (now - executedTime > rawFixtureMaxAgeMs) {
        const hasPayload = Boolean(run.payload_ref);
        const hasFixtures = Array.isArray(run.fixture_results)
          ? run.fixture_results.length > 0
          : Boolean(run.fixture_results);
        if (hasPayload || hasFixtures) {
          toPruneRawFixtures.push({ id: run.id, payloadRef: run.payload_ref });
        }
      }
    }

    if (!this.dryRun) {
      // Execute Horizon 1 (Raw fixtures pruning)
      for (const run of toPruneRawFixtures) {
        await this.db.query(
          `UPDATE evaluation_runs SET fixture_results = '[]'::jsonb, payload_ref = NULL WHERE id = $1;`,
          [run.id]
        );
        if (run.payloadRef) {
          await this.objectStore.deleteObject(run.payloadRef);
          blobsDeleted.push(run.payloadRef);
        }
      }

      // Execute Horizon 2 (Summary runs pruning)
      for (const run of toPruneSummaryRuns) {
        await this.db.query(`DELETE FROM evaluation_runs WHERE id = $1;`, [run.id]);
        if (run.payloadRef) {
          await this.objectStore.deleteObject(run.payloadRef);
          blobsDeleted.push(run.payloadRef);
        }
      }
    }

    // 2. Transient unreferenced projections (Class D)
    const projectionsPruned: { id: string; payloadRef: string | null }[] = [];

    if (this.pruneTransientProjections) {
      const unreferencedProj = await this.db.query<{
        id: string;
        payload_ref: string | null;
      }>(`
        SELECT id, payload_ref FROM projections
        WHERE baseline_id NOT IN (SELECT id FROM baselines)
          AND id NOT IN (SELECT projection_id FROM stories WHERE projection_id IS NOT NULL);
      `);

      for (const p of unreferencedProj.rows) {
        projectionsPruned.push({ id: p.id, payloadRef: p.payload_ref });
      }

      if (projectionsPruned.length > 0 && !this.dryRun) {
        const ids = projectionsPruned.map((p) => p.id);
        for (const id of ids) {
          await this.db.query(`DELETE FROM projections WHERE id = $1;`, [id]);
        }
        for (const p of projectionsPruned) {
          if (p.payloadRef) {
            await this.objectStore.deleteObject(p.payloadRef);
            blobsDeleted.push(p.payloadRef);
          }
        }
      }
    }

    // Execute post-prune safety check
    await this.verifyRetentionSafety(preSafetyCounts);

    return {
      timestamp,
      dryRun: this.dryRun,
      evaluationRunsScanned: allRuns.length,
      rawFixturesPruned: toPruneRawFixtures.length,
      rawFixtureRunIdsPruned: toPruneRawFixtures.map((r) => r.id),
      evaluationRunsPruned: toPruneSummaryRuns.length,
      evaluationRunIdsPruned: toPruneSummaryRuns.map((r) => r.id),
      projectionsPruned: projectionsPruned.length,
      projectionIdsPruned: projectionsPruned.map((p) => p.id),
      blobsDeleted,
      safetyVerification: 'passed'
    };
  }
}
