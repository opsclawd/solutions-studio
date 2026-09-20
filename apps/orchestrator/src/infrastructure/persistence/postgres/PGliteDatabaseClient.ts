import { PGlite } from '@electric-sql/pglite';
import type {
  ISqlDatabaseClient,
  QueryResult,
  QueryResultRow
} from '../../../application/ports/persistence/ISqlDatabaseClient.js';

export interface PGliteDatabaseClientOptions {
  readonly dataDir?: string;
  readonly pgliteInstance?: PGlite;
}

export class PGliteDatabaseClient implements ISqlDatabaseClient {
  private readonly db: PGlite;
  private readonly ownsInstance: boolean;

  constructor(options?: PGliteDatabaseClientOptions | PGlite) {
    if (options instanceof PGlite) {
      this.db = options;
      this.ownsInstance = false;
    } else if (
      options &&
      typeof options === 'object' &&
      'pgliteInstance' in options &&
      options.pgliteInstance
    ) {
      this.db = options.pgliteInstance;
      this.ownsInstance = false;
    } else {
      this.db = new PGlite((options as PGliteDatabaseClientOptions)?.dataDir);
      this.ownsInstance = true;
    }
  }

  async query<T = QueryResultRow>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<QueryResult<T>> {
    const result = await this.db.query<T>(sql, params as unknown[]);
    return {
      rows: result.rows as readonly T[],
      rowCount: result.affectedRows ?? result.rows.length
    };
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async transaction<T>(action: (client: ISqlDatabaseClient) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const txClient: ISqlDatabaseClient = {
        query: async <R = QueryResultRow>(
          sql: string,
          params?: readonly unknown[]
        ): Promise<QueryResult<R>> => {
          const result = await tx.query<R>(sql, params as unknown[]);
          return {
            rows: result.rows as readonly R[],
            rowCount: result.affectedRows ?? result.rows.length
          };
        },
        exec: async (sql: string): Promise<void> => {
          await tx.exec(sql);
        },
        transaction: async <R>(
          nestedAction: (client: ISqlDatabaseClient) => Promise<R>
        ): Promise<R> => {
          // Flatten nested transactions or savepoints
          return nestedAction(txClient);
        },
        withSession: async <R>(
          sessionAction: (client: ISqlDatabaseClient) => Promise<R>
        ): Promise<R> => {
          return sessionAction(txClient);
        },
        close: async (): Promise<void> => {
          // No-op inside transaction
        }
      };
      return action(txClient);
    });
  }

  async withSession<T>(action: (sessionClient: ISqlDatabaseClient) => Promise<T>): Promise<T> {
    return action(this);
  }

  async close(): Promise<void> {
    if (this.ownsInstance) {
      await this.db.close();
    }
  }

  get rawInstance(): PGlite {
    return this.db;
  }
}
