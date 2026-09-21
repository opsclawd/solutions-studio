import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDatabaseClient } from '../../../src/infrastructure/persistence/postgres/PGliteDatabaseClient.js';
import { PostgresRequirementsRepository } from '../../../src/infrastructure/persistence/postgres/PostgresRequirementsRepository.js';
import { InMemoryObjectStore } from '../../../src/infrastructure/persistence/object-store/InMemoryObjectStore.js';
import { SchemaMigrationRunner } from '../../../src/infrastructure/persistence/postgres/SchemaMigrationRunner.js';
import { runPhase1ExitGate } from '../../../src/application/harness/runPhase1ExitGate.js';
import { createPhase1TestAdapter } from '../../harness/createPhase1ExitGateAdapter.js';
import { runPhase2ExitGate } from '../../../src/application/harness/runPhase2ExitGate.js';
import { createPhase2TestAdapter } from '../../harness/createPhase2ExitGateAdapter.js';
import { runPhase3ExitGate } from '../../../src/application/harness/runPhase3ExitGate.js';
import { createPhase3TestAdapter } from '../../harness/createPhase3ExitGateAdapter.js';

describe('Exit Gates against Production Postgres Persistence (AC-7)', () => {
  let pgliteInstance: PGlite;
  let dbClient: PGliteDatabaseClient;
  let objectStore: InMemoryObjectStore;

  beforeEach(async () => {
    pgliteInstance = new PGlite();
    dbClient = new PGliteDatabaseClient({ pgliteInstance });
    objectStore = new InMemoryObjectStore();
    const runner = new SchemaMigrationRunner({ db: dbClient });
    await runner.migrate();
  });

  afterEach(async () => {
    await pgliteInstance.close().catch(() => {});
  });

  it('runs Phase 1 exit gate green using PostgresRequirementsRepository', async () => {
    const baseAdapter = createPhase1TestAdapter();
    const repository = new PostgresRequirementsRepository({
      db: dbClient,
      objectStore
    });

    const result = await runPhase1ExitGate({
      adapter: {
        ...baseAdapter,
        createRepository: () => repository
      },
      silent: true
    });

    expect(result.success).toBe(true);
    expect(result.capturedSourceRevisionCount).toBeGreaterThan(0);
    expect(result.compiledRequirementCount).toBeGreaterThan(0);
    expect(result.baseline.id).toBe('BASE-CANONICAL-MESSY-001');
    expect(result.reloadedBaseline.id).toBe('BASE-CANONICAL-MESSY-001');
    expect(result.projectionResult.content).toBeTruthy();
    expect(result.evaluationReport.aggregateScores.failedFixtures).toBe(0);
  });

  it('runs Phase 2 exit gate green using PostgresRequirementsRepository', async () => {
    const baseAdapter = createPhase2TestAdapter();
    const repository = new PostgresRequirementsRepository({
      db: dbClient,
      objectStore
    });

    const result = await runPhase2ExitGate({
      adapter: {
        ...baseAdapter,
        createRepository: () => repository
      },
      silent: true
    });

    expect(result.success).toBe(true);
    expect(result.startingBaseline.id).toBe('BASE-001');
    expect(result.successorBaseline.id).toBe('BASE-002');
    expect(result.immutabilityVerification.baselineAUntouched).toBe(true);
    expect(result.immutabilityVerification.duplicateBaselineOverwriteRejected).toBe(true);
  });

  it('runs Phase 3 exit gate green using PostgresRequirementsRepository', async () => {
    const baseAdapter = createPhase3TestAdapter();
    const repository = new PostgresRequirementsRepository({
      db: dbClient,
      objectStore
    });

    const result = await runPhase3ExitGate({
      adapter: {
        ...baseAdapter,
        createRepository: () => repository
      },
      silent: true
    });

    expect(result.success).toBe(true);
    expect(result.observedIdentities).toHaveLength(6);
    expect(result.startingBaseline.id).toBe('BASE-001');
    expect(result.successorBaseline.id).toBe('BASE-002');
  }, 120_000);
});
