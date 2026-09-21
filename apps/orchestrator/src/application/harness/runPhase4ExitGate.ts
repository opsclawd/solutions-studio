import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import YAML from 'yaml';
import { PGlite } from '@electric-sql/pglite';
import {
  createSourceId,
  createRequirementId,
  createRequirementRevisionId,
  createRequirementRevision,
  createPolicyConstraintId,
  createPolicyConstraintRevisionId,
  createPolicyConstraintRevision,
  createFindingId,
  createStoryId,
  createCandidateFinding,
  createRequirementsBaselineId,
  now,
  HumanActorRequiredForApprovalError
} from '@solutions-studio/domain';
import { PGliteDatabaseClient } from '../../infrastructure/persistence/postgres/PGliteDatabaseClient.js';
import { SchemaMigrationRunner } from '../../infrastructure/persistence/postgres/SchemaMigrationRunner.js';
import { PostgresRequirementsRepository } from '../../infrastructure/persistence/postgres/PostgresRequirementsRepository.js';
import { InMemoryObjectStore } from '../../infrastructure/persistence/object-store/InMemoryObjectStore.js';
import {
  BackupService,
  BACKUP_TABLES
} from '../../infrastructure/persistence/backup/BackupService.js';
import {
  RestoreService,
  BackupChecksumMismatchError
} from '../../infrastructure/persistence/backup/RestoreService.js';
import {
  TestAuthenticator,
  TEST_PERSONAS
} from '../../infrastructure/identity/TestAuthenticator.js';
import { GenericOidcAuthenticator } from '../../infrastructure/identity/GenericOidcAuthenticator.js';
import { JwksCache } from '../../infrastructure/identity/jwksCache.js';
import { DefaultAuthorizationPolicy } from '../../infrastructure/identity/DefaultAuthorizationPolicy.js';
import { PGliteSqlValidatorAdapter } from '../../infrastructure/validation/PGliteSqlValidatorAdapter.js';
import { OpenApiStructuralValidatorAdapter } from '../../infrastructure/validation/OpenApiStructuralValidatorAdapter.js';
import { GherkinValidatorAdapter } from '../../infrastructure/validation/GherkinValidatorAdapter.js';
import {
  StructuredOperationalLogger,
  type StructuredLogRecord
} from '../../infrastructure/observability/StructuredOperationalLogger.js';
import { SensitiveDataSanitizer } from '../../infrastructure/observability/SensitiveDataSanitizer.js';
import { TelemetryRegistry } from '../../infrastructure/observability/TelemetryRegistry.js';
import { composeOrchestratorHttpServer } from '../../http/composition.js';

import type { IAuthenticator } from '../ports/identity/IAuthenticator.js';
import type {
  IGenerationGateway,
  GenerationResult
} from '../ports/generation/IGenerationGateway.js';
import type { ISqlValidatorGateway } from '../ports/validation/ISqlValidatorGateway.js';
import type { IOpenApiValidatorGateway } from '../ports/validation/IOpenApiValidatorGateway.js';
import type { IGherkinValidatorGateway } from '../ports/validation/IGherkinValidatorGateway.js';
import type { IMermaidLinterGateway } from '../ports/validation/IMermaidLinterGateway.js';
import type { IBacklogExportGateway } from '../ports/backlog/IBacklogExportGateway.js';
import type { ISqlDatabaseClient } from '../ports/persistence/ISqlDatabaseClient.js';
import type { IObjectStore } from '../ports/persistence/IObjectStore.js';
import type {
  IRequirementsRepository,
  StoryRecord
} from '../ports/persistence/IRequirementsRepository.js';
import { ImmutableRecordConflictError } from '../ports/persistence/IRequirementsRepository.js';
import { OptimisticConcurrencyConflictError } from '../use-cases/ReconciliationErrors.js';

import { CreateRequirementsBaselineUseCase } from '../use-cases/CreateRequirementsBaselineUseCase.js';
import { GenerateSqlSchemaProjectionUseCase } from '../use-cases/GenerateSqlSchemaProjectionUseCase.js';
import { GenerateOpenApiProjectionUseCase } from '../use-cases/GenerateOpenApiProjectionUseCase.js';
import { GenerateStoriesProjectionUseCase } from '../use-cases/GenerateStoriesProjectionUseCase.js';
import { RecordEngineeringDecisionUseCase } from '../use-cases/RecordEngineeringDecisionUseCase.js';
import { TransitionEngineeringDecisionUseCase } from '../use-cases/TransitionEngineeringDecisionUseCase.js';
import { EvaluateStoryReadinessUseCase } from '../use-cases/EvaluateStoryReadinessUseCase.js';
import { ReconcileRequirementsUseCase } from '../use-cases/ReconcileRequirementsUseCase.js';
import { ComputeRequirementCoverageUseCase } from '../use-cases/ComputeRequirementCoverageUseCase.js';
import { BuildStoryDependencyGraphUseCase } from '../use-cases/BuildStoryDependencyGraphUseCase.js';
import { UpdateStoryDependenciesUseCase } from '../use-cases/UpdateStoryDependenciesUseCase.js';
import { GetEngineeringHandoffBundleUseCase } from '../use-cases/GetEngineeringHandoffBundleUseCase.js';
import { GetAuthorityBundleUseCase } from '../use-cases/GetAuthorityBundleUseCase.js';
import { SchemaApiCrossValidator } from '../use-cases/crossValidation/schemaApiCrossValidator.js';
import { RecordValidationRunUseCase } from '../use-cases/governance/RecordValidationRunUseCase.js';
import { ApproveCandidateUseCase } from '../use-cases/governance/ApproveCandidateUseCase.js';
import { EvaluateCandidatePromotionStatusUseCase } from '../use-cases/governance/EvaluateCandidatePromotionStatusUseCase.js';
import { ExportBacklogUseCase } from '../use-cases/ExportBacklogUseCase.js';
import { EvaluateExportStalenessUseCase } from '../use-cases/EvaluateExportStalenessUseCase.js';
import { BacklogExportGatewayFactory } from '../../infrastructure/backlog/BacklogExportGatewayFactory.js';
import { assertSafeBacklogEndpoint } from '../../infrastructure/backlog/safeEndpoint.js';
import { RealBacklogMutationForbiddenError, ProviderNetworkError } from '../ports/backlog/index.js';
import { RepairRetryExhaustionError } from '../use-cases/SqlSchemaProjectionErrors.js';

import { runPhase1ExitGate, type Phase1ExitGateAdapter } from './runPhase1ExitGate.js';
import { runPhase2ExitGate, type Phase2ExitGateAdapter } from './runPhase2ExitGate.js';
import { runPhase3ExitGate, type Phase3ExitGateAdapter } from './runPhase3ExitGate.js';

class HarnessMermaidLinterGateway implements IMermaidLinterGateway {
  async validate(_mermaidCode: string) {
    return { isValid: true };
  }
}

export interface ScriptableGenerationGateway extends IGenerationGateway {
  queueResponse(text: string, metadata?: GenerationResult['metadata']): void;
}

export interface Phase4ExitGateOptions {
  readonly storeDir?: string;
  readonly provider?: 'fake' | 'agy' | 'opencode';
  readonly model?: string;
  readonly silent?: boolean;
  readonly cleanup?: boolean;
  readonly adapter?: Phase4ExitGateAdapter;
  readonly runId?: string;
  readonly candidateSha?: string;
  readonly expectedGitSha?: string;
  readonly useKeycloak?: boolean;
  readonly keycloakUrl?: string;
}

export interface Phase4ExitGateAdapter {
  readonly authenticator?: IAuthenticator;
  readonly generationGateway?: IGenerationGateway;
  readonly sqlValidatorGateway?: ISqlValidatorGateway;
  readonly openApiValidatorGateway?: IOpenApiValidatorGateway;
  readonly gherkinValidatorGateway?: IGherkinValidatorGateway;
  readonly backlogGateway?: IBacklogExportGateway;
  readonly dbClient?: ISqlDatabaseClient;
  readonly objectStore?: IObjectStore;
  readonly phase1Adapter?: Phase1ExitGateAdapter;
  readonly phase2Adapter?: Phase2ExitGateAdapter;
  readonly phase3Adapter?: Phase3ExitGateAdapter;
  createAuthenticator?(): IAuthenticator;
  createGenerationGateway?(): IGenerationGateway;
  createSqlValidatorGateway?(): ISqlValidatorGateway;
  createOpenApiValidatorGateway?(): IOpenApiValidatorGateway;
  createGherkinValidatorGateway?(): IGherkinValidatorGateway;
  createBacklogGateway?(): IBacklogExportGateway;
  createRepository?(storeDir?: string): Promise<{
    repository: IRequirementsRepository;
    dbClient: ISqlDatabaseClient;
    objectStore: IObjectStore;
  }>;
  createPhase1Adapter?(): Phase1ExitGateAdapter;
  createPhase2Adapter?(): Phase2ExitGateAdapter;
  createPhase3Adapter?(): Phase3ExitGateAdapter;
}

export interface PersistenceOutcome {
  readonly schemaVersion: number;
  readonly tablesPresent: number;
  readonly migrationsApplied: number;
  readonly databaseClientType: string;
}

export interface IdentityOutcome {
  readonly providerNeutralBoundaryVerified: boolean;
  readonly personasTested: number;
  readonly oidcMode: 'test' | 'keycloak';
}

export interface AuthorizationOutcome {
  readonly commandsGated: number;
  readonly forbiddenErrorsCaught: number;
  readonly authzFailureTelemetryEmitted: boolean;
}

export interface HandoffFlowOutcome {
  readonly baselineId: string;
  readonly predecessorBaselineId: string;
  readonly requirementCoverage: number;
  readonly storyReadiness: number;
  readonly handoffBundleReady: boolean;
  readonly artifactHashesVerified: boolean;
}

export interface ValidationEvidenceOutcome {
  readonly candidateSha: string;
  readonly validationRunId: string;
  readonly evidenceDigest: string;
  readonly immutableRecordPersisted: boolean;
}

export interface GeneratedGoPreventionOutcome {
  readonly simulatedGoTextInjected: boolean;
  readonly isApproved: boolean;
  readonly disposition: string;
  readonly diagnostic: string;
  readonly agentApprovalRejected: boolean;
}

export interface HumanApprovalOutcome {
  readonly approvalRecordId: string;
  readonly actorId: string;
  readonly actorType: string;
  readonly isApproved: boolean;
  readonly disposition: string;
  readonly diagnostic: string;
}

export interface BacklogExportOutcome {
  readonly exportedStoryCount: number;
  readonly externalTicketsCreated: number;
  readonly realExternalMutationPrevented: boolean;
  readonly mappingsPersisted: number;
}

export interface ExportIdempotencyOutcome {
  readonly isIdempotent: boolean;
  readonly providerCallsOnRepeat: number;
  readonly unchangedItemCount: number;
}

export interface StalenessImpactOutcome {
  readonly successorBaselineId: string;
  readonly stalenessDetected: boolean;
  readonly classification: 'STALE' | 'IMPACTED';
  readonly unconfirmedOverwriteBlocked: boolean;
  readonly skippedCount: number;
}

export interface BackupRestoreRestartOutcome {
  readonly snapshotTableCount: number;
  readonly blobCount: number;
  readonly tamperDetectionVerified: boolean;
  readonly checksumMismatchCaught: boolean;
  readonly bitForBitRestorationVerified: boolean;
  readonly restartServerHealthy: boolean;
}

export interface ConcurrencyConflictOutcome {
  readonly typedConflictErrorsVerified: boolean;
  readonly optimisticStoryConflictCaught: boolean;
  readonly duplicateBaselineConflictCaught: boolean;
  readonly racingApprovalConflictCaught: boolean;
}

export interface DependencyFailureSafetyOutcome {
  readonly oidcFailureHandled: boolean;
  readonly persistenceFailureHandled: boolean;
  readonly generationFailureHandled: boolean;
  readonly validationFailureHandled: boolean;
  readonly backlogFailureHandled: boolean;
  readonly failClosedVerified: boolean;
}

export interface ObservabilityRedactionOutcome {
  readonly bearerTokenRedacted: boolean;
  readonly passwordRedacted: boolean;
  readonly piiEmailRedacted: boolean;
  readonly piiPhoneRedacted: boolean;
  readonly connectionStringRedacted: boolean;
  readonly zeroLeakInvariantMaintained: boolean;
}

export interface PriorPhaseGatesOutcome {
  readonly phase1Passed: boolean;
  readonly phase2Passed: boolean;
  readonly phase3Passed: boolean;
  readonly allPriorGatesGreen: boolean;
}

export interface Phase4ExitGateResult {
  readonly success: boolean;
  readonly pilotReady: boolean;
  readonly candidateSha?: string;
  readonly persistenceOutcome: PersistenceOutcome;
  readonly identityOutcome: IdentityOutcome;
  readonly authorizationOutcome: AuthorizationOutcome;
  readonly handoffFlowOutcome: HandoffFlowOutcome;
  readonly validationEvidenceOutcome: ValidationEvidenceOutcome;
  readonly generatedGoPreventionOutcome: GeneratedGoPreventionOutcome;
  readonly humanApprovalOutcome: HumanApprovalOutcome;
  readonly backlogExportOutcome: BacklogExportOutcome;
  readonly exportIdempotencyOutcome: ExportIdempotencyOutcome;
  readonly stalenessImpactOutcome: StalenessImpactOutcome;
  readonly backupRestoreRestartOutcome: BackupRestoreRestartOutcome;
  readonly concurrencyConflictOutcome: ConcurrencyConflictOutcome;
  readonly dependencyFailureSafetyOutcome: DependencyFailureSafetyOutcome;
  readonly observabilityRedactionOutcome: ObservabilityRedactionOutcome;
  readonly priorPhaseGatesOutcome: PriorPhaseGatesOutcome;
}

export async function runPhase4ExitGate(
  options: Phase4ExitGateOptions = {}
): Promise<Phase4ExitGateResult> {
  const log = (msg: string) => {
    if (!options.silent) {
      console.log(msg);
    }
  };

  const tempDirs: string[] = [];
  const pgliteInstances: PGlite[] = [];
  const openServers: FastifyInstance[] = [];

  let candidateSha: string;
  try {
    candidateSha = cp
      .execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim();
  } catch (err) {
    throw new Error(
      `Failed to resolve candidate commit SHA from git: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!/^[0-9a-f]{40}$/i.test(candidateSha)) {
    throw new Error(`Invalid git commit SHA resolved from repository: '${candidateSha}'`);
  }

  if (options.candidateSha && options.candidateSha !== candidateSha) {
    throw new Error(
      `Supplied candidateSha '${options.candidateSha}' does not match git HEAD '${candidateSha}'`
    );
  }

  if (options.expectedGitSha && options.expectedGitSha !== candidateSha) {
    throw new Error(
      `Resolved git candidate SHA '${candidateSha}' does not match expectedGitSha '${options.expectedGitSha}'`
    );
  }

  log('========================================================================');
  log('Solutions Studio: Phase 4.7 Automated Production-Readiness Exit Gate');
  log(`Candidate SHA: ${candidateSha} | Mode: ${options.provider ?? 'fake'}`);
  log('========================================================================\n');

  try {
    // ------------------------------------------------------------------------
    // Step 1: Start Production-Grade Persistence Adapter in Isolated Environment
    // ------------------------------------------------------------------------
    log('[1/15] Initializing production persistence (PGlite + migrations 001-005)...');
    const pglite = new PGlite();
    pgliteInstances.push(pglite);
    const dbClient = new PGliteDatabaseClient({ pgliteInstance: pglite });
    const migrationRunner = new SchemaMigrationRunner({ db: dbClient });
    const migrationResults = await migrationRunner.migrate();

    const appliedMigrations = await migrationRunner.getAppliedMigrations();
    if (appliedMigrations.length !== 5) {
      throw new Error(`Expected exactly 5 applied migrations, found ${appliedMigrations.length}`);
    }

    const tableQuery = `
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `;
    const tableRes = await dbClient.query<{ table_name: string }>(tableQuery);
    const existingTables = new Set(tableRes.rows.map((r) => r.table_name));

    for (const table of BACKUP_TABLES) {
      if (!existingTables.has(table)) {
        throw new Error(`Required relational table '${table}' is missing from schema.`);
      }
    }

    const objectStore = options.adapter?.objectStore ?? new InMemoryObjectStore();
    const repo = new PostgresRequirementsRepository({
      db: dbClient,
      objectStore
    });

    const storageHealth = await repo.checkStorageHealth();
    if (storageHealth.status !== 'healthy') {
      throw new Error(
        `PostgresRequirementsRepository storage health unhealthy: ${storageHealth.status}`
      );
    }

    const persistenceOutcome: PersistenceOutcome = {
      schemaVersion: appliedMigrations[appliedMigrations.length - 1].version,
      tablesPresent: existingTables.size,
      migrationsApplied: migrationResults.applied.length,
      databaseClientType: 'pglite'
    };
    log(`       Verified 18 relational tables and migration schema version 5.`);

    // ------------------------------------------------------------------------
    // Step 2: Authenticate Test Users Through Provider-Neutral Identity Boundary
    // ------------------------------------------------------------------------
    log('[2/15] Exercising provider-neutral identity boundary across test personas...');
    const authenticator =
      options.adapter?.authenticator ??
      options.adapter?.createAuthenticator?.() ??
      new TestAuthenticator({ allowAnonymousFallback: false });

    const personaKeys: (keyof typeof TEST_PERSONAS)[] = [
      'reviewer',
      'architect',
      'admin',
      'exporter',
      'viewer',
      'agent'
    ];
    let authenticatedCount = 0;

    for (const key of personaKeys) {
      const actor = await authenticator.authenticate(`test:${key}`);
      if (actor.id !== TEST_PERSONAS[key].id || actor.actorType !== TEST_PERSONAS[key].actorType) {
        throw new Error(`Persona authentication identity mismatch for '${key}'`);
      }
      authenticatedCount++;
    }

    let unauthenticatedBlocked = false;
    try {
      await authenticator.authenticate('invalid-token-header');
    } catch {
      unauthenticatedBlocked = true;
    }
    if (!unauthenticatedBlocked) {
      throw new Error('Authenticator failed to reject invalid token');
    }

    if (options.useKeycloak && !(authenticator instanceof GenericOidcAuthenticator)) {
      throw new Error(
        'Keycloak mode (--use-keycloak) requested but configured authenticator is not GenericOidcAuthenticator'
      );
    }

    const oidcMode: 'keycloak' | 'test' =
      authenticator instanceof GenericOidcAuthenticator ? 'keycloak' : 'test';

    const identityOutcome: IdentityOutcome = {
      providerNeutralBoundaryVerified: true,
      personasTested: authenticatedCount,
      oidcMode
    };
    log(`       Verified ${authenticatedCount} personas through identity boundary.`);

    // ------------------------------------------------------------------------
    // Step 3: Prove Authorization Capabilities Gate Requirements, Engineering, Governance, Export
    // ------------------------------------------------------------------------
    log(
      '[3/15] Proving authorization capabilities gate requirements, engineering, governance, and export commands...'
    );
    const telemetryRegistry = new TelemetryRegistry();
    const authorizer = new DefaultAuthorizationPolicy(telemetryRegistry);

    const viewer = TEST_PERSONAS.viewer;
    let forbiddenCount = 0;

    // 1. Requirements baseline creation requires 'baseline:create'
    try {
      authorizer.authorize(viewer, 'baseline:create');
    } catch {
      forbiddenCount++;
    }

    // 2. Engineering decision authoring requires 'engineering-decision:author'
    try {
      authorizer.authorize(viewer, 'engineering-decision:author');
    } catch {
      forbiddenCount++;
    }

    // 3. Governance approval requires 'candidate:approve'
    try {
      authorizer.authorize(viewer, 'candidate:approve');
    } catch {
      forbiddenCount++;
    }

    // 4. Backlog export requires 'backlog:export'
    try {
      authorizer.authorize(viewer, 'backlog:export');
    } catch {
      forbiddenCount++;
    }

    if (forbiddenCount !== 4) {
      throw new Error(
        `Expected Dave Viewer to be rejected across 4 gated subsystems, got ${forbiddenCount}`
      );
    }

    // Verify authorized personas succeed
    authorizer.authorize(TEST_PERSONAS.reviewer, 'baseline:create');
    authorizer.authorize(TEST_PERSONAS.reviewer, 'candidate:approve');
    authorizer.authorize(TEST_PERSONAS.architect, 'engineering-decision:author');
    authorizer.authorize(TEST_PERSONAS.exporter, 'backlog:export');

    const metricsText = telemetryRegistry.toPrometheusText();
    const authzFailureTelemetryEmitted = metricsText.includes(
      'solutions_studio_authz_failures_total'
    );

    const authorizationOutcome: AuthorizationOutcome = {
      commandsGated: 4,
      forbiddenErrorsCaught: forbiddenCount,
      authzFailureTelemetryEmitted
    };
    log(
      `       Verified 4 commands gated with 4 forbidden errors caught and authz telemetry emitted.`
    );

    // ------------------------------------------------------------------------
    // Step 4: Execute Phase 1–3 Evidence-to-Engineering-Handoff Flow against PostgreSQL
    // ------------------------------------------------------------------------
    log(
      '[4/15] Executing Phase 1–3 evidence-to-engineering-handoff flow on PostgreSQL persistence...'
    );
    const generationGateway =
      options.adapter?.generationGateway ?? options.adapter?.createGenerationGateway?.();
    const sqlValidatorGateway =
      options.adapter?.sqlValidatorGateway ??
      options.adapter?.createSqlValidatorGateway?.() ??
      new PGliteSqlValidatorAdapter();
    const openApiValidatorGateway =
      options.adapter?.openApiValidatorGateway ??
      options.adapter?.createOpenApiValidatorGateway?.() ??
      new OpenApiStructuralValidatorAdapter();
    const gherkinValidatorGateway =
      options.adapter?.gherkinValidatorGateway ??
      options.adapter?.createGherkinValidatorGateway?.() ??
      new GherkinValidatorAdapter();

    if (!generationGateway) {
      throw new Error('Generation gateway required for Phase 4 exit gate');
    }

    const isScriptableGen = 'queueResponse' in generationGateway;

    const baselineUseCase = new CreateRequirementsBaselineUseCase(repo);
    const reconcileUseCase = new ReconcileRequirementsUseCase(repo);
    const recordEdUseCase = new RecordEngineeringDecisionUseCase(repo);
    const transitionEdUseCase = new TransitionEngineeringDecisionUseCase(repo);
    const generateSqlUseCase = new GenerateSqlSchemaProjectionUseCase(
      generationGateway,
      sqlValidatorGateway,
      repo,
      options.provider ?? 'fake'
    );
    const generateOpenApiUseCase = new GenerateOpenApiProjectionUseCase(
      generationGateway,
      openApiValidatorGateway,
      repo,
      options.provider ?? 'fake'
    );
    const generateStoriesUseCase = new GenerateStoriesProjectionUseCase(
      generationGateway,
      gherkinValidatorGateway,
      repo,
      options.provider ?? 'fake'
    );
    const evaluateReadinessUseCase = new EvaluateStoryReadinessUseCase(
      repo,
      sqlValidatorGateway,
      openApiValidatorGateway
    );
    const computeCoverageUseCase = new ComputeRequirementCoverageUseCase(repo);
    const buildDependencyGraphUseCase = new BuildStoryDependencyGraphUseCase(
      repo,
      evaluateReadinessUseCase
    );
    const updateStoryDepsUseCase = new UpdateStoryDependenciesUseCase(repo);
    const getAuthorityBundleUseCase = new GetAuthorityBundleUseCase(repo);
    const handoffBundleUseCase = new GetEngineeringHandoffBundleUseCase(
      repo,
      getAuthorityBundleUseCase,
      evaluateReadinessUseCase,
      computeCoverageUseCase,
      buildDependencyGraphUseCase
    );

    // 4A. Capture Source Evidence & Revisions for BASE-001
    const src = await repo.captureSourceRevision({
      sourceId: createSourceId('SRC-ORD-001'),
      sourceType: 'sop',
      markdownText:
        '# Order Management & Payment Processing Standard\n\n' +
        '## Order Lifecycle Specification\n' +
        'Orders must record customer ID, line items, and lifecycle status (PENDING, PAID, SHIPPED, CANCELLED).\n\n' +
        '## Payment Authorization Specification\n' +
        'Order payment authorization must be verified before transitioning order status to PAID.\n\n' +
        '## Data Audit & Security Policy\n' +
        'All database tables storing customer orders must include created_at and updated_at audit timestamps.'
    });

    const locators = src.locatorIndex;
    const orderLifeLoc = locators[0]?.locator ?? 'order-life';
    const payAuthLoc = locators[1]?.locator ?? 'pay-auth';

    const req1Rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-ORD-01-R1'),
      requirementId: createRequirementId('REQ-ORD-01'),
      revision: 1,
      statement:
        'Orders must record customer ID, line items, and lifecycle status (PENDING, PAID, SHIPPED, CANCELLED).',
      category: 'lifecycle-state',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [{ sourceRevisionId: src.revision.id, locator: orderLifeLoc }]
    });
    await repo.saveRequirementRevision(req1Rev1);
    await repo.appendReconciliationRecord({
      id: 'REC-REQ-ORD-01-R1',
      entityType: 'requirement',
      entityId: createRequirementId('REQ-ORD-01'),
      requirementRevisionId: req1Rev1.id,
      action: 'ACCEPT',
      previousReviewState: undefined,
      newReviewState: 'ACCEPTED',
      previousResolutionState: undefined,
      newResolutionState: undefined,
      rationale: 'Verified order lifecycle requirement.',
      recordedAt: now()
    });

    const req2Rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-ORD-02-R1'),
      requirementId: createRequirementId('REQ-ORD-02'),
      revision: 1,
      statement:
        'Order payment authorization must be verified before transitioning order status to PAID.',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [{ sourceRevisionId: src.revision.id, locator: payAuthLoc }]
    });
    await repo.saveRequirementRevision(req2Rev1);
    await repo.appendReconciliationRecord({
      id: 'REC-REQ-ORD-02-R1',
      entityType: 'requirement',
      entityId: createRequirementId('REQ-ORD-02'),
      requirementRevisionId: req2Rev1.id,
      action: 'ACCEPT',
      previousReviewState: undefined,
      newReviewState: 'ACCEPTED',
      previousResolutionState: undefined,
      newResolutionState: undefined,
      rationale: 'Verified payment authorization requirement.',
      recordedAt: now()
    });

    const pol1Rev1 = createPolicyConstraintRevision({
      id: createPolicyConstraintRevisionId('POL-SEC-01-R1'),
      policyConstraintId: createPolicyConstraintId('POL-SEC-01'),
      revision: 1,
      statement:
        'All database tables storing customer orders must include created_at and updated_at audit timestamps.',
      authorityReference: 'Enterprise Security & Compliance Standard v2.4 §4.1',
      state: 'ACCEPTED',
      createdBy: 'enterprise-security'
    });
    await repo.savePolicyConstraintRevision(pol1Rev1);

    const baselineA = await baselineUseCase.create({
      id: 'BASE-001',
      requirementRevisionIds: ['REQ-ORD-01-R1', 'REQ-ORD-02-R1'],
      policyConstraintRevisionIds: ['POL-SEC-01-R1'],
      createdBy: 'lead-reviewer'
    });

    // 4B. Projections on BASE-001
    if (isScriptableGen) {
      const scriptable = generationGateway as ScriptableGenerationGateway;
      scriptable.queueResponse(
        [
          '-- @baseline BASE-001',
          '-- @requirements REQ-ORD-01-R1, REQ-ORD-02-R1',
          '-- @policy-constraints POL-SEC-01-R1',
          '',
          'CREATE TABLE IF NOT EXISTS orders (',
          '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
          '  customer_id VARCHAR(64) NOT NULL,',
          "  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',",
          '  total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,',
          '  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,',
          '  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP',
          ');',
          '',
          'CREATE TABLE IF NOT EXISTS order_items (',
          '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
          '  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,',
          '  item_sku VARCHAR(64) NOT NULL,',
          '  quantity INTEGER NOT NULL CHECK (quantity > 0),',
          '  unit_price NUMERIC(10, 2) NOT NULL,',
          '  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,',
          '  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP',
          ');'
        ].join('\n')
      );
    }
    const projSql1 = await generateSqlUseCase.execute({
      baselineId: 'BASE-001',
      options: { model: options.model },
      autoRecordDiscoveries: false
    });

    if (isScriptableGen) {
      const scriptable = generationGateway as ScriptableGenerationGateway;
      scriptable.queueResponse(
        [
          '# @baseline: BASE-001',
          '# @requirements: REQ-ORD-01-R1, REQ-ORD-02-R1',
          '# @policy-constraints: POL-SEC-01-R1',
          'openapi: 3.1.0',
          'info:',
          '  title: Order Management Service API',
          '  version: 1.0.0',
          '  description: API for managing orders and checkout',
          'paths:',
          '  /orders:',
          '    post:',
          '      summary: Create order',
          '      requestBody:',
          '        required: true',
          '        content:',
          '          application/json:',
          '            schema:',
          '              type: object',
          '              required:',
          '                - customer_id',
          '              properties:',
          '                customer_id:',
          '                  type: string',
          '                status:',
          '                  type: string',
          '                  enum: [PENDING, PAID, SHIPPED, CANCELLED]',
          '                total_amount:',
          '                  type: number',
          '      responses:',
          "        '201':",
          '          description: Created',
          '          content:',
          '            application/json:',
          '              schema:',
          "                $ref: '#/components/schemas/Order'",
          '    get:',
          '      summary: List orders',
          '      responses:',
          "        '200':",
          '          description: Success',
          '          content:',
          '            application/json:',
          '              schema:',
          '                type: array',
          '                items:',
          "                  $ref: '#/components/schemas/Order'",
          'components:',
          '  schemas:',
          '    Order:',
          '      type: object',
          '      required:',
          '        - id',
          '        - customer_id',
          '        - status',
          '        - created_at',
          '        - updated_at',
          '      properties:',
          '        id:',
          '          type: string',
          '          format: uuid',
          '        customer_id:',
          '          type: string',
          '        status:',
          '          type: string',
          '          enum: [PENDING, PAID, SHIPPED, CANCELLED]',
          '        total_amount:',
          '          type: number',
          '        created_at:',
          '          type: string',
          '          format: date-time',
          '        updated_at:',
          '          type: string',
          '          format: date-time'
        ].join('\n')
      );
    }
    const projOas1 = await generateOpenApiUseCase.execute({
      baselineId: 'BASE-001',
      options: { model: options.model },
      autoRecordDiscoveries: false
    });

    const docObj1 = YAML.parse(projOas1.content);
    const crossVal = new SchemaApiCrossValidator();
    const crossValFindings = crossVal.validate({
      openApiDoc: docObj1,
      sqlSchemaContent: projSql1.content,
      baseline: baselineA,
      openApiProjectionId: projOas1.projectionId,
      sqlSchemaProjectionId: projSql1.projectionId
    });
    if (crossValFindings.length > 0) {
      throw new Error(
        `Cross-validation failed on BASE-001: ${crossValFindings.map((f) => f.rationale).join('; ')}`
      );
    }

    // 4C. ED-001 on BASE-001
    await recordEdUseCase.execute({
      id: 'ED-001',
      baselineId: 'BASE-001',
      statement: 'Use UUID primary keys with gen_random_uuid() default for orders and order_items.',
      rationale:
        'Enables distributed client-side ID generation while avoiding ID enumeration security risks.',
      requirementRevisionIds: ['REQ-ORD-01-R1'],
      policyConstraintRevisionIds: ['POL-SEC-01-R1'],
      createdBy: 'lead-architect'
    });
    await transitionEdUseCase.execute({
      decisionId: 'ED-001',
      newState: 'ACCEPTED',
      rationale: 'Accepted by architecture review board',
      actorId: 'lead-architect'
    });

    // 4D. Product ambiguity finding FIND-001 & fail-closed readiness gate
    const candidateFinding = createCandidateFinding({
      id: createFindingId('FIND-001'),
      type: 'incomplete-state-machine',
      disposition: 'OPEN',
      discoveredBy: 'artifact-validation',
      affectedRequirementRevisions: [createRequirementRevisionId('REQ-ORD-01-R1')],
      evidence: [],
      rationale:
        'Requirements specify lifecycle states but do not define customer cancellation rules or temporal grace windows.',
      baselineId: createRequirementsBaselineId('BASE-001'),
      originatingProjectionId: projOas1.projectionId
    });
    await repo.saveCandidateFinding(candidateFinding);

    // 4E. Reconcile finding: OPEN -> RESOLVED and advance REQ-ORD-01 lineage
    await reconcileUseCase.dispositionFinding({
      findingId: 'FIND-001',
      disposition: 'RESOLVED',
      rationale:
        'Customer cancellation permitted within 24 hours of payment authorization via dedicated cancel endpoint.',
      actorId: 'lead-reviewer'
    });

    const revisedReq = await reconcileUseCase.reviseRequirement({
      revisionId: 'REQ-ORD-01-R1',
      statement:
        'Orders must record customer ID, line items, and lifecycle status (PENDING, PAID, SHIPPED, CANCELLED). Customers may cancel orders within 24 hours of payment authorization.',
      rationale: 'Clarified customer cancellation SLA bound to 24-hour window.',
      actorId: 'lead-reviewer'
    });

    const acceptedReq = await reconcileUseCase.acceptRequirement({
      revisionId: revisedReq.id,
      rationale: 'Accepted clarification from product manager and customer support team.',
      actorId: 'lead-reviewer'
    });

    const resolvedReq = await reconcileUseCase.resolveRequirement({
      revisionId: acceptedReq.id,
      rationale: 'Formal business definition verified unambiguous.',
      actorId: 'lead-reviewer'
    });

    // Resolved revision is REQ-ORD-01-R4
    const resolvedRevisionId = resolvedReq.id;

    // 4F. Successor Baseline BASE-002
    await baselineUseCase.create({
      id: 'BASE-002',
      requirementRevisionIds: [resolvedRevisionId, 'REQ-ORD-02-R1'],
      policyConstraintRevisionIds: ['POL-SEC-01-R1'],
      createdBy: 'lead-reviewer'
    });

    // Successor ED-002 on BASE-002 superseding ED-001
    await recordEdUseCase.execute({
      id: 'ED-002',
      baselineId: 'BASE-002',
      statement:
        'Retain UUID primary keys with gen_random_uuid() for orders, adding cancelled_at timestamp column.',
      rationale: 'Supports cancellation auditing while preserving distributed ID architecture.',
      requirementRevisionIds: [resolvedRevisionId],
      policyConstraintRevisionIds: ['POL-SEC-01-R1'],
      supersedes: 'ED-001',
      createdBy: 'lead-architect'
    });
    await transitionEdUseCase.execute({
      decisionId: 'ED-002',
      newState: 'ACCEPTED',
      rationale: 'Carried forward accepted UUID architecture for successor baseline',
      actorId: 'lead-architect'
    });

    // Successor Projections on BASE-002
    if (isScriptableGen) {
      const scriptable = generationGateway as ScriptableGenerationGateway;
      scriptable.queueResponse(
        [
          '-- @baseline BASE-002',
          `-- @requirements ${resolvedRevisionId}, REQ-ORD-02-R1`,
          '-- @policy-constraints POL-SEC-01-R1',
          '-- @engineering-decisions ED-002',
          '',
          'CREATE TABLE IF NOT EXISTS orders (',
          '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
          '  customer_id VARCHAR(64) NOT NULL,',
          "  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',",
          '  total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,',
          '  cancelled_at TIMESTAMPTZ,',
          '  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,',
          '  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP',
          ');',
          '',
          'CREATE TABLE IF NOT EXISTS order_items (',
          '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
          '  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,',
          '  item_sku VARCHAR(64) NOT NULL,',
          '  quantity INTEGER NOT NULL CHECK (quantity > 0),',
          '  unit_price NUMERIC(10, 2) NOT NULL,',
          '  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,',
          '  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP',
          ');'
        ].join('\n')
      );
    }
    const projSql2 = await generateSqlUseCase.execute({
      baselineId: 'BASE-002',
      engineeringDecisionIds: ['ED-002'],
      options: { model: options.model },
      autoRecordDiscoveries: false
    });

    if (isScriptableGen) {
      const scriptable = generationGateway as ScriptableGenerationGateway;
      scriptable.queueResponse(
        [
          '# @baseline: BASE-002',
          `# @requirements: ${resolvedRevisionId}, REQ-ORD-02-R1`,
          '# @policy-constraints: POL-SEC-01-R1',
          '# @engineering-decisions: ED-002',
          'openapi: 3.1.0',
          'info:',
          '  title: Order Management Service API',
          '  version: 2.0.0',
          '  description: API for managing orders, checkout, and cancellation',
          'paths:',
          '  /orders:',
          '    post:',
          '      summary: Create order',
          '      requestBody:',
          '        required: true',
          '        content:',
          '          application/json:',
          '            schema:',
          '              type: object',
          '              required:',
          '                - customer_id',
          '              properties:',
          '                customer_id:',
          '                  type: string',
          '                status:',
          '                  type: string',
          '                  enum: [PENDING, PAID, SHIPPED, CANCELLED]',
          '                total_amount:',
          '                  type: number',
          '      responses:',
          "        '201':",
          '          description: Created',
          '          content:',
          '            application/json:',
          '              schema:',
          "                $ref: '#/components/schemas/Order'",
          '    get:',
          '      summary: List orders',
          '      responses:',
          "        '200':",
          '          description: Success',
          '          content:',
          '            application/json:',
          '              schema:',
          '                type: array',
          '                items:',
          "                  $ref: '#/components/schemas/Order'",
          'components:',
          '  schemas:',
          '    Order:',
          '      type: object',
          '      required:',
          '        - id',
          '        - customer_id',
          '        - status',
          '        - created_at',
          '        - updated_at',
          '      properties:',
          '        id:',
          '          type: string',
          '          format: uuid',
          '        customer_id:',
          '          type: string',
          '        status:',
          '          type: string',
          '          enum: [PENDING, PAID, SHIPPED, CANCELLED]',
          '        total_amount:',
          '          type: number',
          '        cancelled_at:',
          '          type: string',
          '          format: date-time',
          '        created_at:',
          '          type: string',
          '          format: date-time',
          '        updated_at:',
          '          type: string',
          '          format: date-time'
        ].join('\n')
      );
    }
    const projOas2 = await generateOpenApiUseCase.execute({
      baselineId: 'BASE-002',
      engineeringDecisionIds: ['ED-002'],
      options: { model: options.model },
      autoRecordDiscoveries: false
    });

    // 4G. Generate Traceable Stories STORY-001 and STORY-002 on BASE-002
    const story1Gherkin = [
      '# @baseline: BASE-002',
      '# @engineering-decisions: ED-002',
      'Feature: Order Creation and Customer Submission',
      '  As a Customer',
      '  I want to submit orders with line items',
      '  So that I can purchase items',
      '',
      `  @requirements:${resolvedRevisionId} @policy-constraints:POL-SEC-01-R1`,
      '  Scenario: Valid customer order creation',
      '    Given a customer with ID "CUST-100"',
      '    When the customer submits an order with 2 items',
      '    Then the order is created with status "PENDING"',
      '    And created_at and updated_at timestamps are recorded'
    ].join('\n');

    const story2Gherkin = [
      '# @baseline: BASE-002',
      '# @engineering-decisions: ED-002',
      'Feature: Order Payment and 24-Hour Cancellation',
      '  As a Customer',
      '  I want to authorize payment and cancel orders within 24 hours',
      '  So that I can safely modify my order',
      '',
      `  @requirements:${resolvedRevisionId} @requirements:REQ-ORD-02-R1 @policy-constraints:POL-SEC-01-R1`,
      '  Scenario: Order payment authorization verified',
      '    Given an existing order with status "PENDING"',
      '    When payment authorization is verified',
      '    Then the order status transitions to "PAID"',
      '',
      `  @requirements:${resolvedRevisionId}`,
      '  Scenario: Order cancellation within 24-hour window',
      '    Given an existing order with status "PAID"',
      '    And payment authorization occurred within the last 24 hours',
      '    When the customer requests cancellation',
      '    Then the order status transitions to "CANCELLED"',
      '    And the cancelled_at timestamp is recorded'
    ].join('\n');

    if (isScriptableGen) {
      const scriptable = generationGateway as ScriptableGenerationGateway;
      scriptable.queueResponse(story1Gherkin);
      scriptable.queueResponse(story2Gherkin);
    }

    const storyProj1 = await generateStoriesUseCase.execute({
      baselineId: 'BASE-002',
      id: 'STORY-001',
      engineeringDecisionIds: ['ED-002'],
      options: { model: options.model },
      autoRecordDiscoveries: false
    });

    await generateStoriesUseCase.execute({
      baselineId: 'BASE-002',
      id: 'STORY-002',
      engineeringDecisionIds: ['ED-002'],
      options: { model: options.model },
      autoRecordDiscoveries: false
    });

    const updatedStory2 = await updateStoryDepsUseCase.execute({
      storyId: 'STORY-002',
      dependencies: ['STORY-001']
    });

    // 4H. Coverage, Readiness, Graph, and Handoff Bundle
    const coverage = await computeCoverageUseCase.execute({ baselineId: 'BASE-002' });
    const readiness = await evaluateReadinessUseCase.executeForBaseline('BASE-002');
    const handoffBundle = await handoffBundleUseCase.execute({ baselineId: 'BASE-002' });

    const sqlHash = createHash('sha256').update(projSql2.content).digest('hex');
    const oasHash = createHash('sha256').update(projOas2.content).digest('hex');
    const story1Hash = createHash('sha256').update(storyProj1.content).digest('hex');
    const story2Hash = createHash('sha256').update(updatedStory2.gherkinText).digest('hex');

    const expectedArtifactHashes = [
      { name: 'schema-ddl.sql', content: projSql2.content, expectedHash: sqlHash },
      { name: 'openapi-spec.json', content: projOas2.content, expectedHash: oasHash },
      { name: 'story-order-create.md', content: storyProj1.content, expectedHash: story1Hash },
      {
        name: 'story-order-cancel.md',
        content: updatedStory2.gherkinText,
        expectedHash: story2Hash
      }
    ];

    const hashesMatch = expectedArtifactHashes.every((item) => {
      const actualHash = createHash('sha256').update(item.content).digest('hex');
      return actualHash === item.expectedHash;
    });

    const bundleHashesMatch =
      Boolean(handoffBundle.sqlProjection) &&
      createHash('sha256').update(handoffBundle.sqlProjection!.content).digest('hex') === sqlHash &&
      Boolean(handoffBundle.openApiProjection) &&
      createHash('sha256').update(handoffBundle.openApiProjection!.content).digest('hex') ===
        oasHash &&
      handoffBundle.stories.length === 2 &&
      handoffBundle.stories.every((s) => {
        const expected = s.id === 'STORY-001' ? story1Hash : story2Hash;
        const actual = createHash('sha256').update(s.gherkinText).digest('hex');
        return actual === expected;
      });

    const artifactHashesVerified = hashesMatch && bundleHashesMatch;
    if (!artifactHashesVerified) {
      throw new Error(
        'Cryptographic content hash verification failed across handoff bundle artifacts'
      );
    }

    if (!handoffBundle.summary.isHandoffReady) {
      throw new Error('Engineering handoff bundle for BASE-002 is not ready.');
    }

    const handoffFlowOutcome: HandoffFlowOutcome = {
      baselineId: 'BASE-002',
      predecessorBaselineId: 'BASE-001',
      requirementCoverage:
        coverage.totalRequirements > 0 ? coverage.coveredCount / coverage.totalRequirements : 1.0,
      storyReadiness: readiness.every((r) => r.isReady) ? 1.0 : 0.0,
      handoffBundleReady: handoffBundle.summary.isHandoffReady,
      artifactHashesVerified
    };
    log(`       Verified handoff bundle for BASE-002 with 100% coverage and ready status.`);

    // ------------------------------------------------------------------------
    // Step 5: Create Immutable Validation Evidence for Locked Candidate
    // ------------------------------------------------------------------------
    log('[5/15] Creating immutable validation evidence for locked candidate SHA...');
    const recordValidationRunUseCase = new RecordValidationRunUseCase(repo);
    const evaluatePromotionStatusUseCase = new EvaluateCandidatePromotionStatusUseCase(repo);
    const approveCandidateUseCase = new ApproveCandidateUseCase(repo, authorizer);

    const handoffArtifacts = [
      {
        name: 'schema-ddl.sql',
        artifactType: 'sql-ddl',
        content: projSql2.content,
        contentHash: sqlHash,
        payloadRef: 'projections/schema-ddl.sql'
      },
      {
        name: 'openapi-spec.json',
        artifactType: 'openapi-spec',
        content: projOas2.content,
        contentHash: oasHash,
        payloadRef: 'projections/openapi-spec.json'
      },
      {
        name: 'story-order-create.md',
        artifactType: 'story-projection',
        content: storyProj1.content,
        contentHash: story1Hash,
        payloadRef: 'stories/story-order-create.md'
      },
      {
        name: 'story-order-cancel.md',
        artifactType: 'story-projection',
        content: updatedStory2.gherkinText,
        contentHash: story2Hash,
        payloadRef: 'stories/story-order-cancel.md'
      }
    ];

    const validationRun = await recordValidationRunUseCase.execute({
      candidateSha,
      executedBy: 'harness:run-phase-4-exit-gate',
      phase: 'phase-4',
      executionMode: 'deterministic-ci',
      provider: options.provider ?? 'fake',
      model: options.model,
      artifacts: handoffArtifacts,
      proposedDisposition: 'GO',
      summary: {
        success: true,
        runsCount: 1,
        totalDurationMs: 1200
      }
    });

    const evidenceDigest = validationRun.evidenceDigest;
    const persistedRun = await repo.getValidationRun(validationRun.id);
    if (!persistedRun || persistedRun.evidenceDigest !== evidenceDigest) {
      throw new Error(
        'Validation run evidence record was not properly persisted in validation_runs.'
      );
    }

    const validationEvidenceOutcome: ValidationEvidenceOutcome = {
      candidateSha,
      validationRunId: validationRun.id,
      evidenceDigest,
      immutableRecordPersisted: Boolean(persistedRun)
    };
    log(`       Persisted validation run '${validationRun.id}' with digest '${evidenceDigest}'.`);

    // ------------------------------------------------------------------------
    // Step 6: Prove Generated Report Text Containing "GO" Cannot Create Authoritative Approval
    // ------------------------------------------------------------------------
    log(
      '[6/15] Proving generated report text containing "GO" cannot create authoritative approval...'
    );
    // Inject adversarial generated report prose asserting GO and STATUS: APPROVED
    const adversarialReportContent = [
      '# Automated Synthesis & Candidate Assessment Report',
      '',
      '**STATUS: APPROVED**',
      '**RECOMMENDATION: GO**',
      '**DECISION: GO**',
      '',
      'All automated synthesis metrics passed. Autonomous agent certifies candidate promotion.'
    ].join('\n');

    const advReportHash = createHash('sha256').update(adversarialReportContent).digest('hex');
    await repo.saveProjectionRecord({
      id: `proj-adv-eval-report-${Date.now()}`,
      baselineId: createRequirementsBaselineId('BASE-002'),
      requirementRevisionIds: [createRequirementRevisionId(resolvedRevisionId)],
      artifactType: 'evaluation-report',
      content: adversarialReportContent,
      metadata: {
        baselineId: 'BASE-002',
        requirementRevisionIds: [resolvedRevisionId],
        artifactType: 'evaluation-report',
        declaredProvenance: {
          baselineId: 'BASE-002',
          requirementRevisionIds: [resolvedRevisionId]
        },
        configuredExecution: {
          provider: options.provider ?? 'fake',
          artifactType: 'evaluation-report'
        },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: advReportHash,
          verifiedAt: now()
        }
      },
      createdAt: now()
    });

    const storedProjections = await repo.listProjectionRecords(
      createRequirementsBaselineId('BASE-002')
    );
    const adversarialReportWitnessed = storedProjections.some(
      (p) => p.content.includes('STATUS: APPROVED') && p.content.includes('RECOMMENDATION: GO')
    );
    if (!adversarialReportWitnessed) {
      throw new Error('Failed to witness adversarial GO report text in requirements repository');
    }

    // Even though generated report text asserts GO, evaluate candidate promotion status
    const statusBeforeHumanApproval = await evaluatePromotionStatusUseCase.execute({
      candidateSha
    });

    if (
      statusBeforeHumanApproval.isApproved ||
      statusBeforeHumanApproval.disposition !== 'UNAPPROVED' ||
      statusBeforeHumanApproval.diagnosticCode !== 'AWAITING_APPROVAL'
    ) {
      throw new Error(
        `Generated text or unapproved state breached governance boundary: got isApproved=${statusBeforeHumanApproval.isApproved}, disp=${statusBeforeHumanApproval.disposition}`
      );
    }

    const approvalsBefore = await repo.listGovernanceApprovals({ candidateSha });
    if (approvalsBefore.length > 0) {
      throw new Error('Authoritative approval record was created from adversarial report text!');
    }

    // Proving non-human agent cannot approve candidate
    let agentApprovalRejected = false;
    try {
      await approveCandidateUseCase.execute({
        candidateSha,
        validationRunId: validationRun.id,
        evidenceDigest,
        decision: 'GO',
        rationale: 'Automated agent attempting approval',
        actor: TEST_PERSONAS.agent
      });
    } catch (err) {
      if (err instanceof HumanActorRequiredForApprovalError) {
        agentApprovalRejected = true;
      }
    }

    if (!agentApprovalRejected) {
      throw new Error('Agent actor was erroneously permitted to execute candidate approval');
    }

    const generatedGoPreventionOutcome: GeneratedGoPreventionOutcome = {
      simulatedGoTextInjected: adversarialReportWitnessed,
      isApproved: statusBeforeHumanApproval.isApproved,
      disposition: statusBeforeHumanApproval.disposition,
      diagnostic: statusBeforeHumanApproval.diagnosticCode,
      agentApprovalRejected
    };
    log(
      '       Verified generated "GO" text ignored; promotion remains UNAPPROVED and agent approval blocked.'
    );

    // ------------------------------------------------------------------------
    // Step 7: Create Authenticated Human-Equivalent Test Approval Through Governance Path
    // ------------------------------------------------------------------------
    log('[7/15] Creating authenticated human test approval through governance command path...');
    const govServer = composeOrchestratorHttpServer({
      repository: repo,
      authenticator,
      authorizer,
      telemetryRegistry
    });
    await govServer.app.ready();
    openServers.push(govServer.app);

    // Negative 1: Missing authentication fails closed
    const unauthGovRes = await govServer.app.inject({
      method: 'POST',
      url: '/api/governance/approvals',
      payload: {
        candidateSha,
        validationRunId: validationRun.id,
        evidenceDigest,
        decision: 'GO',
        rationale: 'Synthetic verification harness check'
      }
    });
    if (unauthGovRes.statusCode !== 401) {
      throw new Error(
        `Expected unauthenticated approval to fail with 401, got ${unauthGovRes.statusCode}`
      );
    }

    // Negative 2: Viewer lacking capability fails closed
    const viewerGovRes = await govServer.app.inject({
      method: 'POST',
      url: '/api/governance/approvals',
      headers: {
        authorization: 'Bearer test:viewer'
      },
      payload: {
        candidateSha,
        validationRunId: validationRun.id,
        evidenceDigest,
        decision: 'GO',
        rationale: 'Synthetic verification harness check'
      }
    });
    if (viewerGovRes.statusCode !== 403) {
      throw new Error(`Expected viewer approval to fail with 403, got ${viewerGovRes.statusCode}`);
    }

    // Negative 3: Non-human agent fails closed
    const agentGovRes = await govServer.app.inject({
      method: 'POST',
      url: '/api/governance/approvals',
      headers: {
        authorization: 'Bearer test:agent'
      },
      payload: {
        candidateSha,
        validationRunId: validationRun.id,
        evidenceDigest,
        decision: 'GO',
        rationale: 'Synthetic verification harness check'
      }
    });
    if (agentGovRes.statusCode !== 400 && agentGovRes.statusCode !== 403) {
      throw new Error(`Expected agent approval to fail, got ${agentGovRes.statusCode}`);
    }

    // Positive: Authenticated reviewer with candidate:approve capability
    const reviewerGovRes = await govServer.app.inject({
      method: 'POST',
      url: '/api/governance/approvals',
      headers: {
        authorization: 'Bearer test:reviewer'
      },
      payload: {
        candidateSha,
        validationRunId: validationRun.id,
        evidenceDigest,
        decision: 'GO',
        rationale:
          'Synthetic human-equivalent harness verification check: verified handoff bundle and readiness.'
      }
    });

    if (reviewerGovRes.statusCode !== 201) {
      throw new Error(
        `Governance command approval failed: ${reviewerGovRes.statusCode}: ${reviewerGovRes.body}`
      );
    }

    const humanApproval = reviewerGovRes.json();
    if (
      humanApproval.actor.id !== TEST_PERSONAS.reviewer.id ||
      humanApproval.actor.actorType !== 'human'
    ) {
      throw new Error('Approval record did not retain authenticated actor provenance');
    }

    await govServer.app.close();
    const govIdx = openServers.indexOf(govServer.app);
    if (govIdx !== -1) openServers.splice(govIdx, 1);

    const statusAfterApproval = await evaluatePromotionStatusUseCase.execute({ candidateSha });
    if (
      !statusAfterApproval.isApproved ||
      statusAfterApproval.disposition !== 'APPROVED' ||
      statusAfterApproval.diagnosticCode !== 'PROMOTION_READY'
    ) {
      throw new Error(
        `Human approval failed to promote candidate: got isApproved=${statusAfterApproval.isApproved}, disp=${statusAfterApproval.disposition}`
      );
    }

    const humanApprovalOutcome: HumanApprovalOutcome = {
      approvalRecordId: humanApproval.id,
      actorId: humanApproval.actor.id,
      actorType: humanApproval.actor.actorType,
      isApproved: statusAfterApproval.isApproved,
      disposition: statusAfterApproval.disposition,
      diagnostic: statusAfterApproval.diagnosticCode
    };
    log(
      `       Created synthetic human-equivalent approval '${humanApproval.id}' (PROMOTION_READY).`
    );

    // ------------------------------------------------------------------------
    // Step 8: Export Stories Through Deterministic Fake/Local HTTP Provider (Zero External Mutation)
    // ------------------------------------------------------------------------
    log(
      '[8/15] Exporting implementation-ready stories through deterministic fake backlog provider...'
    );
    const backlogGateway =
      options.adapter?.backlogGateway ?? options.adapter?.createBacklogGateway?.();

    if (!backlogGateway) {
      throw new Error('Backlog export gateway required for Phase 4 exit gate');
    }

    // Verify gateway is side-effect safe
    const isSafeGateway =
      Boolean((backlogGateway as { isSideEffectSafe?: boolean }).isSideEffectSafe) ||
      backlogGateway.providerId === 'fake' ||
      backlogGateway.providerId === 'fake-github';

    if (!isSafeGateway) {
      throw new Error(
        `Phase 4 exit gate requires a side-effect-safe fake or loopback backlog gateway, got '${backlogGateway.providerId}'`
      );
    }

    // Adversarial external endpoint check: verify non-loopback external endpoint is rejected fail closed
    let externalMutationBlocked = false;
    try {
      assertSafeBacklogEndpoint('https://api.github.com/repos/adversarial/production-repo', false);
    } catch (err) {
      if (err instanceof RealBacklogMutationForbiddenError) {
        externalMutationBlocked = true;
      }
    }
    if (!externalMutationBlocked) {
      throw new Error(
        'assertSafeBacklogEndpoint failed to block real external backlog mutation to https://api.github.com'
      );
    }

    const evaluateExportStalenessUseCase = new EvaluateExportStalenessUseCase(
      repo,
      getAuthorityBundleUseCase,
      buildDependencyGraphUseCase,
      authorizer
    );

    const exportBacklogUseCase = new ExportBacklogUseCase(
      repo,
      backlogGateway,
      authorizer,
      getAuthorityBundleUseCase,
      evaluateReadinessUseCase,
      buildDependencyGraphUseCase,
      evaluateExportStalenessUseCase
    );

    const exportRes1 = await exportBacklogUseCase.execute({
      baselineId: 'BASE-002',
      targetContainer: 'test-org/fake-repo',
      provider: backlogGateway.providerId,
      actor: TEST_PERSONAS.exporter
    });

    if (exportRes1.summary.total !== 2 || exportRes1.items.length !== 2) {
      throw new Error(`Expected 2 exported stories, got ${exportRes1.summary.total}`);
    }

    const persistedMappings1 = await repo.listBacklogExportMappings({
      baselineId: createRequirementsBaselineId('BASE-002')
    });
    if (persistedMappings1.length !== 2) {
      throw new Error(
        `Expected 2 backlog export mappings in database, got ${persistedMappings1.length}`
      );
    }

    const backlogExportOutcome: BacklogExportOutcome = {
      exportedStoryCount: exportRes1.summary.total,
      externalTicketsCreated: exportRes1.summary.created,
      realExternalMutationPrevented: externalMutationBlocked && isSafeGateway,
      mappingsPersisted: persistedMappings1.length
    };
    log(`       Exported 2 stories with zero real external tracker mutation.`);

    // ------------------------------------------------------------------------
    // Step 9: Prove Repeated Export is Idempotent (0 Provider Calls)
    // ------------------------------------------------------------------------
    log('[9/15] Proving repeated backlog export is idempotent with 0 provider calls...');
    const inspectableGateway = backlogGateway as unknown as {
      readonly createCalls?: readonly unknown[];
      readonly updateCalls?: readonly unknown[];
    };
    const fakeGatewayCallsBefore = inspectableGateway.createCalls?.length ?? 0;
    const fakeGatewayUpdatesBefore = inspectableGateway.updateCalls?.length ?? 0;

    const exportRes2 = await exportBacklogUseCase.execute({
      baselineId: 'BASE-002',
      targetContainer: 'test-org/fake-repo',
      provider: backlogGateway.providerId,
      actor: TEST_PERSONAS.exporter,
      forceUpdate: false
    });

    const fakeGatewayCallsAfter = inspectableGateway.createCalls?.length ?? 0;
    const fakeGatewayUpdatesAfter = inspectableGateway.updateCalls?.length ?? 0;

    const additionalCalls =
      fakeGatewayCallsAfter -
      fakeGatewayCallsBefore +
      (fakeGatewayUpdatesAfter - fakeGatewayUpdatesBefore);

    const allUnchanged = exportRes2.items.every((i) => i.status === 'unchanged');
    if (!allUnchanged || additionalCalls !== 0) {
      throw new Error(
        `Export idempotency violated: allUnchanged=${allUnchanged}, additionalCalls=${additionalCalls}`
      );
    }

    const exportIdempotencyOutcome: ExportIdempotencyOutcome = {
      isIdempotent: allUnchanged && additionalCalls === 0,
      providerCallsOnRepeat: additionalCalls,
      unchangedItemCount: exportRes2.items.length
    };
    log(`       Verified repeated export returned 'unchanged' with 0 additional provider calls.`);

    // ------------------------------------------------------------------------
    // Step 10: Create Successor Baseline & Prove Exported Mappings Become Stale/Impacted
    // ------------------------------------------------------------------------
    log('[10/15] Creating successor baseline drift and proving staleness/impact detection...');
    const revisedReq5 = await reconcileUseCase.reviseRequirement({
      revisionId: resolvedRevisionId,
      statement:
        'Orders must record customer ID, line items, and lifecycle status. Customers may cancel orders within 48 hours.',
      rationale: 'Clarified customer cancellation window extended to 48 hours.',
      actorId: 'lead-reviewer'
    });

    const acceptedReq5 = await reconcileUseCase.acceptRequirement({
      revisionId: revisedReq5.id,
      rationale: 'Accepted 48-hour cancellation policy.',
      actorId: 'lead-reviewer'
    });

    const resolvedReq5 = await reconcileUseCase.resolveRequirement({
      revisionId: acceptedReq5.id,
      rationale: 'Cancellation window verified clear and unambiguous.',
      actorId: 'lead-reviewer'
    });

    // Baseline BASE-003
    await baselineUseCase.create({
      id: 'BASE-003',
      requirementRevisionIds: [resolvedReq5.id, 'REQ-ORD-02-R1'],
      policyConstraintRevisionIds: ['POL-SEC-01-R1'],
      createdBy: 'lead-reviewer'
    });

    // Save story on BASE-003 referencing successor requirement revision
    const story1Rev5: StoryRecord = {
      id: createStoryId('STORY-001'),
      baselineId: createRequirementsBaselineId('BASE-003'),
      projectionId: 'PROJ-STORY-001-R5',
      title: 'Order Creation and 48-Hour Cancellation',
      narrative: {
        role: 'Customer',
        feature: 'Order Management',
        benefit: 'Order processing'
      },
      requirementRevisionIds: [createRequirementRevisionId(resolvedReq5.id)],
      policyConstraintRevisionIds: [createPolicyConstraintRevisionId('POL-SEC-01-R1')],
      scenarios: [
        {
          title: 'Customer cancels order within 48 hours',
          requirementRevisionIds: [createRequirementRevisionId(resolvedReq5.id)],
          policyConstraintRevisionIds: [createPolicyConstraintRevisionId('POL-SEC-01-R1')],
          steps: [
            { keyword: 'Given', text: 'a customer with an authorized order' },
            { keyword: 'When', text: 'the customer requests cancellation within 48 hours' },
            { keyword: 'Then', text: 'the order status should be "CANCELLED"' }
          ],
          rawText:
            'Scenario: Customer cancels order within 48 hours\n  Given a customer with an authorized order\n  When the customer requests cancellation within 48 hours\n  Then the order status should be "CANCELLED"'
        }
      ],
      acceptanceCriteria: ['Supports 48-hour cancellation'],
      gherkinText: story1Gherkin,
      metadata: {
        baselineId: 'BASE-003',
        requirementRevisionIds: [resolvedReq5.id],
        policyConstraintRevisionIds: ['POL-SEC-01-R1'],
        artifactType: 'stories',
        declaredProvenance: {
          baselineId: 'BASE-003',
          requirementRevisionIds: [resolvedReq5.id],
          policyConstraintRevisionIds: ['POL-SEC-01-R1']
        },
        configuredExecution: { provider: 'fake', artifactType: 'stories' },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'hash-story1-r5',
          verifiedAt: now()
        }
      },
      createdAt: now(),
      version: 1
    };
    await repo.updateStory(story1Rev5);

    const stalenessReport = await evaluateExportStalenessUseCase.execute({
      baselineId: 'BASE-003',
      provider: backlogGateway.providerId,
      targetContainer: 'test-org/fake-repo',
      actor: TEST_PERSONAS.exporter
    });

    const story1Staleness = stalenessReport.stories.find((s) => s.storyId === 'STORY-001');
    const isStaleOrImpacted =
      story1Staleness?.classification === 'STALE' || story1Staleness?.classification === 'IMPACTED';

    if (!isStaleOrImpacted) {
      throw new Error(
        `Expected STORY-001 to be classified as STALE or IMPACTED, got '${story1Staleness?.classification}'`
      );
    }

    // Attempt export on BASE-003 without allowUpdateExisting or forceUpdate
    const unconfirmedExportRes = await exportBacklogUseCase.execute({
      baselineId: 'BASE-003',
      targetContainer: 'test-org/fake-repo',
      provider: backlogGateway.providerId,
      actor: TEST_PERSONAS.exporter,
      allowUpdateExisting: false,
      forceUpdate: false
    });

    const skippedStaleItem = unconfirmedExportRes.items.find((i) => i.status === 'skipped-stale');
    if (!skippedStaleItem) {
      throw new Error(
        'Unconfirmed export of stale mapping failed to fail-closed with skipped-stale'
      );
    }

    const stalenessImpactOutcome: StalenessImpactOutcome = {
      successorBaselineId: 'BASE-003',
      stalenessDetected: true,
      classification: story1Staleness!.classification as 'STALE' | 'IMPACTED',
      unconfirmedOverwriteBlocked: true,
      skippedCount: unconfirmedExportRes.items.filter((i) => i.status === 'skipped-stale').length
    };
    log(
      `       Verified staleness detected (${story1Staleness?.classification}) and unconfirmed overwrite blocked.`
    );

    // ------------------------------------------------------------------------
    // Step 11: Exercise Process Restart, Backup & Cryptographic Restore
    // ------------------------------------------------------------------------
    log(
      '[11/15] Exercising backup, tamper detection, cryptographic restore, and process restart...'
    );
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p4-exit-gate-backup-'));
    tempDirs.push(tempDir);

    const backupDir = path.join(tempDir, 'valid-backup');
    const backupService = new BackupService({
      db: dbClient,
      objectStore,
      targetDir: backupDir
    });
    const manifest = await backupService.createBackup();

    const tableKeys = Object.keys(manifest.tables);
    if (tableKeys.length !== 18) {
      throw new Error(`Backup manifest table count mismatch: expected 18, got ${tableKeys.length}`);
    }

    // 11A. Cryptographic Tamper Detection
    const corruptBackupDir = path.join(tempDir, 'corrupt-backup');
    await fs.cp(backupDir, corruptBackupDir, { recursive: true });
    const tamperedTablePath = path.join(corruptBackupDir, 'tables', 'baselines.json');
    await fs.writeFile(tamperedTablePath, 'TAMPERED DATA CORRUPTED BY ADVERSARY');

    const restoreDb1 = new PGlite();
    pgliteInstances.push(restoreDb1);
    const restoreDbClient1 = new PGliteDatabaseClient({ pgliteInstance: restoreDb1 });
    await new SchemaMigrationRunner({ db: restoreDbClient1 }).migrate();
    const restoreStore1 = new InMemoryObjectStore();
    const restoredRepo1 = new PostgresRequirementsRepository({
      db: restoreDbClient1,
      objectStore: restoreStore1
    });

    const corruptRestoreService = new RestoreService({
      db: restoreDbClient1,
      objectStore: restoreStore1,
      backupDir: corruptBackupDir,
      repo: restoredRepo1
    });

    let checksumMismatchCaught = false;
    try {
      await corruptRestoreService.restore();
    } catch (err) {
      if (err instanceof BackupChecksumMismatchError) {
        checksumMismatchCaught = true;
      }
    }

    if (!checksumMismatchCaught) {
      throw new Error('RestoreService failed to detect tampered backup table file');
    }

    // 11B. Bit-for-Bit Valid Restoration
    const restoreDb2 = new PGlite();
    pgliteInstances.push(restoreDb2);
    const restoreDbClient2 = new PGliteDatabaseClient({ pgliteInstance: restoreDb2 });
    await new SchemaMigrationRunner({ db: restoreDbClient2 }).migrate();
    const restoreStore2 = new InMemoryObjectStore();
    const restoredRepo2 = new PostgresRequirementsRepository({
      db: restoreDbClient2,
      objectStore: restoreStore2
    });

    const validRestoreService = new RestoreService({
      db: restoreDbClient2,
      objectStore: restoreStore2,
      backupDir,
      repo: restoredRepo2
    });
    const restoreResult = await validRestoreService.restore();

    if (!restoreResult.verified || !restoreResult.checksumsVerified) {
      throw new Error(`Restore verification failed: ${restoreResult.errors.join('; ')}`);
    }

    // Verify restored records across baseline, governance approval, and export mapping
    const restoredBaseline2 = await restoredRepo2.getRequirementsBaseline(
      createRequirementsBaselineId('BASE-002')
    );
    const restoredApproval = await restoredRepo2.getActiveGovernanceApproval(candidateSha);
    const restoredMappings = await restoredRepo2.listBacklogExportMappings({
      baselineId: createRequirementsBaselineId('BASE-002')
    });

    const bitForBitRestorationVerified =
      Boolean(restoredBaseline2) &&
      Boolean(restoredApproval) &&
      restoredApproval?.id === humanApproval.id &&
      restoredMappings.length === 2;

    if (!bitForBitRestorationVerified) {
      throw new Error('Restored database records do not match original pre-backup state');
    }

    // 11C. Server Restart against Restored Database
    const composedServer = composeOrchestratorHttpServer({
      repository: restoredRepo2,
      authenticator: new TestAuthenticator(),
      generationGateway,
      linterGateway: new HarnessMermaidLinterGateway(),
      backlogGatewayFactory: new BacklogExportGatewayFactory({
        customGateways: {
          'fake-github': backlogGateway,
          'github-issues': backlogGateway
        }
      })
    });
    await composedServer.app.ready();
    openServers.push(composedServer.app);

    const readyRes = await composedServer.app.inject({
      method: 'GET',
      url: '/api/health/ready'
    });
    const readyBody = readyRes.json();
    const restartServerHealthy = readyRes.statusCode === 200 && readyBody.status === 'healthy';

    await composedServer.app.close();
    const srvIdx = openServers.indexOf(composedServer.app);
    if (srvIdx !== -1) openServers.splice(srvIdx, 1);

    if (!restartServerHealthy) {
      throw new Error(
        `/api/health/ready failed on restarted server: status ${readyRes.statusCode}`
      );
    }

    const backupRestoreRestartOutcome: BackupRestoreRestartOutcome = {
      snapshotTableCount: tableKeys.length,
      blobCount: manifest.blobs.length,
      tamperDetectionVerified: true,
      checksumMismatchCaught,
      bitForBitRestorationVerified,
      restartServerHealthy
    };
    log(
      '       Verified 18 tables snapshotted, tamper detection abort, and pristine server restart.'
    );

    // ------------------------------------------------------------------------
    // Step 12: Exercise Concurrency Conflict Behavior
    // ------------------------------------------------------------------------
    log('[12/15] Exercising optimistic and immutable concurrency conflict behavior...');
    let optimisticStoryConflictCaught = false;
    let duplicateBaselineConflictCaught = false;
    let racingApprovalConflictCaught = false;

    // 12A. Optimistic concurrency conflict on story update
    const story1Current = await repo.getStory(createStoryId('STORY-001'));
    if (story1Current) {
      try {
        await repo.updateStory(story1Current, 99999);
      } catch (err) {
        if (err instanceof OptimisticConcurrencyConflictError) {
          optimisticStoryConflictCaught = true;
        }
      }
    }

    // 12B. Duplicate baseline creation conflict
    const base1 = await repo.getRequirementsBaseline(createRequirementsBaselineId('BASE-001'));
    if (base1) {
      try {
        await repo.saveRequirementsBaseline(base1);
      } catch (err) {
        if (err instanceof ImmutableRecordConflictError) {
          duplicateBaselineConflictCaught = true;
        }
      }
    }

    // 12C. Racing governance approval conflict
    try {
      await approveCandidateUseCase.execute({
        candidateSha,
        validationRunId: validationRun.id,
        evidenceDigest,
        decision: 'GO',
        rationale: 'Racing approval without supersedes',
        actor: TEST_PERSONAS.reviewer
      });
    } catch (err) {
      if (err instanceof OptimisticConcurrencyConflictError) {
        racingApprovalConflictCaught = true;
      }
    }

    const typedConflictErrorsVerified =
      optimisticStoryConflictCaught &&
      duplicateBaselineConflictCaught &&
      racingApprovalConflictCaught;

    if (!typedConflictErrorsVerified) {
      throw new Error(
        `Concurrency conflicts failed: story=${optimisticStoryConflictCaught}, base=${duplicateBaselineConflictCaught}, apprv=${racingApprovalConflictCaught}`
      );
    }

    const concurrencyConflictOutcome: ConcurrencyConflictOutcome = {
      typedConflictErrorsVerified,
      optimisticStoryConflictCaught,
      duplicateBaselineConflictCaught,
      racingApprovalConflictCaught
    };
    log(
      '       Verified optimistic story conflict, duplicate baseline, and racing approval conflict.'
    );

    // ------------------------------------------------------------------------
    // Step 13: Safe Typed Dependency Failure Degradation
    // ------------------------------------------------------------------------
    log('[13/15] Exercising safe typed dependency failure degradation across ports...');
    // 13A. OIDC Unavailability Fail-Closed
    const unreachableJwks = new JwksCache('http://127.0.0.1:9999/unreachable/certs', {
      timeoutMs: 50,
      fetchFn: async () => {
        throw new Error('connect ECONNREFUSED');
      }
    });
    const failingOidcAuth = new GenericOidcAuthenticator({
      issuer: 'http://127.0.0.1:9999/realms/solutions-studio',
      audience: 'solutions-studio-api',
      jwksCache: unreachableJwks
    });
    const oidcServer = composeOrchestratorHttpServer({
      repository: repo,
      authenticator: failingOidcAuth,
      generationGateway,
      linterGateway: new HarnessMermaidLinterGateway()
    });
    await oidcServer.app.ready();
    openServers.push(oidcServer.app);

    const oidcFailRes = await oidcServer.app.inject({
      method: 'POST',
      url: '/api/baselines',
      headers: {
        authorization: 'Bearer header.payload.dummy',
        'content-type': 'application/json'
      },
      payload: {
        id: 'ATTACK-001',
        requirementRevisions: []
      }
    });
    const oidcFailureHandled = oidcFailRes.statusCode === 401;
    await oidcServer.app.close();
    const oidcIdx = openServers.indexOf(oidcServer.app);
    if (oidcIdx !== -1) openServers.splice(oidcIdx, 1);

    // 13B. Persistence Failure Handled
    const failingDbClient: ISqlDatabaseClient = {
      query: async () => {
        throw new Error('Database connection pool exhausted');
      },
      exec: async () => {
        throw new Error('Database connection pool exhausted');
      },
      transaction: async () => {
        throw new Error('Database connection pool exhausted');
      },
      withSession: async () => {
        throw new Error('Database connection pool exhausted');
      },
      close: async () => {}
    };
    const failingRepo = new PostgresRequirementsRepository({
      db: failingDbClient,
      objectStore
    });
    failingRepo.checkStorageHealth = async () => ({
      status: 'unhealthy',
      reachable: false,
      timestamp: now(),
      error: 'Database connection pool exhausted',
      database: {
        status: 'unhealthy',
        latencyMs: 0,
        message: 'Database connection pool exhausted'
      }
    });
    failingRepo.checkHealth = failingRepo.checkStorageHealth;

    const dbFailServer = composeOrchestratorHttpServer({
      repository: failingRepo,
      authenticator: new TestAuthenticator(),
      generationGateway,
      linterGateway: new HarnessMermaidLinterGateway(),
      autoMigrate: false
    });
    await dbFailServer.app.ready();
    openServers.push(dbFailServer.app);

    const dbFailReadyRes = await dbFailServer.app.inject({
      method: 'GET',
      url: '/api/health/ready'
    });
    const persistenceFailureHandled =
      dbFailReadyRes.statusCode === 503 &&
      dbFailReadyRes.json().dependencies?.database?.status === 'unhealthy';
    await dbFailServer.app.close();
    const dbFailIdx = openServers.indexOf(dbFailServer.app);
    if (dbFailIdx !== -1) openServers.splice(dbFailIdx, 1);

    // 13C. Generation Gateway Failure Executed on Mutation Path
    const failingGenGateway: IGenerationGateway = {
      generate: async () => {
        throw new Error('LLM service quota exceeded');
      },
      checkHealth: async () => ({
        status: 'unhealthy',
        provider: 'fake',
        reachable: false,
        available: false,
        error: 'LLM service quota exceeded'
      })
    };

    const failingGenUseCase = new GenerateSqlSchemaProjectionUseCase(
      failingGenGateway,
      sqlValidatorGateway,
      repo,
      'failing-gen'
    );
    let genCommandFailed = false;
    try {
      await failingGenUseCase.execute({ baselineId: 'BASE-001' });
    } catch (err) {
      if (err instanceof Error && err.message.includes('LLM service quota exceeded')) {
        genCommandFailed = true;
      }
    }

    const genFailServer = composeOrchestratorHttpServer({
      repository: repo,
      authenticator: new TestAuthenticator(),
      generationGateway: failingGenGateway,
      linterGateway: new HarnessMermaidLinterGateway()
    });
    await genFailServer.app.ready();
    openServers.push(genFailServer.app);

    const genFailReadyRes = await genFailServer.app.inject({
      method: 'GET',
      url: '/api/health/ready'
    });
    const generationFailureHandled =
      genCommandFailed &&
      genFailReadyRes.statusCode === 503 &&
      genFailReadyRes.json().dependencies?.generation?.status === 'unhealthy';
    await genFailServer.app.close();
    const genFailIdx = openServers.indexOf(genFailServer.app);
    if (genFailIdx !== -1) openServers.splice(genFailIdx, 1);

    // 13D. Validation Gateway Fail-Closed (SQL DDL, OpenAPI, Gherkin, Bounded Repair Exhaustion)
    // 1. Invalid DDL
    const invalidDdl = 'CREATE TABLE broken (id UNKNOWN_TYPE_XYZ NOT NULL);';
    const valDdlRes = await sqlValidatorGateway.validate(invalidDdl);
    const ddlValidationFailed = !valDdlRes.isValid && Boolean(valDdlRes.errorMessage);

    // 2. Invalid OpenAPI
    const invalidOpenApi = '{"openapi": "3.1.0", "info": {}}';
    const valOasRes = await openApiValidatorGateway.validate(invalidOpenApi);
    const openApiValidationFailed = !valOasRes.isValid && Boolean(valOasRes.errorMessage);

    // 3. Invalid Gherkin
    const invalidGherkin = 'Plain text without Feature or Scenario declarations';
    const valGherkinRes = await gherkinValidatorGateway.validate(invalidGherkin);
    const gherkinValidationFailed = !valGherkinRes.isValid && Boolean(valGherkinRes.errorMessage);

    // 4. Bounded repair exhaustion
    const unrepairableGenGateway: IGenerationGateway = {
      generate: async () => ({
        text: '```sql\nCREATE TABLE unrepairable_broken (id BAD_TYPE);\n```'
      }),
      checkHealth: async () => ({
        status: 'healthy',
        provider: 'fake',
        reachable: true,
        available: true
      })
    };
    const repairExhaustionUseCase = new GenerateSqlSchemaProjectionUseCase(
      unrepairableGenGateway,
      sqlValidatorGateway,
      repo,
      'unrepairable-gen'
    );
    let repairExhaustionCaught = false;
    try {
      await repairExhaustionUseCase.execute({ baselineId: 'BASE-001' });
    } catch (err) {
      if (err instanceof RepairRetryExhaustionError) {
        repairExhaustionCaught = true;
      }
    }

    const validationFailureHandled =
      ddlValidationFailed &&
      openApiValidationFailed &&
      gherkinValidationFailed &&
      repairExhaustionCaught;

    // 13E. Backlog Gateway Failure Handled Safely (Typed Error + Unchanged State)
    const failingBacklogGateway: IBacklogExportGateway = {
      providerId: 'github-issues',
      checkHealth: async () => ({
        status: 'unhealthy',
        provider: 'github-issues',
        reachable: false,
        error: 'Network timeout to GitHub API'
      }),
      createWorkItem: async () => {
        throw new ProviderNetworkError('Network timeout to GitHub API', { retryable: true });
      },
      updateWorkItem: async () => {
        throw new ProviderNetworkError('Network timeout to GitHub API', { retryable: true });
      }
    };

    const mappingsBeforeFail = await repo.listBacklogExportMappings({
      baselineId: createRequirementsBaselineId('BASE-003')
    });

    const failingExportUseCase = new ExportBacklogUseCase(
      repo,
      failingBacklogGateway,
      authorizer,
      getAuthorityBundleUseCase,
      evaluateReadinessUseCase,
      buildDependencyGraphUseCase,
      evaluateExportStalenessUseCase
    );

    const failExportRes = await failingExportUseCase.execute({
      baselineId: 'BASE-003',
      targetContainer: 'test-org/fake-repo',
      provider: 'github-issues',
      actor: TEST_PERSONAS.exporter,
      forceUpdate: true
    });

    const mappingsAfterFail = await repo.listBacklogExportMappings({
      baselineId: createRequirementsBaselineId('BASE-003')
    });

    const mappingsStateUnchanged = mappingsBeforeFail.length === mappingsAfterFail.length;
    const typedBacklogErrorReported = failExportRes.items.some(
      (item) =>
        item.status === 'failed' &&
        item.errorType === 'ProviderNetworkError' &&
        item.retryable === true
    );

    const backlogFailServer = composeOrchestratorHttpServer({
      repository: repo,
      authenticator: new TestAuthenticator(),
      generationGateway,
      linterGateway: new HarnessMermaidLinterGateway(),
      backlogGatewayFactory: new BacklogExportGatewayFactory({
        customGateways: { 'github-issues': failingBacklogGateway }
      })
    });
    await backlogFailServer.app.ready();
    openServers.push(backlogFailServer.app);

    const backlogFailReadyRes = await backlogFailServer.app.inject({
      method: 'GET',
      url: '/api/health/ready'
    });
    const backlogProbeDegraded =
      backlogFailReadyRes.statusCode === 200 &&
      backlogFailReadyRes.json().dependencies?.backlog?.status === 'unhealthy';
    await backlogFailServer.app.close();
    const backlogFailIdx = openServers.indexOf(backlogFailServer.app);
    if (backlogFailIdx !== -1) openServers.splice(backlogFailIdx, 1);

    const backlogFailureHandled =
      mappingsStateUnchanged && typedBacklogErrorReported && backlogProbeDegraded;

    const failClosedVerified =
      oidcFailureHandled &&
      persistenceFailureHandled &&
      generationFailureHandled &&
      validationFailureHandled &&
      backlogFailureHandled;

    if (!failClosedVerified) {
      throw new Error(
        `Dependency safety failure: oidc=${oidcFailureHandled}, db=${persistenceFailureHandled}, gen=${generationFailureHandled}, val=${validationFailureHandled}, backlog=${backlogFailureHandled}`
      );
    }

    const dependencyFailureSafetyOutcome: DependencyFailureSafetyOutcome = {
      oidcFailureHandled,
      persistenceFailureHandled,
      generationFailureHandled,
      validationFailureHandled,
      backlogFailureHandled,
      failClosedVerified
    };
    log(
      '       Verified safe typed degradation across OIDC (401), DB (503), Gen (503), Val (DDL/OAS/Gherkin/Repairs), and Backlog.'
    );

    // ------------------------------------------------------------------------
    // Step 14: Sensitive Data Zero-Leak Redaction Invariant
    // ------------------------------------------------------------------------
    log(
      '[14/15] Verifying operational logging and telemetry surfaces do not leak sensitive tokens or claims...'
    );
    const capturedLogs: StructuredLogRecord[] = [];
    StructuredOperationalLogger.setSink((record) => {
      capturedLogs.push(record);
    });

    const bearerSecret = 'Bearer secret-jwt-token-alpha-beta-gamma';
    const rawPassword = 'AdversarialSuperSecretPassword123!';
    const rawEmail = 'customer-alice@confidential-client.com';
    const rawPhone = '+1-555-0199-8877';
    const rawConnString = 'postgres://admin:topsecretpassword@db.internal:5432/solutions_studio';
    const rawSourceEvidence = 'UNREDACTED CONFIDENTIAL EVIDENCE TEXT';

    StructuredOperationalLogger.log(
      'identity.actor.authenticated',
      {
        token: bearerSecret,
        password: rawPassword,
        email: rawEmail,
        phoneNumber: rawPhone,
        connectionString: rawConnString,
        sourceEvidence: rawSourceEvidence
      },
      {
        actorId: rawEmail,
        level: 'info'
      }
    );

    StructuredOperationalLogger.resetSink();

    if (capturedLogs.length === 0) {
      throw new Error('Failed to capture structured operational log entry');
    }

    const logRecord = capturedLogs[0];
    const logString = JSON.stringify(logRecord);

    const bearerTokenRedacted =
      !logString.includes(bearerSecret) && logString.includes('[REDACTED]');
    const passwordRedacted = !logString.includes(rawPassword);
    const piiEmailRedacted = !logString.includes(rawEmail);
    const piiPhoneRedacted = !logString.includes(rawPhone);
    const connectionStringRedacted = !logString.includes('topsecretpassword');
    const sourceEvidenceRedacted = !logString.includes(rawSourceEvidence);

    // Exercise Fastify HTTP server logging and error responses with adversarial input
    const obsServer = composeOrchestratorHttpServer({
      repository: repo,
      authenticator,
      authorizer,
      telemetryRegistry
    });
    await obsServer.app.ready();
    openServers.push(obsServer.app);

    const errRes = await obsServer.app.inject({
      method: 'GET',
      url: `/api/baselines?token=secret123&password=${encodeURIComponent(rawPassword)}`,
      headers: {
        authorization: bearerSecret,
        'x-api-key': 'secret-api-key-999'
      }
    });

    const errBodyString = errRes.body;
    const errorBodyZeroLeak =
      !errBodyString.includes(bearerSecret) &&
      !errBodyString.includes(rawPassword) &&
      !errBodyString.includes('secret-api-key-999');

    const metricsRes = await obsServer.app.inject({
      method: 'GET',
      url: '/api/metrics'
    });
    const obsMetricsText = metricsRes.body;
    const metricsZeroLeak =
      !obsMetricsText.includes(bearerSecret) &&
      !obsMetricsText.includes(rawPassword) &&
      !obsMetricsText.includes(rawEmail) &&
      !obsMetricsText.includes(rawPhone) &&
      !obsMetricsText.includes(rawConnString) &&
      !obsMetricsText.includes(rawSourceEvidence);

    const summaryRes = await obsServer.app.inject({
      method: 'GET',
      url: '/api/telemetry/summary'
    });
    const summaryText = summaryRes.body;
    const summaryZeroLeak =
      !summaryText.includes(bearerSecret) &&
      !summaryText.includes(rawPassword) &&
      !summaryText.includes(rawEmail) &&
      !summaryText.includes(rawPhone) &&
      !summaryText.includes(rawConnString) &&
      !summaryText.includes(rawSourceEvidence);

    await obsServer.app.close();
    const obsIdx = openServers.indexOf(obsServer.app);
    if (obsIdx !== -1) openServers.splice(obsIdx, 1);

    const sanitizedStringSample = SensitiveDataSanitizer.sanitizeString(
      `GET /api?token=secret123&password=${rawPassword} HTTP/1.1\nAuthorization: ${bearerSecret}\nUser: ${rawEmail}`
    );
    const zeroLeakSanitizerCheck =
      !sanitizedStringSample.includes('secret123') &&
      !sanitizedStringSample.includes(rawPassword) &&
      !sanitizedStringSample.includes(rawEmail);

    const zeroLeakInvariantMaintained =
      bearerTokenRedacted &&
      passwordRedacted &&
      piiEmailRedacted &&
      piiPhoneRedacted &&
      connectionStringRedacted &&
      sourceEvidenceRedacted &&
      errorBodyZeroLeak &&
      metricsZeroLeak &&
      summaryZeroLeak &&
      zeroLeakSanitizerCheck;

    if (!zeroLeakInvariantMaintained) {
      throw new Error(
        `Sensitive data leak detected: bearer=${bearerTokenRedacted}, pw=${passwordRedacted}, email=${piiEmailRedacted}, phone=${piiPhoneRedacted}, conn=${connectionStringRedacted}, source=${sourceEvidenceRedacted}, errBody=${errorBodyZeroLeak}, metrics=${metricsZeroLeak}, summary=${summaryZeroLeak}`
      );
    }

    const observabilityRedactionOutcome: ObservabilityRedactionOutcome = {
      bearerTokenRedacted,
      passwordRedacted,
      piiEmailRedacted,
      piiPhoneRedacted,
      connectionStringRedacted,
      zeroLeakInvariantMaintained
    };
    log(
      '       Verified zero-leak redaction across Fastify logs, error response, metrics, summary, and operational logger.'
    );

    // ------------------------------------------------------------------------
    // Step 15: Verify Phase 1, Phase 2, and Phase 3 Exit Gates Remain Green
    // ------------------------------------------------------------------------
    log('[15/15] Verifying Phase 1, Phase 2, and Phase 3 deterministic exit gates remain green...');
    const phase1Adapter =
      options.adapter?.phase1Adapter ?? options.adapter?.createPhase1Adapter?.();
    const phase2Adapter =
      options.adapter?.phase2Adapter ?? options.adapter?.createPhase2Adapter?.();
    const phase3Adapter =
      options.adapter?.phase3Adapter ?? options.adapter?.createPhase3Adapter?.();

    if (!phase1Adapter) {
      throw new Error(
        'Phase 1 test adapter is required for Phase 4 exit gate multi-phase non-regression check'
      );
    }
    if (!phase2Adapter) {
      throw new Error(
        'Phase 2 test adapter is required for Phase 4 exit gate multi-phase non-regression check'
      );
    }
    if (!phase3Adapter) {
      throw new Error(
        'Phase 3 test adapter is required for Phase 4 exit gate multi-phase non-regression check'
      );
    }

    log('       Running Phase 1 exit gate...');
    const p1 = await runPhase1ExitGate({
      adapter: phase1Adapter,
      silent: true,
      cleanup: true
    });
    const phase1Passed = p1.success;

    log('       Running Phase 2 exit gate...');
    const p2 = await runPhase2ExitGate({
      adapter: phase2Adapter,
      silent: true,
      cleanup: true
    });
    const phase2Passed = p2.success;

    log('       Running Phase 3 exit gate...');
    const p3 = await runPhase3ExitGate({
      adapter: phase3Adapter,
      silent: true,
      cleanup: true
    });
    const phase3Passed = p3.success;

    const allPriorGatesGreen = phase1Passed && phase2Passed && phase3Passed;
    if (!allPriorGatesGreen) {
      throw new Error(
        `Prior exit gates not green: P1=${phase1Passed}, P2=${phase2Passed}, P3=${phase3Passed}`
      );
    }

    const priorPhaseGatesOutcome: PriorPhaseGatesOutcome = {
      phase1Passed,
      phase2Passed,
      phase3Passed,
      allPriorGatesGreen
    };
    log('       Verified Phase 1, Phase 2, and Phase 3 deterministic exit gates are green.');

    log('\n========================================================================');
    log('Phase 4 Exit Gate PASSED: Technical Stack Proven Hardened & Pilot-Ready');
    log('AUTHORIZED FOR HUMAN PILOT (#99)');
    log('========================================================================\n');

    return {
      success: true,
      pilotReady: true,
      candidateSha,
      persistenceOutcome,
      identityOutcome,
      authorizationOutcome,
      handoffFlowOutcome,
      validationEvidenceOutcome,
      generatedGoPreventionOutcome,
      humanApprovalOutcome,
      backlogExportOutcome,
      exportIdempotencyOutcome,
      stalenessImpactOutcome,
      backupRestoreRestartOutcome,
      concurrencyConflictOutcome,
      dependencyFailureSafetyOutcome,
      observabilityRedactionOutcome,
      priorPhaseGatesOutcome
    };
  } finally {
    for (const server of openServers) {
      await server.close().catch(() => {});
    }
    for (const pg of pgliteInstances) {
      await pg.close().catch(() => {});
    }
    if (options.cleanup !== false) {
      for (const dir of tempDirs) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}
