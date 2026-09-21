#!/usr/bin/env tsx
import { RetentionLifecycleManager } from '../src/infrastructure/persistence/lifecycle/RetentionLifecycleManager.js';
import { RepositoryFactory } from '../src/infrastructure/persistence/RepositoryFactory.js';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const maxFixtureAgeIdx = args.indexOf('--max-fixture-age-days');
  const maxRawFixtureAgeDays =
    maxFixtureAgeIdx !== -1 && args[maxFixtureAgeIdx + 1]
      ? parseInt(args[maxFixtureAgeIdx + 1], 10)
      : 14;

  const maxSummaryAgeIdx = args.indexOf('--max-summary-age-days');
  const maxAgeIdx = args.indexOf('--max-age-days');
  const maxSummaryAgeDays =
    maxSummaryAgeIdx !== -1 && args[maxSummaryAgeIdx + 1]
      ? parseInt(args[maxSummaryAgeIdx + 1], 10)
      : maxAgeIdx !== -1 && args[maxAgeIdx + 1]
        ? parseInt(args[maxAgeIdx + 1], 10)
        : 90;

  const keepLastIdx = args.indexOf('--keep-last');
  const keepLast =
    keepLastIdx !== -1 && args[keepLastIdx + 1] ? parseInt(args[keepLastIdx + 1], 10) : 10;

  console.log(
    `Starting retention cleanup (dryRun: ${dryRun}, maxRawFixtureAgeDays: ${maxRawFixtureAgeDays}, maxSummaryAgeDays: ${maxSummaryAgeDays}, keepLast: ${keepLast})...`
  );

  const factory = await RepositoryFactory.createFromEnvironment();
  const db = factory.db;
  const objectStore = factory.objectStore;

  if (!db || !objectStore) {
    throw new Error('Database client and object store are required for retention cleanup.');
  }

  const manager = new RetentionLifecycleManager(db, objectStore, {
    maxRawFixtureAgeDays,
    maxEvaluationRunSummaryAgeDays: maxSummaryAgeDays,
    keepLastEvaluationRuns: keepLast,
    pruneTransientProjections: true,
    dryRun
  });

  const report = await manager.prune();
  console.log('Retention cleanup report:');
  console.log(JSON.stringify(report, null, 2));

  if (factory.close) {
    await factory.close();
  }
}

main().catch((err) => {
  console.error('Retention cleanup failed:', err);
  process.exit(1);
});
