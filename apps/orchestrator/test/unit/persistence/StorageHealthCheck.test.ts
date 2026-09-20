import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { PostgresRequirementsRepository } from '../../../src/infrastructure/persistence/postgres/PostgresRequirementsRepository.js';
import { PGliteDatabaseClient } from '../../../src/infrastructure/persistence/postgres/PGliteDatabaseClient.js';
import { SchemaMigrationRunner } from '../../../src/infrastructure/persistence/postgres/SchemaMigrationRunner.js';
import { InMemoryObjectStore } from '../../../src/infrastructure/persistence/object-store/InMemoryObjectStore.js';
import type { IObjectStore } from '../../../src/application/ports/persistence/IObjectStore.js';

describe('Storage Health Checks and Health API Surface', () => {
  describe('Liveness Check', () => {
    it('GET /api/health/live returns 200 and ok status', async () => {
      const composed = composeOrchestratorHttpServer({
        generationGateway: new FakeGenerationGateway(),
        linterGateway: new FakeMermaidLinterGateway()
      });
      const app = composed.app;
      await app.ready();

      try {
        const res = await app.inject({
          method: 'GET',
          url: '/api/health/live'
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'ok' });
      } finally {
        await app.close();
      }
    });
  });

  describe('Filesystem Storage Health', () => {
    let tempDir: string;
    let repo: FilesystemRequirementsRepository;
    let app: FastifyInstance;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-health-test-'));
      repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
      const composed = composeOrchestratorHttpServer({
        repository: repo,
        generationGateway: new FakeGenerationGateway(),
        linterGateway: new FakeMermaidLinterGateway()
      });
      app = composed.app;
      await app.ready();
    });

    afterEach(async () => {
      await app.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('GET /api/health returns 200 ok when filesystem store is healthy', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health'
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });

    it('GET /api/health/ready returns 200 healthy report when accessible', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health/ready'
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('healthy');
      expect(body.database?.status).toBe('healthy');
      expect(body.database?.details?.dialect).toBe('filesystem');
      expect(body.database?.details?.baseDir).toBe(tempDir);
    });

    it('GET /api/health/ready returns 503 unhealthy when store directory is inaccessible', async () => {
      // Point repo to an invalid non-existent, uncreatable path
      const brokenRepo = new FilesystemRequirementsRepository({
        baseDir: '/dev/null/impossible/store-dir'
      });
      const brokenComposed = composeOrchestratorHttpServer({
        repository: brokenRepo,
        generationGateway: new FakeGenerationGateway(),
        linterGateway: new FakeMermaidLinterGateway()
      });
      const brokenApp = brokenComposed.app;
      await brokenApp.ready();

      try {
        const readyRes = await brokenApp.inject({
          method: 'GET',
          url: '/api/health/ready'
        });
        expect(readyRes.statusCode).toBe(503);
        const readyBody = readyRes.json();
        expect(readyBody.status).toBe('unhealthy');
        expect(readyBody.database?.status).toBe('unhealthy');

        const healthRes = await brokenApp.inject({
          method: 'GET',
          url: '/api/health'
        });
        expect(healthRes.statusCode).toBe(503);
      } finally {
        await brokenApp.close();
      }
    });
  });

  describe('PostgreSQL + Object Store Storage Health', () => {
    let pglite: PGlite;
    let dbClient: PGliteDatabaseClient;
    let objectStore: InMemoryObjectStore;
    let repo: PostgresRequirementsRepository;
    let app: FastifyInstance;

    beforeEach(async () => {
      pglite = new PGlite();
      dbClient = new PGliteDatabaseClient({ pgliteInstance: pglite });
      const migrationRunner = new SchemaMigrationRunner({ db: dbClient });
      await migrationRunner.migrate();

      objectStore = new InMemoryObjectStore();
      repo = new PostgresRequirementsRepository({
        db: dbClient,
        objectStore
      });

      const composed = composeOrchestratorHttpServer({
        repository: repo,
        generationGateway: new FakeGenerationGateway(),
        linterGateway: new FakeMermaidLinterGateway()
      });
      app = composed.app;
      await app.ready();
    });

    afterEach(async () => {
      await app.close();
      await pglite.close().catch(() => {});
    });

    it('GET /api/health and /api/health/ready return 200 when database and object store are healthy', async () => {
      const healthRes = await app.inject({
        method: 'GET',
        url: '/api/health'
      });
      expect(healthRes.statusCode).toBe(200);
      expect(healthRes.json()).toEqual({ status: 'ok' });

      const readyRes = await app.inject({
        method: 'GET',
        url: '/api/health/ready'
      });
      expect(readyRes.statusCode).toBe(200);
      const readyBody = readyRes.json();
      expect(readyBody.status).toBe('healthy');
      expect(readyBody.database?.status).toBe('healthy');
      expect(readyBody.database?.details?.dialect).toBe('postgresql');
      expect(readyBody.database?.details?.currentMigration).toBe(3);
      expect(readyBody.objectStore?.status).toBe('healthy');
    });

    it('GET /api/health/ready returns 503 when database is down or queries fail', async () => {
      // Close the underlying database client to simulate database failure
      await pglite.close();

      const readyRes = await app.inject({
        method: 'GET',
        url: '/api/health/ready'
      });
      expect(readyRes.statusCode).toBe(503);
      const readyBody = readyRes.json();
      expect(readyBody.status).toBe('unhealthy');
      expect(readyBody.database?.status).toBe('unhealthy');
      expect(readyBody.database?.message).toBeDefined();

      const healthRes = await app.inject({
        method: 'GET',
        url: '/api/health'
      });
      expect(healthRes.statusCode).toBe(503);
    });

    it('GET /api/health/ready returns 503 when object store health check fails', async () => {
      // Mock object store that fails health check
      const failingObjectStore: IObjectStore = {
        putObject: async (key: string) => ({
          key,
          sizeBytes: 0,
          contentHash: 'hash',
          lastModified: new Date()
        }),
        getObject: async () => undefined,
        getObjectString: async () => undefined,
        deleteObject: async () => true,
        hasObject: async () => false,
        listObjects: async () => [],
        checkHealth: async () => ({
          status: 'unhealthy',
          latencyMs: 120,
          message: 'Azure Blob Storage connection refused: 503 Service Unavailable'
        })
      };

      const failingRepo = new PostgresRequirementsRepository({
        db: dbClient,
        objectStore: failingObjectStore
      });

      const failingComposed = composeOrchestratorHttpServer({
        repository: failingRepo,
        generationGateway: new FakeGenerationGateway(),
        linterGateway: new FakeMermaidLinterGateway()
      });
      const failingApp = failingComposed.app;
      await failingApp.ready();

      try {
        const readyRes = await failingApp.inject({
          method: 'GET',
          url: '/api/health/ready'
        });
        expect(readyRes.statusCode).toBe(503);
        const readyBody = readyRes.json();
        expect(readyBody.status).toBe('unhealthy');
        expect(readyBody.database?.status).toBe('healthy');
        expect(readyBody.objectStore?.status).toBe('unhealthy');
        expect(readyBody.objectStore?.message).toContain('Azure Blob Storage connection refused');

        const healthRes = await failingApp.inject({
          method: 'GET',
          url: '/api/health'
        });
        expect(healthRes.statusCode).toBe(503);
      } finally {
        await failingApp.close();
      }
    });

    it('GET /api/health/ready returns 503 when database is unmigrated (schema_migrations missing)', async () => {
      const freshPglite = new PGlite();
      const freshDbClient = new PGliteDatabaseClient({ pgliteInstance: freshPglite });
      const unmigratedRepo = new PostgresRequirementsRepository({
        db: freshDbClient,
        objectStore: new InMemoryObjectStore()
      });

      const unmigratedComposed = composeOrchestratorHttpServer({
        repository: unmigratedRepo,
        autoMigrate: false,
        generationGateway: new FakeGenerationGateway(),
        linterGateway: new FakeMermaidLinterGateway()
      });
      const unmigratedApp = unmigratedComposed.app;
      await unmigratedApp.ready();

      try {
        const readyRes = await unmigratedApp.inject({
          method: 'GET',
          url: '/api/health/ready'
        });
        expect(readyRes.statusCode).toBe(503);
        const readyBody = readyRes.json();
        expect(readyBody.status).toBe('unhealthy');
        expect(readyBody.database?.status).toBe('unhealthy');
        expect(readyBody.database?.message).toContain('unmigrated');

        const healthRes = await unmigratedApp.inject({
          method: 'GET',
          url: '/api/health'
        });
        expect(healthRes.statusCode).toBe(503);
      } finally {
        await unmigratedApp.close();
        await freshDbClient.close().catch(() => {});
        await freshPglite.close().catch(() => {});
      }
    });

    it('GET /api/health/ready returns 503 when database has pending migrations', async () => {
      const pendingPglite = new PGlite();
      const pendingDbClient = new PGliteDatabaseClient({ pgliteInstance: pendingPglite });

      // Create schema_migrations table with only migration 1 recorded
      await pendingDbClient.query(`
        CREATE TABLE schema_migrations (
          version INT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL,
          checksum VARCHAR(64) NOT NULL
        );
      `);
      await pendingDbClient.query(`
        INSERT INTO schema_migrations VALUES (1, '001_initial_production_schema.sql', NOW(), '99b597dcf880406c7fd8d16d2ef6730d096c653c3dbce040a46937390b09e026');
      `);

      const pendingRepo = new PostgresRequirementsRepository({
        db: pendingDbClient,
        objectStore: new InMemoryObjectStore()
      });

      const pendingComposed = composeOrchestratorHttpServer({
        repository: pendingRepo,
        autoMigrate: false,
        generationGateway: new FakeGenerationGateway(),
        linterGateway: new FakeMermaidLinterGateway()
      });
      const pendingApp = pendingComposed.app;
      await pendingApp.ready();

      try {
        const readyRes = await pendingApp.inject({
          method: 'GET',
          url: '/api/health/ready'
        });
        expect(readyRes.statusCode).toBe(503);
        const readyBody = readyRes.json();
        expect(readyBody.status).toBe('unhealthy');
        expect(readyBody.database?.status).toBe('unhealthy');
        expect(readyBody.database?.message).toContain('Pending migrations detected');

        const healthRes = await pendingApp.inject({
          method: 'GET',
          url: '/api/health'
        });
        expect(healthRes.statusCode).toBe(503);
      } finally {
        await pendingApp.close();
        await pendingDbClient.close().catch(() => {});
        await pendingPglite.close().catch(() => {});
      }
    });
  });
});
