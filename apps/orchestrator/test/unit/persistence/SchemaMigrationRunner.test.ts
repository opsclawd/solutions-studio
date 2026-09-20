import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDatabaseClient } from '../../../src/infrastructure/persistence/postgres/PGliteDatabaseClient.js';
import {
  SchemaMigrationRunner,
  MigrationChecksumMismatchError,
  type MigrationFile
} from '../../../src/infrastructure/persistence/postgres/SchemaMigrationRunner.js';

describe('SchemaMigrationRunner', () => {
  let pglite: PGlite;
  let db: PGliteDatabaseClient;

  beforeEach(async () => {
    pglite = new PGlite();
    db = new PGliteDatabaseClient({ pgliteInstance: pglite });
  }, 30000);

  afterEach(async () => {
    await db.close();
    await pglite.close();
  });

  it('applies the built-in production migrations cleanly', async () => {
    const runner = new SchemaMigrationRunner({ db });

    const statusBefore = await runner.status();
    expect(statusBefore.currentVersion).toBe(0);
    expect(statusBefore.pendingCount).toBeGreaterThanOrEqual(2);

    const result = await runner.migrate();
    expect(result.applied.length).toBeGreaterThanOrEqual(4);
    expect(result.applied[0].version).toBe(1);
    expect(result.applied[1].version).toBe(2);
    expect(result.applied[2].version).toBe(3);
    expect(result.applied[3].version).toBe(4);

    const statusAfter = await runner.status();
    expect(statusAfter.pendingCount).toBe(0);
    expect(statusAfter.currentVersion).toBe(4);

    // Verify tables exist
    const tables = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public';`
    );
    const tableNames = tables.rows.map((t) => t.tablename);
    expect(tableNames).toContain('sources');
    expect(tableNames).toContain('source_revisions');
    expect(tableNames).toContain('requirements');
    expect(tableNames).toContain('requirement_revisions');
    expect(tableNames).toContain('candidate_findings');
    expect(tableNames).toContain('reconciliation_records');
    expect(tableNames).toContain('baselines');
    expect(tableNames).toContain('policy_constraints');
    expect(tableNames).toContain('policy_constraint_revisions');
    expect(tableNames).toContain('engineering_decisions');
    expect(tableNames).toContain('projections');
    expect(tableNames).toContain('stories');
    expect(tableNames).toContain('evaluation_runs');
    expect(tableNames).toContain('validation_runs');
    expect(tableNames).toContain('governance_approvals');
    expect(tableNames).toContain('backlog_export_mappings');
    expect(tableNames).toContain('schema_migrations');
  }, 30000);

  it('is idempotent on subsequent runs', async () => {
    const runner = new SchemaMigrationRunner({ db });
    await runner.migrate();

    const secondRun = await runner.migrate();
    expect(secondRun.applied.length).toBe(0);

    const status = await runner.status();
    expect(status.pendingCount).toBe(0);
  }, 30000);

  it('detects and rejects checksum mismatch on altered migration', async () => {
    const migrations: MigrationFile[] = [
      {
        version: 1,
        name: 'test_migration',
        filename: '001_test.sql',
        sql: 'CREATE TABLE t1 (id INT PRIMARY KEY);',
        checksum: 'original_checksum_111'
      }
    ];

    const runner = new SchemaMigrationRunner({ db, migrations });
    await runner.migrate();

    // Now pretend file content was altered
    const alteredMigrations: MigrationFile[] = [
      {
        version: 1,
        name: 'test_migration',
        filename: '001_test.sql',
        sql: 'CREATE TABLE t1 (id INT PRIMARY KEY, name TEXT);',
        checksum: 'tampered_checksum_222'
      }
    ];

    const runnerAltered = new SchemaMigrationRunner({ db, migrations: alteredMigrations });
    await expect(runnerAltered.getPendingMigrations()).rejects.toThrow(
      MigrationChecksumMismatchError
    );
  }, 30000);

  it('rolls back failed migration inside transaction', async () => {
    const migrations: MigrationFile[] = [
      {
        version: 1,
        name: 'valid_migration',
        filename: '001_valid.sql',
        sql: 'CREATE TABLE t_valid (id INT PRIMARY KEY);',
        checksum: 'c1'
      },
      {
        version: 2,
        name: 'failing_migration',
        filename: '002_fail.sql',
        sql: 'SYNTAX ERROR INVALID SQL;',
        checksum: 'c2'
      }
    ];

    const runner = new SchemaMigrationRunner({ db, migrations });
    await expect(runner.migrate()).rejects.toThrow();

    const applied = await runner.getAppliedMigrations();
    expect(applied.length).toBe(1);
    expect(applied[0].version).toBe(1);
  }, 30000);
});
