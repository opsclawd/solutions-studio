import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDatabaseClient } from '../src/infrastructure/persistence/postgres/PGliteDatabaseClient.js';
import { PostgresRequirementsRepository } from '../src/infrastructure/persistence/postgres/PostgresRequirementsRepository.js';
import { FilesystemObjectStore } from '../src/infrastructure/persistence/object-store/FilesystemObjectStore.js';
import { SchemaMigrationRunner } from '../src/infrastructure/persistence/postgres/SchemaMigrationRunner.js';
import { LocalStoreMigrationService } from '../src/infrastructure/persistence/migration/LocalStoreMigrationService.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let sourceDir = path.resolve('.requirements-store');
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      sourceDir = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  console.log(`Starting Local Store Migration from: ${sourceDir}`);
  console.log(`Mode: ${dryRun ? 'DRY-RUN (no writes)' : 'LIVE MIGRATION'}`);

  const dataDir = process.env.PG_DATA_DIR;
  const pglite = new PGlite(dataDir);
  const db = new PGliteDatabaseClient({ pgliteInstance: pglite });

  const migrationRunner = new SchemaMigrationRunner({ db });
  await migrationRunner.migrate();

  const blobsDir = process.env.BLOB_STORE_DIR ?? path.join(sourceDir, '..', 'blobs');
  const objectStore = new FilesystemObjectStore({ baseDir: blobsDir });

  const targetRepo = new PostgresRequirementsRepository({
    db,
    objectStore
  });

  const migrator = new LocalStoreMigrationService({
    sourceDir,
    targetRepo,
    targetDb: db,
    targetObjectStore: objectStore,
    dryRun
  });

  try {
    const report = await migrator.migrate();
    console.log('Migration Completed:');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await db.close();
    await pglite.close();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
