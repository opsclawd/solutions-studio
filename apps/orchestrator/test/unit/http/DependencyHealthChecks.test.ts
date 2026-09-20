import { describe, it, expect } from 'vitest';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import type { IAuthenticator } from '../../../src/application/ports/identity/IAuthenticator.js';
import { createAuthenticatedActor } from '@solutions-studio/domain';

const healthyRepository: any = {
  checkStorageHealth: async () => ({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: {
      status: 'healthy',
      latencyMs: 1,
      details: { dialect: 'filesystem' }
    },
    objectStore: {
      status: 'healthy',
      latencyMs: 1,
      details: { backend: 'filesystem' }
    }
  })
};

describe('Dependency Health Checks and Metrics API Surface', () => {
  it('GET /api/health/live returns 200 and uptime', async () => {
    const server = composeOrchestratorHttpServer({
      repository: healthyRepository,
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
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(typeof body.uptime).toBe('number');
      expect(body.timestamp).toBeDefined();
    } finally {
      await server.app.close();
    }
  });

  it('GET /api/health/ready returns 200 with composite dependencies when all healthy', async () => {
    const server = composeOrchestratorHttpServer({
      repository: healthyRepository,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway(),
      backlogGatewayFactory: {
        getGateway: () => ({
          providerId: 'github-issues',
          checkHealth: async () => ({
            status: 'healthy',
            provider: 'github-issues',
            reachable: true,
            latencyMs: 1
          }),
          createWorkItem: async () => {},
          updateWorkItem: async () => {}
        })
      } as any
    });
    await server.app.ready();

    try {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/health/ready'
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('healthy');
      expect(body.dependencies).toBeDefined();
      expect(body.dependencies.database?.status).toBe('healthy');
      expect(body.dependencies.objectStore?.status).toBe('healthy');
      expect(body.dependencies.identity?.status).toBe('healthy');
      expect(body.dependencies.identity?.reachable).toBe(true);
      expect(body.dependencies.generation?.status).toBe('healthy');
      expect(body.dependencies.backlog?.status).toBe('healthy');
      expect(body.version).toBe('0.1.0');
    } finally {
      await server.app.close();
    }
  });

  it('GET /api/health/ready returns 503 when authenticator reports unhealthy/unreachable', async () => {
    const failingAuthenticator: IAuthenticator = {
      authenticate: async () =>
        createAuthenticatedActor({
          id: 'test',
          name: 'Test',
          actorType: 'human',
          capabilities: []
        }),
      checkHealth: async () => ({
        status: 'unhealthy',
        provider: 'oidc',
        issuer: 'http://keycloak:8080/realms/solutions-studio',
        reachable: false,
        latencyMs: 3000,
        error: 'Keycloak connection refused on port 8080'
      })
    };

    const server = composeOrchestratorHttpServer({
      repository: healthyRepository,
      authenticator: failingAuthenticator,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });
    await server.app.ready();

    try {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/health/ready'
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.status).toBe('unhealthy');
      expect(body.dependencies.identity.status).toBe('unhealthy');
      expect(body.dependencies.identity.reachable).toBe(false);
      expect(body.dependencies.identity.error).toContain('Keycloak connection refused');
    } finally {
      await server.app.close();
    }
  });

  it('GET /api/health/ready returns 503 when generationGateway reports unhealthy', async () => {
    const failingGenerationGateway: any = {
      generate: async () => ({ content: '', repairsNeeded: 0, repairHistory: [] }),
      checkHealth: async () => ({
        status: 'unhealthy',
        provider: 'fake',
        available: false,
        latencyMs: 50,
        error: 'Engine process crashed'
      })
    };

    const server = composeOrchestratorHttpServer({
      repository: healthyRepository,
      generationGateway: failingGenerationGateway,
      linterGateway: new FakeMermaidLinterGateway()
    });
    await server.app.ready();

    try {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/health/ready'
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.status).toBe('unhealthy');
      expect(body.dependencies.generation.status).toBe('unhealthy');
      expect(body.dependencies.generation.available).toBe(false);
      expect(body.dependencies.generation.error).toContain('Engine process crashed');
    } finally {
      await server.app.close();
    }
  });

  it('GET /api/health/ready returns 200 with degraded status when backlogExportGateway reports degraded', async () => {
    const degradedBacklogGateway: any = {
      providerId: 'github-issues',
      checkHealth: async () => ({
        status: 'degraded',
        provider: 'github-issues',
        reachable: false,
        latencyMs: 10,
        error: 'GITHUB_TOKEN not configured (optional provider unconfigured)'
      }),
      createWorkItem: async () => {
        throw new Error('Not implemented');
      },
      updateWorkItem: async () => {
        throw new Error('Not implemented');
      }
    };

    const server = composeOrchestratorHttpServer({
      repository: healthyRepository,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway(),
      backlogGatewayFactory: {
        getGateway: () => degradedBacklogGateway
      } as any
    });
    await server.app.ready();

    try {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/health/ready'
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('degraded');
      expect(body.dependencies.backlog.status).toBe('degraded');
      expect(body.dependencies.backlog.reachable).toBe(false);
      expect(body.dependencies.backlog.error).toContain('GITHUB_TOKEN not configured');
    } finally {
      await server.app.close();
    }
  });

  it('GET /api/health/ready returns 503 when storage reports unhealthy', async () => {
    const unhealthyRepo: any = {
      checkStorageHealth: async () => ({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: {
          status: 'unhealthy',
          latencyMs: 1500,
          error: 'PostgreSQL connection timeout'
        },
        objectStore: {
          status: 'healthy',
          latencyMs: 1
        }
      })
    };

    const server = composeOrchestratorHttpServer({
      repository: unhealthyRepo,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });
    await server.app.ready();

    try {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/health/ready'
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.status).toBe('unhealthy');
      expect(body.dependencies.database.status).toBe('unhealthy');
      expect(body.dependencies.database.error).toContain('PostgreSQL connection timeout');
    } finally {
      await server.app.close();
    }
  });

  it('GET /api/metrics exposes Prometheus formatted metrics', async () => {
    const server = composeOrchestratorHttpServer({
      repository: healthyRepository,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });
    await server.app.ready();

    try {
      // Trigger a request to increment counters
      await server.app.inject({
        method: 'GET',
        url: '/api/health/live'
      });

      const res = await server.app.inject({
        method: 'GET',
        url: '/api/metrics'
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      const text = res.body;
      expect(text).toContain('solutions_studio_http_requests_total');
      expect(text).toContain('# HELP solutions_studio_http_requests_total');
      expect(text).toContain('# TYPE solutions_studio_http_requests_total counter');
    } finally {
      await server.app.close();
    }
  });

  it('GET /api/telemetry/summary exposes structured JSON metrics summary', async () => {
    const server = composeOrchestratorHttpServer({
      repository: healthyRepository,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });
    await server.app.ready();

    try {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/telemetry/summary'
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.timestamp).toBeDefined();
      expect(typeof body.uptimeSeconds).toBe('number');
      expect(body.metrics).toBeDefined();
      expect(body.metrics.counters).toBeDefined();
      expect(body.metrics.gauges).toBeDefined();
      expect(body.metrics.histograms).toBeDefined();
    } finally {
      await server.app.close();
    }
  });
});
