import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDatabaseClient } from '../../../src/infrastructure/persistence/postgres/PGliteDatabaseClient.js';
import { PostgresRequirementsRepository } from '../../../src/infrastructure/persistence/postgres/PostgresRequirementsRepository.js';
import { FilesystemObjectStore } from '../../../src/infrastructure/persistence/object-store/FilesystemObjectStore.js';
import { SchemaMigrationRunner } from '../../../src/infrastructure/persistence/postgres/SchemaMigrationRunner.js';
import {
  runRequirementsRepositoryContractTests,
  type ContractTestContext
} from './RequirementsRepositoryContractTests.js';

runRequirementsRepositoryContractTests(
  'PostgresRequirementsRepository',
  async (): Promise<ContractTestContext> => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pg-repo-contract-'));
    const dataDir = path.join(tempDir, 'pgdata');
    const blobsDir = path.join(tempDir, 'blobs');

    let pglite = new PGlite(dataDir);
    let db = new PGliteDatabaseClient({ pgliteInstance: pglite });
    const objectStore = new FilesystemObjectStore({ baseDir: blobsDir });

    const migrationRunner = new SchemaMigrationRunner({ db });
    await migrationRunner.migrate();

    const repo = new PostgresRequirementsRepository({
      db,
      objectStore
    });

    return {
      repo,
      cleanup: async () => {
        await db.close().catch(() => {});
        await pglite.close().catch(() => {});
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      },
      reopen: async () => {
        // Simulate restart: close previous connections and reopen
        await db.close().catch(() => {});
        await pglite.close().catch(() => {});

        pglite = new PGlite(dataDir);
        db = new PGliteDatabaseClient({ pgliteInstance: pglite });
        return new PostgresRequirementsRepository({
          db,
          objectStore
        });
      }
    };
  }
);
