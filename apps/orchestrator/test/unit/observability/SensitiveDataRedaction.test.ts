import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SensitiveDataSanitizer } from '../../../src/infrastructure/observability/SensitiveDataSanitizer.js';
import {
  StructuredOperationalLogger,
  type StructuredLogRecord
} from '../../../src/infrastructure/observability/StructuredOperationalLogger.js';

describe('Sensitive Data Redaction Invariants', () => {
  it('redacts sensitive keys including passwords, secrets, tokens, and authorization', () => {
    const payload = {
      username: 'alice',
      password: 'super-secret-password-123',
      secret: 'api-secret-key-456',
      token: 'jwt.token.string',
      authorization: 'Bearer token-value-789',
      clientSecret: 'secret-xyz',
      nested: {
        accessToken: 'access-token-999',
        safeProperty: 'public-data'
      }
    };

    const sanitized = SensitiveDataSanitizer.sanitizeObject(payload) as any;

    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.secret).toBe('[REDACTED]');
    expect(sanitized.token).toBe('[REDACTED]');
    expect(sanitized.authorization).toBe('[REDACTED]');
    expect(sanitized.clientSecret).toBe('[REDACTED]');
    expect(sanitized.nested.accessToken).toBe('[REDACTED]');
    expect(sanitized.nested.safeProperty).toBe('public-data');
    expect(sanitized.username).toBe('alice');
  });

  it('redacts Bearer tokens and JWT string patterns in string values', () => {
    const bearerString = 'Bearer test-token-abcdef-12345';
    const jwtString =
      'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

    const sanitizedBearer = SensitiveDataSanitizer.sanitizeValue('header', bearerString);
    const sanitizedJwt = SensitiveDataSanitizer.sanitizeValue('other', jwtString);

    expect(sanitizedBearer).toBe('Bearer [REDACTED]');
    expect(sanitizedJwt).toBe('[REDACTED_TOKEN]');
  });

  it('replaces raw evidence markdown text with safe surrogates', () => {
    const rawMarkdown =
      '# Highly Confidential SME Interview\nClient stated proprietary trade secrets and patent details.';

    const payload = {
      sourceRevisionId: 'rev-001',
      markdownText: rawMarkdown,
      status: 'active'
    };

    const sanitized = SensitiveDataSanitizer.sanitizeObject(payload) as any;

    expect(sanitized.sourceRevisionId).toBe('rev-001');
    expect(sanitized.status).toBe('active');
    expect(sanitized.markdownText).not.toContain('trade secrets');
    expect(sanitized.markdownText).toEqual({
      byteLength: Buffer.byteLength(rawMarkdown, 'utf8'),
      redacted: true
    });
  });

  describe('StructuredOperationalLogger Sink Verification', () => {
    const capturedLogs: StructuredLogRecord[] = [];

    beforeEach(() => {
      capturedLogs.length = 0;
      StructuredOperationalLogger.setSink((record) => {
        capturedLogs.push(record);
      });
    });

    afterEach(() => {
      StructuredOperationalLogger.resetSink();
    });

    it('StructuredOperationalLogger never emits secrets or tokens into the sink', () => {
      StructuredOperationalLogger.log(
        'identity.actor.authenticated',
        {
          actorId: 'user-alice',
          token: 'sensitive-bearer-token',
          password: 'plain-password',
          claims: {
            role: 'reviewer'
          }
        },
        { correlationId: 'c-test-1122' }
      );

      expect(capturedLogs).toHaveLength(1);
      const record = capturedLogs[0];

      expect(record.correlationId).toBe('c-test-1122');
      expect(record.event).toBe('identity.actor.authenticated');
      expect(record.details.token).toBe('[REDACTED]');
      expect(record.details.password).toBe('[REDACTED]');
      expect(record.details.actorId).toBe('user-alice');
    });

    it('masks email-shaped actor IDs to prevent PII exposure in operational logs', () => {
      const emailActorId = 'alice.smith@enterprise.corp';
      const sanitized = SensitiveDataSanitizer.sanitizeActorId(emailActorId);
      expect(sanitized).toBe('[REDACTED_IDENTITY]');

      StructuredOperationalLogger.log('identity.actor.authenticated', {
        actorId: emailActorId,
        actorType: 'human'
      });

      expect(capturedLogs).toHaveLength(1);
      expect(capturedLogs[0].details.actorId).toBe('[REDACTED_IDENTITY]');
    });

    it('redacts tokens and query parameters inside error messages and stack traces', () => {
      const sensitiveError = new Error(
        'Failed to connect to https://idp.example.com/oauth/token?token=secret123&client_secret=pass456'
      );
      const sanitized = SensitiveDataSanitizer.sanitizeError(sensitiveError);

      expect(sanitized.message).not.toContain('secret123');
      expect(sanitized.message).not.toContain('pass456');
      expect(sanitized.message).toContain('token=[REDACTED]');
      expect(sanitized.message).toContain('client_secret=[REDACTED]');
    });

    it('redacts sensitive claims including email, phone, and upn', () => {
      const claims = {
        sub: 'actor-123',
        email: 'alice@example.com',
        phone: '+1-555-0199',
        phoneNumber: '+1-555-0188',
        upn: 'alice@corp.internal',
        roles: ['reviewer']
      };

      const sanitized = SensitiveDataSanitizer.sanitizeObject(claims) as any;
      expect(sanitized.sub).toBe('actor-123');
      expect(sanitized.email).toBe('[REDACTED]');
      expect(sanitized.phone).toBe('[REDACTED]');
      expect(sanitized.phoneNumber).toBe('[REDACTED]');
      expect(sanitized.upn).toBe('[REDACTED]');
      expect(sanitized.roles).toEqual(['reviewer']);
    });
  });

  describe('HTTP Ingress Query Parameter Stripping', () => {
    const capturedLogs: StructuredLogRecord[] = [];

    beforeEach(() => {
      capturedLogs.length = 0;
      StructuredOperationalLogger.setSink((record) => {
        capturedLogs.push(record);
      });
    });

    afterEach(() => {
      StructuredOperationalLogger.resetSink();
    });

    it('strips query parameters from http.request.completed log records', async () => {
      const { composeOrchestratorHttpServer } = await import('../../../src/http/composition.js');
      const { FakeGenerationGateway } = await import('../../fakes/FakeGenerationGateway.js');
      const { FakeMermaidLinterGateway } = await import('../../fakes/FakeMermaidLinterGateway.js');

      const server = composeOrchestratorHttpServer({
        generationGateway: new FakeGenerationGateway(),
        linterGateway: new FakeMermaidLinterGateway()
      });
      await server.app.ready();

      try {
        const res = await server.app.inject({
          method: 'GET',
          url: '/api/health/live?token=secret-token-abc&code=auth-code-123'
        });

        expect(res.statusCode).toBe(200);

        const httpLogs = capturedLogs.filter((l) => l.event === 'http.request.completed');
        expect(httpLogs.length).toBeGreaterThanOrEqual(1);
        const record = httpLogs[0];
        expect(record.details.url).toBe('/api/health/live');
        expect(record.details.url).not.toContain('secret-token-abc');
        expect(record.details.url).not.toContain('auth-code-123');
      } finally {
        await server.app.close();
      }
    });
  });
});
