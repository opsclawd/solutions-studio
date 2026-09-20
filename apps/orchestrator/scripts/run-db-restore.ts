#!/usr/bin/env tsx
import path from 'node:path';
import { RestoreService } from '../src/infrastructure/persistence/backup/RestoreService.js';
import { RepositoryFactory } from '../src/infrastructure/persistence/RepositoryFactory.js';

async function main() {
  const backupDir = process.argv[2];
  if (!backupDir) {
    console.error('Usage: tsx scripts/run-db-restore.ts <path-to-backup-dir>');
    process.exit(1);
  }

  const resolvedDir = path.resolve(process.cwd(), backupDir);
  console.log(`Starting restore from directory: ${resolvedDir}`);

  const factory = await RepositoryFactory.createFromEnvironment();
  const db = factory.db;
  const objectStore = factory.objectStore;
  const repo = factory.repo;

  if (!db || !objectStore) {
    throw new Error('Database client and object store are required for database restore.');
  }

  const restoreService = new RestoreService({
    db,
    objectStore,
    backupDir: resolvedDir,
    repo
  });

  const result = await restoreService.restore();
  console.log(`Restore finished. Verified: ${result.verified}`);
  if (!result.verified) {
    console.error('Errors during post-restore verification:', result.errors);
    process.exit(1);
  }

  console.log(`Verified baselines: ${result.verifiedBaselines.length}`);
  console.log(`Verified source revisions: ${result.verifiedSourceRevisions.length}`);
  console.log(`Verified projections: ${result.verifiedProjections.length}`);
  console.log(`Verified stories: ${result.verifiedStories.length}`);

  if (factory.close) {
    await factory.close();
  }
}

main().catch((err) => {
  console.error('Restore failed:', err);
  process.exit(1);
});
