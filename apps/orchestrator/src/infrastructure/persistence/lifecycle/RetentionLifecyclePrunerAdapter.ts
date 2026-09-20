import type { ISqlDatabaseClient } from '../../../application/ports/persistence/ISqlDatabaseClient.js';
import type { IObjectStore } from '../../../application/ports/persistence/IObjectStore.js';
import type {
  IRetentionPruner,
  RetentionPruneOptions,
  RetentionPruneOutput
} from '../../../application/ports/maintenance/IRetentionPruner.js';
import { RetentionLifecycleManager } from './RetentionLifecycleManager.js';

export class RetentionLifecyclePrunerAdapter implements IRetentionPruner {
  constructor(
    private readonly db: ISqlDatabaseClient,
    private readonly objectStore: IObjectStore
  ) {}

  async prune(options?: RetentionPruneOptions): Promise<RetentionPruneOutput> {
    const start = Date.now();
    const manager = new RetentionLifecycleManager(this.db, this.objectStore, {
      maxRawFixtureAgeDays: options?.maxRawFixtureAgeDays,
      maxEvaluationRunSummaryAgeDays: options?.maxSummaryAgeDays,
      keepLastEvaluationRuns: options?.keepLast,
      pruneTransientProjections: options?.pruneTransientProjections,
      dryRun: options?.dryRun
    });

    const report = await manager.prune();
    const durationMs = Date.now() - start;

    return {
      status: report.dryRun ? 'dry-run' : 'completed',
      timestamp: report.timestamp,
      dryRun: report.dryRun,
      prunedFixturesCount: report.rawFixturesPruned,
      prunedSummariesCount: report.evaluationRunsPruned,
      retainedSummariesCount: report.evaluationRunsScanned - report.evaluationRunsPruned,
      prunedProjectionsCount: report.projectionsPruned,
      durationMs
    };
  }
}
