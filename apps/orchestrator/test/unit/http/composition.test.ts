import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';
import { parseArgs } from '../../../scripts/run-http-server.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';

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
  });

  it('starts and serves over real socket via listen(0)', async () => {
    const composed = composeOrchestratorHttpServer({
      storeDir: tempDir,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });

    const address = await composed.app.listen({ port: 0, host: '127.0.0.1' });
    try {
      expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);

      const healthRes = await fetch(`${address}/api/health`);
      expect(healthRes.status).toBe(200);
      expect(await healthRes.json()).toEqual({ status: 'ok' });

      const reviewRes = await fetch(`${address}/api/requirements/review-state`);
      expect(reviewRes.status).toBe(200);
      const reviewBody = await reviewRes.json();
      expect(reviewBody.requirementRevisions).toEqual([]);
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
});
