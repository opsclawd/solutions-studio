import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createRequirementsBaselineId } from '@solutions-studio/domain';
import { PGliteDatabaseClient } from '../../../src/infrastructure/persistence/postgres/PGliteDatabaseClient.js';
import { SchemaMigrationRunner } from '../../../src/infrastructure/persistence/postgres/SchemaMigrationRunner.js';
import { PostgresRequirementsRepository } from '../../../src/infrastructure/persistence/postgres/PostgresRequirementsRepository.js';
import { InMemoryObjectStore } from '../../../src/infrastructure/persistence/object-store/InMemoryObjectStore.js';
import type {
  ISqlDatabaseClient,
  QueryResultRow
} from '../../../src/application/ports/persistence/ISqlDatabaseClient.js';

class SimulatedConnectionPool implements ISqlDatabaseClient {
  private readonly connections: { id: string; client: PGliteDatabaseClient; inUse: boolean }[];
  private readonly advisoryLocks = new Map<
    string,
    { holderSessionId: string; queue: (() => void)[] }
  >();
  public activeSessionsCount = 0;

  constructor(instances: PGliteDatabaseClient[]) {
    this.connections = instances.map((client, idx) => ({
      id: `conn-${idx + 1}`,
      client,
      inUse: false
    }));
  }

  private acquireConnection(): { id: string; client: PGliteDatabaseClient; inUse: boolean } {
    const conn = this.connections.find((c) => !c.inUse);
    if (!conn) {
      throw new Error('Connection pool exhausted: no available connections');
    }
    conn.inUse = true;
    return conn;
  }

  private releaseConnection(conn: { inUse: boolean }) {
    conn.inUse = false;
  }

  async withSession<T>(action: (client: ISqlDatabaseClient) => Promise<T>): Promise<T> {
    const conn = this.acquireConnection();
    this.activeSessionsCount++;
    const sessionClient = this.createSessionClient(conn.id, conn.client);
    try {
      return await action(sessionClient);
    } finally {
      this.activeSessionsCount--;
      this.releaseConnection(conn);
    }
  }

  private createSessionClient(
    sessionId: string,
    underlying: PGliteDatabaseClient
  ): ISqlDatabaseClient {
    const client: ISqlDatabaseClient = {
      query: async <T = QueryResultRow>(sql: string, params?: readonly unknown[]) => {
        if (sql.includes('pg_advisory_lock(')) {
          const lockKey = String(params?.[0] ?? 'default');
          await this.acquireAdvisoryLock(sessionId, lockKey);
          return { rows: [{ pg_advisory_lock: null } as T], rowCount: 1 };
        }
        if (sql.includes('pg_advisory_unlock(')) {
          const lockKey = String(params?.[0] ?? 'default');
          const unlocked = this.releaseAdvisoryLock(sessionId, lockKey);
          return { rows: [{ pg_advisory_unlock: unlocked } as T], rowCount: 1 };
        }
        return underlying.query<T>(sql, params);
      },
      exec: (sql: string) => underlying.exec(sql),
      transaction: <T>(action: (txClient: ISqlDatabaseClient) => Promise<T>) => {
        return underlying.transaction(action);
      },
      close: () => underlying.close(),
      withSession: async <T>(action: (s: ISqlDatabaseClient) => Promise<T>) => action(client)
    };
    return client;
  }

  private async acquireAdvisoryLock(sessionId: string, lockKey: string): Promise<void> {
    const current = this.advisoryLocks.get(lockKey);
    if (!current) {
      this.advisoryLocks.set(lockKey, { holderSessionId: sessionId, queue: [] });
      return;
    }
    if (current.holderSessionId === sessionId) {
      return;
    }

    await new Promise<void>((resolve) => {
      current.queue.push(resolve);
    });
    current.holderSessionId = sessionId;
  }

  private releaseAdvisoryLock(sessionId: string, lockKey: string): boolean {
    const current = this.advisoryLocks.get(lockKey);
    if (!current || current.holderSessionId !== sessionId) {
      return false;
    }

    const nextWaiter = current.queue.shift();
    if (nextWaiter) {
      nextWaiter();
    } else {
      this.advisoryLocks.delete(lockKey);
    }
    return true;
  }

  async query<T = QueryResultRow>(sql: string, params?: readonly unknown[]) {
    const conn = this.acquireConnection();
    try {
      return await conn.client.query<T>(sql, params);
    } finally {
      this.releaseConnection(conn);
    }
  }

  async exec(sql: string) {
    const conn = this.acquireConnection();
    try {
      await conn.client.exec(sql);
    } finally {
      this.releaseConnection(conn);
    }
  }

  async transaction<T>(action: (txClient: ISqlDatabaseClient) => Promise<T>): Promise<T> {
    const conn = this.acquireConnection();
    try {
      return await conn.client.transaction(action);
    } finally {
      this.releaseConnection(conn);
    }
  }

  async close() {
    for (const c of this.connections) {
      await c.client.close().catch(() => {});
    }
  }
}

describe('Pooled Baseline Lock Multi-Connection Integration', () => {
  let pglite1: PGlite;
  let pglite2: PGlite;
  let client1: PGliteDatabaseClient;
  let client2: PGliteDatabaseClient;
  let pool: SimulatedConnectionPool;
  let repo: PostgresRequirementsRepository;
  let objectStore: InMemoryObjectStore;

  beforeEach(async () => {
    pglite1 = new PGlite();
    client1 = new PGliteDatabaseClient({ pgliteInstance: pglite1 });
    const runner1 = new SchemaMigrationRunner({ db: client1 });
    await runner1.migrate();

    pglite2 = new PGlite();
    client2 = new PGliteDatabaseClient({ pgliteInstance: pglite2 });
    const runner2 = new SchemaMigrationRunner({ db: client2 });
    await runner2.migrate();

    pool = new SimulatedConnectionPool([client1, client2]);
    objectStore = new InMemoryObjectStore();
    repo = new PostgresRequirementsRepository({
      db: pool,
      objectStore
    });
  }, 30000);

  afterEach(async () => {
    await pool.close();
    await pglite1.close().catch(() => {});
    await pglite2.close().catch(() => {});
  });

  it('serializes two competing clients on a connection pool while committing inner transactions', async () => {
    const baselineId = createRequirementsBaselineId('BASE-POOLED-001');
    const executionEvents: string[] = [];

    // Client 1: acquires baseline lock, runs an inner transaction, commits, then finishes
    const client1Promise = repo.withBaselineLock(baselineId, async () => {
      executionEvents.push('client1:start');

      // Inner transaction committed inside the lock
      await repo.activeDb.transaction(async (tx) => {
        executionEvents.push('client1:tx_start');
        await tx.query('SELECT 1;');
        executionEvents.push('client1:tx_commit');
      });

      // Sleep briefly after inner transaction commit to verify the lock is still held
      await new Promise((r) => setTimeout(r, 60));
      executionEvents.push('client1:end');
      return 'client1_done';
    });

    // Client 2: concurrently attempts to acquire the same baseline lock
    // Small delay ensures client1 enters first
    await new Promise((r) => setTimeout(r, 10));

    const client2Promise = repo.withBaselineLock(baselineId, async () => {
      executionEvents.push('client2:start');

      // Inner transaction for client 2
      await repo.activeDb.transaction(async (tx) => {
        executionEvents.push('client2:tx_start');
        await tx.query('SELECT 1;');
        executionEvents.push('client2:tx_commit');
      });

      executionEvents.push('client2:end');
      return 'client2_done';
    });

    const [res1, res2] = await Promise.all([client1Promise, client2Promise]);

    expect(res1).toBe('client1_done');
    expect(res2).toBe('client2_done');

    // Verify strict mutual exclusion: client 1 completely finishes before client 2 starts
    expect(executionEvents).toEqual([
      'client1:start',
      'client1:tx_start',
      'client1:tx_commit',
      'client1:end',
      'client2:start',
      'client2:tx_start',
      'client2:tx_commit',
      'client2:end'
    ]);
  });

  it('allows concurrent locks on different baselines across pooled connections', async () => {
    const baseline1 = createRequirementsBaselineId('BASE-POOLED-DIFF-1');
    const baseline2 = createRequirementsBaselineId('BASE-POOLED-DIFF-2');
    const events: string[] = [];

    const task1 = repo.withBaselineLock(baseline1, async () => {
      events.push('task1:start');
      await new Promise((r) => setTimeout(r, 50));
      events.push('task1:end');
    });

    const task2 = repo.withBaselineLock(baseline2, async () => {
      events.push('task2:start');
      await new Promise((r) => setTimeout(r, 50));
      events.push('task2:end');
    });

    await Promise.all([task1, task2]);

    // Both should have started before either finished (concurrent execution)
    expect(events.indexOf('task1:start')).toBeLessThan(events.indexOf('task1:end'));
    expect(events.indexOf('task2:start')).toBeLessThan(events.indexOf('task2:end'));
    expect(events).toContain('task1:start');
    expect(events).toContain('task2:start');
  });

  it('releases lock and allows next client to proceed even when action throws', async () => {
    const baselineId = createRequirementsBaselineId('BASE-POOLED-FAIL');
    const events: string[] = [];

    const failingTask = repo
      .withBaselineLock(baselineId, async () => {
        events.push('fail_client:start');
        await repo.activeDb.transaction(async (tx) => {
          await tx.query('SELECT 1;');
        });
        events.push('fail_client:throw');
        throw new Error('Simulated failure inside locked action');
      })
      .catch((err: Error) => err);

    await new Promise((r) => setTimeout(r, 10));

    const succeedingTask = repo.withBaselineLock(baselineId, async () => {
      events.push('succ_client:start');
      events.push('succ_client:end');
      return 'recovered';
    });

    const [err, res] = await Promise.all([failingTask, succeedingTask]);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Simulated failure inside locked action');

    expect(res).toBe('recovered');
    expect(events).toEqual([
      'fail_client:start',
      'fail_client:throw',
      'succ_client:start',
      'succ_client:end'
    ]);
  });
});
