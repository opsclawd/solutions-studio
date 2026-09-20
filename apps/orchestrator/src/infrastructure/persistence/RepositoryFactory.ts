import path from 'node:path';
import type { IRequirementsRepository } from '../../application/ports/persistence/IRequirementsRepository.js';
import type { IObjectStore } from '../../application/ports/persistence/IObjectStore.js';
import type { ISqlDatabaseClient } from '../../application/ports/persistence/ISqlDatabaseClient.js';
import { FilesystemRequirementsRepository } from './filesystem/FilesystemRequirementsRepository.js';
import { PostgresRequirementsRepository } from './postgres/PostgresRequirementsRepository.js';
import { PGliteDatabaseClient } from './postgres/PGliteDatabaseClient.js';
import { RemotePostgresDatabaseClient } from './postgres/RemotePostgresDatabaseClient.js';
import { FilesystemObjectStore } from './object-store/FilesystemObjectStore.js';
import { InMemoryObjectStore } from './object-store/InMemoryObjectStore.js';
import { SchemaMigrationRunner } from './postgres/SchemaMigrationRunner.js';

import { AzureBlobStorageAdapter } from './object-store/AzureBlobStorageAdapter.js';

export interface RepositoryFactoryOptions {
  readonly type?: 'postgres' | 'filesystem';
  readonly connectionString?: string;
  readonly baseDir?: string;
  readonly dataDir?: string;
  readonly dbClient?: ISqlDatabaseClient;
  readonly objectStore?: IObjectStore;
  readonly autoMigrate?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly pool?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly clientFactory?: () => Promise<any> | any;
}

export interface EnvironmentRepositoryComponents {
  readonly repo: IRequirementsRepository;
  readonly db?: ISqlDatabaseClient;
  readonly objectStore?: IObjectStore;
  readonly close?: () => Promise<void>;
}

export type RepositoryEnvironmentResult = IRequirementsRepository & EnvironmentRepositoryComponents;

export class RepositoryFactory {
  static createFromEnvironment(
    options: RepositoryFactoryOptions = {}
  ): RepositoryEnvironmentResult {
    const connectionString = options.connectionString ?? process.env.DATABASE_URL;
    const type =
      options.type ??
      (process.env.STORAGE_TYPE === 'postgres' || Boolean(connectionString)
        ? 'postgres'
        : 'filesystem');

    if (type === 'postgres') {
      let dbClient = options.dbClient;
      if (!dbClient) {
        if (connectionString) {
          if (
            connectionString.startsWith('memory://') ||
            connectionString.startsWith('file://') ||
            connectionString.startsWith('pglite://')
          ) {
            const dataDir = connectionString.replace(/^(memory|file|pglite):\/\//, '');
            dbClient = new PGliteDatabaseClient({
              dataDir: dataDir.length > 0 ? dataDir : undefined
            });
          } else {
            dbClient = new RemotePostgresDatabaseClient({
              connectionString,
              pool: options.pool,
              clientFactory: options.clientFactory
            });
          }
        } else {
          dbClient = new PGliteDatabaseClient({
            dataDir: options.dataDir ?? process.env.PG_DATA_DIR
          });
        }
      }

      let objectStore = options.objectStore;
      if (!objectStore) {
        if (
          process.env.STORAGE_BACKEND === 'azure' ||
          process.env.AZURE_STORAGE_ACCOUNT ||
          process.env.AZURE_STORAGE_ACCOUNT_NAME
        ) {
          objectStore = AzureBlobStorageAdapter.fromEnvironment();
        } else if (options.baseDir || process.env.REQUIREMENTS_STORE_DIR) {
          const base = options.baseDir ?? process.env.REQUIREMENTS_STORE_DIR!;
          objectStore = new FilesystemObjectStore({ baseDir: path.join(base, 'blobs') });
        } else {
          objectStore = new InMemoryObjectStore();
        }
      }

      const repo = new PostgresRequirementsRepository({
        db: dbClient,
        objectStore
      });

      const result = Object.assign(repo, {
        repo,
        db: dbClient,
        objectStore,
        close: async () => {
          await dbClient.close?.();
        }
      });

      return result as RepositoryEnvironmentResult;
    }

    const baseDir =
      options.baseDir ?? process.env.REQUIREMENTS_STORE_DIR ?? path.resolve('.requirements-store');
    const repo = new FilesystemRequirementsRepository({ baseDir });

    const result = Object.assign(repo, {
      repo,
      close: async () => {}
    });

    return result as RepositoryEnvironmentResult;
  }

  static async createRequirementsRepository(
    options: RepositoryFactoryOptions = {}
  ): Promise<RepositoryEnvironmentResult> {
    return createRequirementsRepository(options);
  }
}

export async function createRequirementsRepository(
  options: RepositoryFactoryOptions = {}
): Promise<RepositoryEnvironmentResult> {
  const result = RepositoryFactory.createFromEnvironment(options);

  if (result instanceof PostgresRequirementsRepository && options.autoMigrate !== false) {
    if (result.db) {
      const runner = new SchemaMigrationRunner({ db: result.db });
      await runner.migrate();
    }
  }

  return result;
}
