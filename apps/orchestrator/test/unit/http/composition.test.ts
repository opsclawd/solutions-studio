import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  composeOrchestratorHttpServer,
  composeOrchestratorHttpServerAsync
} from '../../../src/http/composition.js';
import { parseArgs } from '../../../scripts/run-http-server.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { PGlite } from '@electric-sql/pglite';
import { PostgresRequirementsRepository } from '../../../src/infrastructure/persistence/postgres/PostgresRequirementsRepository.js';
import { InMemoryObjectStore } from '../../../src/infrastructure/persistence/object-store/InMemoryObjectStore.js';
import { SchemaMigrationRunner } from '../../../src/infrastructure/persistence/postgres/SchemaMigrationRunner.js';
import { PGliteDatabaseClient } from '../../../src/infrastructure/persistence/postgres/PGliteDatabaseClient.js';

describe('HTTP Boundary: Composition Root & Server CLI', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-comp-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('composes all required use cases, repository, and fastify app', () => {
    const composed = composeOrchestratorHttpServer({
      storeDir: tempDir,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });

    expect(composed.app).toBeDefined();
    expect(composed.repository).toBeDefined();
    expect(composed.compileUseCase).toBeDefined();
    expect(composed.reconcileUseCase).toBeDefined();
    expect(composed.baselineUseCase).toBeDefined();
    expect(composed.generateArtifactUseCase).toBeDefined();
    expect(composed.projectBaselineUseCase).toBeDefined();
    expect(composed.reviewStateUseCase).toBeDefined();
    expect(composed.evaluateStoryReadinessUseCase).toBeDefined();
    expect(composed.computeRequirementCoverageUseCase).toBeDefined();
  });

  it('starts and serves over real socket via listen(0)', async () => {
    const composed = composeOrchestratorHttpServer({
      storeDir: tempDir,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });

    let address: string | null = null;
    try {
      address = await composed.app.listen({ port: 0, host: '127.0.0.1' });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      const msg = ((err as Error)?.message ?? '').toLowerCase();
      if (
        code === 'EPERM' ||
        code === 'EACCES' ||
        code === 'ENOPROTOOPT' ||
        code === 'EADDRNOTAVAIL' ||
        msg.includes('eperm') ||
        msg.includes('eacces') ||
        msg.includes('permission') ||
        msg.includes('not permitted') ||
        msg.includes('access')
      ) {
        // Sandboxed environments may deny raw socket binding; fallback to Fastify injection
        await composed.app.ready();
        const healthRes = await composed.app.inject({ method: 'GET', url: '/api/health' });
        expect(healthRes.statusCode).toBe(200);
        expect(healthRes.json()).toEqual({ status: 'ok' });

        const reviewRes = await composed.app.inject({
          method: 'GET',
          url: '/api/requirements/review-state'
        });
        expect(reviewRes.statusCode).toBe(200);
        const reviewBody = reviewRes.json();
        expect(reviewBody.requirementRevisions).toEqual([]);
        await composed.app.close();
        return;
      }
      throw err;
    }

    try {
      expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);

      try {
        const healthRes = await fetch(`${address}/api/health`);
        expect(healthRes.status).toBe(200);
        expect(await healthRes.json()).toEqual({ status: 'ok' });

        const reviewRes = await fetch(`${address}/api/requirements/review-state`);
        expect(reviewRes.status).toBe(200);
        const reviewBody = await reviewRes.json();
        expect(reviewBody.requirementRevisions).toEqual([]);
      } catch (fetchErr: unknown) {
        const code = (fetchErr as { code?: string })?.code;
        const msg = ((fetchErr as Error)?.message ?? '').toLowerCase();
        if (
          code === 'EPERM' ||
          code === 'EACCES' ||
          code === 'ECONNREFUSED' ||
          msg.includes('fetch failed') ||
          msg.includes('eperm') ||
          msg.includes('eacces') ||
          msg.includes('permission') ||
          msg.includes('not permitted') ||
          msg.includes('econnrefused')
        ) {
          const healthRes = await composed.app.inject({ method: 'GET', url: '/api/health' });
          expect(healthRes.statusCode).toBe(200);
          expect(healthRes.json()).toEqual({ status: 'ok' });

          const reviewRes = await composed.app.inject({
            method: 'GET',
            url: '/api/requirements/review-state'
          });
          expect(reviewRes.statusCode).toBe(200);
          const reviewBody = reviewRes.json();
          expect(reviewBody.requirementRevisions).toEqual([]);
          return;
        }
        throw fetchErr;
      }
    } finally {
      await composed.app.close();
    }
  });

  it('logs internal exceptions when statusCode >= 500 and returns sanitized 500 response', async () => {
    const composed = composeOrchestratorHttpServer({
      storeDir: tempDir,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });

    composed.app.get('/api/test-internal-error', async () => {
      throw new Error('Simulated unexpected crash');
    });

    let loggedError: unknown = null;
    composed.app.addHook('onRequest', async (req) => {
      req.log.error = ((err: unknown) => {
        loggedError = err;
      }) as typeof req.log.error;
    });

    const res = await composed.app.inject({
      method: 'GET',
      url: '/api/test-internal-error'
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error'
    });
    expect(loggedError).toBeInstanceOf(Error);
    expect((loggedError as Error).message).toBe('Simulated unexpected crash');
  });

  describe('run-http-server parseArgs', () => {
    it('parses valid CLI options', () => {
      const parsed = parseArgs([
        '--port',
        '8080',
        '--host',
        '127.0.0.1',
        '--store',
        'custom-store'
      ]);
      expect(parsed.port).toBe(8080);
      expect(parsed.host).toBe('127.0.0.1');
      expect(parsed.storeDir).toBe(path.resolve(process.cwd(), 'custom-store'));
    });

    it('rejects invalid port', () => {
      expect(() => parseArgs(['--port', 'not-a-number'])).toThrow('Invalid port');
      expect(() => parseArgs(['--port', '0'])).toThrow('Invalid port');
      expect(() => parseArgs(['--port', '70000'])).toThrow('Invalid port');
    });

    it('rejects unknown option', () => {
      expect(() => parseArgs(['--unknown-flag'])).toThrow("Unknown option: '--unknown-flag'");
    });
  });

  describe('Production Configuration Integration (PostgreSQL + Object Store)', () => {
    let pgliteInstance: PGlite;

    beforeEach(() => {
      pgliteInstance = new PGlite();
    });

    afterEach(async () => {
      await pgliteInstance.close().catch(() => {});
    });

    it('asynchronously composes server with remote postgres config, applies migrations on startup, and exposes healthy status', async () => {
      const underlyingClient = new PGliteDatabaseClient({ pgliteInstance });
      const objectStore = new InMemoryObjectStore();

      // Simulate remote PostgreSQL database client factory
      const clientFactory = () => {
        return {
          query: (sql: string, params?: readonly unknown[]) => underlyingClient.query(sql, params),
          exec: (sql: string) => underlyingClient.exec(sql),
          connect: async () => ({
            query: (sql: string, params?: readonly unknown[]) =>
              underlyingClient.query(sql, params),
            exec: (sql: string) => underlyingClient.exec(sql),
            release: () => {}
          }),
          end: async () => {}
        };
      };

      const composed = await composeOrchestratorHttpServerAsync({
        connectionString: 'postgresql://app_user:secret@localhost:5432/solutions_studio',
        clientFactory,
        objectStore,
        autoMigrate: true,
        generationGateway: new FakeGenerationGateway(),
        linterGateway: new FakeMermaidLinterGateway()
      });

      try {
        expect(composed.repository).toBeInstanceOf(PostgresRequirementsRepository);

        // Verify migrations ran automatically on startup
        const runner = new SchemaMigrationRunner({ db: underlyingClient });
        const status = await runner.status();
        expect(status.currentVersion).toBe(4);
        expect(status.pendingCount).toBe(0);

        // Test operational probes
        const liveRes = await composed.app.inject({ method: 'GET', url: '/api/health/live' });
        expect(liveRes.statusCode).toBe(200);
        expect(liveRes.json()).toEqual({ status: 'ok' });

        const readyRes = await composed.app.inject({ method: 'GET', url: '/api/health/ready' });
        expect(readyRes.statusCode).toBe(200);
        const readyBody = readyRes.json();
        expect(readyBody.status).toBe('healthy');
        expect(readyBody.database?.status).toBe('healthy');
        expect(readyBody.database?.details?.dialect).toBe('postgresql');
        expect(readyBody.database?.details?.currentMigration).toBe(4);

        const healthRes = await composed.app.inject({ method: 'GET', url: '/api/health' });
        expect(healthRes.statusCode).toBe(200);
        expect(healthRes.json()).toEqual({ status: 'ok' });

        // Test domain endpoint
        const reviewRes = await composed.app.inject({
          method: 'GET',
          url: '/api/requirements/review-state'
        });
        expect(reviewRes.statusCode).toBe(200);
        expect(reviewRes.json().requirementRevisions).toEqual([]);
      } finally {
        await composed.app.close();
      }
    });
  });

  describe('Authentication Configuration & Provider Resolution (F-43bc07fe & F-1e8e2316)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('rejects unknown or misspelled AUTH_PROVIDER values by failing closed', () => {
      process.env.AUTH_PROVIDER = 'unknown-provider';
      expect(() =>
        composeOrchestratorHttpServer({
          storeDir: tempDir,
          generationGateway: new FakeGenerationGateway(),
          linterGateway: new FakeMermaidLinterGateway()
        })
      ).toThrow(/Invalid or unsupported AUTH_PROVIDER/);
    });

    it('prohibits TestAuthenticator in production (NODE_ENV=production)', () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_PROVIDER = 'test';
      expect(() =>
        composeOrchestratorHttpServer({
          storeDir: tempDir,
          generationGateway: new FakeGenerationGateway(),
          linterGateway: new FakeMermaidLinterGateway()
        })
      ).toThrow(/Test authentication .* is not permitted in production/);
    });

    it('fails startup in production if OIDC_ISSUER or OIDC_AUDIENCE is missing', () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_PROVIDER = 'oidc';
      delete process.env.OIDC_ISSUER;
      delete process.env.OIDC_ISSUER_URL;
      delete process.env.OIDC_AUDIENCE;

      expect(() =>
        composeOrchestratorHttpServer({
          storeDir: tempDir,
          generationGateway: new FakeGenerationGateway(),
          linterGateway: new FakeMermaidLinterGateway()
        })
      ).toThrow(/Missing required OIDC configuration in production: OIDC_ISSUER/);
    });

    it('supports OIDC_ISSUER_URL as canonical alias for OIDC_ISSUER', () => {
      process.env.AUTH_PROVIDER = 'oidc';
      process.env.OIDC_ISSUER_URL = 'https://login.microsoftonline.com/tenant-123/v2.0';
      process.env.OIDC_AUDIENCE = 'api://solutions-studio';
      delete process.env.OIDC_ISSUER;

      const composed = composeOrchestratorHttpServer({
        storeDir: tempDir,
        generationGateway: new FakeGenerationGateway(),
        linterGateway: new FakeMermaidLinterGateway()
      });

      expect(composed.authenticator).toBeDefined();
      expect((composed.authenticator as any).issuer).toBe(
        'https://login.microsoftonline.com/tenant-123/v2.0'
      );
      expect((composed.authenticator as any).audience).toBe('api://solutions-studio');
    });
  });
});
