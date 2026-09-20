import type {
  ISqlDatabaseClient,
  QueryResult,
  QueryResultRow
} from '../../../application/ports/persistence/ISqlDatabaseClient.js';

export interface RemotePostgresClientOptions {
  readonly connectionString?: string;
  readonly host?: string;
  readonly port?: number;
  readonly database?: string;
  readonly user?: string;
  readonly password?: string;
  readonly ssl?: boolean | object;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly pool?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly clientFactory?: () => Promise<any> | any;
}

export class RemotePostgresDatabaseClient implements ISqlDatabaseClient {
  private readonly options: RemotePostgresClientOptions;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pool?: any;

  constructor(options: RemotePostgresClientOptions = {}) {
    this.options = options;
    if (options.pool) {
      this.pool = options.pool;
    }
  }

  get connectionString(): string | undefined {
    return this.options.connectionString;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getPool(): Promise<any> {
    if (this.pool) {
      return this.pool;
    }
    if (this.options.clientFactory) {
      this.pool = await this.options.clientFactory();
      return this.pool;
    }
    try {
      // Dynamic import to avoid hard package requirement when running in hermetic WASM/PGlite mode
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pgModule: any = await import('pg' as string);
      const PoolClass = pgModule.default?.Pool ?? pgModule.Pool;
      this.pool = new PoolClass({
        connectionString: this.options.connectionString,
        host: this.options.host,
        port: this.options.port,
        database: this.options.database,
        user: this.options.user,
        password: this.options.password,
        ssl: this.options.ssl
      });
      return this.pool;
    } catch (err) {
      throw new Error(
        `Remote PostgreSQL client requires 'pg' library or an injected pool/clientFactory. Unable to connect to '${this.options.connectionString ?? 'remote postgres'}': ${(err as Error).message}`
      );
    }
  }

  async query<T = QueryResultRow>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<QueryResult<T>> {
    const pool = await this.getPool();
    const res = await pool.query(sql, params as unknown[]);
    return {
      rows: (res.rows ?? []) as readonly T[],
      rowCount: res.rowCount ?? res.rows?.length ?? 0
    };
  }

  async exec(sql: string): Promise<void> {
    const pool = await this.getPool();
    if (typeof pool.exec === 'function') {
      await pool.exec(sql);
    } else {
      await pool.query(sql);
    }
  }

  async withSession<T>(action: (sessionClient: ISqlDatabaseClient) => Promise<T>): Promise<T> {
    const pool = await this.getPool();
    const client = await pool.connect();
    try {
      const sessionClient: ISqlDatabaseClient = {
        query: async <R = QueryResultRow>(
          sql: string,
          params?: readonly unknown[]
        ): Promise<QueryResult<R>> => {
          const res = await client.query(sql, params as unknown[]);
          return {
            rows: (res.rows ?? []) as readonly R[],
            rowCount: res.rowCount ?? res.rows?.length ?? 0
          };
        },
        exec: async (sql: string): Promise<void> => {
          if (typeof client.exec === 'function') {
            await client.exec(sql);
          } else {
            await client.query(sql);
          }
        },
        transaction: async <R>(
          txAction: (txClient: ISqlDatabaseClient) => Promise<R>
        ): Promise<R> => {
          await client.query('BEGIN;');
          try {
            const result = await txAction(sessionClient);
            await client.query('COMMIT;');
            return result;
          } catch (err) {
            await client.query('ROLLBACK;').catch(() => {});
            throw err;
          }
        },
        withSession: async <R>(
          nestedAction: (client: ISqlDatabaseClient) => Promise<R>
        ): Promise<R> => {
          return nestedAction(sessionClient);
        },
        close: async (): Promise<void> => {
          // No-op for session client, connection release is handled in finally
        }
      };
      return await action(sessionClient);
    } finally {
      if (typeof client.release === 'function') {
        client.release();
      }
    }
  }

  async transaction<T>(action: (client: ISqlDatabaseClient) => Promise<T>): Promise<T> {
    return this.withSession((sessionClient) => sessionClient.transaction(action));
  }

  async close(): Promise<void> {
    if (this.pool && typeof this.pool.end === 'function') {
      await this.pool.end();
    }
  }
}
