#!/usr/bin/env tsx
import path from 'node:path';
import { now, type AuthenticatedActor } from '@solutions-studio/domain';
import { RepositoryFactory } from '../src/infrastructure/persistence/RepositoryFactory.js';
import type { IRequirementsRepository } from '../src/application/ports/persistence/IRequirementsRepository.js';
import { DefaultAuthorizationPolicy } from '../src/infrastructure/identity/DefaultAuthorizationPolicy.js';
import { TestAuthenticator } from '../src/infrastructure/identity/TestAuthenticator.js';
import { GetAuthorityBundleUseCase } from '../src/application/use-cases/GetAuthorityBundleUseCase.js';
import { EvaluateStoryReadinessUseCase } from '../src/application/use-cases/EvaluateStoryReadinessUseCase.js';
import { BuildStoryDependencyGraphUseCase } from '../src/application/use-cases/BuildStoryDependencyGraphUseCase.js';
import { ExportBacklogUseCase } from '../src/application/use-cases/ExportBacklogUseCase.js';
import { EvaluateExportStalenessUseCase } from '../src/application/use-cases/EvaluateExportStalenessUseCase.js';
import { GitHubIssuesBacklogExportAdapter } from '../src/infrastructure/backlog/GitHubIssuesBacklogExportAdapter.js';
import { assertSafeBacklogEndpoint } from '../src/infrastructure/backlog/safeEndpoint.js';
import type { IBacklogExportGateway } from '../src/application/ports/backlog/IBacklogExportGateway.js';
import type {
  ExportBacklogResponseDto,
  BaselineExportStalenessReportDto
} from '@solutions-studio/contracts';

export interface BacklogExportCliArgs {
  baselineId: string;
  targetContainer: string;
  provider: string;
  storyIds?: string[];
  forceUpdate: boolean;
  allowUpdate: boolean;
  rationale?: string;
  propagateStaleOnly: boolean;
  checkStalenessOnly: boolean;
  token?: string;
  baseUrl?: string;
  allowRealMutation: boolean;
  storeDir?: string;
  format: 'text' | 'json';
  operatorToken?: string;
  allowTestAuthenticator?: boolean;
}

export function parseArgs(args: string[]): BacklogExportCliArgs {
  let baselineId: string | undefined = undefined;
  let targetContainer: string | undefined = undefined;
  let provider = 'github-issues';
  const storyIds: string[] = [];
  let forceUpdate = false;
  let allowUpdate = false;
  let rationale: string | undefined = undefined;
  let propagateStaleOnly = false;
  let checkStalenessOnly = false;
  let token = process.env.GITHUB_TOKEN;
  let baseUrl = process.env.GITHUB_API_URL;
  let allowRealMutation = process.env.ALLOW_REAL_BACKLOG_MUTATION === 'true';
  let storeDir = process.env.STORE_DIR;
  let format: 'text' | 'json' = 'text';
  let operatorToken = process.env.OPERATOR_TOKEN ?? process.env.AUTH_TOKEN;
  let allowTestAuthenticator = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--baseline') {
      baselineId = args[++i];
    } else if (arg.startsWith('--baseline=')) {
      baselineId = arg.substring('--baseline='.length);
    } else if (arg === '--target') {
      targetContainer = args[++i];
    } else if (arg.startsWith('--target=')) {
      targetContainer = arg.substring('--target='.length);
    } else if (arg === '--provider') {
      provider = args[++i];
    } else if (arg.startsWith('--provider=')) {
      provider = arg.substring('--provider='.length);
    } else if (arg === '--story') {
      const val = args[++i];
      if (val) {
        storyIds.push(
          ...val
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        );
      }
    } else if (arg.startsWith('--story=')) {
      const val = arg.substring('--story='.length);
      storyIds.push(
        ...val
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      );
    } else if (arg === '--force-update') {
      forceUpdate = true;
    } else if (arg === '--allow-update') {
      allowUpdate = true;
    } else if (arg === '--rationale') {
      rationale = args[++i];
    } else if (arg.startsWith('--rationale=')) {
      rationale = arg.substring('--rationale='.length);
    } else if (arg === '--propagate-stale-only') {
      propagateStaleOnly = true;
    } else if (arg === '--check-staleness-only') {
      checkStalenessOnly = true;
    } else if (arg === '--token') {
      token = args[++i];
    } else if (arg.startsWith('--token=')) {
      token = arg.substring('--token='.length);
    } else if (arg === '--operator-token') {
      operatorToken = args[++i];
    } else if (arg.startsWith('--operator-token=')) {
      operatorToken = arg.substring('--operator-token='.length);
    } else if (arg === '--allow-test-authenticator') {
      allowTestAuthenticator = true;
    } else if (arg === '--base-url') {
      baseUrl = args[++i];
    } else if (arg.startsWith('--base-url=')) {
      baseUrl = arg.substring('--base-url='.length);
    } else if (arg === '--allow-real-mutation') {
      allowRealMutation = true;
    } else if (arg === '--store') {
      storeDir = args[++i];
    } else if (arg.startsWith('--store=')) {
      storeDir = arg.substring('--store='.length);
    } else if (arg === '--format') {
      const val = args[++i];
      if (val === 'json' || val === 'text') {
        format = val;
      }
    } else if (arg.startsWith('--format=')) {
      const val = arg.substring('--format='.length);
      if (val === 'json' || val === 'text') {
        format = val;
      }
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!baselineId) {
    throw new Error('Missing required argument: --baseline <baselineId>');
  }
  if (!targetContainer) {
    throw new Error('Missing required argument: --target <targetContainer> (e.g. owner/repo)');
  }

  return {
    baselineId,
    targetContainer,
    provider,
    storyIds: storyIds.length > 0 ? storyIds : undefined,
    forceUpdate,
    allowUpdate,
    rationale,
    propagateStaleOnly,
    checkStalenessOnly,
    token,
    baseUrl,
    allowRealMutation,
    storeDir,
    format,
    operatorToken,
    allowTestAuthenticator
  };
}

function printHelp(): void {
  console.log(`
Usage: run-backlog-export --baseline <baselineId> --target <targetContainer> [options]

Options:
  --baseline <id>            Baseline ID to export (required)
  --target <owner/repo>      Target external container (required)
  --provider <provider>      Backlog provider (default: github-issues)
  --story <storyId>          Specific story ID to export (can be specified multiple times)
  --force-update             Force update of stories even if content hash is unchanged
  --allow-update             Explicitly allow updating existing external work items if stale
  --rationale <text>         Rationale message for updates to record in history
  --propagate-stale-only     Only export stories that are STALE or IMPACTED
  --check-staleness-only     Check staleness status without performing export mutations
  --token <token>            GitHub API token (default: GITHUB_TOKEN env var)
  --operator-token <token>   Operator auth token (required if actor not injected)
  --allow-test-authenticator Allow TestAuthenticator to verify operator tokens
  --base-url <url>           Base URL for provider API (default: GITHUB_API_URL or https://api.github.com)
  --allow-real-mutation      Explicit flag required to mutate real external backlog
  --store <dir>              Storage directory path
  --format <text|json>       Output format (default: text)
  --help, -h                 Show this help message
`);
}

export interface RunBacklogExportOptions extends Partial<BacklogExportCliArgs> {
  baselineId: string;
  targetContainer: string;
  repository?: IRequirementsRepository;
  gateway?: IBacklogExportGateway;
  actor?: AuthenticatedActor;
  log?: (message: string) => void;
}

export async function runBacklogExport(
  options: RunBacklogExportOptions
): Promise<ExportBacklogResponseDto> {
  const provider = options.provider ?? 'github-issues';
  const forceUpdate = options.forceUpdate ?? false;
  const allowUpdate = options.allowUpdate ?? false;
  const propagateStaleOnly = options.propagateStaleOnly ?? false;
  const checkStalenessOnly = options.checkStalenessOnly ?? false;
  const allowRealMutation = options.allowRealMutation ?? false;
  const format = options.format ?? 'text';

  if (provider === 'github-issues' || options.baseUrl) {
    const effectiveBaseUrl =
      options.baseUrl ?? process.env.GITHUB_API_URL ?? 'https://api.github.com';
    assertSafeBacklogEndpoint(effectiveBaseUrl, allowRealMutation);
  }

  const storeDir = options.storeDir ?? path.resolve(process.cwd(), '.requirements-store');
  const repository =
    options.repository ??
    RepositoryFactory.createFromEnvironment({
      baseDir: storeDir
    });

  let gateway: IBacklogExportGateway;
  if (options.gateway) {
    if (provider && provider !== options.gateway.providerId) {
      throw new Error(
        `Provider mismatch: CLI specified '${provider}' but injected gateway is '${options.gateway.providerId}'`
      );
    }
    gateway = options.gateway;
  } else {
    if (provider !== 'github-issues') {
      throw new Error(
        `Unsupported backlog export provider '${provider}'. Supported providers: github-issues.`
      );
    }
    gateway = new GitHubIssuesBacklogExportAdapter({
      baseUrl: options.baseUrl,
      defaultToken: options.token,
      allowRealExternalMutation: allowRealMutation
    });
  }

  const authorizer = new DefaultAuthorizationPolicy();
  const getAuthorityBundleUseCase = new GetAuthorityBundleUseCase(repository);
  const evaluateStoryReadinessUseCase = new EvaluateStoryReadinessUseCase(repository);
  const buildStoryDependencyGraphUseCase = new BuildStoryDependencyGraphUseCase(
    repository,
    evaluateStoryReadinessUseCase
  );
  const evaluateExportStalenessUseCase = new EvaluateExportStalenessUseCase(
    repository,
    getAuthorityBundleUseCase,
    buildStoryDependencyGraphUseCase,
    authorizer
  );

  let actor = options.actor;
  if (!actor) {
    const operatorToken =
      options.operatorToken ??
      options.token ??
      process.env.OPERATOR_TOKEN ??
      process.env.AUTH_TOKEN;
    if (operatorToken && (options.allowTestAuthenticator || process.env.NODE_ENV === 'test')) {
      const authenticator = new TestAuthenticator({ allowAnonymousFallback: false });
      actor = await authenticator.authenticate(operatorToken);
    }
  }

  if (!actor) {
    throw new Error(
      'Authenticated operator identity is required for backlog export. Provide an authenticated actor or specify --operator-token / OPERATOR_TOKEN with an authorized operator identity.'
    );
  }

  if (actor.metadata?.isAnonymousFallback) {
    throw new Error(
      'Anonymous fallback actors are not permitted to perform backlog export operations.'
    );
  }

  const log = options.log ?? console.log;

  if (checkStalenessOnly) {
    const stalenessReport = await evaluateExportStalenessUseCase.execute({
      baselineId: options.baselineId,
      provider,
      targetContainer: options.targetContainer,
      storyIds: options.storyIds,
      actor
    });
    if (format === 'json') {
      log(JSON.stringify(stalenessReport, null, 2));
    } else {
      log(formatStalenessReport(stalenessReport));
    }
    return {
      baselineId: options.baselineId,
      provider,
      externalContainer: options.targetContainer,
      items: [],
      summary: {
        total: stalenessReport.totalStories,
        created: 0,
        updated: 0,
        unchanged: stalenessReport.currentCount,
        skippedStale: stalenessReport.staleCount + stalenessReport.impactedCount,
        rejected: 0,
        failed: 0
      },
      exportedAt: now()
    };
  }

  const useCase = new ExportBacklogUseCase(
    repository,
    gateway,
    authorizer,
    getAuthorityBundleUseCase,
    evaluateStoryReadinessUseCase,
    buildStoryDependencyGraphUseCase,
    evaluateExportStalenessUseCase
  );

  const result = await useCase.execute({
    baselineId: options.baselineId,
    targetContainer: options.targetContainer,
    provider,
    storyIds: options.storyIds,
    forceUpdate,
    allowUpdateExisting: allowUpdate,
    updateRationale: options.rationale,
    propagateStaleOnly,
    credentials: options.token ? { token: options.token } : undefined,
    actor
  });

  if (format === 'json') {
    log(JSON.stringify(result, null, 2));
  } else {
    log(formatExportReport(result));
  }

  return result;
}

export function formatExportReport(result: ExportBacklogResponseDto): string {
  const lines: string[] = [];
  lines.push('================================================================');
  lines.push(`Backlog Export Report: Baseline ${result.baselineId}`);
  lines.push(`Provider: ${result.provider} | Target: ${result.externalContainer}`);
  lines.push('================================================================');
  lines.push(
    `Summary: Total: ${result.summary.total} | Created: ${result.summary.created} | Updated: ${result.summary.updated} | Unchanged: ${result.summary.unchanged} | Skipped Stale: ${result.summary.skippedStale ?? 0} | Rejected: ${result.summary.rejected} | Failed: ${result.summary.failed}`
  );
  lines.push('----------------------------------------------------------------');

  for (const item of result.items) {
    if (item.status === 'created' || item.status === 'updated' || item.status === 'unchanged') {
      const urlPart = item.externalUrl ? ` -> ${item.externalUrl}` : '';
      lines.push(
        `[${item.status.toUpperCase()}] Story: ${item.storyId} (Issue #${item.externalWorkItemId})${urlPart}`
      );
    } else if (item.status === 'skipped-stale') {
      lines.push(
        `[SKIPPED-STALE] Story: ${item.storyId} (Issue #${item.externalWorkItemId}) - ${item.message}`
      );
    } else if (item.status === 'rejected') {
      lines.push(
        `[REJECTED] Story: ${item.storyId} - Reasons: ${item.rejectionReasons.join(', ')}`
      );
    } else if (item.status === 'failed') {
      lines.push(
        `[FAILED] Story: ${item.storyId} - Error: ${item.errorMessage} (Retryable: ${item.retryable})`
      );
    }
  }

  lines.push('================================================================');
  return lines.join('\n');
}

export function formatStalenessReport(report: BaselineExportStalenessReportDto): string {
  const lines: string[] = [];
  lines.push('================================================================');
  lines.push(`Export Staleness Report: Baseline ${report.baselineId}`);
  lines.push('================================================================');
  lines.push(
    `Summary: Total: ${report.totalStories} | Current: ${report.currentCount} | Stale: ${report.staleCount} | Impacted: ${report.impactedCount} | Unexported: ${report.unexportedCount}`
  );
  lines.push('----------------------------------------------------------------');

  for (const story of report.stories) {
    const causesStr =
      story.causes.length > 0 ? ` (${story.causes.map((c) => c.category).join(', ')})` : '';
    lines.push(`[${story.classification}] Story: ${story.storyId}${causesStr}`);
  }

  lines.push('================================================================');
  return lines.join('\n');
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await runBacklogExport(args);

  if (result.summary.failed > 0 || result.summary.rejected > 0) {
    process.exit(1);
  }
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  (import.meta.url === `file://${path.resolve(process.argv[1])}` ||
    process.argv[1].endsWith('run-backlog-export.ts') ||
    process.argv[1].endsWith('run-backlog-export.js'));

if (isDirectRun) {
  main().catch((err) => {
    console.error(
      '\nFatal error running backlog export:',
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  });
}
