import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createStory,
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createStoryId,
  createActorId,
  createReviewerId,
  createInstant,
  createBacklogExportMapping,
  createBacklogExportMappingId,
  now
} from '@solutions-studio/domain';
import {
  GitHubIssuesBacklogExportAdapter,
  formatGitHubIssueBody
} from '../../src/infrastructure/backlog/GitHubIssuesBacklogExportAdapter.js';
import { GitHubHttpStubServer } from '../support/GitHubHttpStubServer.js';
import {
  ProviderAuthenticationError,
  ProviderRateLimitError,
  RealBacklogMutationForbiddenError
} from '../../src/application/ports/backlog/BacklogExportErrors.js';
import type { BacklogExportPayload } from '../../src/application/ports/backlog/IBacklogExportGateway.js';

describe('GitHubIssuesBacklogExportAdapter Contract & Protocol Tests', () => {
  let stubServer: GitHubHttpStubServer;

  beforeEach(async () => {
    stubServer = new GitHubHttpStubServer();
    await stubServer.start();
  });

  afterEach(async () => {
    await stubServer.stop();
  });

  const baselineId = createRequirementsBaselineId('BASE-001');
  const reqRevId = createRequirementRevisionId('REQ-001-R1');
  const storyId = createStoryId('STORY-001');

  const sampleStory = createStory({
    id: storyId,
    baselineId,
    title: 'User Login with MFA',
    narrative: {
      role: 'security officer',
      feature: 'TOTP MFA verification',
      benefit: 'prevent credential stuffing attacks'
    },
    requirementRevisionIds: [reqRevId],
    scenarios: [
      {
        title: 'Successful TOTP prompt',
        requirementRevisionIds: [reqRevId],
        steps: [
          { keyword: 'Given', text: 'user has valid credentials' },
          { keyword: 'When', text: 'user submits TOTP code 123456' },
          { keyword: 'Then', text: 'session is authenticated' }
        ]
      }
    ],
    acceptanceCriteria: ['Must prompt for 6-digit TOTP', 'Must lock out after 5 attempts'],
    gherkinText:
      'Feature: MFA Login\nScenario: Successful TOTP\nGiven user has valid credentials\nWhen user submits TOTP code 123456\nThen session is authenticated'
  });

  const samplePayload: BacklogExportPayload = {
    story: sampleStory,
    baseline: {
      id: baselineId,
      requirementRevisions: [reqRevId],
      policyConstraintRevisions: [],
      createdAt: createInstant('2026-09-20T10:00:00Z'),
      createdBy: createReviewerId('LEAD')
    },
    requirements: [
      {
        id: reqRevId,
        requirementId: 'REQ-001' as any,
        revision: 1,
        statement: 'System must enforce TOTP MFA.',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: [],
        rationale: 'Security baseline'
      }
    ],
    policyConstraints: [],
    engineeringDecisions: [
      {
        id: 'DEC-001' as any,
        baselineId,
        statement: 'Use RFC 6238 TOTP algorithms',
        rationale: 'Standardized security',
        requirementRevisionIds: [reqRevId],
        policyConstraintRevisionIds: [],
        state: 'ACCEPTED',
        createdAt: now(),
        createdBy: createActorId('ARCHITECT')
      }
    ],
    contentHash: '1234567890abcdef'.repeat(4),
    targetContainer: 'acme/security-app',
    prerequisites: [
      {
        storyId: createStoryId('STORY-000'),
        externalWorkItemId: '41',
        title: 'User Registration'
      }
    ]
  };

  it('formats issue markdown body with human narrative, Gherkin syntax, and machine-readable provenance', () => {
    const body = formatGitHubIssueBody(samplePayload, 'acme/security-app');

    expect(body).toContain('**As a** security officer, **I want** TOTP MFA verification');
    expect(body).toContain('Must prompt for 6-digit TOTP');
    expect(body).toContain('```gherkin');
    expect(body).toContain('Given user has valid credentials');
    expect(body).toContain('- #41 ([STORY-000]) — User Registration');
    expect(body).toContain(
      '| **Content SHA-256** | `1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef` |'
    );
    expect(body).toContain('<!-- solutions-studio-provenance:start');
    expect(body).toContain('"provider": "github-issues"');
    expect(body).toContain('"externalContainer": "acme/security-app"');
    expect(body).toContain('solutions-studio-provenance:end -->');
  });

  it('sends correct headers, serialized payload, and maps created issue response', async () => {
    const adapter = new GitHubIssuesBacklogExportAdapter({
      baseUrl: stubServer.url,
      defaultToken: 'ghp_testToken12345',
      allowRealExternalMutation: true
    });

    const result = await adapter.createWorkItem({
      targetContainer: 'acme/security-app',
      payload: samplePayload
    });

    expect(result.externalWorkItemId).toBe('43');
    expect(result.externalUrl).toContain('/issues/43');
    expect(stubServer.requests).toHaveLength(1);

    const req = stubServer.requests[0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/repos/acme/security-app/issues');
    expect(req.headers['authorization']).toBe('Bearer ghp_testToken12345');
    expect(req.headers['accept']).toBe('application/vnd.github+json');
    expect(req.headers['x-github-api-version']).toBe('2022-11-28');
    expect(req.headers['user-agent']).toBe('Solutions-Studio-Backlog-Export/1.0');

    const body = req.jsonBody as { title: string; body: string; labels: string[] };
    expect(body.title).toBe('[STORY-001] User Login with MFA');
    expect(body.labels).toEqual(['solutions-studio', 'baseline:BASE-001']);
    expect(body.body).toContain('<!-- solutions-studio-provenance:start');
  });

  it('handles updateWorkItem by sending PATCH request to issue number', async () => {
    const adapter = new GitHubIssuesBacklogExportAdapter({
      baseUrl: stubServer.url,
      defaultToken: 'ghp_testToken12345',
      allowRealExternalMutation: true
    });

    const existingMapping = createBacklogExportMapping({
      id: createBacklogExportMappingId('bmap-1'),
      storyId: sampleStory.id,
      baselineId,
      provider: 'github-issues',
      externalContainer: 'acme/security-app',
      externalWorkItemId: '43',
      externalUrl: 'https://github.com/acme/security-app/issues/43',
      exportContentHash: '0'.repeat(60) + 'beef',
      exportedAt: '2026-09-20T10:00:00Z',
      exportedBy: 'actor-1'
    });

    const result = await adapter.updateWorkItem({
      targetContainer: 'acme/security-app',
      payload: samplePayload,
      existingMapping
    });

    expect(result.externalWorkItemId).toBe('43');
    expect(stubServer.requests).toHaveLength(1);

    const req = stubServer.requests[0];
    expect(req.method).toBe('PATCH');
    expect(req.url).toBe('/repos/acme/security-app/issues/43');
  });

  it('retries on HTTP 429 with Retry-After header and succeeds on retry', async () => {
    // Queue HTTP 429 on first request, then default handler responds with 201
    stubServer.queueResponse(
      429,
      { message: 'You have exceeded a secondary rate limit.' },
      { 'Retry-After': '0.05', 'content-type': 'application/json' }
    );

    const adapter = new GitHubIssuesBacklogExportAdapter({
      baseUrl: stubServer.url,
      defaultToken: 'ghp_testToken12345',
      maxRetries: 3
    });

    const result = await adapter.createWorkItem({
      targetContainer: 'acme/security-app',
      payload: samplePayload
    });

    expect(result.externalWorkItemId).toBeDefined();
    expect(stubServer.requests).toHaveLength(2);
    expect(stubServer.requests[0].method).toBe('POST');
    expect(stubServer.requests[1].method).toBe('POST');
  });

  it('throws ProviderRateLimitError when retries are exhausted on 429', async () => {
    stubServer.queueResponse(429, { message: 'Rate limited' }, { 'Retry-After': '0.01' });
    stubServer.queueResponse(429, { message: 'Rate limited' }, { 'Retry-After': '0.01' });

    const adapter = new GitHubIssuesBacklogExportAdapter({
      baseUrl: stubServer.url,
      defaultToken: 'ghp_testToken12345',
      maxRetries: 1
    });

    await expect(
      adapter.createWorkItem({
        targetContainer: 'acme/security-app',
        payload: samplePayload
      })
    ).rejects.toThrow(ProviderRateLimitError);
  });

  it('reconciles lost acknowledgements on HTTP 502 when GitHub committed the issue before error', async () => {
    // Stub POST /issues returns 502, but issue was committed in GitHub issues store
    stubServer.issues.push({
      id: 55555,
      number: 43,
      title: '[STORY-001] User Login with MFA',
      body: formatGitHubIssueBody(samplePayload, 'acme/security-app'),
      html_url: 'https://github.com/acme/security-app/issues/43',
      state: 'open'
    });
    stubServer.queueResponse(502, { message: 'Bad Gateway' });

    const adapter = new GitHubIssuesBacklogExportAdapter({
      baseUrl: stubServer.url,
      defaultToken: 'ghp_testToken12345',
      allowRealExternalMutation: true
    });

    const result = await adapter.createWorkItem({
      targetContainer: 'acme/security-app',
      payload: samplePayload
    });

    expect(result.externalWorkItemId).toBe('43');
    // Expect 1 POST request (which failed with 502) and 1 GET request (which reconciled the committed issue)
    expect(stubServer.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    expect(stubServer.requests.filter((r) => r.method === 'GET')).toHaveLength(1);
  });

  it('fails safely and does NOT retry create POST on HTTP 502 when issue was not committed', async () => {
    stubServer.queueResponse(502, { message: 'Bad Gateway' });

    const adapter = new GitHubIssuesBacklogExportAdapter({
      baseUrl: stubServer.url,
      defaultToken: 'ghp_testToken12345',
      allowRealExternalMutation: true
    });

    await expect(
      adapter.createWorkItem({
        targetContainer: 'acme/security-app',
        payload: samplePayload
      })
    ).rejects.toThrow();

    // Exactly 1 POST request made - no blind second POST!
    expect(stubServer.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it('retries on HTTP 502 server error for idempotent updateWorkItem (PATCH) and succeeds', async () => {
    stubServer.queueResponse(502, { message: 'Bad Gateway' });

    const adapter = new GitHubIssuesBacklogExportAdapter({
      baseUrl: stubServer.url,
      defaultToken: 'ghp_testToken12345',
      allowRealExternalMutation: true,
      maxRetries: 3
    });

    const existingMapping = createBacklogExportMapping({
      id: createBacklogExportMappingId('bmap-1'),
      storyId: sampleStory.id,
      baselineId,
      provider: 'github-issues',
      externalContainer: 'acme/security-app',
      externalWorkItemId: '43',
      externalUrl: 'https://github.com/acme/security-app/issues/43',
      exportContentHash: '0'.repeat(60) + 'beef',
      exportedAt: '2026-09-20T10:00:00Z',
      exportedBy: 'actor-1'
    });

    const result = await adapter.updateWorkItem({
      targetContainer: 'acme/security-app',
      payload: samplePayload,
      existingMapping
    });

    expect(result.externalWorkItemId).toBe('43');
    expect(stubServer.requests).toHaveLength(2);
    expect(stubServer.requests[0].method).toBe('PATCH');
    expect(stubServer.requests[1].method).toBe('PATCH');
  });

  it('handles HTTP 403 secondary rate limit with Retry-After header and succeeds on retry', async () => {
    stubServer.queueResponse(
      403,
      { message: 'You have exceeded a secondary rate limit. Please wait a few minutes.' },
      { 'Retry-After': '0.05', 'content-type': 'application/json' }
    );

    const adapter = new GitHubIssuesBacklogExportAdapter({
      baseUrl: stubServer.url,
      defaultToken: 'ghp_testToken12345',
      allowRealExternalMutation: true,
      maxRetries: 3
    });

    const result = await adapter.createWorkItem({
      targetContainer: 'acme/security-app',
      payload: samplePayload
    });

    expect(result.externalWorkItemId).toBeDefined();
    expect(stubServer.requests).toHaveLength(2);
  });

  it('classifies HTTP 403 with x-ratelimit-remaining: 0 as ProviderRateLimitError with bounded reset delay', async () => {
    const futureEpoch = Math.floor(Date.now() / 1000) + 30;
    stubServer.queueResponse(
      403,
      { message: 'API rate limit exceeded' },
      {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(futureEpoch),
        'content-type': 'application/json'
      }
    );

    const adapter = new GitHubIssuesBacklogExportAdapter({
      baseUrl: stubServer.url,
      defaultToken: 'ghp_testToken12345',
      allowRealExternalMutation: true,
      maxRetries: 1
    });

    await expect(
      adapter.createWorkItem({
        targetContainer: 'acme/security-app',
        payload: samplePayload
      })
    ).rejects.toThrow(ProviderRateLimitError);
  });

  it('rejects malformed 2xx response missing issue number with ProviderValidationError', async () => {
    // Malformed body: number is missing
    stubServer.queueResponse(201, { id: 12345, state: 'open' });

    const adapter = new GitHubIssuesBacklogExportAdapter({
      baseUrl: stubServer.url,
      defaultToken: 'ghp_testToken12345',
      allowRealExternalMutation: true
    });

    await expect(
      adapter.createWorkItem({
        targetContainer: 'acme/security-app',
        payload: samplePayload
      })
    ).rejects.toThrow();
  });

  it('rejects HTTP redirects with ProviderValidationError to prevent SSRF', async () => {
    stubServer.queueResponse(302, undefined, { location: 'http://attacker.example/hijack' });

    const adapter = new GitHubIssuesBacklogExportAdapter({
      baseUrl: stubServer.url,
      defaultToken: 'ghp_testToken12345',
      allowRealExternalMutation: true
    });

    await expect(
      adapter.createWorkItem({
        targetContainer: 'acme/security-app',
        payload: samplePayload
      })
    ).rejects.toThrow();
  });

  it('maps standard HTTP 401 to typed ProviderAuthenticationError', async () => {
    stubServer.queueResponse(401, { message: 'Bad credentials' });

    const adapter = new GitHubIssuesBacklogExportAdapter({
      baseUrl: stubServer.url,
      defaultToken: 'bad_token'
    });

    await expect(
      adapter.createWorkItem({
        targetContainer: 'acme/security-app',
        payload: samplePayload
      })
    ).rejects.toThrow(ProviderAuthenticationError);
  });

  it('enforces safety rail rejecting deceptive non-loopback hostnames without explicit permission', async () => {
    const deceptiveHosts = [
      'https://api.github.com',
      'http://localhost.attacker.example',
      'http://127.0.0.1.attacker.example',
      'http://user:pass@localhost:8080'
    ];

    for (const host of deceptiveHosts) {
      const liveAdapter = new GitHubIssuesBacklogExportAdapter({
        baseUrl: host,
        defaultToken: 'dummy_token',
        allowRealExternalMutation: false
      });

      await expect(
        liveAdapter.createWorkItem({
          targetContainer: 'acme/security-app',
          payload: samplePayload
        })
      ).rejects.toThrow(RealBacklogMutationForbiddenError);
    }
  });

  it('allows valid loopback IPv4 and IPv6 addresses', () => {
    expect(() => {
      new GitHubIssuesBacklogExportAdapter({
        baseUrl: 'http://127.0.0.1:8080',
        allowRealExternalMutation: false
      });
      new GitHubIssuesBacklogExportAdapter({
        baseUrl: 'http://127.0.0.2:8080',
        allowRealExternalMutation: false
      });
      new GitHubIssuesBacklogExportAdapter({
        baseUrl: 'http://[::1]:8080',
        allowRealExternalMutation: false
      });
      new GitHubIssuesBacklogExportAdapter({
        baseUrl: 'http://localhost:8080',
        allowRealExternalMutation: false
      });
    }).not.toThrow();
  });

  it('renders storyVersion, exportVersion, and export history table when present', () => {
    const payloadWithHistory: BacklogExportPayload = {
      ...samplePayload,
      exportVersion: 2,
      history: [
        {
          exportVersion: 1,
          storyVersion: 1,
          baselineId: createRequirementsBaselineId('BASE-000'),
          exportContentHash: 'a'.repeat(64),
          requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
          policyConstraintRevisionIds: [],
          exportedAt: createInstant('2026-09-19T10:00:00Z'),
          exportedBy: createActorId('operator-1'),
          externalWorkItemId: '43',
          updateRationale: 'Initial release'
        }
      ]
    };

    const body = formatGitHubIssueBody(payloadWithHistory, 'acme/security-app');
    expect(body).toContain('| **Story Version** | `v1` |');
    expect(body).toContain('| **Export Version** | `v2` |');
    expect(body).toContain('### Export History');
    expect(body).toContain(
      '| v1 | v1 | `BASE-000` | `aaaaaaaa...` | 2026-09-19T10:00:00Z | Initial release |'
    );
    expect(body).toContain('"storyVersion": 1');
    expect(body).toContain('"exportVersion": 2');
  });
});
