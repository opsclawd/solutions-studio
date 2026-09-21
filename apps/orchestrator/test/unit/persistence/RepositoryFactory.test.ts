import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { RepositoryFactory } from '../../../src/infrastructure/persistence/RepositoryFactory.js';
import { PostgresRequirementsRepository } from '../../../src/infrastructure/persistence/postgres/PostgresRequirementsRepository.js';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { RemotePostgresDatabaseClient } from '../../../src/infrastructure/persistence/postgres/RemotePostgresDatabaseClient.js';
import { PGliteDatabaseClient } from '../../../src/infrastructure/persistence/postgres/PGliteDatabaseClient.js';
import { FilesystemObjectStore } from '../../../src/infrastructure/persistence/object-store/FilesystemObjectStore.js';
import { InMemoryObjectStore } from '../../../src/infrastructure/persistence/object-store/InMemoryObjectStore.js';

describe('RepositoryFactory Selection and Composition', () => {
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-factory-test-'));
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    delete process.env.STORAGE_TYPE;
    delete process.env.STORAGE_BACKEND;
    delete process.env.REQUIREMENTS_STORE_DIR;
    delete process.env.PG_DATA_DIR;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('selects FilesystemRequirementsRepository by default when no environment vars are set', async () => {
    const result = RepositoryFactory.createFromEnvironment({ baseDir: tempDir });
    expect(result).toBeInstanceOf(FilesystemRequirementsRepository);
    expect(result.repo).toBeInstanceOf(FilesystemRequirementsRepository);
    if (result.close) await result.close();
  });

  it('selects RemotePostgresDatabaseClient when remote postgres connectionString is provided in options', async () => {
    const connStr = 'postgres://testuser:testpass@db.example.com:5432/solutions_studio';
    const result = RepositoryFactory.createFromEnvironment({ connectionString: connStr });

    expect(result).toBeInstanceOf(PostgresRequirementsRepository);
    expect(result.db).toBeInstanceOf(RemotePostgresDatabaseClient);
    expect((result.db as RemotePostgresDatabaseClient).connectionString).toBe(connStr);
    expect(result.objectStore).toBeInstanceOf(InMemoryObjectStore);
    if (result.close) await result.close();
  });

  it('selects RemotePostgresDatabaseClient when DATABASE_URL environment variable is set to postgres://', async () => {
    process.env.DATABASE_URL = 'postgresql://admin:secret@10.0.0.5:5432/prod_db';
    const result = RepositoryFactory.createFromEnvironment();

    expect(result).toBeInstanceOf(PostgresRequirementsRepository);
    expect(result.db).toBeInstanceOf(RemotePostgresDatabaseClient);
    expect((result.db as RemotePostgresDatabaseClient).connectionString).toBe(
      'postgresql://admin:secret@10.0.0.5:5432/prod_db'
    );
    if (result.close) await result.close();
  });

  it('selects PGliteDatabaseClient when connectionString starts with memory:// or pglite://', async () => {
    const result = RepositoryFactory.createFromEnvironment({ connectionString: 'memory://' });
    expect(result).toBeInstanceOf(PostgresRequirementsRepository);
    expect(result.db).toBeInstanceOf(PGliteDatabaseClient);
    if (result.close) await result.close();
  });

  it('selects PostgresRequirementsRepository with PGlite when STORAGE_TYPE=postgres without connectionString', async () => {
    process.env.STORAGE_TYPE = 'postgres';
    const result = RepositoryFactory.createFromEnvironment();

    expect(result).toBeInstanceOf(PostgresRequirementsRepository);
    expect(result.db).toBeInstanceOf(PGliteDatabaseClient);
    if (result.close) await result.close();
  });

  it('selects FilesystemObjectStore when REQUIREMENTS_STORE_DIR is specified with postgres storage', async () => {
    process.env.STORAGE_TYPE = 'postgres';
    process.env.REQUIREMENTS_STORE_DIR = tempDir;

    const result = RepositoryFactory.createFromEnvironment();
    expect(result).toBeInstanceOf(PostgresRequirementsRepository);
    expect(result.objectStore).toBeInstanceOf(FilesystemObjectStore);
    expect((result.objectStore as FilesystemObjectStore).baseDir).toBe(path.join(tempDir, 'blobs'));
    if (result.close) await result.close();
  });
});
