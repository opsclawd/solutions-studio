import path from 'node:path';
import { existsSync } from 'node:fs';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import type { IRequirementsRepository } from '../application/ports/persistence/IRequirementsRepository.js';
import type { ISqlDatabaseClient } from '../application/ports/persistence/ISqlDatabaseClient.js';
import type { IObjectStore } from '../application/ports/persistence/IObjectStore.js';
import type { IGenerationGateway } from '../application/ports/generation/IGenerationGateway.js';
import type { IMermaidLinterGateway } from '../application/ports/validation/IMermaidLinterGateway.js';
import type { IPrototypeValidatorGateway } from '../application/ports/validation/IPrototypeValidatorGateway.js';
import type { ISqlValidatorGateway } from '../application/ports/validation/ISqlValidatorGateway.js';
import type { IOpenApiValidatorGateway } from '../application/ports/validation/IOpenApiValidatorGateway.js';
import type { IGherkinValidatorGateway } from '../application/ports/validation/IGherkinValidatorGateway.js';
import { CompileRequirementsUseCase } from '../application/use-cases/CompileRequirementsUseCase.js';
import { ReconcileRequirementsUseCase } from '../application/use-cases/ReconcileRequirementsUseCase.js';
import { CreateRequirementsBaselineUseCase } from '../application/use-cases/CreateRequirementsBaselineUseCase.js';
import { GenerateArtifactUseCase } from '../application/use-cases/GenerateArtifactUseCase.js';
import { GeneratePrototypeProjectionUseCase } from '../application/use-cases/GeneratePrototypeProjectionUseCase.js';
import { GenerateSqlSchemaProjectionUseCase } from '../application/use-cases/GenerateSqlSchemaProjectionUseCase.js';
import { GenerateOpenApiProjectionUseCase } from '../application/use-cases/GenerateOpenApiProjectionUseCase.js';
import { GenerateStoriesProjectionUseCase } from '../application/use-cases/GenerateStoriesProjectionUseCase.js';
import { GetStoriesUseCase } from '../application/use-cases/GetStoriesUseCase.js';
import { EvaluateStoryReadinessUseCase } from '../application/use-cases/EvaluateStoryReadinessUseCase.js';
import { ComputeRequirementCoverageUseCase } from '../application/use-cases/ComputeRequirementCoverageUseCase.js';
import { ProjectBaselineUseCase } from '../application/use-cases/ProjectBaselineUseCase.js';
import { GetRequirementsReviewStateUseCase } from '../application/use-cases/GetRequirementsReviewStateUseCase.js';
import { RecordRequirementsDiscoveryUseCase } from '../application/use-cases/RecordRequirementsDiscoveryUseCase.js';
import { RecordPolicyConstraintRevisionUseCase } from '../application/use-cases/RecordPolicyConstraintRevisionUseCase.js';
import { GetPolicyConstraintRevisionUseCase } from '../application/use-cases/GetPolicyConstraintRevisionUseCase.js';
import { GetAuthorityBundleUseCase } from '../application/use-cases/GetAuthorityBundleUseCase.js';
import { RecordEngineeringDecisionUseCase } from '../application/use-cases/RecordEngineeringDecisionUseCase.js';
import { TransitionEngineeringDecisionUseCase } from '../application/use-cases/TransitionEngineeringDecisionUseCase.js';
import { GetEngineeringDecisionsUseCase } from '../application/use-cases/GetEngineeringDecisionsUseCase.js';
import { BuildStoryDependencyGraphUseCase } from '../application/use-cases/BuildStoryDependencyGraphUseCase.js';
import { UpdateStoryDependenciesUseCase } from '../application/use-cases/UpdateStoryDependenciesUseCase.js';
import { GetEngineeringHandoffBundleUseCase } from '../application/use-cases/GetEngineeringHandoffBundleUseCase.js';
import { RecordValidationRunUseCase } from '../application/use-cases/governance/RecordValidationRunUseCase.js';
import { ApproveCandidateUseCase } from '../application/use-cases/governance/ApproveCandidateUseCase.js';
import { EvaluateCandidatePromotionStatusUseCase } from '../application/use-cases/governance/EvaluateCandidatePromotionStatusUseCase.js';
import { RevokeGovernanceApprovalUseCase } from '../application/use-cases/governance/RevokeGovernanceApprovalUseCase.js';
import { ExportGovernanceAuditUseCase } from '../application/use-cases/governance/ExportGovernanceAuditUseCase.js';
import {
  RepositoryFactory,
  createRequirementsRepository
} from '../infrastructure/persistence/RepositoryFactory.js';
import { PostgresRequirementsRepository } from '../infrastructure/persistence/postgres/PostgresRequirementsRepository.js';
import { SchemaMigrationRunner } from '../infrastructure/persistence/postgres/SchemaMigrationRunner.js';
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
import { GherkinValidatorAdapter } from '../infrastructure/validation/GherkinValidatorAdapter.js';
import type { IAuthenticator } from '../application/ports/identity/IAuthenticator.js';
import type { IAuthorizationPolicy } from '../application/ports/identity/IAuthorizationPolicy.js';
import { GenericOidcAuthenticator } from '../infrastructure/identity/GenericOidcAuthenticator.js';
import { TestAuthenticator } from '../infrastructure/identity/TestAuthenticator.js';
import { DefaultAuthorizationPolicy } from '../infrastructure/identity/DefaultAuthorizationPolicy.js';
import { buildServer } from './server.js';

export interface ComposeHttpServerOptions {
  readonly storeDir?: string;
  readonly connectionString?: string;
  readonly dbClient?: ISqlDatabaseClient;
  readonly objectStore?: IObjectStore;
  readonly authenticator?: IAuthenticator;
  readonly authorizer?: IAuthorizationPolicy;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly pool?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly clientFactory?: () => Promise<any> | any;
  readonly autoMigrate?: boolean;
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
  readonly gherkinValidatorGateway?: IGherkinValidatorGateway;
  readonly fastifyOptions?: FastifyServerOptions;
  // Use cases overrides (e.g. for testing)
  readonly compileUseCase?: CompileRequirementsUseCase;
  readonly reconcileUseCase?: ReconcileRequirementsUseCase;
  readonly baselineUseCase?: CreateRequirementsBaselineUseCase;
  readonly generateArtifactUseCase?: GenerateArtifactUseCase;
  readonly generatePrototypeProjectionUseCase?: GeneratePrototypeProjectionUseCase;
  readonly generateSqlSchemaProjectionUseCase?: GenerateSqlSchemaProjectionUseCase;
  readonly generateOpenApiProjectionUseCase?: GenerateOpenApiProjectionUseCase;
  readonly generateStoriesProjectionUseCase?: GenerateStoriesProjectionUseCase;
  readonly getStoriesUseCase?: GetStoriesUseCase;
  readonly evaluateStoryReadinessUseCase?: EvaluateStoryReadinessUseCase;
  readonly computeRequirementCoverageUseCase?: ComputeRequirementCoverageUseCase;
  readonly projectBaselineUseCase?: ProjectBaselineUseCase;
  readonly reviewStateUseCase?: GetRequirementsReviewStateUseCase;
  readonly recordDiscoveryUseCase?: RecordRequirementsDiscoveryUseCase;
  readonly recordPolicyConstraintRevisionUseCase?: RecordPolicyConstraintRevisionUseCase;
  readonly getPolicyConstraintRevisionUseCase?: GetPolicyConstraintRevisionUseCase;
  readonly getAuthorityBundleUseCase?: GetAuthorityBundleUseCase;
  readonly recordEngineeringDecisionUseCase?: RecordEngineeringDecisionUseCase;
  readonly transitionEngineeringDecisionUseCase?: TransitionEngineeringDecisionUseCase;
  readonly getEngineeringDecisionsUseCase?: GetEngineeringDecisionsUseCase;
  readonly buildStoryDependencyGraphUseCase?: BuildStoryDependencyGraphUseCase;
  readonly updateStoryDependenciesUseCase?: UpdateStoryDependenciesUseCase;
  readonly getEngineeringHandoffBundleUseCase?: GetEngineeringHandoffBundleUseCase;
  readonly recordValidationRunUseCase?: RecordValidationRunUseCase;
  readonly approveCandidateUseCase?: ApproveCandidateUseCase;
  readonly evaluateCandidatePromotionStatusUseCase?: EvaluateCandidatePromotionStatusUseCase;
  readonly revokeGovernanceApprovalUseCase?: RevokeGovernanceApprovalUseCase;
  readonly exportGovernanceAuditUseCase?: ExportGovernanceAuditUseCase;
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
  readonly gherkinValidatorGateway: IGherkinValidatorGateway;
  readonly compileUseCase: CompileRequirementsUseCase;
  readonly reconcileUseCase: ReconcileRequirementsUseCase;
  readonly baselineUseCase: CreateRequirementsBaselineUseCase;
  readonly generateArtifactUseCase: GenerateArtifactUseCase;
  readonly generatePrototypeProjectionUseCase: GeneratePrototypeProjectionUseCase;
  readonly generateSqlSchemaProjectionUseCase: GenerateSqlSchemaProjectionUseCase;
  readonly generateOpenApiProjectionUseCase: GenerateOpenApiProjectionUseCase;
  readonly generateStoriesProjectionUseCase: GenerateStoriesProjectionUseCase;
  readonly getStoriesUseCase: GetStoriesUseCase;
  readonly evaluateStoryReadinessUseCase: EvaluateStoryReadinessUseCase;
  readonly computeRequirementCoverageUseCase: ComputeRequirementCoverageUseCase;
  readonly buildStoryDependencyGraphUseCase: BuildStoryDependencyGraphUseCase;
  readonly updateStoryDependenciesUseCase: UpdateStoryDependenciesUseCase;
  readonly getEngineeringHandoffBundleUseCase: GetEngineeringHandoffBundleUseCase;
  readonly recordValidationRunUseCase: RecordValidationRunUseCase;
  readonly approveCandidateUseCase: ApproveCandidateUseCase;
  readonly evaluateCandidatePromotionStatusUseCase: EvaluateCandidatePromotionStatusUseCase;
  readonly revokeGovernanceApprovalUseCase: RevokeGovernanceApprovalUseCase;
  readonly exportGovernanceAuditUseCase: ExportGovernanceAuditUseCase;
  readonly projectBaselineUseCase: ProjectBaselineUseCase;
  readonly reviewStateUseCase: GetRequirementsReviewStateUseCase;
  readonly recordDiscoveryUseCase: RecordRequirementsDiscoveryUseCase;
  readonly recordPolicyConstraintRevisionUseCase: RecordPolicyConstraintRevisionUseCase;
  readonly getPolicyConstraintRevisionUseCase: GetPolicyConstraintRevisionUseCase;
  readonly getAuthorityBundleUseCase: GetAuthorityBundleUseCase;
  readonly recordEngineeringDecisionUseCase: RecordEngineeringDecisionUseCase;
  readonly transitionEngineeringDecisionUseCase: TransitionEngineeringDecisionUseCase;
  readonly getEngineeringDecisionsUseCase: GetEngineeringDecisionsUseCase;
  readonly authenticator: IAuthenticator;
  readonly authorizer: IAuthorizationPolicy;
}

export function composeOrchestratorHttpServer(
  options: ComposeHttpServerOptions = {}
): ComposedHttpServer {
  const storeDir = options.storeDir ?? path.resolve(process.cwd(), '.requirements-store');
  const repository =
    options.repository ??
    RepositoryFactory.createFromEnvironment({
      baseDir: storeDir,
      connectionString: options.connectionString,
      dbClient: options.dbClient,
      objectStore: options.objectStore,
      pool: options.pool,
      clientFactory: options.clientFactory,
      autoMigrate: options.autoMigrate
    });
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

  const gherkinValidatorGateway = options.gherkinValidatorGateway ?? new GherkinValidatorAdapter();

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

  const generateStoriesProjectionUseCase =
    options.generateStoriesProjectionUseCase ??
    new GenerateStoriesProjectionUseCase(
      generationGateway,
      gherkinValidatorGateway,
      repository,
      provider
    );

  const getStoriesUseCase = options.getStoriesUseCase ?? new GetStoriesUseCase(repository);

  const projectBaselineUseCase =
    options.projectBaselineUseCase ??
    new ProjectBaselineUseCase(
      generateArtifactUseCase,
      repository,
      provider,
      generatePrototypeProjectionUseCase,
      generateSqlSchemaProjectionUseCase,
      generateOpenApiProjectionUseCase,
      generateStoriesProjectionUseCase
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

  const evaluateStoryReadinessUseCase =
    options.evaluateStoryReadinessUseCase ??
    new EvaluateStoryReadinessUseCase(repository, sqlValidatorGateway, openApiValidatorGateway);

  const computeRequirementCoverageUseCase =
    options.computeRequirementCoverageUseCase ?? new ComputeRequirementCoverageUseCase(repository);

  const buildStoryDependencyGraphUseCase =
    options.buildStoryDependencyGraphUseCase ??
    new BuildStoryDependencyGraphUseCase(repository, evaluateStoryReadinessUseCase);

  const updateStoryDependenciesUseCase =
    options.updateStoryDependenciesUseCase ?? new UpdateStoryDependenciesUseCase(repository);

  const getEngineeringHandoffBundleUseCase =
    options.getEngineeringHandoffBundleUseCase ??
    new GetEngineeringHandoffBundleUseCase(
      repository,
      getAuthorityBundleUseCase,
      evaluateStoryReadinessUseCase,
      computeRequirementCoverageUseCase,
      buildStoryDependencyGraphUseCase
    );

  const resolveAuthenticator = (): IAuthenticator => {
    if (options.authenticator) {
      return options.authenticator;
    }

    const authProviderEnv = process.env.AUTH_PROVIDER?.trim().toLowerCase();
    const isProduction = process.env.NODE_ENV === 'production';
    const isTestEnv = process.env.NODE_ENV === 'test';

    // 1. Fail closed on unknown/misspelled provider values
    if (authProviderEnv && authProviderEnv !== 'oidc' && authProviderEnv !== 'test') {
      throw new Error(
        `Invalid or unsupported AUTH_PROVIDER: '${process.env.AUTH_PROVIDER}'. Supported values are 'oidc' and 'test'.`
      );
    }

    // 2. Reject test auth in production environment
    if (isProduction && authProviderEnv === 'test') {
      throw new Error(
        'Test authentication (AUTH_PROVIDER=test) is not permitted in production (NODE_ENV=production).'
      );
    }

    // 3. Determine effective auth provider
    // When unset: default to 'test' under test environment (NODE_ENV=test), otherwise default to 'oidc'
    const effectiveProvider = authProviderEnv ?? (isTestEnv ? 'test' : 'oidc');

    if (effectiveProvider === 'oidc') {
      const issuer = (process.env.OIDC_ISSUER ?? process.env.OIDC_ISSUER_URL)?.trim();
      const audience = process.env.OIDC_AUDIENCE?.trim();
      const jwksUri = process.env.OIDC_JWKS_URI?.trim();

      if (isProduction) {
        if (!issuer) {
          throw new Error(
            'Missing required OIDC configuration in production: OIDC_ISSUER (or OIDC_ISSUER_URL)'
          );
        }
        if (!audience) {
          throw new Error('Missing required OIDC configuration in production: OIDC_AUDIENCE');
        }
      }

      const effectiveIssuer = issuer || 'http://localhost:8080/realms/solutions-studio';
      const effectiveAudience = audience || 'solutions-studio-api';
      const effectiveJwksUri =
        jwksUri ||
        (effectiveIssuer.endsWith('/')
          ? `${effectiveIssuer}protocol/openid-connect/certs`
          : `${effectiveIssuer}/protocol/openid-connect/certs`);

      return new GenericOidcAuthenticator({
        issuer: effectiveIssuer,
        audience: effectiveAudience,
        jwksUri: effectiveJwksUri
      });
    }

    return new TestAuthenticator();
  };

  const authenticator = resolveAuthenticator();

  const authorizer = options.authorizer ?? new DefaultAuthorizationPolicy();

  const recordValidationRunUseCase =
    options.recordValidationRunUseCase ?? new RecordValidationRunUseCase(repository);
  const approveCandidateUseCase =
    options.approveCandidateUseCase ?? new ApproveCandidateUseCase(repository, authorizer);
  const evaluateCandidatePromotionStatusUseCase =
    options.evaluateCandidatePromotionStatusUseCase ??
    new EvaluateCandidatePromotionStatusUseCase(repository);
  const revokeGovernanceApprovalUseCase =
    options.revokeGovernanceApprovalUseCase ??
    new RevokeGovernanceApprovalUseCase(repository, authorizer);
  const exportGovernanceAuditUseCase =
    options.exportGovernanceAuditUseCase ??
    new ExportGovernanceAuditUseCase(repository, evaluateCandidatePromotionStatusUseCase);

  const app = buildServer(
    {
      repository,
      authenticator,
      authorizer,
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
      getEngineeringDecisionsUseCase,
      generateStoriesProjectionUseCase,
      getStoriesUseCase,
      evaluateStoryReadinessUseCase,
      computeRequirementCoverageUseCase,
      buildStoryDependencyGraphUseCase,
      updateStoryDependenciesUseCase,
      getEngineeringHandoffBundleUseCase,
      recordValidationRunUseCase,
      approveCandidateUseCase,
      evaluateCandidatePromotionStatusUseCase,
      revokeGovernanceApprovalUseCase,
      exportGovernanceAuditUseCase
    },
    options.fastifyOptions
  );

  if (
    repository instanceof PostgresRequirementsRepository &&
    (repository as { db?: unknown }).db &&
    options.autoMigrate !== false
  ) {
    app.addHook('onReady', async () => {
      const runner = new SchemaMigrationRunner({
        db: (repository as { db: ISqlDatabaseClient }).db
      });
      await runner.migrate();
    });
  }

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
    gherkinValidatorGateway,
    compileUseCase,
    reconcileUseCase,
    baselineUseCase,
    generateArtifactUseCase,
    generatePrototypeProjectionUseCase,
    generateSqlSchemaProjectionUseCase,
    generateOpenApiProjectionUseCase,
    generateStoriesProjectionUseCase,
    getStoriesUseCase,
    evaluateStoryReadinessUseCase,
    computeRequirementCoverageUseCase,
    buildStoryDependencyGraphUseCase,
    updateStoryDependenciesUseCase,
    getEngineeringHandoffBundleUseCase,
    recordValidationRunUseCase,
    approveCandidateUseCase,
    evaluateCandidatePromotionStatusUseCase,
    revokeGovernanceApprovalUseCase,
    exportGovernanceAuditUseCase,
    projectBaselineUseCase,
    reviewStateUseCase,
    recordDiscoveryUseCase,
    recordPolicyConstraintRevisionUseCase,
    getPolicyConstraintRevisionUseCase,
    getAuthorityBundleUseCase,
    recordEngineeringDecisionUseCase,
    transitionEngineeringDecisionUseCase,
    getEngineeringDecisionsUseCase,
    authenticator,
    authorizer
  };
}

export async function composeOrchestratorHttpServerAsync(
  options: ComposeHttpServerOptions = {}
): Promise<ComposedHttpServer> {
  let repository = options.repository;
  if (
    !repository &&
    (options.connectionString ||
      process.env.DATABASE_URL ||
      process.env.STORAGE_TYPE === 'postgres' ||
      options.dbClient)
  ) {
    repository = await createRequirementsRepository({
      baseDir: options.storeDir,
      connectionString: options.connectionString,
      dbClient: options.dbClient,
      objectStore: options.objectStore,
      pool: options.pool,
      clientFactory: options.clientFactory,
      autoMigrate: options.autoMigrate
    });
  }
  const composed = composeOrchestratorHttpServer({
    ...options,
    repository
  });
  await composed.app.ready();
  return composed;
}
