import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDatabaseClient } from '../../../src/infrastructure/persistence/postgres/PGliteDatabaseClient.js';
import { SchemaMigrationRunner } from '../../../src/infrastructure/persistence/postgres/SchemaMigrationRunner.js';
import { PostgresRequirementsRepository } from '../../../src/infrastructure/persistence/postgres/PostgresRequirementsRepository.js';
import { InMemoryObjectStore } from '../../../src/infrastructure/persistence/object-store/InMemoryObjectStore.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { TestAuthenticator } from '../../../src/infrastructure/identity/TestAuthenticator.js';

describe('Retention Scheduling & Maintenance Route API', () => {
  let pglite: PGlite;
  let dbClient: PGliteDatabaseClient;
  let repo: PostgresRequirementsRepository;
  let objectStore: InMemoryObjectStore;

  beforeEach(async () => {
    pglite = new PGlite();
    dbClient = new PGliteDatabaseClient({ pgliteInstance: pglite });
    const runner = new SchemaMigrationRunner({ db: dbClient });
    await runner.migrate();

    objectStore = new InMemoryObjectStore();
    repo = new PostgresRequirementsRepository({
      db: dbClient,
      objectStore
    });
  });

  afterEach(async () => {
    await dbClient.close().catch(() => {});
    await pglite.close().catch(() => {});
  });

  it('rejects retention pruning when caller lacks operator:admin capability', async () => {
    const server = composeOrchestratorHttpServer({
      repository: repo,
      authenticator: new TestAuthenticator(),
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });
    await server.app.ready();

    try {
      // test:reviewer has requirements:reconcile and candidate:approve, but NOT operator:admin
      const res = await server.app.inject({
        method: 'POST',
        url: '/api/admin/maintenance/retention',
        headers: {
          authorization: 'Bearer test:reviewer',
          'content-type': 'application/json'
        },
        payload: {
          dryRun: true
        }
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.code).toBe('FORBIDDEN');
    } finally {
      await server.app.close();
    }
  });

  it('allows retention pruning when caller has operator:admin capability', async () => {
    const server = composeOrchestratorHttpServer({
      repository: repo,
      authenticator: new TestAuthenticator(),
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });
    await server.app.ready();

    try {
      // test:admin has operator:admin capability
      const res = await server.app.inject({
        method: 'POST',
        url: '/api/admin/maintenance/retention',
        headers: {
          authorization: 'Bearer test:admin',
          'content-type': 'application/json'
        },
        payload: {
          dryRun: true,
          maxRawFixtureAgeDays: 14,
          maxSummaryAgeDays: 90,
          keepLast: 10
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('dry-run');
      expect(body.dryRun).toBe(true);
      expect(body.prunedFixturesCount).toBeDefined();
      expect(body.prunedSummariesCount).toBeDefined();
      expect(body.retainedSummariesCount).toBeDefined();
      expect(body.timestamp).toBeDefined();
    } finally {
      await server.app.close();
    }
  });

  it('verifies version-controlled crontab and docker-compose maintenance scheduler configuration', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const rootDir = fs.existsSync(path.resolve(process.cwd(), 'infra/pilot/crontab'))
      ? process.cwd()
      : path.resolve(process.cwd(), '../..');

    const crontabPath = path.resolve(rootDir, 'infra/pilot/crontab');
    expect(fs.existsSync(crontabPath)).toBe(true);
    const crontabContent = fs.readFileSync(crontabPath, 'utf8');
    expect(crontabContent).toContain('0 3 * * *');
    expect(crontabContent).toContain('run-retention-cleanup.js');

    const composePath = path.resolve(rootDir, 'infra/pilot/docker-compose.yml');
    expect(fs.existsSync(composePath)).toBe(true);
    const composeContent = fs.readFileSync(composePath, 'utf8');
    expect(composeContent).toContain('maintenance-scheduler:');
    expect(composeContent).toContain('crontab:/etc/crontabs/root:ro');
  });

  it('preserves Tier 1 Class A baselines and revisions during live retention pruning', async () => {
    const {
      createRequirementRevision,
      createRequirementsBaseline,
      createRequirementId,
      createRequirementRevisionId,
      createRequirementsBaselineId,
      createReviewerId,
      now
    } = await import('@solutions-studio/domain');

    // Create Class A requirement and baseline
    const rev = createRequirementRevision({
      id: createRequirementRevisionId('REQ-CLASS-A-R1'),
      requirementId: createRequirementId('REQ-CLASS-A'),
      revision: 1,
      statement: 'Class A immutable requirement statement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BL-CLASS-A'),
      requirements: [rev],
      policyConstraints: [],
      createdBy: createReviewerId('rev-01'),
      createdAt: now()
    });
    await repo.saveRequirementsBaseline(baseline);

    // Execute retention pruning (non dry-run)
    const server = composeOrchestratorHttpServer({
      repository: repo,
      authenticator: new TestAuthenticator(),
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });
    await server.app.ready();

    try {
      const res = await server.app.inject({
        method: 'POST',
        url: '/api/admin/maintenance/retention',
        headers: {
          authorization: 'Bearer test:admin',
          'content-type': 'application/json'
        },
        payload: {
          dryRun: false,
          maxRawFixtureAgeDays: 14,
          maxSummaryAgeDays: 90,
          keepLast: 10
        }
      });

      expect(res.statusCode).toBe(200);

      // Verify Class A baseline and requirement revision remain completely intact
      const fetchedBaseline = await repo.getRequirementsBaseline(baseline.id);
      expect(fetchedBaseline).toBeDefined();
      expect(fetchedBaseline?.id).toBe(baseline.id);

      const fetchedRev = await repo.getRequirementRevision(rev.id);
      expect(fetchedRev).toBeDefined();
      expect(fetchedRev?.id).toBe(rev.id);
    } finally {
      await server.app.close();
    }
  });
});
