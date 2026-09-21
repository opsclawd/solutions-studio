import { z } from 'zod';
import { now, type BacklogExportMapping } from '@solutions-studio/domain';
import {
  type IBacklogExportGateway,
  type ExportWorkItemParams,
  type ExportWorkItemResult,
  type BacklogExportPayload,
  ProviderAuthenticationError,
  ProviderRateLimitError,
  ProviderResourceNotFoundError,
  ProviderValidationError,
  ProviderServerUnavailableError,
  ProviderNetworkError
} from '../../application/ports/backlog/index.js';
import { assertSafeBacklogEndpoint } from './safeEndpoint.js';

export interface GitHubIssuesAdapterOptions {
  readonly baseUrl?: string;
  readonly defaultToken?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly allowRealExternalMutation?: boolean;
  readonly fetchFn?: typeof fetch;
}

const GitHubIssueResponseSchema = z.object({
  id: z.number().int().positive(),
  number: z.number().int().positive(),
  html_url: z.string().url().optional(),
  state: z.string().optional()
});

export function formatGitHubIssueBody(
  payload: BacklogExportPayload,
  targetContainer: string
): string {
  const story = payload.story;
  const baseline = payload.baseline;

  // 1. Narrative
  const narrativeSection = [
    '### Narrative',
    '',
    `**As a** ${story.narrative.role}, **I want** ${story.narrative.feature}, **so that** ${story.narrative.benefit}.`,
    ''
  ].join('\n');

  // 2. Acceptance Criteria
  const acSection = [
    '### Acceptance Criteria',
    '',
    ...(story.acceptanceCriteria.length > 0
      ? story.acceptanceCriteria.map((ac) => `- [ ] ${ac}`)
      : ['- [ ] Acceptance criteria defined in scenarios']),
    ''
  ].join('\n');

  // 3. Scenarios formatted as syntax-highlighted Gherkin
  const scenariosSection = [
    '### Scenarios',
    '',
    ...story.scenarios.map((sc) => {
      const stepsText = sc.steps.map((st) => `${st.keyword} ${st.text}`).join('\n');
      return [`#### ${sc.title}`, '', '```gherkin', stepsText, '```', ''].join('\n');
    })
  ].join('\n');

  // 4. Prerequisites / Dependencies
  let prereqSection = '';
  if (payload.prerequisites && payload.prerequisites.length > 0) {
    prereqSection = [
      '### Prerequisites / Dependencies',
      '',
      ...payload.prerequisites.map((p) => {
        const ref = p.externalWorkItemId
          ? `#${p.externalWorkItemId} ([${p.storyId}])`
          : `[${p.storyId}]`;
        const titleSuffix = p.title ? ` — ${p.title}` : '';
        return `- ${ref}${titleSuffix}`;
      }),
      '',
      ''
    ].join('\n');
  }

  // 5. Traceability table
  const edIds = payload.engineeringDecisions.map((d) => d.id).join(', ') || 'None';
  const policyIds = (story.policyConstraintRevisionIds ?? []).join(', ') || 'None';
  const reqIds = story.requirementRevisionIds.join(', ');
  const storyVersion = story.version ?? 1;
  const exportVersion = payload.exportVersion ?? 1;

  const traceabilitySection = [
    '### Traceability & Lineage',
    '',
    '| Attribute | Internal Authority Reference |',
    '| :--- | :--- |',
    `| **Baseline ID** | \`${baseline.id}\` |`,
    `| **Story ID** | \`${story.id}\` |`,
    `| **Story Version** | \`v${storyVersion}\` |`,
    `| **Export Version** | \`v${exportVersion}\` |`,
    `| **Requirement Revisions** | \`${reqIds}\` |`,
    `| **Policy Constraints** | \`${policyIds}\` |`,
    `| **Engineering Decisions** | \`${edIds}\` |`,
    `| **Content SHA-256** | \`${payload.contentHash}\` |`,
    ''
  ].join('\n');

  // 6. Export History (if previous snapshots exist)
  let historySection = '';
  if (payload.history && payload.history.length > 0) {
    historySection = [
      '### Export History',
      '',
      '| Export Version | Story Version | Baseline | Content Hash | Exported At | Rationale |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      ...payload.history.map(
        (h) =>
          `| v${h.exportVersion} | v${h.storyVersion} | \`${h.baselineId}\` | \`${h.exportContentHash.slice(0, 8)}...\` | ${h.exportedAt} | ${h.updateRationale ?? 'N/A'} |`
      ),
      '',
      ''
    ].join('\n');
  }

  // 7. Machine-readable Provenance HTML comment
  const machineReadableProvenance = {
    declaredProvenance: {
      baselineId: baseline.id,
      storyId: story.id,
      storyVersion,
      exportVersion,
      requirementRevisionIds: story.requirementRevisionIds,
      policyConstraintRevisionIds: story.policyConstraintRevisionIds ?? [],
      engineeringDecisionIds: payload.engineeringDecisions.map((d) => d.id)
    },
    configuredExecution: {
      provider: 'github-issues',
      externalContainer: targetContainer
    },
    measuredVerification: {
      contentHash: payload.contentHash,
      exportedAt: now()
    },
    dependencies: payload.prerequisites.map((p) => ({
      storyId: p.storyId,
      externalWorkItemId: p.externalWorkItemId
    }))
  };

  const provenanceComment = [
    '<!-- solutions-studio-provenance:start',
    JSON.stringify(machineReadableProvenance, null, 2),
    'solutions-studio-provenance:end -->'
  ].join('\n');

  return [
    narrativeSection,
    acSection,
    scenariosSection,
    prereqSection,
    traceabilitySection,
    historySection,
    provenanceComment
  ]
    .filter(Boolean)
    .join('\n');
}

export class GitHubIssuesBacklogExportAdapter implements IBacklogExportGateway {
  public readonly providerId = 'github-issues';
  private readonly baseUrl: string;
  private readonly defaultToken?: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly allowRealExternalMutation: boolean;
  private readonly fetchFn: typeof fetch;

  constructor(options: GitHubIssuesAdapterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/$/, '');
    this.defaultToken = options.defaultToken;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.maxRetries = options.maxRetries ?? 3;
    this.allowRealExternalMutation =
      options.allowRealExternalMutation ?? process.env.ALLOW_REAL_BACKLOG_MUTATION === 'true';
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  private assertSafeEndpoint(): void {
    assertSafeBacklogEndpoint(this.baseUrl, this.allowRealExternalMutation);
  }

  private resolveToken(credentials?: { token?: string }): string {
    const token = credentials?.token || this.defaultToken || process.env.GITHUB_TOKEN;
    if (!token || token.trim().length === 0) {
      throw new ProviderAuthenticationError(
        'GitHub personal access token is required for backlog export'
      );
    }
    return token.trim();
  }

  private parseTargetContainer(targetContainer: string): { owner: string; repo: string } {
    const parts = targetContainer.split('/');
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
      throw new ProviderValidationError(
        `Invalid targetContainer '${targetContainer}': expected 'owner/repo' format`
      );
    }
    return { owner: parts[0].trim(), repo: parts[1].trim() };
  }

  private async executeWithRetry<T>(fn: () => Promise<T>, retryServerErrors = true): Promise<T> {
    let attempt = 0;
    while (true) {
      attempt++;
      try {
        return await fn();
      } catch (err) {
        if (err instanceof ProviderRateLimitError) {
          if (attempt < this.maxRetries) {
            const delay = err.retryAfterSeconds ? err.retryAfterSeconds * 1000 : 100 * attempt;
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          throw err;
        }

        if (retryServerErrors && err instanceof ProviderServerUnavailableError) {
          if (attempt < this.maxRetries) {
            const delay = Math.min(50 * Math.pow(2, attempt), 2000);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          throw err;
        }

        throw err;
      }
    }
  }

  private async doFetch(
    url: string,
    method: 'POST' | 'PATCH',
    token: string,
    body: Record<string, unknown>
  ): Promise<ExportWorkItemResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Solutions-Studio-Backlog-Export/1.0',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        redirect: 'manual',
        signal: controller.signal
      });
    } catch (err) {
      throw new ProviderNetworkError(
        `GitHub API network request failed: ${(err as Error).message}`
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (res.status >= 300 && res.status < 400) {
      throw new ProviderValidationError(
        `Unexpected HTTP redirect returned from GitHub API (${res.status}): redirects are disabled for safety`
      );
    }

    // Inspect rate limits (429 or 403 secondary/primary rate limit)
    const retryHeader = res.headers.get('Retry-After');
    const rateLimitRemaining = res.headers.get('x-ratelimit-remaining');
    const rateLimitReset = res.headers.get('x-ratelimit-reset');

    let msg = '';
    let responseJson: unknown = undefined;
    try {
      responseJson = await res.json();
      msg = (responseJson as { message?: string })?.message || '';
    } catch {
      // ignore
    }

    const is403RateLimit =
      res.status === 403 &&
      (rateLimitRemaining === '0' ||
        Boolean(retryHeader) ||
        msg.toLowerCase().includes('rate limit') ||
        msg.toLowerCase().includes('secondary rate'));

    if (res.status === 429 || is403RateLimit) {
      let retrySeconds: number | undefined;
      if (retryHeader) {
        retrySeconds = parseFloat(retryHeader);
      } else if (rateLimitReset) {
        const resetEpoch = parseInt(rateLimitReset, 10);
        if (!isNaN(resetEpoch)) {
          const nowEpoch = Math.floor(Date.now() / 1000);
          retrySeconds = Math.max(1, resetEpoch - nowEpoch);
        }
      }
      throw new ProviderRateLimitError(
        `GitHub API rate limit exceeded (${res.status}): ${msg || 'Rate limit exceeded'}`,
        retrySeconds
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new ProviderAuthenticationError(
        `GitHub API error (${res.status}): ${msg || 'Authentication failed'}`
      );
    }

    if (res.status === 404) {
      throw new ProviderResourceNotFoundError(
        `GitHub API resource not found (404): ${msg || 'Not found'}`
      );
    }

    if (res.status === 422) {
      const errors = (responseJson as { errors?: unknown })?.errors;
      throw new ProviderValidationError(
        `GitHub validation failed (422): ${msg || 'Validation failed'}`,
        errors
      );
    }

    if (res.status >= 500) {
      throw new ProviderServerUnavailableError(`GitHub API server unavailable (${res.status})`);
    }

    if (!res.ok) {
      throw new ProviderValidationError(`Unexpected GitHub API status: ${res.status}`);
    }

    // Validate 2xx response strictly against schema
    const parseResult = GitHubIssueResponseSchema.safeParse(responseJson);
    if (!parseResult.success) {
      throw new ProviderValidationError(
        'Invalid or malformed response from GitHub API: missing required issue number or ID',
        parseResult.error.issues
      );
    }

    const data = parseResult.data;

    return {
      externalWorkItemId: String(data.number),
      externalUrl: data.html_url,
      metadata: {
        issueNumber: data.number,
        id: data.id,
        state: data.state
      }
    };
  }

  async findWorkItem(params: ExportWorkItemParams): Promise<ExportWorkItemResult | undefined> {
    this.assertSafeEndpoint();
    const token = this.resolveToken(params.credentials);
    const { owner, repo } = this.parseTargetContainer(params.targetContainer);

    const url = `${this.baseUrl}/repos/${owner}/${repo}/issues?state=all`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Solutions-Studio-Backlog-Export/1.0'
        },
        redirect: 'manual',
        signal: controller.signal
      });
    } catch (err) {
      throw new ProviderNetworkError(
        `GitHub API network request failed: ${(err as Error).message}`
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      return undefined;
    }

    let issues: unknown[];
    try {
      issues = (await res.json()) as unknown[];
    } catch {
      return undefined;
    }

    if (!Array.isArray(issues)) {
      return undefined;
    }

    const expectedTitlePrefix = `[${params.payload.story.id}]`;
    const expectedStoryMarker = `"storyId": "${params.payload.story.id}"`;
    const expectedBaselineMarker = `"baselineId": "${params.payload.baseline.id}"`;

    for (const issue of issues) {
      if (typeof issue === 'object' && issue !== null) {
        const item = issue as {
          number?: number;
          id?: number;
          title?: string;
          body?: string;
          html_url?: string;
          state?: string;
        };
        const titleMatch = item.title?.startsWith(expectedTitlePrefix);
        const bodyMatch =
          item.body?.includes('solutions-studio-provenance:start') &&
          item.body.includes(expectedStoryMarker) &&
          item.body.includes(expectedBaselineMarker);

        if (titleMatch || bodyMatch) {
          if (typeof item.number === 'number' && typeof item.id === 'number') {
            return {
              externalWorkItemId: String(item.number),
              externalUrl: item.html_url,
              metadata: {
                issueNumber: item.number,
                id: item.id,
                state: item.state
              }
            };
          }
        }
      }
    }

    return undefined;
  }

  async createWorkItem(params: ExportWorkItemParams): Promise<ExportWorkItemResult> {
    this.assertSafeEndpoint();
    const token = this.resolveToken(params.credentials);
    const { owner, repo } = this.parseTargetContainer(params.targetContainer);

    const title = `[${params.payload.story.id}] ${params.payload.story.title}`;
    const body = formatGitHubIssueBody(params.payload, params.targetContainer);
    const labels = ['solutions-studio', `baseline:${params.payload.baseline.id}`];

    const url = `${this.baseUrl}/repos/${owner}/${repo}/issues`;

    // Rate limits can be retried (as request was rejected before processing),
    // but server errors (5xx) must NOT be blindly repeated on POST without reconciliation!
    try {
      return await this.executeWithRetry(
        () =>
          this.doFetch(url, 'POST', token, {
            title,
            body,
            labels
          }),
        false // do NOT blindly retry 5xx on POST
      );
    } catch (err) {
      if (err instanceof ProviderServerUnavailableError || err instanceof ProviderNetworkError) {
        // Ambiguous outcome / lost acknowledgement:
        // Inspect whether GitHub committed the issue before the 5xx / timeout
        try {
          const reconciled = await this.findWorkItem(params);
          if (reconciled) {
            return reconciled;
          }
        } catch {
          // Fall through to rethrow original error
        }
      }
      throw err;
    }
  }

  async updateWorkItem(
    params: ExportWorkItemParams & { readonly existingMapping: BacklogExportMapping }
  ): Promise<ExportWorkItemResult> {
    this.assertSafeEndpoint();
    const token = this.resolveToken(params.credentials);
    const { owner, repo } = this.parseTargetContainer(params.targetContainer);

    const title = `[${params.payload.story.id}] ${params.payload.story.title}`;
    const body = formatGitHubIssueBody(params.payload, params.targetContainer);

    const issueNumber = params.existingMapping.externalWorkItemId;
    const url = `${this.baseUrl}/repos/${owner}/${repo}/issues/${issueNumber}`;

    return this.executeWithRetry(
      () =>
        this.doFetch(url, 'PATCH', token, {
          title,
          body
        }),
      true
    );
  }

  async checkHealth(): Promise<{
    status: 'healthy' | 'unhealthy' | 'degraded';
    provider: string;
    reachable?: boolean;
    latencyMs?: number;
    error?: string;
  }> {
    const start = Date.now();
    const token = this.defaultToken ?? process.env.GITHUB_TOKEN;
    if (!token) {
      return {
        status: 'degraded',
        provider: 'github-issues',
        reachable: false,
        latencyMs: 0,
        error: 'Unconfigured: GITHUB_TOKEN not set'
      };
    }
    try {
      const res = await (this.fetchFn ?? fetch)(`${this.baseUrl}/zen`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'solutions-studio'
        },
        signal: AbortSignal.timeout(3000)
      });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return {
          status: 'healthy',
          provider: 'github-issues',
          reachable: true,
          latencyMs
        };
      }
      return {
        status: 'degraded',
        provider: 'github-issues',
        reachable: false,
        latencyMs,
        error: `GitHub API returned HTTP ${res.status}`
      };
    } catch (err) {
      return {
        status: 'unhealthy',
        provider: 'github-issues',
        reachable: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }
}
