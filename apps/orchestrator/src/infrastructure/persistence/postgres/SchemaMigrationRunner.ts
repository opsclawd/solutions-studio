import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ISqlDatabaseClient } from '../../../application/ports/persistence/ISqlDatabaseClient.js';

export interface MigrationFile {
  readonly version: number;
  readonly name: string;
  readonly filename: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: Date;
}

export interface MigrationStatus {
  readonly currentVersion: number;
  readonly latestAvailableVersion: number;
  readonly appliedCount: number;
  readonly pendingCount: number;
}

export class MigrationChecksumMismatchError extends Error {
  constructor(
    public readonly version: number,
    public readonly name: string,
    public readonly expectedChecksum: string,
    public readonly actualChecksum: string
  ) {
    super(
      `Migration checksum mismatch for version ${version} (${name}): database has '${expectedChecksum}', but migration file has '${actualChecksum}'`
    );
    this.name = 'MigrationChecksumMismatchError';
  }
}

export interface SchemaMigrationRunnerOptions {
  readonly db: ISqlDatabaseClient;
  readonly migrationsDir?: string;
  readonly migrations?: readonly MigrationFile[];
}

export class SchemaMigrationRunner {
  private readonly db: ISqlDatabaseClient;
  private readonly migrationsDir: string;
  private readonly explicitMigrations?: readonly MigrationFile[];
  private static readonly MIGRATION_LOCK_ID = 987654;

  constructor(options: SchemaMigrationRunnerOptions) {
    this.db = options.db;
    if (options.migrationsDir) {
      this.migrationsDir = options.migrationsDir;
    } else {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      this.migrationsDir = path.resolve(currentDir, 'migrations');
    }
    this.explicitMigrations = options.migrations;
  }

  async loadAvailableMigrations(): Promise<readonly MigrationFile[]> {
    if (this.explicitMigrations) {
      return [...this.explicitMigrations].sort((a, b) => a.version - b.version);
    }

    try {
      const files = await fs.readdir(this.migrationsDir);
      const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();
      const migrations: MigrationFile[] = [];

      for (const file of sqlFiles) {
        const match = file.match(/^(\d+)_(.+)\.sql$/);
        if (!match) {
          continue;
        }
        const version = parseInt(match[1], 10);
        const name = match[2];
        const filePath = path.join(this.migrationsDir, file);
        const sql = await fs.readFile(filePath, 'utf8');
        const checksum = crypto.createHash('sha256').update(sql).digest('hex');

        migrations.push({
          version,
          name,
          filename: file,
          sql,
          checksum
        });
      }

      migrations.sort((a, b) => a.version - b.version);
      return migrations;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async ensureMigrationsTable(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
          version INT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          checksum VARCHAR(64) NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  async getAppliedMigrations(): Promise<readonly AppliedMigration[]> {
    await this.ensureMigrationsTable();
    const result = await this.db.query<{
      version: number;
      name: string;
      checksum: string;
      applied_at: string | Date;
    }>(`SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC;`);

    return result.rows.map((r) => ({
      version: typeof r.version === 'number' ? r.version : parseInt(String(r.version), 10),
      name: r.name,
      checksum: r.checksum,
      appliedAt: r.applied_at instanceof Date ? r.applied_at : new Date(r.applied_at)
    }));
  }

  async getPendingMigrations(): Promise<readonly MigrationFile[]> {
    const available = await this.loadAvailableMigrations();
    const applied = await this.getAppliedMigrations();
    const appliedVersions = new Set(applied.map((a) => a.version));

    // Verify existing checksums
    for (const app of applied) {
      const avail = available.find((a) => a.version === app.version);
      if (avail && avail.checksum !== app.checksum) {
        throw new MigrationChecksumMismatchError(
          app.version,
          app.name,
          app.checksum,
          avail.checksum
        );
      }
    }

    return available.filter((a) => !appliedVersions.has(a.version));
  }

  async status(): Promise<MigrationStatus> {
    const available = await this.loadAvailableMigrations();
    const applied = await this.getAppliedMigrations();
    const currentVersion = applied.length > 0 ? applied[applied.length - 1].version : 0;
    const latestAvailableVersion =
      available.length > 0 ? available[available.length - 1].version : 0;
    const pending = await this.getPendingMigrations();

    return {
      currentVersion,
      latestAvailableVersion,
      appliedCount: applied.length,
      pendingCount: pending.length
    };
  }

  async migrate(): Promise<{ readonly applied: readonly AppliedMigration[] }> {
    // Acquire advisory lock
    await this.db.query('SELECT pg_advisory_lock($1);', [SchemaMigrationRunner.MIGRATION_LOCK_ID]);
    try {
      await this.ensureMigrationsTable();
      const pending = await this.getPendingMigrations();
      const newlyApplied: AppliedMigration[] = [];

      for (const migration of pending) {
        await this.db.transaction(async (tx) => {
          await tx.exec(migration.sql);
          await tx.query(
            `INSERT INTO schema_migrations (version, name, checksum, applied_at)
             VALUES ($1, $2, $3, NOW());`,
            [migration.version, migration.name, migration.checksum]
          );
        });

        newlyApplied.push({
          version: migration.version,
          name: migration.name,
          checksum: migration.checksum,
          appliedAt: new Date()
        });
      }

      return { applied: Object.freeze(newlyApplied) };
    } finally {
      await this.db.query('SELECT pg_advisory_unlock($1);', [
        SchemaMigrationRunner.MIGRATION_LOCK_ID
      ]);
    }
  }
}
