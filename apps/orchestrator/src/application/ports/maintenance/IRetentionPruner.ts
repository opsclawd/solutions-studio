export interface RetentionPruneOptions {
  readonly maxRawFixtureAgeDays?: number;
  readonly maxSummaryAgeDays?: number;
  readonly keepLast?: number;
  readonly pruneTransientProjections?: boolean;
  readonly dryRun?: boolean;
}

export interface RetentionPruneOutput {
  readonly status: 'completed' | 'dry-run';
  readonly timestamp: string;
  readonly dryRun: boolean;
  readonly prunedFixturesCount: number;
  readonly prunedSummariesCount: number;
  readonly retainedSummariesCount: number;
  readonly prunedProjectionsCount: number;
  readonly durationMs: number;
}

export interface IRetentionPruner {
  prune(options?: RetentionPruneOptions): Promise<RetentionPruneOutput>;
}
