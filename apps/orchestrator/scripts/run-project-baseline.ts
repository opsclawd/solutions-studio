#!/usr/bin/env tsx
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { IRequirementsRepository } from '../src/application/ports/persistence/IRequirementsRepository.js';
import type { IGenerationGateway } from '../src/application/ports/generation/IGenerationGateway.js';
import type { IMermaidLinterGateway } from '../src/application/ports/validation/IMermaidLinterGateway.js';
import { FilesystemRequirementsRepository } from '../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { GatewayFactory } from '../src/infrastructure/generation/GatewayFactory.js';
import type {
  ProviderType,
  GatewayConfig
} from '../src/infrastructure/generation/GatewayFactory.js';
import { MermaidCliLinterAdapter } from '../src/infrastructure/validation/MermaidCliLinterAdapter.js';
import { GenerateArtifactUseCase } from '../src/application/use-cases/GenerateArtifactUseCase.js';
import { GeneratePrototypeProjectionUseCase } from '../src/application/use-cases/GeneratePrototypeProjectionUseCase.js';
import { GenerateSqlSchemaProjectionUseCase } from '../src/application/use-cases/GenerateSqlSchemaProjectionUseCase.js';
import { BabelTsxValidatorAdapter } from '../src/infrastructure/validation/BabelTsxValidatorAdapter.js';
import { PGliteSqlValidatorAdapter } from '../src/infrastructure/validation/PGliteSqlValidatorAdapter.js';
import {
  ProjectBaselineUseCase,
  type BaselineProjectionResult
} from '../src/application/use-cases/ProjectBaselineUseCase.js';

export type ArtifactType = 'process-diagram' | 'state-diagram' | 'prototype' | 'sql-schema';
export type CliProviderType = 'agy' | 'opencode';
export const VALID_CLI_PROVIDERS: readonly CliProviderType[] = ['agy', 'opencode'];

export interface CliArgs {
  baselineId: string;
  artifactType: ArtifactType;
  provider: CliProviderType;
  storeDir?: string;
  timeoutMs?: number;
  agyBinPath?: string;
  opencodeBinPath?: string;
  modelName?: string;
}

const KNOWN_OPTIONS = new Set([
  '--baseline',
  '--artifact-type',
  '--provider',
  '--store',
  '--timeout',
  '--agy-bin',
  '--opencode-bin',
  '--model'
]);

export function parseArgs(args: string[]): CliArgs {
  let baselineId: string | undefined = undefined;
  let artifactType: ArtifactType | undefined = undefined;
  let provider: CliProviderType = (process.env.GENERATION_PROVIDER as CliProviderType) ?? 'agy';
  let storeDir: string | undefined = undefined;
  let timeoutMs: number | undefined = undefined;
  let agyBinPath: string | undefined = process.env.AGY_BIN_PATH;
  let opencodeBinPath: string | undefined = process.env.OPENCODE_BIN_PATH;
  let modelName: string | undefined = undefined;

  const seenOptions = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument: '${arg}'`);
    }

    if (!KNOWN_OPTIONS.has(arg)) {
      throw new Error(`Unknown option: '${arg}'`);
    }

    if (seenOptions.has(arg)) {
      throw new Error(`Duplicate option: '${arg}'`);
    }
    seenOptions.add(arg);

    if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
      throw new Error(`Option '${arg}' requires a value`);
    }

    const value = args[++i];

    switch (arg) {
      case '--baseline':
        baselineId = value;
        break;
      case '--artifact-type':
        artifactType = value as ArtifactType;
        break;
      case '--provider':
        provider = value as CliProviderType;
        break;
      case '--store':
        storeDir = path.resolve(process.cwd(), value);
        break;
      case '--timeout': {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error(`Option '--timeout' must be a positive integer, received: '${value}'`);
        }
        timeoutMs = parsed;
        break;
      }
      case '--agy-bin':
        agyBinPath = path.resolve(process.cwd(), value);
        break;
      case '--opencode-bin':
        opencodeBinPath = path.resolve(process.cwd(), value);
        break;
      case '--model':
        modelName = value;
        break;
    }
  }

  if (!baselineId) {
    throw new Error("Option '--baseline' is required");
  }

  if (!artifactType) {
    throw new Error("Option '--artifact-type' is required");
  }

  const validArtifactTypes: ArtifactType[] = [
    'process-diagram',
    'state-diagram',
    'prototype',
    'sql-schema'
  ];
  if (!validArtifactTypes.includes(artifactType)) {
    throw new Error(
      `Invalid artifact type '${artifactType}'. Allowed values: ${validArtifactTypes.join(', ')}`
    );
  }

  const validProviders: readonly CliProviderType[] = VALID_CLI_PROVIDERS;
  if (!validProviders.includes(provider)) {
    throw new Error(`Invalid provider '${provider}'. Allowed values: ${validProviders.join(', ')}`);
  }

  if (seenOptions.has('--agy-bin') && provider !== 'agy') {
    throw new Error(`Option '--agy-bin' is only valid when provider is 'agy', got '${provider}'`);
  }

  if (seenOptions.has('--opencode-bin') && provider !== 'opencode') {
    throw new Error(
      `Option '--opencode-bin' is only valid when provider is 'opencode', got '${provider}'`
    );
  }

  if (seenOptions.has('--model') && provider !== 'agy' && provider !== 'opencode') {
    throw new Error(
      `Option '--model' is only valid when provider is 'agy' or 'opencode', got '${provider}'`
    );
  }

  return {
    baselineId,
    artifactType,
    provider,
    storeDir,
    timeoutMs,
    agyBinPath,
    opencodeBinPath,
    modelName
  };
}

export interface ProjectBaselineDependencies {
  readonly storeDir: string;
  readonly repository: IRequirementsRepository;
  readonly provider: ProviderType;
  readonly generationGateway: IGenerationGateway;
  readonly linterGateway: IMermaidLinterGateway;
  readonly generateArtifactUseCase: GenerateArtifactUseCase;
  readonly projectBaselineUseCase: ProjectBaselineUseCase;
}

export interface RunProjectBaselineOptions {
  baselineId: string;
  artifactType: ArtifactType;
  provider?: ProviderType;
  storeDir?: string;
  timeoutMs?: number;
  agyBinPath?: string;
  opencodeBinPath?: string;
  modelName?: string;
  repository?: IRequirementsRepository;
  generationGateway?: IGenerationGateway;
  linterGateway?: IMermaidLinterGateway;
  log?: (message: string) => void;
}

export function composeProjectBaselineComponents(
  options: RunProjectBaselineOptions
): ProjectBaselineDependencies {
  const storeDir = options.storeDir ?? path.resolve(process.cwd(), '.requirements-store');
  const repository =
    options.repository ?? new FilesystemRequirementsRepository({ baseDir: storeDir });
  const provider = options.provider ?? (process.env.GENERATION_PROVIDER as ProviderType) ?? 'agy';

  const gatewayConfig: GatewayConfig = {
    provider,
    timeoutMs: options.timeoutMs,
    agyBinPath: options.agyBinPath,
    opencodeBinPath: options.opencodeBinPath,
    model: options.modelName,
    cwd: process.cwd()
  };

  const generationGateway =
    options.generationGateway ?? GatewayFactory.createGateway(gatewayConfig);

  const mmdcBinPath =
    process.env.MMDC_BIN_PATH ??
    (existsSync(path.resolve(process.cwd(), 'node_modules/.bin/mmdc'))
      ? path.resolve(process.cwd(), 'node_modules/.bin/mmdc')
      : existsSync(path.resolve(process.cwd(), 'apps/orchestrator/node_modules/.bin/mmdc'))
        ? path.resolve(process.cwd(), 'apps/orchestrator/node_modules/.bin/mmdc')
        : undefined);

  const linterGateway =
    options.linterGateway ??
    new MermaidCliLinterAdapter({
      timeoutMs: options.timeoutMs,
      executablePath: mmdcBinPath
    });

  const generateArtifactUseCase = new GenerateArtifactUseCase(generationGateway, linterGateway);

  const prototypeValidator = new BabelTsxValidatorAdapter();
  const generatePrototypeProjectionUseCase = new GeneratePrototypeProjectionUseCase(
    generationGateway,
    prototypeValidator,
    repository,
    provider
  );

  const sqlValidator = new PGliteSqlValidatorAdapter();
  const generateSqlSchemaProjectionUseCase = new GenerateSqlSchemaProjectionUseCase(
    generationGateway,
    sqlValidator,
    repository,
    provider
  );

  const projectBaselineUseCase = new ProjectBaselineUseCase(
    generateArtifactUseCase,
    repository,
    provider,
    generatePrototypeProjectionUseCase,
    generateSqlSchemaProjectionUseCase
  );

  return {
    storeDir,
    repository,
    provider,
    generationGateway,
    linterGateway,
    generateArtifactUseCase,
    projectBaselineUseCase
  };
}

export interface ProjectBaselineExecutionResult {
  readonly success: boolean;
  readonly projectionResult: BaselineProjectionResult;
  readonly projectionId: string;
  readonly baselineId: string;
  readonly artifactType: ArtifactType;
  readonly requirementRevisionIds: readonly string[];
  readonly repairsNeeded: number;
  readonly attemptCount: number;
  readonly contentHash: string;
  readonly content: string;
  readonly provider: string;
  readonly storeDir: string;
  readonly reportText: string;
}

export function formatProjectionReport(result: BaselineProjectionResult, storeDir: string): string {
  const meta = result.metadata;
  const revisionsList = meta.requirementRevisionIds.map((id) => `  - ${id}`).join('\n');
  const projectionFilePath = path.join(storeDir, 'projections', `${result.projectionId}.json`);

  return [
    '====================================================',
    'Solutions Studio: Baseline Projection Report',
    '====================================================',
    `Projection ID:            ${result.projectionId}`,
    `Baseline ID:              ${meta.baselineId}`,
    `Artifact Type:            ${meta.artifactType}`,
    `Provider:                 ${meta.configuredExecution.provider}`,
    `Repairs Needed:           ${meta.measuredVerification.repairsNeeded}`,
    `Attempt Count:            ${meta.measuredVerification.attemptCount}`,
    `Content Hash (SHA-256):   ${meta.measuredVerification.contentHash}`,
    `Requirement Revision IDs (${meta.requirementRevisionIds.length}):`,
    revisionsList,
    '',
    `Projection record persisted to: ${projectionFilePath}`,
    '===================================================='
  ].join('\n');
}

export async function runProjectBaseline(
  options: RunProjectBaselineOptions
): Promise<ProjectBaselineExecutionResult> {
  const components = composeProjectBaselineComponents(options);

  const projectionResult = await components.projectBaselineUseCase.project({
    baselineId: options.baselineId,
    artifactType: options.artifactType
  });

  const reportText = formatProjectionReport(projectionResult, components.storeDir);

  if (options.log) {
    options.log(reportText);
  }

  return {
    success: true,
    projectionResult,
    projectionId: projectionResult.projectionId,
    baselineId: projectionResult.metadata.baselineId,
    artifactType: options.artifactType,
    requirementRevisionIds: projectionResult.metadata.requirementRevisionIds,
    repairsNeeded: projectionResult.metadata.measuredVerification.repairsNeeded,
    attemptCount: projectionResult.metadata.measuredVerification.attemptCount,
    contentHash: projectionResult.metadata.measuredVerification.contentHash,
    content: projectionResult.content,
    provider: components.provider,
    storeDir: components.storeDir,
    reportText
  };
}

export async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  await runProjectBaseline({
    ...cliArgs,
    log: console.log
  });
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  (import.meta.url === `file://${path.resolve(process.argv[1])}` ||
    process.argv[1].endsWith('run-project-baseline.ts') ||
    process.argv[1].endsWith('run-project-baseline.js'));

if (isDirectRun) {
  main().catch((err) => {
    console.error('\nFatal error running baseline projection:', err);
    process.exit(1);
  });
}
