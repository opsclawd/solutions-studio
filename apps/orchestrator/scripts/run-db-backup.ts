#!/usr/bin/env tsx
import path from 'node:path';
import { BackupService } from '../src/infrastructure/persistence/backup/BackupService.js';
import { RepositoryFactory } from '../src/infrastructure/persistence/RepositoryFactory.js';

async function main() {
  const targetDir = process.argv[2] ?? path.resolve(process.cwd(), `backup-${Date.now()}`);
  console.log(`Starting backup to directory: ${targetDir}`);

  const factory = await RepositoryFactory.createFromEnvironment();
  const db = factory.db;
  const objectStore = factory.objectStore;

  if (!db || !objectStore) {
    throw new Error('Database client and object store are required for database backup.');
  }

  const backupService = new BackupService({
    db,
    objectStore,
    targetDir
  });

  const manifest = await backupService.createBackup();
  console.log(`Backup completed successfully.`);
  console.log(`Manifest: ${JSON.stringify(manifest, null, 2)}`);

  if (factory.close) {
    await factory.close();
  }
}

main().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
