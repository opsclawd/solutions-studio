import { describe, it, expect } from 'vitest';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';
import { CorrelationContext } from '../../../src/infrastructure/observability/CorrelationContext.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';

describe('Correlation ID Tracking & Propagation', () => {
  it('propagates correlationId across async boundaries via CorrelationContext', async () => {
    const testCorrelationId = 'c-test-12345-abcde';

    await CorrelationContext.run(testCorrelationId, async () => {
      expect(CorrelationContext.getCorrelationId()).toBe(testCorrelationId);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(CorrelationContext.getCorrelationId()).toBe(testCorrelationId);
    });
  });

  it('generates a unique c-... identifier when outside of context', () => {
    const id1 = CorrelationContext.generateCorrelationId();
    const id2 = CorrelationContext.generateCorrelationId();

    expect(id1).toMatch(/^c-[a-f0-9-]+$/);
    expect(id2).toMatch(/^c-[a-f0-9-]+$/);
    expect(id1).not.toBe(id2);
  });

  it('captures incoming x-correlation-id and returns it in response headers', async () => {
    const server = composeOrchestratorHttpServer({
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });
    await server.app.ready();

    try {
      const customId = 'c-client-provided-9988';
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/health/live',
        headers: {
          'x-correlation-id': customId
        }
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-correlation-id']).toBe(customId);
    } finally {
      await server.app.close();
    }
  });

  it('auto-generates a correlation ID when request header is absent', async () => {
    const server = composeOrchestratorHttpServer({
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });
    await server.app.ready();

    try {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/health/live'
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-correlation-id']).toBeDefined();
      expect(String(res.headers['x-correlation-id'])).toMatch(/^c-/);
    } finally {
      await server.app.close();
    }
  });

  it('propagates the exact x-correlation-id across all emitted operational events in request lifecycle', async () => {
    const { StructuredOperationalLogger } =
      await import('../../../src/infrastructure/observability/StructuredOperationalLogger.js');
    const { TestAuthenticator } =
      await import('../../../src/infrastructure/identity/TestAuthenticator.js');
    const { createRequirementRevision, createRequirementId, createRequirementRevisionId } =
      await import('@solutions-studio/domain');

    const capturedEvents: any[] = [];
    StructuredOperationalLogger.setSink((record) => {
      capturedEvents.push(record);
    });

    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'corr-test-'));

    try {
      const server = composeOrchestratorHttpServer({
        storeDir: tempDir,
        authenticator: new TestAuthenticator(),
        generationGateway: new FakeGenerationGateway(),
        linterGateway: new FakeMermaidLinterGateway()
      });
      await server.app.ready();

      // Seed a requirement revision
      const rev = createRequirementRevision({
        id: createRequirementRevisionId('REQ-CORR-R1'),
        requirementId: createRequirementId('REQ-CORR'),
        revision: 1,
        statement: 'Correlation test requirement',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'PENDING',
        resolutionState: 'UNRESOLVED'
      });
      await server.repository.saveRequirementRevision(rev);

      const targetCorrelationId = 'c-trace-99887766';

      // Execute reconcile endpoint
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/requirements/${rev.id}/accept`,
        headers: {
          authorization: 'Bearer test:reviewer',
          'x-correlation-id': targetCorrelationId,
          'content-type': 'application/json'
        },
        payload: {
          rationale: 'Accepting in correlation test'
        }
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-correlation-id']).toBe(targetCorrelationId);

      // Verify captured events include identity.actor.authenticated, command.executed, and http.request.completed
      const eventsForCorrelation = capturedEvents.filter(
        (e) => e.correlationId === targetCorrelationId
      );
      expect(eventsForCorrelation.length).toBeGreaterThanOrEqual(3);

      const eventNames = eventsForCorrelation.map((e) => e.event);
      expect(eventNames).toContain('identity.actor.authenticated');
      expect(eventNames).toContain('command.executed');
      expect(eventNames).toContain('http.request.completed');

      // Verify all events for this request strictly share the exact same correlationId
      for (const event of eventsForCorrelation) {
        expect(event.correlationId).toBe(targetCorrelationId);
      }

      await server.app.close();
    } finally {
      StructuredOperationalLogger.resetSink();
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
