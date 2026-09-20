import { describe, it, expect } from 'vitest';
import { GenericOidcAuthenticator } from '../../../src/infrastructure/identity/GenericOidcAuthenticator.js';
import { JwksCache } from '../../../src/infrastructure/identity/jwksCache.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { TelemetryRegistry } from '../../../src/infrastructure/observability/TelemetryRegistry.js';

describe('OIDC Provider Unavailability & Fail-Closed Authority Safety', () => {
  it('GenericOidcAuthenticator fails closed when JWKS endpoint is unreachable', async () => {
    const unreachableJwksCache = new JwksCache('http://127.0.0.1:9999/unreachable/certs', {
      timeoutMs: 100,
      fetchFn: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:9999');
      }
    });

    const authenticator = new GenericOidcAuthenticator({
      issuer: 'http://127.0.0.1:9999/realms/solutions-studio',
      audience: 'solutions-studio-api',
      jwksCache: unreachableJwksCache
    });

    // Valid RS256 token structure with header kid: "key-1"
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'key-1' })).toString(
      'base64url'
    );
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'http://127.0.0.1:9999/realms/solutions-studio',
        aud: 'solutions-studio-api',
        sub: 'attacker',
        exp: Math.floor(Date.now() / 1000) + 3600
      })
    ).toString('base64url');
    const dummySignature = Buffer.from('sig').toString('base64url');
    const token = `${header}.${payload}.${dummySignature}`;

    await expect(authenticator.authenticate(token)).rejects.toThrow(/Failed to fetch JWKS/);

    const health = await authenticator.checkHealth();
    expect(health.status).toBe('unhealthy');
    expect(health.reachable).toBe(false);
    expect(health.error).toContain('ECONNREFUSED');
  });

  it('HTTP authority-changing endpoints fail closed (401) and never trust caller-supplied identity when OIDC fails', async () => {
    const unreachableJwksCache = new JwksCache('http://127.0.0.1:9999/unreachable/certs', {
      timeoutMs: 100,
      fetchFn: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:9999');
      }
    });

    const authenticator = new GenericOidcAuthenticator({
      issuer: 'http://127.0.0.1:9999/realms/solutions-studio',
      audience: 'solutions-studio-api',
      jwksCache: unreachableJwksCache
    });

    const telemetryRegistry = new TelemetryRegistry();

    const server = composeOrchestratorHttpServer({
      authenticator,
      telemetryRegistry,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });
    await server.app.ready();

    try {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'key-1' })).toString(
        'base64url'
      );
      const payload = Buffer.from(
        JSON.stringify({
          iss: 'http://127.0.0.1:9999/realms/solutions-studio',
          aud: 'solutions-studio-api',
          sub: 'attacker',
          exp: Math.floor(Date.now() / 1000) + 3600
        })
      ).toString('base64url');
      const token = `${header}.${payload}.dummySig`;

      // Attempt to invoke authority-changing endpoint with caller-supplied identity
      const res = await server.app.inject({
        method: 'POST',
        url: '/api/baselines',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        payload: {
          name: 'Exploitative Baseline',
          createdBy: 'privileged-admin-spoof',
          actorId: 'privileged-admin-spoof',
          requirementRevisionIds: []
        }
      });

      // Assert fail-closed behavior: 401 UNAUTHENTICATED
      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.code).toBe('UNAUTHENTICATED');

      // Assert telemetry recorded the authentication failure
      const summary = telemetryRegistry.toSummaryJson() as any;
      expect(summary.metrics.counters.solutions_studio_auth_failures_total).toBeDefined();
      expect(summary.metrics.counters.solutions_studio_auth_failures_total.length).toBeGreaterThan(
        0
      );
    } finally {
      await server.app.close();
    }
  });
});
