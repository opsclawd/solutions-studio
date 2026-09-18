import path from 'node:path';
import { existsSync } from 'node:fs';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import type { IRequirementsRepository } from '../application/ports/persistence/IRequirementsRepository.js';
import type { IGenerationGateway } from '../application/ports/generation/IGenerationGateway.js';
import type { IMermaidLinterGateway } from '../application/ports/validation/IMermaidLinterGateway.js';
import { CompileRequirementsUseCase } from '../application/use-cases/CompileRequirementsUseCase.js';
import { ReconcileRequirementsUseCase } from '../application/use-cases/ReconcileRequirementsUseCase.js';
import { CreateRequirementsBaselineUseCase } from '../application/use-cases/CreateRequirementsBaselineUseCase.js';
import { GenerateArtifactUseCase } from '../application/use-cases/GenerateArtifactUseCase.js';
import { ProjectBaselineUseCase } from '../application/use-cases/ProjectBaselineUseCase.js';
import { GetRequirementsReviewStateUseCase } from '../application/use-cases/GetRequirementsReviewStateUseCase.js';
import { RecordRequirementsDiscoveryUseCase } from '../application/use-cases/RecordRequirementsDiscoveryUseCase.js';
import { FilesystemRequirementsRepository } from '../infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import {
  GatewayFactory,
  type ProviderType,
  type GatewayConfig
} from '../infrastructure/generation/GatewayFactory.js';
import { DeterministicFallbackGateway } from '../infrastructure/generation/DeterministicFallbackGateway.js';
import { MermaidCliLinterAdapter } from '../infrastructure/validation/MermaidCliLinterAdapter.js';
import { buildServer } from './server.js';

export interface ComposeHttpServerOptions {
  readonly storeDir?: string;
  readonly provider?: ProviderType;
  readonly timeoutMs?: number;
  readonly agyBinPath?: string;
  readonly opencodeBinPath?: string;
  readonly modelName?: string;
  readonly repository?: IRequirementsRepository;
  readonly generationGateway?: IGenerationGateway;
  readonly linterGateway?: IMermaidLinterGateway;
  readonly fastifyOptions?: FastifyServerOptions;
  // Use cases overrides (e.g. for testing)
  readonly compileUseCase?: CompileRequirementsUseCase;
  readonly reconcileUseCase?: ReconcileRequirementsUseCase;
  readonly baselineUseCase?: CreateRequirementsBaselineUseCase;
  readonly generateArtifactUseCase?: GenerateArtifactUseCase;
  readonly projectBaselineUseCase?: ProjectBaselineUseCase;
  readonly reviewStateUseCase?: GetRequirementsReviewStateUseCase;
  readonly recordDiscoveryUseCase?: RecordRequirementsDiscoveryUseCase;
}

export interface ComposedHttpServer {
  readonly app: FastifyInstance;
  readonly storeDir: string;
  readonly repository: IRequirementsRepository;
  readonly provider: ProviderType;
  readonly generationGateway: IGenerationGateway;
  readonly linterGateway: IMermaidLinterGateway;
  readonly compileUseCase: CompileRequirementsUseCase;
  readonly reconcileUseCase: ReconcileRequirementsUseCase;
  readonly baselineUseCase: CreateRequirementsBaselineUseCase;
  readonly generateArtifactUseCase: GenerateArtifactUseCase;
  readonly projectBaselineUseCase: ProjectBaselineUseCase;
  readonly reviewStateUseCase: GetRequirementsReviewStateUseCase;
  readonly recordDiscoveryUseCase: RecordRequirementsDiscoveryUseCase;
}

export function composeOrchestratorHttpServer(
  options: ComposeHttpServerOptions = {}
): ComposedHttpServer {
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

  const fallbackGateway =
    provider === 'fake' || provider === 'fixture-replay'
      ? new DeterministicFallbackGateway()
      : undefined;

  const generationGateway =
    options.generationGateway ?? GatewayFactory.createGateway(gatewayConfig, fallbackGateway);

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

  const compileUseCase =
    options.compileUseCase ?? new CompileRequirementsUseCase(generationGateway, repository);

  const reconcileUseCase = options.reconcileUseCase ?? new ReconcileRequirementsUseCase(repository);

  const baselineUseCase =
    options.baselineUseCase ?? new CreateRequirementsBaselineUseCase(repository);

  const generateArtifactUseCase =
    options.generateArtifactUseCase ??
    new GenerateArtifactUseCase(generationGateway, linterGateway);

  const projectBaselineUseCase =
    options.projectBaselineUseCase ??
    new ProjectBaselineUseCase(generateArtifactUseCase, repository, provider);

  const reviewStateUseCase =
    options.reviewStateUseCase ?? new GetRequirementsReviewStateUseCase(repository);

  const recordDiscoveryUseCase =
    options.recordDiscoveryUseCase ?? new RecordRequirementsDiscoveryUseCase(repository);

  const app = buildServer(
    {
      reviewStateUseCase,
      reconcileUseCase,
      baselineUseCase,
      projectBaselineUseCase,
      recordDiscoveryUseCase
    },
    options.fastifyOptions
  );

  return {
    app,
    storeDir,
    repository,
    provider,
    generationGateway,
    linterGateway,
    compileUseCase,
    reconcileUseCase,
    baselineUseCase,
    generateArtifactUseCase,
    projectBaselineUseCase,
    reviewStateUseCase,
    recordDiscoveryUseCase
  };
}
