import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import {
  createSourceId,
  createReviewerId,
  createRequirementsBaselineId,
  createRequirementId,
  createRequirementRevisionId,
  createRequirementRevision,
  createPolicyConstraintId,
  createPolicyConstraintRevisionId,
  createPolicyConstraintRevision,
  createEngineeringDecisionId,
  createFindingId,
  createStoryId,
  createCandidateFinding,
  now,
  type FindingType
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import {
  ImmutableRecordConflictError,
  type ProjectionRecord,
  type StoryRecord
} from '../ports/persistence/IRequirementsRepository.js';
import type {
  IGenerationGateway,
  GenerationResult
} from '../ports/generation/IGenerationGateway.js';
import type { ISqlValidatorGateway } from '../ports/validation/ISqlValidatorGateway.js';
import type { IOpenApiValidatorGateway } from '../ports/validation/IOpenApiValidatorGateway.js';
import type { IGherkinValidatorGateway } from '../ports/validation/IGherkinValidatorGateway.js';

import { GatewayFactory } from '../../infrastructure/generation/GatewayFactory.js';
import { PGliteSqlValidatorAdapter } from '../../infrastructure/validation/PGliteSqlValidatorAdapter.js';
import { OpenApiStructuralValidatorAdapter } from '../../infrastructure/validation/OpenApiStructuralValidatorAdapter.js';
import { GherkinValidatorAdapter } from '../../infrastructure/validation/GherkinValidatorAdapter.js';

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
import {
  GetEngineeringHandoffBundleUseCase,
  type EngineeringHandoffSummary
} from '../use-cases/GetEngineeringHandoffBundleUseCase.js';
import { GetAuthorityBundleUseCase } from '../use-cases/GetAuthorityBundleUseCase.js';
import { SchemaApiCrossValidator } from '../use-cases/crossValidation/schemaApiCrossValidator.js';

export interface ScriptableGenerationGateway extends IGenerationGateway {
  queueResponse(text: string, metadata?: GenerationResult['metadata']): void;
}

export interface Phase3ExitGateAdapter {
  readonly generationGateway?: ScriptableGenerationGateway | IGenerationGateway;
  readonly sqlValidatorGateway?: ISqlValidatorGateway;
  readonly openApiValidatorGateway?: IOpenApiValidatorGateway;
  readonly gherkinValidatorGateway?: IGherkinValidatorGateway;
  createGenerationGateway?(): ScriptableGenerationGateway | IGenerationGateway;
  createSqlValidatorGateway?(): ISqlValidatorGateway;
  createOpenApiValidatorGateway?(): IOpenApiValidatorGateway;
  createGherkinValidatorGateway?(): IGherkinValidatorGateway;
}

export interface Phase3ExitGateOptions {
  readonly storeDir?: string;
  readonly provider?: 'fake' | 'agy' | 'opencode';
  readonly model?: string;
  readonly silent?: boolean;
  readonly cleanup?: boolean;
  readonly adapter?: Phase3ExitGateAdapter;
  readonly runId?: string;
  readonly expectedGitSha?: string;
  readonly adversarialMutatePredecessor?: boolean;
}

export interface Phase3ExitGateResult {
  readonly success: boolean;
  readonly executionMode: 'deterministic-ci' | 'real-provider';
  readonly provider: string;
  readonly model?: string;
  readonly gitCommitSha?: string;
  readonly cleanWorktreeVerified?: boolean;
  readonly observedIdentities: readonly {
    readonly projectionId: string;
    readonly artifactType: string;
    readonly provider?: string;
    readonly model?: string;
  }[];
  readonly runId: string;
  readonly timestamp: string;

  // Step 1: Baselines
  readonly startingBaseline: {
    readonly id: string;
    readonly requirementRevisions: readonly string[];
    readonly policyConstraintRevisions: readonly string[];
  };
  readonly successorBaseline: {
    readonly id: string;
    readonly requirementRevisions: readonly string[];
    readonly policyConstraintRevisions: readonly string[];
  };

  // Step 2 & 3: SQL Projections
  readonly sqlValidationOutcome: {
    readonly projectionAId: string;
    readonly projectionBId: string;
    readonly isValid: boolean;
    readonly repairsNeededA: number;
    readonly repairsNeededB: number;
  };

  // Step 4: OpenAPI Projections
  readonly openApiValidationOutcome: {
    readonly projectionAId: string;
    readonly projectionBId: string;
    readonly openApiVersion: '3.1.0';
    readonly isValid: boolean;
    readonly crossValidationPassed: boolean;
    readonly repairsNeededA: number;
    readonly repairsNeededB: number;
  };

  // Step 5: Engineering Decisions (Predecessor Baseline BASE-001)
  readonly initialEngineeringDecision: {
    readonly id: string;
    readonly statement: string;
    readonly rationale: string;
    readonly baselineId: string;
    readonly state: 'ACCEPTED';
    readonly initialStartingState: 'PROPOSED';
  };

  // Step 6 & 7: Discovery & Fail-Closed Readiness
  readonly discoveryAndReadinessGate: {
    readonly candidateFindingId: string;
    readonly findingType: 'incomplete-state-machine';
    readonly initialDisposition: 'OPEN';
    readonly candidateStoryId: 'STORY-ORD-001-CANDIDATE';
    readonly readinessFailedClosed: boolean;
    readonly blockingRuleId: 'no-blocking-open-findings';
    readonly handoffBlocked: boolean;
  };

  // Step 8: Reconciliation & Successor Revision Resolution
  readonly reconciliation: {
    readonly findingDisposition: 'RESOLVED';
    readonly findingRationale: string;
    readonly revisedRevisionId: string;
    readonly acceptedRevisionId: string;
    readonly resolvedRevisionId: string;
    readonly finalReviewState: 'ACCEPTED';
    readonly finalResolutionState: 'CLEAR';
    readonly actorId: string;
  };

  // Step 9: Successor Engineering Decision (BASE-002)
  readonly successorEngineeringDecision: {
    readonly id: string;
    readonly statement: string;
    readonly rationale: string;
    readonly baselineId: string;
    readonly supersedes: string;
    readonly state: 'ACCEPTED';
    readonly initialStartingState: 'PROPOSED';
  };

  // Step 10: Stories
  readonly storiesOutcome: {
    readonly count: number;
    readonly storyIds: readonly string[];
    readonly allTraceable: boolean;
    readonly gherkinValid: boolean;
    readonly repairsNeededStory1: number;
    readonly repairsNeededStory2: number;
    readonly repairsNeeded: Record<string, number>;
    readonly projectionHashes: Record<string, string>;
  };

  // Step 11: Coverage
  readonly coverageOutcome: {
    readonly totalRequirements: number;
    readonly coveredCount: number;
    readonly uncoveredCount: number;
    readonly isFullyCovered: boolean;
  };

  // Step 12: Readiness
  readonly finalReadinessOutcome: {
    readonly allStoriesReady: boolean;
    readonly readyCount: number;
    readonly nonReadyCount: number;
  };

  // Step 13: Dependency Graph
  readonly dependencyGraphOutcome: {
    readonly isAcyclic: boolean;
    readonly isValid: boolean;
    readonly nodeCount: number;
    readonly edgeCount: number;
  };

  // Step 14: Engineering Handoff
  readonly handoffBundle: {
    readonly isHandoffReady: boolean;
    readonly summary: EngineeringHandoffSummary;
    readonly contentHashesVerified: boolean;
    readonly engineeringDecisionsCount: number;
    readonly hashes: {
      readonly sql: string;
      readonly openApi: string;
      readonly story1: string;
      readonly story2: string;
    };
  };

  // Step 15: Immutability
  readonly immutabilityVerification: {
    readonly baselineAUntouched: boolean;
    readonly duplicateBaselineOverwriteRejected: boolean;
    readonly predecessorProjectionsIsolated: boolean;
    readonly restartReloadDurabilityVerified: boolean;
    readonly predecessorSnapshotsVerified: boolean;
    readonly reloadedProcessPid: number;
    readonly snapshotCount: number;
  };

  readonly storeDir: string;
}

export async function runPhase3ExitGate(
  options: Phase3ExitGateOptions = {}
): Promise<Phase3ExitGateResult> {
  const log = (msg: string) => {
    if (!options.silent) {
      console.log(msg);
    }
  };

  const isTempStore = !options.storeDir;
  const storeDir =
    options.storeDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'phase3-exit-gate-run-')));

  const provider = options.provider ?? (options.adapter ? 'fake' : 'fake');
  const executionMode: 'deterministic-ci' | 'real-provider' =
    provider === 'fake' ? 'deterministic-ci' : 'real-provider';

  // Finding [F-fdee8fda]: Reject injected test adapters for real-provider runs
  if (provider !== 'fake' && options.adapter) {
    throw new Error(
      `Injected test adapter rejected: real-provider execution (provider: '${provider}') must use production gateways, not test adapters.`
    );
  }

  // Finding [F-fdee8fda]: Require an explicit model for real-provider runs
  if (provider !== 'fake' && (!options.model || options.model.trim().length === 0)) {
    throw new Error(
      `Model must be explicitly specified for real-provider runs (provider: '${provider}').`
    );
  }

  // Finding [F-fdee8fda]: Capture a resolvable clean Git SHA before execution
  let gitCommitSha: string | undefined;
  let cleanWorktreeVerified: boolean | undefined;
  try {
    const headSha = cp
      .execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim();
    cp.execSync(`git cat-file -e ${headSha}^{commit}`, { stdio: 'ignore' });
    gitCommitSha = headSha;

    const statusOutput = cp
      .execSync('git status --porcelain', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim();
    if (statusOutput.length > 0) {
      if (provider !== 'fake') {
        throw new Error(`Worktree is dirty:\n${statusOutput}`);
      }
    } else {
      cleanWorktreeVerified = true;
    }
  } catch (err) {
    if (provider !== 'fake') {
      throw new Error(
        `Failed clean Git SHA verification for real-provider run: ${(err as Error).message}`
      );
    }
  }

  if (options.expectedGitSha && gitCommitSha && gitCommitSha !== options.expectedGitSha) {
    throw new Error(
      `Git SHA mismatch: expected '${options.expectedGitSha}', observed '${gitCommitSha}'`
    );
  }

  const runId = options.runId ?? `RUN-P3-${randomUUID().slice(0, 8)}`;
  const timestamp = new Date().toISOString();

  // Instantiate or resolve gateways
  let generationGateway: IGenerationGateway;
  let sqlValidatorGateway: ISqlValidatorGateway;
  let openApiValidatorGateway: IOpenApiValidatorGateway;
  let gherkinValidatorGateway: IGherkinValidatorGateway;

  if (options.adapter) {
    generationGateway =
      options.adapter.createGenerationGateway?.() ?? options.adapter.generationGateway!;
    sqlValidatorGateway =
      options.adapter.createSqlValidatorGateway?.() ?? options.adapter.sqlValidatorGateway!;
    openApiValidatorGateway =
      options.adapter.createOpenApiValidatorGateway?.() ?? options.adapter.openApiValidatorGateway!;
    gherkinValidatorGateway =
      options.adapter.createGherkinValidatorGateway?.() ?? options.adapter.gherkinValidatorGateway!;
  } else {
    if (provider === 'agy' || provider === 'opencode') {
      generationGateway = GatewayFactory.createGateway({
        provider,
        model: options.model,
        timeoutMs: 120_000,
        cwd: process.cwd()
      });
      sqlValidatorGateway = new PGliteSqlValidatorAdapter();
      openApiValidatorGateway = new OpenApiStructuralValidatorAdapter();
      gherkinValidatorGateway = new GherkinValidatorAdapter();
    } else {
      throw new Error(
        `Phase3ExitGate requires an adapter when provider is '${provider}', or specify provider 'agy' or 'opencode'.`
      );
    }
  }

  if (!generationGateway) {
    throw new Error('Generation gateway could not be initialized');
  }
  if (!sqlValidatorGateway) {
    throw new Error('SQL validator gateway could not be initialized');
  }
  if (!openApiValidatorGateway) {
    throw new Error('OpenAPI validator gateway could not be initialized');
  }
  if (!gherkinValidatorGateway) {
    throw new Error('Gherkin validator gateway could not be initialized');
  }

  const isScriptableGen = 'queueResponse' in generationGateway;

  try {
    log('========================================================================');
    log('Solutions Studio: Phase 3.7 Exit Gate & Candidate Validation');
    log(`Mode: ${executionMode} | Provider: ${provider} | Model: ${options.model ?? 'default'}`);
    log('========================================================================\n');

    const repo = new FilesystemRequirementsRepository({ baseDir: storeDir });
    const baselineUseCase = new CreateRequirementsBaselineUseCase(repo);
    const reconcileUseCase = new ReconcileRequirementsUseCase(repo);
    const recordEdUseCase = new RecordEngineeringDecisionUseCase(repo);
    const transitionEdUseCase = new TransitionEngineeringDecisionUseCase(repo);
    const generateSqlUseCase = new GenerateSqlSchemaProjectionUseCase(
      generationGateway,
      sqlValidatorGateway,
      repo,
      provider
    );
    const generateOpenApiUseCase = new GenerateOpenApiProjectionUseCase(
      generationGateway,
      openApiValidatorGateway,
      repo,
      provider
    );
    const generateStoriesUseCase = new GenerateStoriesProjectionUseCase(
      generationGateway,
      gherkinValidatorGateway,
      repo,
      provider
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

    // ------------------------------------------------------------------------
    // Step 1: Establish Initial Immutable Baseline (BASE-001)
    // ------------------------------------------------------------------------
    log('[1/15] Establishing immutable starting baseline BASE-001 with policy constraint...');
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
      evidence: [
        {
          sourceRevisionId: src.revision.id,
          locator: orderLifeLoc
        }
      ]
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
      rationale: 'Verified against order management standard.',
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
      evidence: [
        {
          sourceRevisionId: src.revision.id,
          locator: payAuthLoc
        }
      ]
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

    const polSec1 = createPolicyConstraintRevision({
      id: createPolicyConstraintRevisionId('POL-SEC-01-R1'),
      policyConstraintId: createPolicyConstraintId('POL-SEC-01'),
      revision: 1,
      statement:
        'All database tables storing customer orders must include created_at and updated_at audit timestamps.',
      authorityReference: 'Enterprise Security & Compliance Standard v2.4 §4.1',
      state: 'ACCEPTED',
      createdBy: 'enterprise-security'
    });
    await repo.savePolicyConstraintRevision(polSec1);

    const baselineA = await baselineUseCase.create({
      id: createRequirementsBaselineId('BASE-001'),
      requirementRevisionIds: [req1Rev1.id, req2Rev1.id],
      policyConstraintRevisionIds: [polSec1.id],
      createdBy: createReviewerId('lead-architect')
    });
    log(`       Created baseline 'BASE-001' with policy constraint '${polSec1.id}'.`);

    // ------------------------------------------------------------------------
    // Step 2 & 3: Generate SQL Schema Projection & Validate in Isolated Runtime
    // ------------------------------------------------------------------------
    log('[2/15] Generating SQL schema projection for BASE-001...');
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

    log('[3/15] Validating SQL schema in isolated PostgreSQL-compatible runtime (PGlite)...');
    const sqlValRes1 = await sqlValidatorGateway.validate(projSql1.content);
    if (!sqlValRes1.isValid) {
      throw new Error(`SQL schema validation failed on BASE-001: ${sqlValRes1.errorMessage}`);
    }
    log(`       SQL schema valid in isolated PostgreSQL runtime (${projSql1.projectionId}).`);

    // ------------------------------------------------------------------------
    // Step 4: Generate and Structurally Validate OpenAPI Projection
    // ------------------------------------------------------------------------
    log('[4/15] Generating and structurally validating OpenAPI 3.1.0 projection for BASE-001...');
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
          '  /orders/{id}:',
          '    get:',
          '      summary: Get order by ID',
          '      parameters:',
          '        - name: id',
          '          in: path',
          '          required: true',
          '          schema:',
          '            type: string',
          '            format: uuid',
          '      responses:',
          "        '200':",
          '          description: Success',
          '          content:',
          '            application/json:',
          '              schema:',
          "                $ref: '#/components/schemas/Order'",
          '    patch:',
          '      summary: Authorize payment or update order status',
          '      parameters:',
          '        - name: id',
          '          in: path',
          '          required: true',
          '          schema:',
          '            type: string',
          '            format: uuid',
          '      requestBody:',
          '        required: true',
          '        content:',
          '          application/json:',
          '            schema:',
          '              type: object',
          '              properties:',
          '                status:',
          '                  type: string',
          '                  enum: [PENDING, PAID, SHIPPED, CANCELLED]',
          '      responses:',
          "        '200':",
          '          description: Order updated',
          '          content:',
          '            application/json:',
          '              schema:',
          "                $ref: '#/components/schemas/Order'",
          'components:',
          '  schemas:',
          '    Order:',
          '      type: object',
          '      required:',
          '        - id',
          '        - customer_id',
          '        - status',
          '        - total_amount',
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
          '          format: date-time',
          '    OrderItem:',
          '      type: object',
          '      required:',
          '        - id',
          '        - order_id',
          '        - item_sku',
          '        - quantity',
          '        - unit_price',
          '        - created_at',
          '        - updated_at',
          '      properties:',
          '        id:',
          '          type: string',
          '          format: uuid',
          '        order_id:',
          '          type: string',
          '          format: uuid',
          '        item_sku:',
          '          type: string',
          '        quantity:',
          '          type: integer',
          '        unit_price:',
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
      sqlSchemaProjectionId: projSql1.projectionId,
      options: { model: options.model },
      autoRecordDiscoveries: false
    });

    const oasValRes1 = await openApiValidatorGateway.validate(projOas1.content);
    if (!oasValRes1.isValid) {
      throw new Error(`OpenAPI validation failed on BASE-001: ${oasValRes1.errorMessage}`);
    }

    // Verify OpenAPI 3.1.0 version specification
    const crossValidator = new SchemaApiCrossValidator();
    const docObj1 = (await import('yaml')).parse(projOas1.content) as Record<string, unknown>;
    const openApiVersionDeclared = docObj1.openapi as string;
    if (!/^3\.1(\.\d+)?$/.test(openApiVersionDeclared)) {
      throw new Error(
        `OpenAPI document must declare version 3.1.x, received '${openApiVersionDeclared}'`
      );
    }

    const crossValFindings1 = crossValidator.validate({
      openApiDoc: docObj1,
      sqlSchemaContent: projSql1.content,
      baseline: baselineA,
      openApiProjectionId: projOas1.projectionId,
      sqlSchemaProjectionId: projSql1.projectionId
    });
    const crossValidationPassed1 = crossValFindings1.length === 0;
    if (!crossValidationPassed1) {
      throw new Error(
        `Schema-API cross-validation failed on BASE-001: ${crossValFindings1.map((f) => f.rationale).join('; ')}`
      );
    }
    log(`       OpenAPI 3.1.0 structurally valid & cross-validated with relational schema.`);

    // ------------------------------------------------------------------------
    // Step 5: Encounter Technical Choice & Record Engineering Decision on BASE-001
    // ------------------------------------------------------------------------
    log('[5/15] Recording legitimate technical choice as EngineeringDecision (ED-001)...');
    const ed1Proposed = await recordEdUseCase.execute({
      id: 'ED-001',
      baselineId: 'BASE-001',
      statement: 'Use UUID primary keys with gen_random_uuid() default for orders and order_items.',
      rationale:
        'Enables distributed client-side ID generation while avoiding ID enumeration security risks.',
      requirementRevisionIds: ['REQ-ORD-01-R1'],
      policyConstraintRevisionIds: ['POL-SEC-01-R1'],
      createdBy: 'lead-architect'
    });

    if (ed1Proposed.state !== 'PROPOSED') {
      throw new Error(
        `EngineeringDecision initial state must be 'PROPOSED', got '${ed1Proposed.state}'`
      );
    }

    const ed1Accepted = await transitionEdUseCase.execute({
      decisionId: 'ED-001',
      newState: 'ACCEPTED',
      rationale: 'Approved by lead architect for PostgreSQL compatibility',
      actorId: 'lead-architect'
    });
    log(`       Engineering decision 'ED-001' transitioned to '${ed1Accepted.state}'.`);

    // ------------------------------------------------------------------------
    // Step 6: Encounter Missing/Ambiguous Product Decision & Record Candidate Finding
    // ------------------------------------------------------------------------
    log('[6/15] Encountering product ambiguity & recording candidate finding (FIND-001)...');
    const candidateFinding = createCandidateFinding({
      id: createFindingId('FIND-001'),
      type: 'incomplete-state-machine' as FindingType,
      disposition: 'OPEN',
      discoveredBy: 'artifact-validation',
      affectedRequirementRevisions: [createRequirementRevisionId('REQ-ORD-01-R1')],
      evidence: [],
      rationale:
        'Requirements specify lifecycle states (PENDING, PAID, SHIPPED, CANCELLED) but do not define customer cancellation rules or temporal grace windows for paid orders.',
      baselineId: createRequirementsBaselineId('BASE-001'),
      originatingProjectionId: projOas1.projectionId
    });
    await repo.saveCandidateFinding(candidateFinding);
    log(`       Recorded candidate finding '${candidateFinding.id}' in state 'OPEN'.`);

    // ------------------------------------------------------------------------
    // Step 7: Prove Story Readiness & Handoff Fail Closed While Finding is OPEN
    // ------------------------------------------------------------------------
    log('[7/15] Proving Story Readiness & Engineering Handoff fail closed on product ambiguity...');
    const candidateStoryGherkin = [
      '# @baseline: BASE-001',
      '# @requirements: REQ-ORD-01-R1',
      '# @policy-constraints: POL-SEC-01-R1',
      'Feature: Candidate Order Processing',
      '  As a Customer',
      '  I want to create orders',
      '  So that I can purchase items',
      '',
      '  @requirements:REQ-ORD-01-R1 @policy-constraints:POL-SEC-01-R1',
      '  Scenario: Customer creates an order',
      '    Given a customer with ID "CUST-100"',
      '    When the customer places an order with item "SKU-99"',
      '    Then the order status should be "PENDING"'
    ].join('\n');

    const candidateStoryHash = createHash('sha256').update(candidateStoryGherkin).digest('hex');
    const candidateProjId = 'PROJ-STORY-ORD-001-CANDIDATE';

    const candidateProjRecord: ProjectionRecord = {
      id: candidateProjId,
      baselineId: createRequirementsBaselineId('BASE-001'),
      requirementRevisionIds: [
        createRequirementRevisionId('REQ-ORD-01-R1'),
        createRequirementRevisionId('REQ-ORD-02-R1')
      ],
      policyConstraintRevisionIds: [createPolicyConstraintRevisionId('POL-SEC-01-R1')],
      artifactType: 'stories',
      content: candidateStoryGherkin,
      metadata: {
        baselineId: 'BASE-001',
        requirementRevisionIds: ['REQ-ORD-01-R1', 'REQ-ORD-02-R1'],
        policyConstraintRevisionIds: ['POL-SEC-01-R1'],
        artifactType: 'stories',
        declaredProvenance: {
          baselineId: 'BASE-001',
          requirementRevisionIds: ['REQ-ORD-01-R1'],
          policyConstraintRevisionIds: ['POL-SEC-01-R1']
        },
        configuredExecution: {
          provider,
          model: options.model,
          artifactType: 'stories'
        },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: candidateStoryHash,
          verifiedAt: now()
        }
      },
      createdAt: now()
    };
    await repo.saveProjectionRecord(candidateProjRecord);

    const candidateStoryRecord: StoryRecord = {
      id: createStoryId('STORY-ORD-001-CANDIDATE'),
      baselineId: createRequirementsBaselineId('BASE-001'),
      projectionId: candidateProjId,
      title: 'Candidate Order Processing',
      narrative: {
        role: 'Customer',
        feature: 'Candidate Order Processing',
        benefit: 'I can purchase items'
      },
      requirementRevisionIds: [createRequirementRevisionId('REQ-ORD-01-R1')],
      policyConstraintRevisionIds: [createPolicyConstraintRevisionId('POL-SEC-01-R1')],
      scenarios: [
        {
          id: 'SCENARIO-1',
          title: 'Customer creates an order',
          requirementRevisionIds: [createRequirementRevisionId('REQ-ORD-01-R1')],
          policyConstraintRevisionIds: [createPolicyConstraintRevisionId('POL-SEC-01-R1')],
          steps: [
            { keyword: 'Given', text: 'a customer with ID "CUST-100"' },
            { keyword: 'When', text: 'the customer places an order with item "SKU-99"' },
            { keyword: 'Then', text: 'the order status should be "PENDING"' }
          ],
          rawText:
            'Scenario: Customer creates an order\n  Given a customer with ID "CUST-100"\n  When the customer places an order with item "SKU-99"\n  Then the order status should be "PENDING"'
        }
      ],
      acceptanceCriteria: ['Order status must be PENDING upon creation.'],
      gherkinText: candidateStoryGherkin,
      metadata: candidateProjRecord.metadata,
      dependencies: [],
      createdAt: now()
    };
    await repo.saveStory(candidateStoryRecord);

    const readinessReportCandidate = await evaluateReadinessUseCase.execute({
      storyId: 'STORY-ORD-001-CANDIDATE'
    });

    const hasBlockingRuleFailure = readinessReportCandidate.failures.some(
      (f) => f.ruleId === 'no-blocking-open-findings'
    );
    const readinessFailedClosed =
      readinessReportCandidate.isReady === false &&
      readinessReportCandidate.status === 'not-ready' &&
      hasBlockingRuleFailure;

    if (!readinessFailedClosed) {
      throw new Error(
        'Story readiness gate failed to fail closed while candidate finding was OPEN.'
      );
    }

    const handoffBundleA = await handoffBundleUseCase.execute({ baselineId: 'BASE-001' });
    const handoffBlocked =
      handoffBundleA.summary.isHandoffReady === false &&
      handoffBundleA.summary.openBlockingFindings === 1;

    if (!handoffBlocked) {
      throw new Error(
        'Engineering handoff bundle failed to fail closed while candidate finding was OPEN.'
      );
    }
    log('       Verified Story Readiness & Handoff Bundle fail closed on open product ambiguity.');

    // Snapshot all predecessor artifacts before reconciliation & successor generation
    const predecessorFilesToSnapshot = [
      'baselines/BASE-001.json',
      'engineering-decisions/ED-001.json',
      'stories/STORY-ORD-001-CANDIDATE.json',
      `projections/${projSql1.projectionId}.json`,
      `projections/${projOas1.projectionId}.json`,
      `projections/${candidateProjId}.json`
    ];

    const predecessorSnapshots: Record<string, { path: string; content: string; sha256: string }> =
      {};
    for (const relPath of predecessorFilesToSnapshot) {
      const fullPath = path.resolve(storeDir, relPath);
      const rawContent = await fs.readFile(fullPath, 'utf8');
      const sha256 = createHash('sha256').update(rawContent).digest('hex');
      predecessorSnapshots[relPath] = { path: relPath, content: rawContent, sha256 };
    }

    // ------------------------------------------------------------------------
    // Step 8: Human Authority Reconciliation & Successor Baseline (BASE-002)
    // ------------------------------------------------------------------------
    log('[8/15] Reconciling product ambiguity & advancing requirement lineage to BASE-002...');
    await reconcileUseCase.dispositionFinding({
      findingId: 'FIND-001',
      disposition: 'RESOLVED',
      rationale:
        'Product confirms paid orders may be self-cancelled by the customer within 24 hours of payment authorization.',
      actorId: 'product-lead'
    });

    const revisedReq = await reconcileUseCase.reviseRequirement({
      revisionId: 'REQ-ORD-01-R1',
      statement:
        'Orders must record customer ID, line items, and lifecycle status (PENDING, PAID, SHIPPED, CANCELLED). Customers may self-cancel orders within 24 hours of payment authorization.',
      rationale: 'Clarified 24-hour customer cancellation window for paid orders.',
      actorId: 'product-lead'
    });

    const acceptedReq = await reconcileUseCase.acceptRequirement({
      revisionId: revisedReq.id,
      rationale: 'Accepted clarified cancellation specification',
      actorId: 'product-lead'
    });

    const resolvedReq = await reconcileUseCase.resolveRequirement({
      revisionId: acceptedReq.id,
      rationale: 'Cancellation rules and grace windows verified clear with SMEs',
      actorId: 'product-lead'
    });

    const resolvedRevisionId = resolvedReq.id;

    const baselineB = await baselineUseCase.create({
      id: createRequirementsBaselineId('BASE-002'),
      requirementRevisionIds: [resolvedRevisionId, 'REQ-ORD-02-R1'],
      policyConstraintRevisionIds: ['POL-SEC-01-R1'],
      createdBy: createReviewerId('lead-architect')
    });
    log(
      `       Frozen successor baseline 'BASE-002' with resolved revision '${resolvedRevisionId}'.`
    );

    // ------------------------------------------------------------------------
    // Step 9: Establish Successor Decision & Regenerate Contracts Bound to BASE-002
    // ------------------------------------------------------------------------
    log('[9/15] Recording successor decision ED-002 & regenerating contracts for BASE-002...');
    const ed2Proposed = await recordEdUseCase.execute({
      id: 'ED-002',
      baselineId: 'BASE-002',
      statement: 'Use UUID primary keys with gen_random_uuid() default for orders and order_items.',
      rationale:
        'Enables distributed client-side ID generation while avoiding ID enumeration security risks.',
      requirementRevisionIds: [resolvedRevisionId],
      policyConstraintRevisionIds: ['POL-SEC-01-R1'],
      createdBy: 'lead-architect',
      supersedes: 'ED-001'
    });

    const ed2Accepted = await transitionEdUseCase.execute({
      decisionId: 'ED-002',
      newState: 'ACCEPTED',
      rationale: 'Carried forward accepted UUID primary key architecture for successor baseline',
      actorId: 'lead-architect'
    });

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

    const sqlValRes2 = await sqlValidatorGateway.validate(projSql2.content);
    if (!sqlValRes2.isValid) {
      throw new Error(`SQL schema validation failed on BASE-002: ${sqlValRes2.errorMessage}`);
    }

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
          '  /orders/{id}:',
          '    get:',
          '      summary: Get order by ID',
          '      parameters:',
          '        - name: id',
          '          in: path',
          '          required: true',
          '          schema:',
          '            type: string',
          '            format: uuid',
          '      responses:',
          "        '200':",
          '          description: Success',
          '          content:',
          '            application/json:',
          '              schema:',
          "                $ref: '#/components/schemas/Order'",
          '    patch:',
          '      summary: Authorize payment or cancel order within 24-hour window',
          '      parameters:',
          '        - name: id',
          '          in: path',
          '          required: true',
          '          schema:',
          '            type: string',
          '            format: uuid',
          '      requestBody:',
          '        required: true',
          '        content:',
          '          application/json:',
          '            schema:',
          '              type: object',
          '              properties:',
          '                status:',
          '                  type: string',
          '                  enum: [PENDING, PAID, SHIPPED, CANCELLED]',
          '                cancelled_at:',
          '                  type: string',
          '                  format: date-time',
          '      responses:',
          "        '200':",
          '          description: Order updated',
          '          content:',
          '            application/json:',
          '              schema:',
          "                $ref: '#/components/schemas/Order'",
          'components:',
          '  schemas:',
          '    Order:',
          '      type: object',
          '      required:',
          '        - id',
          '        - customer_id',
          '        - status',
          '        - total_amount',
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
          '          format: date-time',
          '    OrderItem:',
          '      type: object',
          '      required:',
          '        - id',
          '        - order_id',
          '        - item_sku',
          '        - quantity',
          '        - unit_price',
          '        - created_at',
          '        - updated_at',
          '      properties:',
          '        id:',
          '          type: string',
          '          format: uuid',
          '        order_id:',
          '          type: string',
          '          format: uuid',
          '        item_sku:',
          '          type: string',
          '        quantity:',
          '          type: integer',
          '        unit_price:',
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

    const projOas2 = await generateOpenApiUseCase.execute({
      baselineId: 'BASE-002',
      sqlSchemaProjectionId: projSql2.projectionId,
      engineeringDecisionIds: ['ED-002'],
      options: { model: options.model },
      autoRecordDiscoveries: false
    });

    const oasValRes2 = await openApiValidatorGateway.validate(projOas2.content);
    if (!oasValRes2.isValid) {
      throw new Error(`OpenAPI validation failed on BASE-002: ${oasValRes2.errorMessage}`);
    }

    const docObj2 = (await import('yaml')).parse(projOas2.content) as Record<string, unknown>;
    const crossValFindings2 = crossValidator.validate({
      openApiDoc: docObj2,
      sqlSchemaContent: projSql2.content,
      baseline: baselineB,
      openApiProjectionId: projOas2.projectionId,
      sqlSchemaProjectionId: projSql2.projectionId
    });
    const crossValidationPassed2 = crossValFindings2.length === 0;
    if (!crossValidationPassed2) {
      throw new Error(
        `Schema-API cross-validation failed on BASE-002: ${crossValFindings2.map((f) => f.rationale).join('; ')}`
      );
    }
    log(`       Regenerated SQL & OpenAPI 3.1.0 contracts bound cleanly to BASE-002 & ED-002.`);

    // ------------------------------------------------------------------------
    // Step 10: Generate Traceable Gherkin Stories Bound to BASE-002
    // ------------------------------------------------------------------------
    log('[10/15] Generating traceable Gherkin stories bound to BASE-002...');
    const story1Gherkin = [
      '# @baseline: BASE-002',
      '# @engineering-decisions: ED-002',
      'Feature: Order Creation and Checkout',
      '  As a Customer',
      '  I want to create an order with line items',
      '  So that I can purchase items securely',
      '',
      `  @requirements:${resolvedRevisionId} @policy-constraints:POL-SEC-01-R1`,
      '  Scenario: Customer creates order with line items',
      '    Given a registered customer with ID "CUST-001"',
      '    When the customer submits an order with valid line items',
      '    Then the order is created with status "PENDING"',
      '    And created_at and updated_at audit timestamps are recorded'
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

    const storyProj2 = await generateStoriesUseCase.execute({
      baselineId: 'BASE-002',
      id: 'STORY-002',
      engineeringDecisionIds: ['ED-002'],
      options: { model: options.model },
      autoRecordDiscoveries: false
    });

    // Configure dependency: STORY-002 depends on STORY-001
    await updateStoryDepsUseCase.execute({
      storyId: 'STORY-002',
      dependencies: ['STORY-001']
    });

    const story1Validation = await gherkinValidatorGateway.validate(storyProj1.content);
    const story2Validation = await gherkinValidatorGateway.validate(storyProj2.content);
    if (!story1Validation.isValid || !story2Validation.isValid) {
      throw new Error('Gherkin story validation failed for generated stories.');
    }

    // Verify observed identities across all generated projections
    const observedIdentities = [
      { projectionId: projSql1.projectionId, artifactType: 'sql-schema', p: projSql1 },
      { projectionId: projOas1.projectionId, artifactType: 'openapi', p: projOas1 },
      { projectionId: projSql2.projectionId, artifactType: 'sql-schema', p: projSql2 },
      { projectionId: projOas2.projectionId, artifactType: 'openapi', p: projOas2 },
      { projectionId: storyProj1.projectionId, artifactType: 'stories', p: storyProj1 },
      { projectionId: storyProj2.projectionId, artifactType: 'stories', p: storyProj2 }
    ].map(({ projectionId, artifactType, p }) => {
      const artProvider = p.metadata.configuredExecution?.provider;
      const artModel = p.metadata.configuredExecution?.model;
      if (artProvider !== provider) {
        throw new Error(
          `Observed provider mismatch on projection '${projectionId}': expected '${provider}', observed '${artProvider}'`
        );
      }
      if (options.model && artModel !== options.model) {
        throw new Error(
          `Observed model mismatch on projection '${projectionId}': expected '${options.model}', observed '${artModel}'`
        );
      }
      return {
        projectionId,
        artifactType,
        provider: artProvider,
        model: artModel
      };
    });

    log(`       Generated and validated Gherkin stories STORY-001 and STORY-002.`);

    // ------------------------------------------------------------------------
    // Step 11: Compute Deterministic Requirement Coverage
    // ------------------------------------------------------------------------
    log('[11/15] Computing deterministic requirement coverage for BASE-002...');
    const coverage = await computeCoverageUseCase.execute({ baselineId: 'BASE-002' });
    if (!coverage.isFullyCovered || coverage.uncoveredCount !== 0) {
      throw new Error(
        `Coverage gate failed: ${coverage.coveredCount}/${coverage.totalRequirements} requirements covered.`
      );
    }
    log(
      `       Coverage: 100% (${coverage.coveredCount}/${coverage.totalRequirements} requirements covered).`
    );

    // ------------------------------------------------------------------------
    // Step 12: Compute Deterministic Story Readiness
    // ------------------------------------------------------------------------
    log('[12/15] Computing deterministic story readiness for BASE-002...');
    const readinessReports = await evaluateReadinessUseCase.executeForBaseline('BASE-002');
    const allStoriesReady =
      readinessReports.length === 2 &&
      readinessReports.every((r) => r.isReady && r.status === 'implementation-ready');
    if (!allStoriesReady) {
      throw new Error(
        `Story readiness evaluation failed. Non-ready stories: ${readinessReports
          .filter((r) => !r.isReady)
          .map((r) => r.storyId)
          .join(', ')}`
      );
    }
    log('       Readiness: 2/2 stories implementation-ready (0 rule failures).');

    // ------------------------------------------------------------------------
    // Step 13: Build & Validate Story Dependency Graph
    // ------------------------------------------------------------------------
    log('[13/15] Building & validating machine-readable story dependency graph...');
    const depGraph = await buildDependencyGraphUseCase.execute({
      baselineId: 'BASE-002',
      includeReadiness: true
    });
    if (!depGraph.isAcyclic || !depGraph.validation.isValid) {
      throw new Error('Story dependency graph validation failed: cycle or invalid edges detected.');
    }
    log(
      `       Dependency graph: valid acyclic DAG (${depGraph.nodes.length} nodes, ${depGraph.edges.length} edges).`
    );

    // ------------------------------------------------------------------------
    // Step 14: Verify Final Engineering-Handoff State is Implementation-Ready
    // ------------------------------------------------------------------------
    log('[14/15] Verifying complete implementation-ready engineering handoff bundle...');
    const handoffBundleB = await handoffBundleUseCase.execute({ baselineId: 'BASE-002' });
    if (!handoffBundleB.summary.isHandoffReady) {
      throw new Error('Engineering handoff bundle summary indicated handoff is not ready.');
    }
    if (handoffBundleB.summary.openBlockingFindings !== 0) {
      throw new Error(
        `Handoff bundle reported ${handoffBundleB.summary.openBlockingFindings} open blocking findings.`
      );
    }
    if (handoffBundleB.summary.readyStories !== 2) {
      throw new Error(
        `Handoff bundle readyStories expected 2, got ${handoffBundleB.summary.readyStories}.`
      );
    }

    const ed2InBundle = handoffBundleB.engineeringDecisions.find((d) => d.id === 'ED-002');
    if (!ed2InBundle || ed2InBundle.state !== 'ACCEPTED') {
      throw new Error(
        'Successor engineering decision ED-002 missing or unaccepted in handoff bundle.'
      );
    }

    // Verify SHA-256 cryptographic hashes for SQL, OpenAPI, and both Story projections
    const sqlHashVerified =
      Boolean(handoffBundleB.sqlProjection?.metadata?.measuredVerification?.contentHash) &&
      createHash('sha256').update(handoffBundleB.sqlProjection!.content).digest('hex') ===
        handoffBundleB.sqlProjection!.metadata.measuredVerification.contentHash;
    const oasHashVerified =
      Boolean(handoffBundleB.openApiProjection?.metadata?.measuredVerification?.contentHash) &&
      createHash('sha256').update(handoffBundleB.openApiProjection!.content).digest('hex') ===
        handoffBundleB.openApiProjection!.metadata.measuredVerification.contentHash;

    const story1ProjRecord = await repo.getProjectionRecord(storyProj1.projectionId);
    const story2ProjRecord = await repo.getProjectionRecord(storyProj2.projectionId);

    if (!story1ProjRecord || !story2ProjRecord) {
      throw new Error('Could not retrieve story projection records for hash verification');
    }

    const story1Hash = createHash('sha256').update(story1ProjRecord.content).digest('hex');
    const story2Hash = createHash('sha256').update(story2ProjRecord.content).digest('hex');

    const story1HashVerified =
      Boolean(story1ProjRecord.metadata?.measuredVerification?.contentHash) &&
      story1Hash === story1ProjRecord.metadata.measuredVerification.contentHash;

    const story2HashVerified =
      Boolean(story2ProjRecord.metadata?.measuredVerification?.contentHash) &&
      story2Hash === story2ProjRecord.metadata.measuredVerification.contentHash;

    const contentHashesVerified =
      sqlHashVerified && oasHashVerified && story1HashVerified && story2HashVerified;

    if (!contentHashesVerified) {
      throw new Error(
        `Cryptographic content hash verification failed: SQL=${sqlHashVerified}, OAS=${oasHashVerified}, Story1=${story1HashVerified}, Story2=${story2HashVerified}`
      );
    }
    log('       Engineering handoff bundle verified implementation-ready.');

    // ------------------------------------------------------------------------
    // Step 15: Verify Predecessor Immutability & Process-Restart Durability
    // ------------------------------------------------------------------------
    log('[15/15] Verifying predecessor immutability & process-restart durability...');

    // Adversarial mutation hook for testing failure when predecessor content changes
    if (options.adversarialMutatePredecessor) {
      const targetPath = path.resolve(storeDir, 'engineering-decisions/ED-001.json');
      const current = JSON.parse(await fs.readFile(targetPath, 'utf8'));
      current.statement = 'MUTATED STATEMENT (ADVERSARIAL)';
      await fs.writeFile(targetPath, JSON.stringify(current, null, 2), 'utf8');
    }

    const childWorkerCode = `
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const storeDir = process.argv[1];
const relPaths = JSON.parse(process.argv[2]);
const fileResults = {};

for (const rel of relPaths) {
  const full = path.resolve(storeDir, rel);
  if (!fs.existsSync(full)) {
    fileResults[rel] = { exists: false };
    continue;
  }
  const content = fs.readFileSync(full, 'utf8');
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  fileResults[rel] = { exists: true, content, sha256 };
}

let duplicateRejected = false;
try {
  const base1Path = path.resolve(storeDir, 'baselines', 'BASE-001.json');
  fs.writeFileSync(base1Path, fs.readFileSync(base1Path), { flag: 'wx' });
} catch (err) {
  if (err.code === 'EEXIST') {
    duplicateRejected = true;
  }
}

process.stdout.write(JSON.stringify({
  pid: process.pid,
  fileResults,
  duplicateRejected
}));
`;

    const childResult = cp.spawnSync(
      process.execPath,
      ['-e', childWorkerCode, storeDir, JSON.stringify(Object.keys(predecessorSnapshots))],
      { encoding: 'utf8' }
    );

    if (childResult.status !== 0) {
      throw new Error(`Child process failed during reload verification: ${childResult.stderr}`);
    }

    let parsedChildOutput: {
      pid: number;
      fileResults: Record<string, { exists: boolean; content?: string; sha256?: string }>;
      duplicateRejected: boolean;
    };

    try {
      parsedChildOutput = JSON.parse(childResult.stdout.trim());
    } catch {
      throw new Error(`Failed to parse child process output: ${childResult.stdout}`);
    }

    if (parsedChildOutput.pid === process.pid) {
      throw new Error('Process separation failed: child process had same PID as parent!');
    }

    for (const [relPath, snapshot] of Object.entries(predecessorSnapshots)) {
      const reloaded = parsedChildOutput.fileResults[relPath];
      if (!reloaded || !reloaded.exists) {
        throw new Error(
          `Historical immutability violation: Predecessor file '${relPath}' was deleted or missing after reload!`
        );
      }
      if (reloaded.sha256 !== snapshot.sha256) {
        throw new Error(
          `Historical immutability violation: Predecessor file '${relPath}' SHA-256 hash mismatch! Expected '${snapshot.sha256}', reloaded '${reloaded.sha256}'`
        );
      }
      if (reloaded.content !== snapshot.content) {
        throw new Error(
          `Historical immutability violation: Predecessor file '${relPath}' content was modified byte-for-byte!`
        );
      }
    }

    const reloadedRepo = new FilesystemRequirementsRepository({ baseDir: storeDir });
    const reloadedBaselineA = await reloadedRepo.getRequirementsBaseline(
      createRequirementsBaselineId('BASE-001')
    );

    if (!reloadedBaselineA) {
      throw new Error("Failed to reload predecessor baseline 'BASE-001' from disk.");
    }

    const baselineAUntouched =
      reloadedBaselineA.id === 'BASE-001' &&
      reloadedBaselineA.requirementRevisions.length === 2 &&
      reloadedBaselineA.requirementRevisions.includes(
        createRequirementRevisionId('REQ-ORD-01-R1')
      ) &&
      reloadedBaselineA.requirementRevisions.includes(
        createRequirementRevisionId('REQ-ORD-02-R1')
      ) &&
      (reloadedBaselineA.policyConstraintRevisions ?? []).includes(
        createPolicyConstraintRevisionId('POL-SEC-01-R1')
      );

    let duplicateRejected = false;
    try {
      await reloadedRepo.saveRequirementsBaseline(reloadedBaselineA);
    } catch (err) {
      if (err instanceof ImmutableRecordConflictError) {
        duplicateRejected = true;
      }
    }

    const base1Projs = await reloadedRepo.listProjectionRecords(
      createRequirementsBaselineId('BASE-001')
    );
    const predecessorProjectionsIsolated =
      base1Projs.length >= 3 && base1Projs.every((p) => p.baselineId === 'BASE-001');

    const reloadedEd1 = await reloadedRepo.getEngineeringDecision(
      createEngineeringDecisionId('ED-001')
    );
    const reloadedCandidateStory = await reloadedRepo.getStory(
      createStoryId('STORY-ORD-001-CANDIDATE')
    );

    const restartReloadDurabilityVerified =
      baselineAUntouched &&
      duplicateRejected &&
      predecessorProjectionsIsolated &&
      Boolean(
        reloadedEd1 && reloadedEd1.state === 'ACCEPTED' && reloadedEd1.baselineId === 'BASE-001'
      ) &&
      Boolean(reloadedCandidateStory && reloadedCandidateStory.baselineId === 'BASE-001');

    if (!restartReloadDurabilityVerified) {
      throw new Error('Immutability and durability verification failed across process restart.');
    }
    log(
      `       Predecessor baseline BASE-001, ED-001, candidate story, and ${Object.keys(predecessorSnapshots).length} predecessor artifacts verified bit-identical across separate process reload (PID: ${parsedChildOutput.pid}).`
    );

    log('\n========================================================================');
    log('Phase 3 Exit Gate PASSED: Full Engineering Handoff Verified End-to-End');
    log('========================================================================\n');

    return {
      success: true,
      executionMode,
      provider,
      model: options.model,
      gitCommitSha,
      cleanWorktreeVerified,
      observedIdentities,
      runId,
      timestamp,
      startingBaseline: {
        id: baselineA.id,
        requirementRevisions: [...baselineA.requirementRevisions],
        policyConstraintRevisions: [...(baselineA.policyConstraintRevisions ?? [])]
      },
      successorBaseline: {
        id: baselineB.id,
        requirementRevisions: [...baselineB.requirementRevisions],
        policyConstraintRevisions: [...(baselineB.policyConstraintRevisions ?? [])]
      },
      sqlValidationOutcome: {
        projectionAId: projSql1.projectionId,
        projectionBId: projSql2.projectionId,
        isValid: sqlValRes1.isValid && sqlValRes2.isValid,
        repairsNeededA: projSql1.metadata.measuredVerification.repairsNeeded,
        repairsNeededB: projSql2.metadata.measuredVerification.repairsNeeded
      },
      openApiValidationOutcome: {
        projectionAId: projOas1.projectionId,
        projectionBId: projOas2.projectionId,
        openApiVersion: '3.1.0',
        isValid: oasValRes1.isValid && oasValRes2.isValid,
        crossValidationPassed: crossValidationPassed1 && crossValidationPassed2,
        repairsNeededA: projOas1.metadata.measuredVerification.repairsNeeded,
        repairsNeededB: projOas2.metadata.measuredVerification.repairsNeeded
      },
      initialEngineeringDecision: {
        id: ed1Accepted.id,
        statement: ed1Accepted.statement,
        rationale: ed1Accepted.rationale,
        baselineId: ed1Accepted.baselineId,
        state: ed1Accepted.state as 'ACCEPTED',
        initialStartingState: ed1Proposed.state as 'PROPOSED'
      },
      discoveryAndReadinessGate: {
        candidateFindingId: candidateFinding.id,
        findingType: candidateFinding.type as 'incomplete-state-machine',
        initialDisposition: candidateFinding.disposition as 'OPEN',
        candidateStoryId: 'STORY-ORD-001-CANDIDATE',
        readinessFailedClosed,
        blockingRuleId: 'no-blocking-open-findings',
        handoffBlocked
      },
      reconciliation: {
        findingDisposition: 'RESOLVED',
        findingRationale:
          'Product confirms paid orders may be self-cancelled by the customer within 24 hours of payment authorization.',
        revisedRevisionId: revisedReq.id,
        acceptedRevisionId: acceptedReq.id,
        resolvedRevisionId,
        finalReviewState: resolvedReq.reviewState as 'ACCEPTED',
        finalResolutionState: resolvedReq.resolutionState as 'CLEAR',
        actorId: 'product-lead'
      },
      successorEngineeringDecision: {
        id: ed2Accepted.id,
        statement: ed2Accepted.statement,
        rationale: ed2Accepted.rationale,
        baselineId: ed2Accepted.baselineId,
        supersedes: ed2Accepted.supersedes!,
        state: ed2Accepted.state as 'ACCEPTED',
        initialStartingState: ed2Proposed.state as 'PROPOSED'
      },
      storiesOutcome: {
        count: 2,
        storyIds: ['STORY-001', 'STORY-002'],
        allTraceable: true,
        gherkinValid: story1Validation.isValid && story2Validation.isValid,
        repairsNeededStory1: storyProj1.metadata.measuredVerification.repairsNeeded,
        repairsNeededStory2: storyProj2.metadata.measuredVerification.repairsNeeded,
        repairsNeeded: {
          'STORY-001': storyProj1.metadata.measuredVerification.repairsNeeded,
          'STORY-002': storyProj2.metadata.measuredVerification.repairsNeeded
        },
        projectionHashes: {
          'STORY-001': story1Hash,
          'STORY-002': story2Hash
        }
      },
      coverageOutcome: {
        totalRequirements: coverage.totalRequirements,
        coveredCount: coverage.coveredCount,
        uncoveredCount: coverage.uncoveredCount,
        isFullyCovered: coverage.isFullyCovered
      },
      finalReadinessOutcome: {
        allStoriesReady,
        readyCount: readinessReports.filter((r) => r.isReady).length,
        nonReadyCount: readinessReports.filter((r) => !r.isReady).length
      },
      dependencyGraphOutcome: {
        isAcyclic: depGraph.isAcyclic,
        isValid: depGraph.validation.isValid,
        nodeCount: depGraph.nodes.length,
        edgeCount: depGraph.edges.length
      },
      handoffBundle: {
        isHandoffReady: handoffBundleB.summary.isHandoffReady,
        summary: handoffBundleB.summary,
        contentHashesVerified,
        engineeringDecisionsCount: handoffBundleB.engineeringDecisions.length,
        hashes: {
          sql: handoffBundleB.sqlProjection!.metadata.measuredVerification.contentHash!,
          openApi: handoffBundleB.openApiProjection!.metadata.measuredVerification.contentHash!,
          story1: story1Hash,
          story2: story2Hash
        }
      },
      immutabilityVerification: {
        baselineAUntouched,
        duplicateBaselineOverwriteRejected: duplicateRejected,
        predecessorProjectionsIsolated,
        restartReloadDurabilityVerified,
        predecessorSnapshotsVerified: true,
        reloadedProcessPid: parsedChildOutput.pid,
        snapshotCount: Object.keys(predecessorSnapshots).length
      },
      storeDir
    };
  } finally {
    if (isTempStore && options.cleanup !== false) {
      await fs.rm(storeDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
