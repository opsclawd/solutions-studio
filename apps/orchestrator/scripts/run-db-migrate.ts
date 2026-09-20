import { PGlite } from '@electric-sql/pglite';
import { PGliteDatabaseClient } from '../src/infrastructure/persistence/postgres/PGliteDatabaseClient.js';
import { SchemaMigrationRunner } from '../src/infrastructure/persistence/postgres/SchemaMigrationRunner.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dataDir = process.env.PG_DATA_DIR;
  const pglite = new PGlite(dataDir);
  const db = new PGliteDatabaseClient({ pgliteInstance: pglite });
  const runner = new SchemaMigrationRunner({ db });

  try {
    if (args.includes('--status')) {
      const status = await runner.status();
      console.log('Database Migration Status:');
      console.log(`  Current Version: ${status.currentVersion}`);
      console.log(`  Latest Available: ${status.latestAvailableVersion}`);
      console.log(`  Applied Migrations: ${status.appliedCount}`);
      console.log(`  Pending Migrations: ${status.pendingCount}`);
      return;
    }

    if (args.includes('--check')) {
      const status = await runner.status();
      if (status.pendingCount > 0) {
        console.error(`Error: ${status.pendingCount} pending migration(s) found.`);
        process.exit(1);
      }
      console.log('All migrations are up to date.');
      return;
    }

    // Default or --up: run pending migrations
    console.log('Applying pending database migrations...');
    const result = await runner.migrate();
    if (result.applied.length === 0) {
      console.log('Database is already up to date. No migrations applied.');
    } else {
      console.log(`Successfully applied ${result.applied.length} migration(s):`);
      for (const m of result.applied) {
        console.log(`  - Version ${m.version}: ${m.name}`);
      }
    }
  } finally {
    await db.close();
    await pglite.close();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
