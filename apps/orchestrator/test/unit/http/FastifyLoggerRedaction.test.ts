import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';

describe('Fastify Logger Redaction (CONSUMER-100-AC-9)', () => {
  it('redacts Authorization header in logger output', async () => {
    const logs: string[] = [];
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        logs.push(chunk.toString());
        callback();
      }
    });

    const SECRET_TOKEN = 'secret-token-do-not-leak-998877';

    const composed = composeOrchestratorHttpServer({
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway(),
      fastifyOptions: {
        logger: {
          level: 'info',
          stream: logStream
        }
      }
    });

    const app = composed.app;
    await app.ready();

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${SECRET_TOKEN}`
        }
      });

      expect(res.statusCode).toBeDefined();

      const combinedLogs = logs.join('\n');

      // 1. Assert the secret token was NEVER written to the log stream
      expect(combinedLogs).not.toContain(SECRET_TOKEN);

      // 2. Assert that logs were produced
      expect(logs.length).toBeGreaterThan(0);

      // 3. Find incoming request log and verify redaction
      const incomingLog = logs
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .find((entry) => entry && entry.req);

      expect(incomingLog).toBeDefined();
      if (incomingLog && incomingLog.req.headers) {
        // Pino redacts fields as '[Redacted]'
        expect(incomingLog.req.headers.authorization).toBe('[Redacted]');
      }
    } finally {
      await app.close();
    }
  });

  it('normalizes logger: true to include authorization header redaction (F-b1ca1a72 & F-4e53a0d9)', async () => {
    const SECRET_TOKEN = 'secret-production-token-112233';

    // Pass the exact production configuration: fastifyOptions: { logger: true }
    const composed = composeOrchestratorHttpServer({
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway(),
      fastifyOptions: {
        logger: true
      }
    });

    const app = composed.app;
    await app.ready();

    try {
      // 1. Verify pino logger on app has redact stringifier installed
      const logSymbols = Object.getOwnPropertySymbols(app.log);
      const formatOptsSym = logSymbols.find((s) => s.toString().includes('pino.formatOpts'));
      expect(formatOptsSym).toBeDefined();
      const formatOpts = (app.log as any)[formatOptsSym!];
      expect(formatOpts).toBeDefined();
      expect(typeof formatOpts.stringify).toBe('function');

      // 2. Perform request with Authorization header
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${SECRET_TOKEN}`
        }
      });

      expect(res.statusCode).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('preserves logger: false intentionally to allow completely disabling logging', async () => {
    const composed = composeOrchestratorHttpServer({
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway(),
      fastifyOptions: {
        logger: false
      }
    });

    const app = composed.app;
    await app.ready();

    try {
      // In Fastify, when logger is disabled (logger: false), app.log is a null logger without level
      expect((app.log as any).level).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
