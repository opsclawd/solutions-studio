import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createSourceId,
  createSourceRevisionId,
  createReviewerId,
  createRequirementsBaselineId,
  createActorId,
  createEvidenceLocator,
  type RequirementsBaseline,
  type RequirementRevisionId,
  type FindingId,
  type FindingDisposition
} from '@solutions-studio/domain';
import type { EvaluationReportDto } from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import type {
  IRequirementsRepository,
  EvaluationRunRecord
} from '../ports/persistence/IRequirementsRepository.js';
import type {
  IGenerationGateway,
  GenerationResult
} from '../ports/generation/IGenerationGateway.js';
import type { IMermaidLinterGateway } from '../ports/validation/IMermaidLinterGateway.js';
import { CompileRequirementsUseCase } from '../use-cases/CompileRequirementsUseCase.js';
import { ReconcileRequirementsUseCase } from '../use-cases/ReconcileRequirementsUseCase.js';
import { CreateRequirementsBaselineUseCase } from '../use-cases/CreateRequirementsBaselineUseCase.js';
import { GenerateArtifactUseCase } from '../use-cases/GenerateArtifactUseCase.js';
import {
  ProjectBaselineUseCase,
  type BaselineProjectionResult
} from '../use-cases/ProjectBaselineUseCase.js';
import { BlockedByOpenFindingsError } from '../use-cases/ReconciliationErrors.js';
import { loadFixture as defaultLoadFixture } from '../../infrastructure/evaluation/loadFixture.js';
import type { LoadedFixture } from '../evaluation/ports.js';
import { runEvaluation } from '../../infrastructure/evaluation/runEvaluation.js';

export interface RequirementReconciliationPlanEntry {
  readonly requirementKey: string;
  readonly action: 'ACCEPT_AND_CLEAR' | 'REJECT';
  readonly acceptRationale?: string;
  readonly clearRationale?: string;
  readonly rejectRationale?: string;
  readonly actorId: string;
}

export interface FindingReconciliationPlanEntry {
  readonly findingKey: string;
  readonly disposition: FindingDisposition;
  readonly rationale: string;
  readonly actorId: string;
}

/**
 * Explicit fixture-owned deterministic reconciliation plan for canonical-messy-discovery-package.
 * Represents synthetic human decisions addressing all planted defects.
 */
export const CANONICAL_REQUIREMENT_RECONCILIATION_PLAN: readonly RequirementReconciliationPlanEntry[] =
  [
    {
      requirementKey: 'REQ-MESSY-THRESH-1',
      action: 'ACCEPT_AND_CLEAR',
      acceptRationale:
        'CEO sign-off threshold verified against corporate financial authority matrix',
      clearRationale:
        'Threshold ambiguity cleared: corporate policy confirms CEO sign-off mandatory for purchases exceeding $50k',
      actorId: 'CFO-DESIGNEE'
    },
    {
      requirementKey: 'REQ-MESSY-THRESH-2',
      action: 'REJECT',
      rejectRationale:
        'Rejected contradictory procurement clause permitting unapproved $100k purchases without CEO sign-off',
      actorId: 'CFO-DESIGNEE'
    },
    {
      requirementKey: 'REQ-MESSY-AUTH-01',
      action: 'ACCEPT_AND_CLEAR',
      acceptRationale: 'Emergency shutdown control verified per industrial safety directive',
      clearRationale:
        'Plant floor life-safety policy confirmed immediate operator intervention overrides standard administrative role gates',
      actorId: 'SAFETY-DIR-01'
    },
    {
      requirementKey: 'REQ-MESSY-STATE-01',
      action: 'ACCEPT_AND_CLEAR',
      acceptRationale:
        'Telemetry batch processing lifecycle verified against data pipeline specification',
      clearRationale:
        'Added terminal error transition to lifecycle definition to close open-state gap',
      actorId: 'DATA-ARCH-01'
    },
    {
      requirementKey: 'REQ-MESSY-ALERT-01',
      action: 'ACCEPT_AND_CLEAR',
      acceptRationale:
        'Telco HTTP alert dispatch verified as primary outbound notification channel',
      clearRationale:
        'Alert delivery failure recovery policy attached (retry with exponential backoff and DLQ routing)',
      actorId: 'OPS-LEAD-01'
    },
    {
      requirementKey: 'REQ-MESSY-TIME-01',
      action: 'ACCEPT_AND_CLEAR',
      acceptRationale: 'Archival compression requirement verified for telemetry retention',
      clearRationale:
        'Temporal ambiguity resolved: execution schedule pinned to 02:00 UTC with memory headroom threshold',
      actorId: 'DBA-LEAD-01'
    },
    {
      requirementKey: 'REQ-MESSY-CARD-01',
      action: 'ACCEPT_AND_CLEAR',
      acceptRationale: 'Multi-tagging capability verified for compliance categorizations',
      clearRationale:
        'Cardinality limits bounded: maximum 10 retention tags and 5 regulatory classifications per record',
      actorId: 'COMPLIANCE-LEAD-01'
    },
    {
      requirementKey: 'REQ-MESSY-ASSUME-01',
      action: 'ACCEPT_AND_CLEAR',
      acceptRationale:
        'Ingestion pipeline external throughput requirement verified as critical integration dependency',
      clearRationale:
        'Vendor SLA bounded: maximum sustained throughput rated at 50,000 QPS with circuit-breaker fallback',
      actorId: 'SRE-ARCH-01'
    },
    {
      requirementKey: 'REQ-MESSY-SUPER-R2',
      action: 'ACCEPT_AND_CLEAR',
      acceptRationale: '30-day contractor access cap verified per current SOP revision 2',
      clearRationale: 'Superseded R1 90-day access provision explicitly retired',
      actorId: 'SEC-ADMIN-01'
    },
    {
      requirementKey: 'REQ-MESSY-SRE-CHAT',
      action: 'REJECT',
      rejectRationale:
        'Rejected informal team chat credential sharing practice; directly violates corporate secret custody policy',
      actorId: 'CISO-OFFICE-01'
    },
    {
      requirementKey: 'REQ-MESSY-SEC-POLICY',
      action: 'ACCEPT_AND_CLEAR',
      acceptRationale:
        'Centralized HSM-backed Secrets Manager requirement accepted per enterprise security policy',
      clearRationale:
        'Enterprise credential handling verified compliant with ISO/IEC 27001 control standards',
      actorId: 'CISO-OFFICE-01'
    },
    {
      requirementKey: 'REQ-MESSY-SLA-SILVER',
      action: 'ACCEPT_AND_CLEAR',
      acceptRationale: 'Silver Support tier SLA (24h response) accepted per service contract',
      clearRationale: 'Silver tier SLA verified distinct from Gold tier (no conflict)',
      actorId: 'SUPPORT-VP-01'
    },
    {
      requirementKey: 'REQ-MESSY-SLA-GOLD',
      action: 'ACCEPT_AND_CLEAR',
      acceptRationale: 'Gold Support tier SLA (4h response) accepted per premium service contract',
      clearRationale: 'Gold tier SLA verified distinct from Silver tier (no conflict)',
      actorId: 'SUPPORT-VP-01'
    }
  ];

export const CANONICAL_FINDING_RECONCILIATION_PLAN: readonly FindingReconciliationPlanEntry[] = [
  {
    findingKey: 'FINDING-MESSY-THRESH',
    disposition: 'RESOLVED',
    rationale:
      'Contradictory approval thresholds resolved: CEO sign-off strictly mandated above $50k; conflicting $100k clause rejected',
    actorId: 'CFO-DESIGNEE'
  },
  {
    findingKey: 'FINDING-MESSY-AUTH-CONFLICT',
    disposition: 'RESOLVED',
    rationale:
      'Source authority conflict resolved: enterprise HSM secret policy prevails over informal team chat practice',
    actorId: 'CISO-OFFICE-01'
  },
  {
    findingKey: 'FINDING-MESSY-SUPERSEDED',
    disposition: 'DISMISSED_FALSE_POSITIVE',
    rationale:
      'Revision 2 contractor access policy legitimately supersedes Revision 1; not an unhandled conflict',
    actorId: 'SEC-ADMIN-01'
  },
  {
    findingKey: 'FINDING-MESSY-AUTH',
    disposition: 'ACCEPTED_RISK',
    rationale:
      'Operator emergency factory shutdown without secondary authorization accepted as deliberate life-safety policy',
    actorId: 'SAFETY-DIR-01'
  },
  {
    findingKey: 'FINDING-MESSY-TRANS',
    disposition: 'RESOLVED',
    rationale:
      'Incomplete state machine resolved: added error transition path from PROCESSING to FAILED with telemetry logging',
    actorId: 'DATA-ARCH-01'
  },
  {
    findingKey: 'FINDING-MESSY-RECOV',
    disposition: 'RESOLVED',
    rationale:
      'Missing failure recovery resolved: specified exponential backoff retry and DLQ for failed alert dispatches',
    actorId: 'OPS-LEAD-01'
  },
  {
    findingKey: 'FINDING-MESSY-TIME',
    disposition: 'RESOLVED',
    rationale:
      'Temporal ambiguity resolved: bounded archival maintenance execution to nightly 02:00 UTC schedule under 30% load',
    actorId: 'DBA-LEAD-01'
  },
  {
    findingKey: 'FINDING-MESSY-CARD',
    disposition: 'RESOLVED',
    rationale:
      'Undefined cardinality resolved: enforced maximum caps of 10 tags and 5 regulatory classifications',
    actorId: 'COMPLIANCE-LEAD-01'
  },
  {
    findingKey: 'FINDING-MESSY-ASSUME',
    disposition: 'RESOLVED',
    rationale:
      'Unsupported assumption resolved: confirmed vendor burst SLA of 50,000 QPS with circuit-breaker protection',
    actorId: 'SRE-ARCH-01'
  },
  {
    findingKey: 'FINDING-MESSY-BOUNDARY',
    disposition: 'RESOLVED',
    rationale:
      'Boundary ambiguity resolved: dual-approval threshold clarified as inclusive of exactly $50k (">= $50k triggers CEO sign-off")',
    actorId: 'CFO-DESIGNEE'
  },
  {
    findingKey: 'FINDING-MESSY-SUBJECTIVE',
    disposition: 'RESOLVED',
    rationale:
      'Subjective normative language resolved: archival maintenance "reasonable completion window" replaced with an explicit 4-hour SLA bound',
    actorId: 'DBA-LEAD-01'
  }
];

export interface ScriptableGenerationGateway extends IGenerationGateway {
  queueResponse(text: string, metadata?: GenerationResult['metadata']): void;
}

export interface Phase1ExitGateAdapter {
  readonly generationGateway?: ScriptableGenerationGateway;
  readonly mermaidLinterGateway?: IMermaidLinterGateway;
  createGenerationGateway?(): ScriptableGenerationGateway;
  createMermaidLinterGateway?(): IMermaidLinterGateway;
  loadFixture?(fixtureId: string): LoadedFixture;
  createRepository?(storeDir: string): IRequirementsRepository | Promise<IRequirementsRepository>;
}

export interface Phase1ExitGateOptions {
  readonly storeDir?: string;
  readonly silent?: boolean;
  readonly cleanup?: boolean;
  readonly adapter?: Phase1ExitGateAdapter;
}

export interface Phase1ExitGateResult {
  readonly success: boolean;
  readonly capturedSourceRevisionCount: number;
  readonly compiledRequirementCount: number;
  readonly compiledFindingCount: number;
  readonly acceptedRequirementCount: number;
  readonly rejectedRequirementCount: number;
  readonly dispositionedFindingCount: number;
  readonly baseline: RequirementsBaseline;
  readonly reloadedBaseline: RequirementsBaseline;
  readonly projectionResult: BaselineProjectionResult;
  readonly evaluationReport: EvaluationReportDto;
  readonly reloadedEvaluationRun: EvaluationRunRecord;
  readonly storeDir: string;
}

export async function runPhase1ExitGate(
  options: Phase1ExitGateOptions = {}
): Promise<Phase1ExitGateResult> {
  const log = (msg: string) => {
    if (!options.silent) {
      console.log(msg);
    }
  };

  const isTempStore = !options.storeDir;
  const storeDir =
    options.storeDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'phase1-exit-gate-run-')));

  const adapter = options.adapter;
  if (!adapter) {
    throw new Error(
      'runPhase1ExitGate requires an adapter providing generation and mermaid linter gateways'
    );
  }

  const generationGateway = adapter.createGenerationGateway?.() ?? adapter.generationGateway;
  if (!generationGateway) {
    throw new Error('Phase1ExitGateAdapter did not provide a generation gateway');
  }

  const mermaidLinterGateway =
    adapter.createMermaidLinterGateway?.() ?? adapter.mermaidLinterGateway;
  if (!mermaidLinterGateway) {
    throw new Error('Phase1ExitGateAdapter did not provide a mermaid linter gateway');
  }

  const loadFixtureFn = adapter.loadFixture ?? defaultLoadFixture;

  try {
    log('====================================================');
    log('Solutions Studio: Phase 1.7 Exit Gate & Baseline Projection');
    log('====================================================\n');

    // ----------------------------------------------------
    // Step 1: Ingest and persist messy discovery package
    // ----------------------------------------------------
    log('[1/8] Ingesting canonical messy discovery package sources...');
    const repo = adapter?.createRepository
      ? await adapter.createRepository(storeDir)
      : new FilesystemRequirementsRepository({ baseDir: storeDir });
    const compileUseCase = new CompileRequirementsUseCase(generationGateway, repo);
    const reconcileUseCase = new ReconcileRequirementsUseCase(repo);
    const baselineUseCase = new CreateRequirementsBaselineUseCase(repo);

    const loaded = loadFixtureFn('canonical-messy-discovery-package');
    if (!loaded.fixture.canonicalMessyPackage) {
      throw new Error(
        "Fixture 'canonical-messy-discovery-package' is missing canonicalMessyPackage flag"
      );
    }

    const sourceIdMap = new Map<string, string>();
    const capturedSourceRevisionIds: string[] = [];

    for (const sourceDef of loaded.fixture.sources) {
      const sourceRev = loaded.sourceRevisions.get(sourceDef.sourceRevisionId);
      if (!sourceRev) {
        throw new Error(`Missing source file content for revision ${sourceDef.sourceRevisionId}`);
      }

      const record = await repo.captureSourceRevision({
        sourceId: createSourceId(sourceDef.sourceId),
        sourceType: sourceDef.sourceType,
        markdownText: sourceRev.text
      });

      sourceIdMap.set(sourceDef.sourceRevisionId, record.revision.id);
      if (!capturedSourceRevisionIds.includes(record.revision.id)) {
        capturedSourceRevisionIds.push(record.revision.id);
      }

      // Assert deterministic locator index was generated
      if (!record.locatorIndex || record.locatorIndex.length === 0) {
        throw new Error(`Source revision ${record.revision.id} has empty locator index`);
      }

      for (const locEntry of record.locatorIndex) {
        if (!locEntry.locator || !locEntry.headingPath || !locEntry.text) {
          throw new Error(`Malformed locator index entry in ${record.revision.id}`);
        }
      }
    }

    // Verify locator resolution across all captured sources
    for (const req of loaded.fixture.expectedRequirements) {
      for (const ev of req.evidence) {
        const capturedRevId = sourceIdMap.get(ev.sourceRevisionId);
        if (!capturedRevId) {
          throw new Error(
            `Unmapped sourceRevisionId '${ev.sourceRevisionId}' in fixture requirements`
          );
        }
        const resolved = await repo.resolveLocator(
          createSourceRevisionId(capturedRevId),
          createEvidenceLocator(ev.locator)
        );
        if (!resolved) {
          throw new Error(
            `Failed to resolve locator '${ev.locator}' in captured revision '${capturedRevId}'`
          );
        }
      }
    }

    log(
      `      Captured ${capturedSourceRevisionIds.length} source revisions with deterministic locators.`
    );

    // ----------------------------------------------------
    // Step 2: Compile candidate requirements and findings
    // ----------------------------------------------------
    log('[2/8] Compiling candidate requirements and findings via GenerationGateway...');
    const scriptedResponse = {
      requirements: loaded.fixture.expectedRequirements.map((r) => ({
        requirementKey: r.requirementKey,
        statement: `Requirement statement for ${r.requirementKey}`,
        category: r.category,
        origin: r.origin,
        evidence: r.evidence.map((e) => ({
          sourceRevisionId: sourceIdMap.get(e.sourceRevisionId) ?? e.sourceRevisionId,
          locator: e.locator
        }))
      })),
      findings: loaded.fixture.expectedFindings.map((f) => ({
        findingKey: f.findingKey,
        type: f.type,
        relatedRequirementKeys: [...f.relatedRequirementKeys],
        evidence: f.evidence.map((e) => ({
          sourceRevisionId: sourceIdMap.get(e.sourceRevisionId) ?? e.sourceRevisionId,
          locator: e.locator
        })),
        rationale: f.rationale
      }))
    };
    generationGateway.queueResponse(JSON.stringify(scriptedResponse));

    const compileResult = await compileUseCase.compile({
      sourceRevisionIds: capturedSourceRevisionIds.map((id) => createSourceRevisionId(id))
    });

    if (compileResult.rejectedRequirements.length > 0) {
      throw new Error(
        `Compilation rejected requirements: ${JSON.stringify(compileResult.rejectedRequirements)}`
      );
    }
    if (compileResult.rejectedFindings.length > 0) {
      throw new Error(
        `Compilation rejected findings: ${JSON.stringify(compileResult.rejectedFindings)}`
      );
    }

    log(
      `      Compiled ${compileResult.acceptedRequirementRevisions.length} candidate requirements and ${compileResult.acceptedFindingIds.length} defect findings.`
    );

    // Build key-to-revision and key-to-finding lookup maps
    const keyToCompiledRevId = new Map<string, RequirementRevisionId>();
    for (let i = 0; i < loaded.fixture.expectedRequirements.length; i++) {
      const key = loaded.fixture.expectedRequirements[i].requirementKey;
      const revId = compileResult.acceptedRequirementRevisions[i];
      keyToCompiledRevId.set(key, revId);
    }

    const keyToFindingId = new Map<string, FindingId>();
    for (let i = 0; i < loaded.fixture.expectedFindings.length; i++) {
      const key = loaded.fixture.expectedFindings[i].findingKey;
      const findingId = compileResult.acceptedFindingIds[i];
      keyToFindingId.set(key, findingId);
    }

    // ----------------------------------------------------
    // Step 3: Apply deterministic reconciliation plan
    // ----------------------------------------------------
    log('[3/8] Applying deterministic human reconciliation decisions...');
    const acceptedClearedRevisionIds: RequirementRevisionId[] = [];
    let acceptedCount = 0;
    let rejectedCount = 0;

    for (const planEntry of CANONICAL_REQUIREMENT_RECONCILIATION_PLAN) {
      const compiledRevId = keyToCompiledRevId.get(planEntry.requirementKey);
      if (!compiledRevId) {
        throw new Error(`Missing compiled revision ID for key '${planEntry.requirementKey}'`);
      }

      if (planEntry.action === 'ACCEPT_AND_CLEAR') {
        const accepted = await reconcileUseCase.acceptRequirement({
          revisionId: compiledRevId,
          rationale: planEntry.acceptRationale!,
          actorId: planEntry.actorId
        });
        const cleared = await reconcileUseCase.resolveRequirement({
          revisionId: accepted.id,
          rationale: planEntry.clearRationale!,
          actorId: planEntry.actorId
        });
        acceptedClearedRevisionIds.push(cleared.id);
        acceptedCount++;
      } else if (planEntry.action === 'REJECT') {
        await reconcileUseCase.rejectRequirement({
          revisionId: compiledRevId,
          rationale: planEntry.rejectRationale!,
          actorId: planEntry.actorId
        });
        rejectedCount++;
      }
    }

    log(
      `      Reconciled candidates: ${acceptedCount} accepted & cleared, ${rejectedCount} rejected with rationales.`
    );

    // ----------------------------------------------------
    // Step 4: Verify deterministic blocking policy & disposition findings
    // ----------------------------------------------------
    log('[4/8] Verifying open finding lineage blocking gate...');
    let blockedCaught = false;
    try {
      await baselineUseCase.create({
        id: createRequirementsBaselineId('BASE-BLOCKED-CHECK'),
        requirementRevisionIds: acceptedClearedRevisionIds,
        createdBy: createReviewerId('REV-LEAD-01')
      });
    } catch (err) {
      if (err instanceof BlockedByOpenFindingsError) {
        blockedCaught = true;
        log(
          `      Deterministic block confirmed: ${err.blockingFindings.length} open finding(s) blocked premature baseline creation.`
        );
      } else {
        throw err;
      }
    }

    if (!blockedCaught) {
      throw new Error('Expected BlockedByOpenFindingsError was not thrown for open findings!');
    }

    log('      Dispositioning defect findings according to deterministic plan...');
    let dispositionCount = 0;
    for (const findingEntry of CANONICAL_FINDING_RECONCILIATION_PLAN) {
      const findingId = keyToFindingId.get(findingEntry.findingKey);
      if (!findingId) {
        throw new Error(`Missing compiled finding ID for key '${findingEntry.findingKey}'`);
      }

      await reconcileUseCase.dispositionFinding({
        findingId,
        disposition: findingEntry.disposition,
        rationale: findingEntry.rationale,
        actorId: createActorId(findingEntry.actorId)
      });
      dispositionCount++;
    }
    log(`      Dispositioned ${dispositionCount} candidate findings.`);

    // ----------------------------------------------------
    // Step 5: Create immutable RequirementsBaseline
    // ----------------------------------------------------
    log('[5/8] Freezing immutable RequirementsBaseline...');
    const baseline = await baselineUseCase.create({
      id: createRequirementsBaselineId('BASE-CANONICAL-MESSY-001'),
      requirementRevisionIds: acceptedClearedRevisionIds,
      createdBy: createReviewerId('LEAD-ARCH-01')
    });

    log(
      `      Created baseline '${baseline.id}' containing exact ${baseline.requirementRevisions.length} revision(s).`
    );

    // ----------------------------------------------------
    // Step 6: Process restart / reload durability & isolation probe
    // ----------------------------------------------------
    log('[6/8] Discarding in-memory state and verifying restart reload durability...');
    const restartedRepo = adapter?.createRepository
      ? await adapter.createRepository(storeDir)
      : new FilesystemRequirementsRepository({ baseDir: storeDir });
    const reloadedBaseline = await restartedRepo.getRequirementsBaseline(baseline.id);
    if (!reloadedBaseline || reloadedBaseline.id !== baseline.id) {
      throw new Error(`Failed to reload baseline '${baseline.id}' from restarted repository`);
    }
    if (reloadedBaseline.requirementRevisions.length !== acceptedClearedRevisionIds.length) {
      throw new Error(
        `Baseline revisions count mismatch: expected ${acceptedClearedRevisionIds.length}, got ${reloadedBaseline.requirementRevisions.length}`
      );
    }
    for (let i = 0; i < acceptedClearedRevisionIds.length; i++) {
      if (reloadedBaseline.requirementRevisions[i] !== acceptedClearedRevisionIds[i]) {
        throw new Error(`Baseline revision mismatch at index ${i}`);
      }
    }

    // Verify source revisions and locator indexes reloaded intact
    for (const sourceId of capturedSourceRevisionIds) {
      const reloadedSource = await restartedRepo.getSourceRevision(
        createSourceRevisionId(sourceId)
      );
      if (!reloadedSource || reloadedSource.locatorIndex.length === 0) {
        throw new Error(`Failed to reload source revision ${sourceId} or its locator index`);
      }
    }

    // Isolation probe: create a newer revision R4 for one requirement and baseline BASE-002
    const restartedReconcile = new ReconcileRequirementsUseCase(restartedRepo);
    const restartedBaselineUseCase = new CreateRequirementsBaselineUseCase(restartedRepo);

    const firstRevId = acceptedClearedRevisionIds[0];
    const newerRev = await restartedReconcile.reviseRequirement({
      revisionId: firstRevId,
      statement: 'Subsequent release cycle updated requirement statement',
      rationale: 'Isolation probe revision'
    });
    const acceptedNewer = await restartedReconcile.acceptRequirement({
      revisionId: newerRev.id,
      rationale: 'Accepted newer revision'
    });
    const clearedNewer = await restartedReconcile.resolveRequirement({
      revisionId: acceptedNewer.id,
      rationale: 'Cleared newer revision'
    });
    await restartedBaselineUseCase.create({
      id: createRequirementsBaselineId('BASE-CANONICAL-MESSY-002'),
      requirementRevisionIds: [clearedNewer.id],
      createdBy: createReviewerId('LEAD-ARCH-02')
    });

    // Verify original baseline BASE-CANONICAL-MESSY-001 is completely untouched by newer revision
    const reloadedB1AfterMutation = await restartedRepo.getRequirementsBaseline(baseline.id);
    if (
      !reloadedB1AfterMutation ||
      !reloadedB1AfterMutation.requirementRevisions.includes(firstRevId) ||
      reloadedB1AfterMutation.requirementRevisions.includes(clearedNewer.id)
    ) {
      throw new Error(
        'Baseline isolation violation: original baseline was modified by newer revision!'
      );
    }

    log('      Durability and provenance isolation verified across repository restart.');

    // ----------------------------------------------------
    // Step 7: Mermaid projection with closed-loop syntax repair
    // ----------------------------------------------------
    log('[7/8] Generating Mermaid diagram projection from verified baseline...');
    const generateArtifactUseCase = new GenerateArtifactUseCase(
      generationGateway,
      mermaidLinterGateway
    );
    const projectBaselineUseCase = new ProjectBaselineUseCase(
      generateArtifactUseCase,
      restartedRepo,
      'fake'
    );

    // Queue 1 invalid diagram followed by 1 valid repaired diagram (exercising <= 2 repair seam)
    generationGateway.queueResponse('graph TD\n  Start[Start Process] --> ;');
    const validDiagram =
      '```mermaid\ngraph TD\n  Start[Start Telemetry Processing] --> Ingest[Ingest Stream]\n  Ingest --> Validate[Validate Rules]\n  Validate --> Complete[Complete Archival]\n```';
    generationGateway.queueResponse(validDiagram);

    const projectionResult = await projectBaselineUseCase.project({
      baselineId: baseline.id,
      artifactType: 'process-diagram'
    });

    if (
      projectionResult.content !==
      'graph TD\n  Start[Start Telemetry Processing] --> Ingest[Ingest Stream]\n  Ingest --> Validate[Validate Rules]\n  Validate --> Complete[Complete Archival]'
    ) {
      throw new Error(`Unexpected projection content: ${projectionResult.content}`);
    }

    if (projectionResult.metadata.baselineId !== baseline.id) {
      throw new Error(`Projection metadata baselineId mismatch: expected ${baseline.id}`);
    }

    if (
      projectionResult.metadata.requirementRevisionIds.length !==
        acceptedClearedRevisionIds.length ||
      projectionResult.metadata.requirementRevisionIds.includes(clearedNewer.id)
    ) {
      throw new Error('Projection metadata failed exact requirement revisions contract');
    }

    if (
      projectionResult.metadata.measuredVerification.repairsNeeded !== 1 ||
      projectionResult.metadata.measuredVerification.attemptCount !== 2 ||
      projectionResult.repairHistory.length !== 1
    ) {
      throw new Error(
        `Closed-loop repair verification failed: repairsNeeded=${projectionResult.metadata.measuredVerification.repairsNeeded}, attemptCount=${projectionResult.metadata.measuredVerification.attemptCount}`
      );
    }

    // Verify reloaded projection record from repository
    const storedProjection = await restartedRepo.getProjectionRecord(projectionResult.projectionId);
    if (!storedProjection || storedProjection.id !== projectionResult.projectionId) {
      throw new Error(`Failed to reload projection record '${projectionResult.projectionId}'`);
    }

    log(
      `      Projection verified: record '${projectionResult.projectionId}' produced with 1 repair iteration and hash ${projectionResult.metadata.measuredVerification.contentHash.slice(0, 12)}...`
    );

    // ----------------------------------------------------
    // Step 8: Execute Requirements Intelligence Evaluation Runner
    // ----------------------------------------------------
    log('[8/8] Executing Requirements Intelligence Evaluation runner on versioned corpus...');
    const evalReportPath = path.join(storeDir, 'evaluation-report.json');
    const evalMarkdownPath = path.join(storeDir, 'evaluation-report.md');

    const evalResult = await runEvaluation({
      provider: 'fixture-replay',
      outputReportPath: evalReportPath,
      outputMarkdownPath: evalMarkdownPath,
      repository: restartedRepo,
      storeDir: path.join(storeDir, 'eval-fixtures')
    });

    if (!evalResult.success) {
      throw new Error('Evaluation runner execution failed with non-zero failures');
    }

    if (evalResult.report.corpusVersion !== 'v2.0') {
      throw new Error(
        `Corpus version mismatch: expected 'v2.0', got '${evalResult.report.corpusVersion}'`
      );
    }

    if (!evalResult.report.corpusIdentity || evalResult.report.corpusIdentity.length === 0) {
      throw new Error('Missing corpus identity hash');
    }

    if (evalResult.report.aggregateScores.failedFixtures !== 0) {
      throw new Error(
        `Evaluation had ${evalResult.report.aggregateScores.failedFixtures} failed fixtures`
      );
    }

    const canonicalResult = evalResult.report.fixtureResults.find(
      (f) => f.fixtureId === 'canonical-messy-discovery-package'
    );
    if (!canonicalResult) {
      throw new Error(
        "Missing 'canonical-messy-discovery-package' in evaluation report fixture results"
      );
    }

    // Verify report files written to disk
    const jsonStats = await fs.stat(evalReportPath);
    if (jsonStats.size === 0) {
      throw new Error('Evaluation JSON report file is empty');
    }

    const mdStats = await fs.stat(evalMarkdownPath);
    if (mdStats.size === 0) {
      throw new Error('Evaluation Markdown report file is empty');
    }

    // Verify persisted evaluation run record in repository
    const reloadedEvalRun = await restartedRepo.getEvaluationRun(evalResult.runRecord.id);
    if (!reloadedEvalRun || reloadedEvalRun.id !== evalResult.report.runId) {
      throw new Error('Failed to reload evaluation run record from repository');
    }

    log(
      `      Evaluation verified: ${evalResult.report.aggregateScores.completedFixtures}/${evalResult.report.aggregateScores.totalFixtures} fixtures passed on corpus ${evalResult.report.corpusVersion} (${evalResult.report.corpusIdentity.slice(0, 12)}...).`
    );

    log('\n====================================================');
    log('Phase 1.7 End-to-End Integration Exit Gate: SUCCESS');
    log('====================================================\n');

    return {
      success: true,
      capturedSourceRevisionCount: capturedSourceRevisionIds.length,
      compiledRequirementCount: compileResult.acceptedRequirementRevisions.length,
      compiledFindingCount: compileResult.acceptedFindingIds.length,
      acceptedRequirementCount: acceptedCount,
      rejectedRequirementCount: rejectedCount,
      dispositionedFindingCount: dispositionCount,
      baseline,
      reloadedBaseline,
      projectionResult,
      evaluationReport: evalResult.report,
      reloadedEvaluationRun: reloadedEvalRun,
      storeDir
    };
  } finally {
    if (isTempStore && options.cleanup !== false) {
      await fs.rm(storeDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
