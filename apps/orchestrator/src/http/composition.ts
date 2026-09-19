import path from 'node:path';
import { existsSync } from 'node:fs';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import type { IRequirementsRepository } from '../application/ports/persistence/IRequirementsRepository.js';
import type { IGenerationGateway } from '../application/ports/generation/IGenerationGateway.js';
import type { IMermaidLinterGateway } from '../application/ports/validation/IMermaidLinterGateway.js';
import type { IPrototypeValidatorGateway } from '../application/ports/validation/IPrototypeValidatorGateway.js';
import type { ISqlValidatorGateway } from '../application/ports/validation/ISqlValidatorGateway.js';
import type { IOpenApiValidatorGateway } from '../application/ports/validation/IOpenApiValidatorGateway.js';
import { CompileRequirementsUseCase } from '../application/use-cases/CompileRequirementsUseCase.js';
import { ReconcileRequirementsUseCase } from '../application/use-cases/ReconcileRequirementsUseCase.js';
import { CreateRequirementsBaselineUseCase } from '../application/use-cases/CreateRequirementsBaselineUseCase.js';
import { GenerateArtifactUseCase } from '../application/use-cases/GenerateArtifactUseCase.js';
import { GeneratePrototypeProjectionUseCase } from '../application/use-cases/GeneratePrototypeProjectionUseCase.js';
import { GenerateSqlSchemaProjectionUseCase } from '../application/use-cases/GenerateSqlSchemaProjectionUseCase.js';
import { GenerateOpenApiProjectionUseCase } from '../application/use-cases/GenerateOpenApiProjectionUseCase.js';
import { ProjectBaselineUseCase } from '../application/use-cases/ProjectBaselineUseCase.js';
import { GetRequirementsReviewStateUseCase } from '../application/use-cases/GetRequirementsReviewStateUseCase.js';
import { RecordRequirementsDiscoveryUseCase } from '../application/use-cases/RecordRequirementsDiscoveryUseCase.js';
import { RecordPolicyConstraintRevisionUseCase } from '../application/use-cases/RecordPolicyConstraintRevisionUseCase.js';
import { GetPolicyConstraintRevisionUseCase } from '../application/use-cases/GetPolicyConstraintRevisionUseCase.js';
import { GetAuthorityBundleUseCase } from '../application/use-cases/GetAuthorityBundleUseCase.js';
import { RecordEngineeringDecisionUseCase } from '../application/use-cases/RecordEngineeringDecisionUseCase.js';
import { TransitionEngineeringDecisionUseCase } from '../application/use-cases/TransitionEngineeringDecisionUseCase.js';
import { GetEngineeringDecisionsUseCase } from '../application/use-cases/GetEngineeringDecisionsUseCase.js';
import { FilesystemRequirementsRepository } from '../infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import {
  GatewayFactory,
  type ProviderType,
  type GatewayConfig
} from '../infrastructure/generation/GatewayFactory.js';
import { DeterministicFallbackGateway } from '../infrastructure/generation/DeterministicFallbackGateway.js';
import { MermaidCliLinterAdapter } from '../infrastructure/validation/MermaidCliLinterAdapter.js';
import { BabelTsxValidatorAdapter } from '../infrastructure/validation/BabelTsxValidatorAdapter.js';
import { PGliteSqlValidatorAdapter } from '../infrastructure/validation/PGliteSqlValidatorAdapter.js';
import { OpenApiStructuralValidatorAdapter } from '../infrastructure/validation/OpenApiStructuralValidatorAdapter.js';
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
  readonly prototypeValidatorGateway?: IPrototypeValidatorGateway;
  readonly sqlValidatorGateway?: ISqlValidatorGateway;
  readonly openApiValidatorGateway?: IOpenApiValidatorGateway;
  readonly fastifyOptions?: FastifyServerOptions;
  // Use cases overrides (e.g. for testing)
  readonly compileUseCase?: CompileRequirementsUseCase;
  readonly reconcileUseCase?: ReconcileRequirementsUseCase;
  readonly baselineUseCase?: CreateRequirementsBaselineUseCase;
  readonly generateArtifactUseCase?: GenerateArtifactUseCase;
  readonly generatePrototypeProjectionUseCase?: GeneratePrototypeProjectionUseCase;
  readonly generateSqlSchemaProjectionUseCase?: GenerateSqlSchemaProjectionUseCase;
  readonly generateOpenApiProjectionUseCase?: GenerateOpenApiProjectionUseCase;
  readonly projectBaselineUseCase?: ProjectBaselineUseCase;
  readonly reviewStateUseCase?: GetRequirementsReviewStateUseCase;
  readonly recordDiscoveryUseCase?: RecordRequirementsDiscoveryUseCase;
  readonly recordPolicyConstraintRevisionUseCase?: RecordPolicyConstraintRevisionUseCase;
  readonly getPolicyConstraintRevisionUseCase?: GetPolicyConstraintRevisionUseCase;
  readonly getAuthorityBundleUseCase?: GetAuthorityBundleUseCase;
  readonly recordEngineeringDecisionUseCase?: RecordEngineeringDecisionUseCase;
  readonly transitionEngineeringDecisionUseCase?: TransitionEngineeringDecisionUseCase;
  readonly getEngineeringDecisionsUseCase?: GetEngineeringDecisionsUseCase;
}

export interface ComposedHttpServer {
  readonly app: FastifyInstance;
  readonly storeDir: string;
  readonly repository: IRequirementsRepository;
  readonly provider: ProviderType;
  readonly generationGateway: IGenerationGateway;
  readonly linterGateway: IMermaidLinterGateway;
  readonly prototypeValidatorGateway: IPrototypeValidatorGateway;
  readonly sqlValidatorGateway: ISqlValidatorGateway;
  readonly openApiValidatorGateway: IOpenApiValidatorGateway;
  readonly compileUseCase: CompileRequirementsUseCase;
  readonly reconcileUseCase: ReconcileRequirementsUseCase;
  readonly baselineUseCase: CreateRequirementsBaselineUseCase;
  readonly generateArtifactUseCase: GenerateArtifactUseCase;
  readonly generatePrototypeProjectionUseCase: GeneratePrototypeProjectionUseCase;
  readonly generateSqlSchemaProjectionUseCase: GenerateSqlSchemaProjectionUseCase;
  readonly generateOpenApiProjectionUseCase: GenerateOpenApiProjectionUseCase;
  readonly projectBaselineUseCase: ProjectBaselineUseCase;
  readonly reviewStateUseCase: GetRequirementsReviewStateUseCase;
  readonly recordDiscoveryUseCase: RecordRequirementsDiscoveryUseCase;
  readonly recordPolicyConstraintRevisionUseCase: RecordPolicyConstraintRevisionUseCase;
  readonly getPolicyConstraintRevisionUseCase: GetPolicyConstraintRevisionUseCase;
  readonly getAuthorityBundleUseCase: GetAuthorityBundleUseCase;
  readonly recordEngineeringDecisionUseCase: RecordEngineeringDecisionUseCase;
  readonly transitionEngineeringDecisionUseCase: TransitionEngineeringDecisionUseCase;
  readonly getEngineeringDecisionsUseCase: GetEngineeringDecisionsUseCase;
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

  const prototypeValidatorGateway =
    options.prototypeValidatorGateway ?? new BabelTsxValidatorAdapter();

  const sqlValidatorGateway = options.sqlValidatorGateway ?? new PGliteSqlValidatorAdapter();

  const openApiValidatorGateway =
    options.openApiValidatorGateway ?? new OpenApiStructuralValidatorAdapter();

  const compileUseCase =
    options.compileUseCase ?? new CompileRequirementsUseCase(generationGateway, repository);

  const reconcileUseCase = options.reconcileUseCase ?? new ReconcileRequirementsUseCase(repository);

  const baselineUseCase =
    options.baselineUseCase ?? new CreateRequirementsBaselineUseCase(repository);

  const generateArtifactUseCase =
    options.generateArtifactUseCase ??
    new GenerateArtifactUseCase(generationGateway, linterGateway);

  const generatePrototypeProjectionUseCase =
    options.generatePrototypeProjectionUseCase ??
    new GeneratePrototypeProjectionUseCase(
      generationGateway,
      prototypeValidatorGateway,
      repository,
      provider
    );

  const generateSqlSchemaProjectionUseCase =
    options.generateSqlSchemaProjectionUseCase ??
    new GenerateSqlSchemaProjectionUseCase(
      generationGateway,
      sqlValidatorGateway,
      repository,
      provider
    );

  const generateOpenApiProjectionUseCase =
    options.generateOpenApiProjectionUseCase ??
    new GenerateOpenApiProjectionUseCase(
      generationGateway,
      openApiValidatorGateway,
      repository,
      provider
    );

  const projectBaselineUseCase =
    options.projectBaselineUseCase ??
    new ProjectBaselineUseCase(
      generateArtifactUseCase,
      repository,
      provider,
      generatePrototypeProjectionUseCase,
      generateSqlSchemaProjectionUseCase,
      generateOpenApiProjectionUseCase
    );

  const reviewStateUseCase =
    options.reviewStateUseCase ?? new GetRequirementsReviewStateUseCase(repository);

  const recordDiscoveryUseCase =
    options.recordDiscoveryUseCase ?? new RecordRequirementsDiscoveryUseCase(repository);

  const recordPolicyConstraintRevisionUseCase =
    options.recordPolicyConstraintRevisionUseCase ??
    new RecordPolicyConstraintRevisionUseCase(repository);

  const getPolicyConstraintRevisionUseCase =
    options.getPolicyConstraintRevisionUseCase ??
    new GetPolicyConstraintRevisionUseCase(repository);

  const getAuthorityBundleUseCase =
    options.getAuthorityBundleUseCase ?? new GetAuthorityBundleUseCase(repository);

  const recordEngineeringDecisionUseCase =
    options.recordEngineeringDecisionUseCase ?? new RecordEngineeringDecisionUseCase(repository);

  const transitionEngineeringDecisionUseCase =
    options.transitionEngineeringDecisionUseCase ??
    new TransitionEngineeringDecisionUseCase(repository);

  const getEngineeringDecisionsUseCase =
    options.getEngineeringDecisionsUseCase ?? new GetEngineeringDecisionsUseCase(repository);

  const app = buildServer(
    {
      reviewStateUseCase,
      reconcileUseCase,
      baselineUseCase,
      projectBaselineUseCase,
      recordDiscoveryUseCase,
      recordPolicyConstraintRevisionUseCase,
      getPolicyConstraintRevisionUseCase,
      getAuthorityBundleUseCase,
      recordEngineeringDecisionUseCase,
      transitionEngineeringDecisionUseCase,
      getEngineeringDecisionsUseCase
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
    prototypeValidatorGateway,
    sqlValidatorGateway,
    openApiValidatorGateway,
    compileUseCase,
    reconcileUseCase,
    baselineUseCase,
    generateArtifactUseCase,
    generatePrototypeProjectionUseCase,
    generateSqlSchemaProjectionUseCase,
    generateOpenApiProjectionUseCase,
    projectBaselineUseCase,
    reviewStateUseCase,
    recordDiscoveryUseCase,
    recordPolicyConstraintRevisionUseCase,
    getPolicyConstraintRevisionUseCase,
    getAuthorityBundleUseCase,
    recordEngineeringDecisionUseCase,
    transitionEngineeringDecisionUseCase,
    getEngineeringDecisionsUseCase
  };
}
