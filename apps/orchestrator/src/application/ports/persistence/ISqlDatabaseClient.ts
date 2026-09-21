export interface QueryResultRow {
  [column: string]: unknown;
}

export interface QueryResult<T = QueryResultRow> {
  readonly rows: readonly T[];
  readonly rowCount: number;
}

export interface ISqlDatabaseClient {
  query<T = QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  transaction<T>(action: (client: ISqlDatabaseClient) => Promise<T>): Promise<T>;
  withSession<T>(action: (sessionClient: ISqlDatabaseClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
