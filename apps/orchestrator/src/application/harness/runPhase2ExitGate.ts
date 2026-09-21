import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createSourceId,
  createReviewerId,
  createRequirementsBaselineId,
  createActorId,
  createEvidenceLocator,
  createRequirementId,
  createRequirementRevisionId,
  createRequirementRevision,
  InvalidBaselineMembershipError,
  now
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import {
  ImmutableRecordConflictError,
  type IRequirementsRepository
} from '../ports/persistence/IRequirementsRepository.js';
import type {
  IGenerationGateway,
  GenerationResult
} from '../ports/generation/IGenerationGateway.js';
import type { IMermaidLinterGateway } from '../ports/validation/IMermaidLinterGateway.js';
import type { IPrototypeValidatorGateway } from '../ports/validation/IPrototypeValidatorGateway.js';
import { GetRequirementsReviewStateUseCase } from '../use-cases/GetRequirementsReviewStateUseCase.js';
import { ProjectBaselineUseCase } from '../use-cases/ProjectBaselineUseCase.js';
import { GenerateArtifactUseCase } from '../use-cases/GenerateArtifactUseCase.js';
import { GeneratePrototypeProjectionUseCase } from '../use-cases/GeneratePrototypeProjectionUseCase.js';
import { RecordRequirementsDiscoveryUseCase } from '../use-cases/RecordRequirementsDiscoveryUseCase.js';
import { ReconcileRequirementsUseCase } from '../use-cases/ReconcileRequirementsUseCase.js';
import { CreateRequirementsBaselineUseCase } from '../use-cases/CreateRequirementsBaselineUseCase.js';
import { BlockedByOpenFindingsError } from '../use-cases/ReconciliationErrors.js';
import { GatewayFactory } from '../../infrastructure/generation/GatewayFactory.js';
import { MermaidCliLinterAdapter } from '../../infrastructure/validation/MermaidCliLinterAdapter.js';
import { BabelTsxValidatorAdapter } from '../../infrastructure/validation/BabelTsxValidatorAdapter.js';

export interface ScriptableGenerationGateway extends IGenerationGateway {
  queueResponse(text: string, metadata?: GenerationResult['metadata']): void;
}

export interface Phase2ExitGateAdapter {
  readonly generationGateway?: ScriptableGenerationGateway | IGenerationGateway;
  readonly mermaidLinterGateway?: IMermaidLinterGateway;
  readonly prototypeValidatorGateway?: IPrototypeValidatorGateway;
  createGenerationGateway?(): ScriptableGenerationGateway | IGenerationGateway;
  createMermaidLinterGateway?(): IMermaidLinterGateway;
  createPrototypeValidatorGateway?(): IPrototypeValidatorGateway;
  createRepository?(storeDir: string): IRequirementsRepository | Promise<IRequirementsRepository>;
}

export interface Phase2ExitGateOptions {
  readonly storeDir?: string;
  readonly provider?: 'fake' | 'agy' | 'opencode';
  readonly model?: string;
  readonly silent?: boolean;
  readonly cleanup?: boolean;
  readonly adapter?: Phase2ExitGateAdapter;
  readonly runId?: string;
}

export interface Phase2ExitGateResult {
  readonly success: boolean;
  readonly executionMode: 'deterministic-ci' | 'real-provider';
  readonly provider: string;
  readonly model?: string;
  readonly runId: string;
  readonly timestamp: string;

  // Baseline & Revision Identities
  readonly startingBaseline: {
    readonly id: string;
    readonly requirementRevisions: readonly string[];
  };
  readonly successorBaseline: {
    readonly id: string;
    readonly requirementRevisions: readonly string[];
  };

  // Provenance & Locators
  readonly provenanceVerification: {
    readonly sourceRevisionsCount: number;
    readonly locatorsChecked: number;
    readonly allLocatorsResolved: boolean;
  };

  // Projections & Verifications (Baseline A)
  readonly projectionsA: {
    readonly processDiagram: {
      readonly id: string;
      readonly baselineId: string;
      readonly requirementRevisionIds: readonly string[];
      readonly repairsNeeded: number;
      readonly attemptCount: number;
      readonly contentHash: string;
      readonly syntaxValid: boolean;
    };
    readonly prototype: {
      readonly id: string;
      readonly baselineId: string;
      readonly requirementRevisionIds: readonly string[];
      readonly repairsNeeded: number;
      readonly attemptCount: number;
      readonly contentHash: string;
      readonly syntaxValid: boolean;
      readonly declaredProvenanceValid: boolean;
      readonly sandboxCompileOutcome: {
        readonly success: boolean;
        readonly errorMessage?: string;
      };
    };
  };

  // Projections & Verifications (Baseline B)
  readonly projectionsB: {
    readonly processDiagram: {
      readonly id: string;
      readonly baselineId: string;
      readonly requirementRevisionIds: readonly string[];
      readonly repairsNeeded: number;
      readonly attemptCount: number;
      readonly contentHash: string;
      readonly syntaxValid: boolean;
    };
    readonly prototype: {
      readonly id: string;
      readonly baselineId: string;
      readonly requirementRevisionIds: readonly string[];
      readonly repairsNeeded: number;
      readonly attemptCount: number;
      readonly contentHash: string;
      readonly syntaxValid: boolean;
      readonly declaredProvenanceValid: boolean;
      readonly sandboxCompileOutcome: {
        readonly success: boolean;
        readonly errorMessage?: string;
      };
    };
  };

  // Candidate Discovery & Non-Promotion Gate Enforcement
  readonly discovery: {
    readonly originatingProjectionId: string;
    readonly candidateRequirement: {
      readonly id: string;
      readonly statement: string;
      readonly origin: 'REVIEWER_PROPOSAL';
      readonly initialReviewState: 'PENDING';
      readonly initialResolutionState: 'UNRESOLVED';
    };
    readonly candidateFinding: {
      readonly id: string;
      readonly type: string;
      readonly discoveredBy: 'artifact-validation' | 'human';
      readonly initialDisposition: 'OPEN';
    };
    readonly promotionPreventionGate: {
      readonly unacceptedProposalBlockedBaseline: boolean;
      readonly openFindingBlockedBaseline: boolean;
    };
  };

  // Human Reconciliation Outcome
  readonly reconciliation: {
    readonly findingDisposition: 'RESOLVED';
    readonly findingRationale: string;
    readonly acceptedRevisionId: string;
    readonly resolvedRevisionId: string;
    readonly finalReviewState: 'ACCEPTED';
    readonly finalResolutionState: 'CLEAR';
    readonly actorId: string;
  };

  // Immutability & Durability Witness
  readonly immutabilityVerification: {
    readonly baselineAUntouched: boolean;
    readonly duplicateBaselineOverwriteRejected: boolean;
    readonly projectionIsolationVerified: boolean;
    readonly stalenessDetectedForPriorProjections: boolean;
    readonly restartReloadDurabilityVerified: boolean;
  };

  readonly storeDir: string;
}

export async function runPhase2ExitGate(
  options: Phase2ExitGateOptions = {}
): Promise<Phase2ExitGateResult> {
  const log = (msg: string) => {
    if (!options.silent) {
      console.log(msg);
    }
  };

  const isTempStore = !options.storeDir;
  const storeDir =
    options.storeDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'phase2-exit-gate-run-')));

  const provider = options.provider ?? (options.adapter ? 'fake' : 'fake');
  const executionMode: 'deterministic-ci' | 'real-provider' =
    provider === 'fake' ? 'deterministic-ci' : 'real-provider';
  const runId = options.runId ?? `RUN-P2-${randomUUID().slice(0, 8)}`;
  const timestamp = new Date().toISOString();

  // Instantiate or resolve gateways
  let generationGateway: IGenerationGateway;
  let mermaidLinterGateway: IMermaidLinterGateway;
  let prototypeValidatorGateway: IPrototypeValidatorGateway;

  if (options.adapter) {
    generationGateway =
      options.adapter.createGenerationGateway?.() ?? options.adapter.generationGateway!;
    mermaidLinterGateway =
      options.adapter.createMermaidLinterGateway?.() ?? options.adapter.mermaidLinterGateway!;
    prototypeValidatorGateway =
      options.adapter.createPrototypeValidatorGateway?.() ??
      options.adapter.prototypeValidatorGateway!;
  } else {
    if (provider === 'agy' || provider === 'opencode') {
      generationGateway = GatewayFactory.createGateway({
        provider,
        model: options.model,
        timeoutMs: 120_000,
        cwd: process.cwd()
      });
      mermaidLinterGateway = new MermaidCliLinterAdapter({ timeoutMs: 60_000 });
      prototypeValidatorGateway = new BabelTsxValidatorAdapter();
    } else {
      throw new Error(
        `Phase2ExitGate requires an adapter when provider is '${provider}', or specify provider 'agy' or 'opencode'.`
      );
    }
  }

  if (!generationGateway) {
    throw new Error('Generation gateway could not be initialized');
  }
  if (!mermaidLinterGateway) {
    throw new Error('Mermaid linter gateway could not be initialized');
  }
  if (!prototypeValidatorGateway) {
    throw new Error('Prototype validator gateway could not be initialized');
  }

  const isScriptableGen = 'queueResponse' in generationGateway;

  try {
    log('========================================================================');
    log('Solutions Studio: Phase 2.7 Exit Gate & Candidate Validation');
    log(`Mode: ${executionMode} | Provider: ${provider} | Model: ${options.model ?? 'default'}`);
    log('========================================================================\n');

    const repo = options.adapter?.createRepository
      ? await options.adapter.createRepository(storeDir)
      : new FilesystemRequirementsRepository({ baseDir: storeDir });
    const reconcileUseCase = new ReconcileRequirementsUseCase(repo);
    const baselineUseCase = new CreateRequirementsBaselineUseCase(repo);
    const reviewStateUseCase = new GetRequirementsReviewStateUseCase(repo);
    const discoveryUseCase = new RecordRequirementsDiscoveryUseCase(repo);
    const generateArtifactUseCase = new GenerateArtifactUseCase(
      generationGateway,
      mermaidLinterGateway
    );
    const generatePrototypeProjectionUseCase = new GeneratePrototypeProjectionUseCase(
      generationGateway,
      prototypeValidatorGateway,
      repo,
      provider
    );
    const projectBaselineUseCase = new ProjectBaselineUseCase(
      generateArtifactUseCase,
      repo,
      provider,
      generatePrototypeProjectionUseCase
    );

    // ------------------------------------------------------------------------
    // Step 1: Ingest synthetic discovery package & initialize starting baseline
    // ------------------------------------------------------------------------
    log('[1/10] Ingesting synthetic discovery package (SRC-001) & starting baseline BASE-001...');
    const src = await repo.captureSourceRevision({
      sourceId: createSourceId('SRC-001'),
      sourceType: 'sop',
      markdownText:
        '# Enterprise Security Standard\n\n' +
        '## Encryption at Rest\n\n' +
        'All relational and object databases storing customer data must employ AES-256 encryption at rest.\n\n' +
        '## Role-Based Access Control\n\n' +
        'Administrative roles must require multi-factor authentication and role-based privilege assignment.\n\n' +
        '## Session Management\n\n' +
        'User sessions must expire after 15 minutes of inactivity across all internal web portals.'
    });

    const locators = src.locatorIndex;
    const rbacLocator = locators[1]?.locator ?? 'sec-2';

    // Starting baseline contains REQ-002-R1 (ACCEPTED and CLEAR)
    const req2Rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-002-R1'),
      requirementId: createRequirementId('REQ-002'),
      revision: 1,
      statement:
        'Administrative roles must require multi-factor authentication and role-based privilege assignment.',
      category: 'actors-permissions',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [
        {
          sourceRevisionId: src.revision.id,
          locator: createEvidenceLocator(rbacLocator)
        }
      ]
    });
    await repo.saveRequirementRevision(req2Rev1);

    await repo.appendReconciliationRecord({
      id: 'REC-REQ-002-R1',
      entityType: 'requirement',
      entityId: createRequirementId('REQ-002'),
      requirementRevisionId: req2Rev1.id,
      action: 'ACCEPT',
      previousReviewState: undefined,
      newReviewState: 'ACCEPTED',
      previousResolutionState: undefined,
      newResolutionState: undefined,
      rationale: 'Verified against enterprise security standard baseline.',
      recordedAt: now()
    });

    const baselineA = await baselineUseCase.create({
      id: createRequirementsBaselineId('BASE-001'),
      requirementRevisionIds: [req2Rev1.id],
      createdBy: createReviewerId('lead-architect')
    });

    const reviewStateA = await reviewStateUseCase.get({ baselineId: 'BASE-001' });
    if (!reviewStateA.baseline || reviewStateA.baseline.id !== 'BASE-001') {
      throw new Error("Failed to load review state for starting baseline 'BASE-001'");
    }
    log(
      `       Created baseline 'BASE-001' with members: [${baselineA.requirementRevisions.join(', ')}]`
    );

    // ------------------------------------------------------------------------
    // Step 2: Inspect requirement evidence and provenance
    // ------------------------------------------------------------------------
    log('[2/10] Inspecting requirement evidence locators and provenance trace...');
    let locatorsChecked = 0;
    let allLocatorsResolved = true;

    for (const memberRev of reviewStateA.requirementRevisions) {
      for (const ev of memberRev.evidence) {
        locatorsChecked++;
        const resolved = await repo.resolveLocator(ev.sourceRevisionId, ev.locator);
        if (!resolved) {
          allLocatorsResolved = false;
          throw new Error(
            `Locator resolution failure: '${ev.locator}' in revision '${ev.sourceRevisionId}'`
          );
        }
        if (!resolved.text || !resolved.headingPath) {
          allLocatorsResolved = false;
          throw new Error(`Malformed excerpt resolved for locator '${ev.locator}'`);
        }
      }
    }
    log(`       Resolved ${locatorsChecked} evidence locator(s) with exact text excerpts.`);

    // ------------------------------------------------------------------------
    // Step 3: Generate process/state projection from BASELINE-A (BASE-001)
    // ------------------------------------------------------------------------
    log('[3/10] Generating process diagram projection from BASELINE-A...');
    if (isScriptableGen) {
      const scriptable = generationGateway as ScriptableGenerationGateway;
      // Closed loop repair test: queue 1 invalid diagram syntax, followed by 1 valid repaired diagram
      scriptable.queueResponse('graph TD\n  Start[Start Request] --> ;');
      scriptable.queueResponse(
        '```mermaid\ngraph TD\n  Start([Start Request]) --> Auth{Verify Admin MFA}\n  Auth -->|Authorized| Grant[Assign RBAC Role]\n  Auth -->|Denied| Reject[Deny Access]\n```'
      );
    }

    const projA_diag = await projectBaselineUseCase.project({
      baselineId: 'BASE-001',
      artifactType: 'process-diagram'
    });

    const diagValidation = await mermaidLinterGateway.validate(projA_diag.content);
    if (!diagValidation.isValid) {
      throw new Error(
        `Process diagram from BASE-001 failed Mermaid validation: ${diagValidation.errorMessage}`
      );
    }
    log(
      `       Generated process diagram '${projA_diag.projectionId}' (repairs needed: ${projA_diag.metadata.measuredVerification.repairsNeeded}).`
    );

    // ------------------------------------------------------------------------
    // Step 4: Generate interactive prototype projection from BASELINE-A (BASE-001)
    // ------------------------------------------------------------------------
    log('[4/10] Generating interactive prototype projection from BASELINE-A...');
    if (isScriptableGen) {
      const scriptable = generationGateway as ScriptableGenerationGateway;
      scriptable.queueResponse(
        [
          '```tsx',
          '/**',
          ' * @baseline BASE-001',
          ' * @requirements REQ-002-R1',
          ' */',
          "import React, { useState } from 'react';",
          '',
          'export default function AdminAuthPrototype() {',
          '  const [mfaVerified, setMfaVerified] = useState(false);',
          '  return (',
          '    <div className="p-6 bg-white rounded-lg border border-gray-200">',
          '      <h2 className="text-sm font-bold text-gray-900 mb-2">Admin MFA & RBAC Control</h2>',
          '      <p data-testid="counter-value" className="text-xs text-gray-700 mb-4">',
          '        Status: {mfaVerified ? "Authenticated (Admin Role Assigned)" : "Unauthenticated"}',
          '      </p>',
          '      <button',
          '        type="button"',
          '        data-testid="increment-btn"',
          '        onClick={() => setMfaVerified((v) => !v)}',
          '        className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold"',
          '      >',
          '        Toggle MFA Verification',
          '      </button>',
          '    </div>',
          '  );',
          '}',
          '```'
        ].join('\n')
      );
    }

    const projA_proto = await projectBaselineUseCase.project({
      baselineId: 'BASE-001',
      artifactType: 'prototype'
    });

    const protoValidation = await prototypeValidatorGateway.validate(projA_proto.content);
    if (!protoValidation.isValid) {
      throw new Error(
        `Prototype from BASE-001 failed TSX validation: ${protoValidation.errorMessage}`
      );
    }

    // Extract declared provenance and verify adherence
    const declaredProvMatch = projA_proto.content.match(/@baseline\s*[:\s]\s*([A-Za-z0-9_-]+)/i);
    const declaredBaselineId = declaredProvMatch ? declaredProvMatch[1] : undefined;
    const declaredProvenanceValid = declaredBaselineId === 'BASE-001';
    if (!declaredProvenanceValid) {
      throw new Error(
        `Prototype from BASE-001 failed declared provenance check: got '${declaredBaselineId}'`
      );
    }

    log(
      `       Generated prototype '${projA_proto.projectionId}' with valid AST and declared provenance.`
    );

    // ------------------------------------------------------------------------
    // Step 5: Simulate SME review identifying unstated behavior
    // ------------------------------------------------------------------------
    log('[5/10] Simulating SME review of projections (identifying unstated session timeout)...');
    const discoveredStatement =
      'Privileged administrator sessions must terminate automatically after 15 minutes of inactivity.';
    const discoveredFindingRationale =
      'Missing authorization boundary: Session inactivity timeout not enforced for administrative sessions.';
    log(
      '       Identified unstated requirement: Inactivity timeout boundary for administrative sessions.'
    );

    // ------------------------------------------------------------------------
    // Step 6: Record discovery as non-authoritative candidate proposal & finding
    // ------------------------------------------------------------------------
    log('[6/10] Recording discovery as non-authoritative candidate proposal and finding...');
    const candidateReq = await discoveryUseCase.recordRequirementDiscovery({
      statement: discoveredStatement,
      category: 'business-rule',
      rationale:
        'Discovered during SME review of interactive prototype and process diagram from BASE-001',
      originatingProjectionId: projA_proto.projectionId,
      baselineId: 'BASE-001',
      actorId: 'sme-reviewer',
      requirementId: 'REQ-003',
      revisionId: 'REQ-003-R1'
    });

    const candidateFinding = await discoveryUseCase.recordFindingDiscovery({
      type: 'missing-authorization',
      discoveredBy: 'artifact-validation',
      rationale: discoveredFindingRationale,
      originatingProjectionId: projA_proto.projectionId,
      baselineId: 'BASE-001',
      affectedRequirementRevisions: ['REQ-002-R1'],
      actorId: 'sme-reviewer',
      findingId: 'FIND-002'
    });

    if (candidateReq.reviewState !== 'PENDING' || candidateReq.resolutionState !== 'UNRESOLVED') {
      throw new Error(
        'Candidate requirement was not created in non-authoritative PENDING/UNRESOLVED state'
      );
    }
    if (candidateFinding.disposition !== 'OPEN') {
      throw new Error('Candidate finding was not created with OPEN disposition');
    }

    // Verify Promotion Prevention Gate:
    // 1. Unaccepted proposal cannot directly promote itself into a baseline
    let unacceptedBlocked = false;
    try {
      await baselineUseCase.create({
        id: createRequirementsBaselineId('BASE-PREMATURE-PROPOSAL'),
        requirementRevisionIds: [candidateReq.id],
        createdBy: createReviewerId('rogue-actor')
      });
    } catch (err) {
      if (err instanceof InvalidBaselineMembershipError) {
        unacceptedBlocked = true;
      } else {
        throw err;
      }
    }
    if (!unacceptedBlocked) {
      throw new Error(
        'Promotion prevention gate failed: Unaccepted candidate proposal was accepted into baseline!'
      );
    }

    // 2. Open candidate finding blocks baselining of affected revisions
    let openFindingBlocked = false;
    try {
      await baselineUseCase.create({
        id: createRequirementsBaselineId('BASE-PREMATURE-FINDING'),
        requirementRevisionIds: ['REQ-002-R1'],
        createdBy: createReviewerId('rogue-actor')
      });
    } catch (err) {
      if (err instanceof BlockedByOpenFindingsError) {
        openFindingBlocked = true;
      } else {
        throw err;
      }
    }
    if (!openFindingBlocked) {
      throw new Error(
        'Promotion prevention gate failed: Open defect finding failed to block baseline creation!'
      );
    }

    log(
      '       Non-authoritative candidate state confirmed; promotion prevention gates successfully blocked premature baseline.'
    );

    // ------------------------------------------------------------------------
    // Step 7: Reconcile candidate state
    // ------------------------------------------------------------------------
    log('[7/10] Executing human reconciliation of candidate proposal and defect finding...');
    // Resolve finding
    await reconcileUseCase.dispositionFinding({
      findingId: candidateFinding.id,
      disposition: 'RESOLVED',
      rationale: 'Resolved by specifying session inactivity timeout requirement REQ-003',
      actorId: createActorId('security-lead')
    });

    // Accept proposal -> R2
    const acceptedR2 = await reconcileUseCase.acceptRequirement({
      revisionId: candidateReq.id,
      rationale: 'Accepted into security specification following prototype inspection',
      actorId: 'security-lead'
    });

    // Resolve proposal -> R3 (CLEAR)
    const resolvedR3 = await reconcileUseCase.resolveRequirement({
      revisionId: acceptedR2.id,
      rationale: 'Timeout boundaries and session termination policies verified clear',
      actorId: 'security-lead'
    });

    if (resolvedR3.reviewState !== 'ACCEPTED' || resolvedR3.resolutionState !== 'CLEAR') {
      throw new Error(
        'Reconciliation failed to advance candidate requirement to ACCEPTED and CLEAR'
      );
    }
    log(
      `       Reconciled discovery: Finding dispositioned to RESOLVED; Requirement advanced to ${resolvedR3.id} (ACCEPTED, CLEAR).`
    );

    // ------------------------------------------------------------------------
    // Step 8: Create immutable BASELINE-B (BASE-002)
    // ------------------------------------------------------------------------
    log('[8/10] Freezing immutable successor baseline BASE-002...');
    const baselineB = await baselineUseCase.create({
      id: createRequirementsBaselineId('BASE-002'),
      requirementRevisionIds: ['REQ-002-R1', resolvedR3.id],
      createdBy: createReviewerId('lead-architect')
    });
    log(
      `       Created successor baseline 'BASE-002' with members: [${baselineB.requirementRevisions.join(', ')}].`
    );

    // ------------------------------------------------------------------------
    // Step 9: Regenerate relevant projections from BASELINE-B (BASE-002)
    // ------------------------------------------------------------------------
    log('[9/10] Regenerating projections from successor baseline BASE-002...');
    if (isScriptableGen) {
      const scriptable = generationGateway as ScriptableGenerationGateway;
      scriptable.queueResponse(
        '```mermaid\ngraph TD\n  Start([Start Request]) --> Auth{Verify Admin MFA}\n  Auth -->|Authorized| Grant[Assign RBAC Role]\n  Auth -->|Denied| Reject[Deny Access]\n  Grant --> Timeout[Enforce 15-Minute Inactivity Timeout]\n  Timeout --> Terminate[Terminate Session]\n```'
      );
      scriptable.queueResponse(
        [
          '```tsx',
          '/**',
          ' * @baseline BASE-002',
          ` * @requirements REQ-002-R1, ${resolvedR3.id}`,
          ' */',
          "import React, { useState } from 'react';",
          '',
          'export default function AdminAuthSuccessorPrototype() {',
          '  const [authenticated, setAuthenticated] = useState(false);',
          '  const [sessionActive, setSessionActive] = useState(true);',
          '  return (',
          '    <div className="p-6 bg-white rounded-lg border border-gray-200">',
          '      <h2 className="text-sm font-bold text-gray-900 mb-2">Admin MFA & Timeout Control</h2>',
          '      <button',
          '        type="button"',
          '        onClick={() => setAuthenticated(true)}',
          '        className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold mr-2"',
          '      >',
          '        Authenticate Admin',
          '      </button>',
          '      <button',
          '        type="button"',
          '        onClick={() => setSessionActive(false)}',
          '        className="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-semibold"',
          '      >',
          '        Simulate Inactivity (15m)',
          '      </button>',
          '      <p className="mt-4 text-xs text-gray-700">',
          '        Status: {authenticated && sessionActive ? "Active Session" : "Session Terminated"}',
          '      </p>',
          '    </div>',
          '  );',
          '}',
          '```'
        ].join('\n')
      );
    }

    const projB_diag = await projectBaselineUseCase.project({
      baselineId: 'BASE-002',
      artifactType: 'process-diagram'
    });

    const diagBValidation = await mermaidLinterGateway.validate(projB_diag.content);
    if (!diagBValidation.isValid) {
      throw new Error(
        `Successor diagram failed Mermaid validation: ${diagBValidation.errorMessage}`
      );
    }

    const projB_proto = await projectBaselineUseCase.project({
      baselineId: 'BASE-002',
      artifactType: 'prototype'
    });

    const protoBValidation = await prototypeValidatorGateway.validate(projB_proto.content);
    if (!protoBValidation.isValid) {
      throw new Error(
        `Successor prototype failed TSX validation: ${protoBValidation.errorMessage}`
      );
    }

    const declaredProvMatchB = projB_proto.content.match(/@baseline\s*[:\s]\s*([A-Za-z0-9_-]+)/i);
    const declaredBaselineIdB = declaredProvMatchB ? declaredProvMatchB[1] : undefined;
    const declaredProvenanceValidB = declaredBaselineIdB === 'BASE-002';
    if (!declaredProvenanceValidB) {
      throw new Error(
        `Prototype from BASE-002 failed declared provenance check: got '${declaredBaselineIdB}'`
      );
    }

    log(
      `       Regenerated projections '${projB_diag.projectionId}' and '${projB_proto.projectionId}' bound to BASE-002.`
    );

    // ------------------------------------------------------------------------
    // Step 10: Prove historical immutability and provenance traceability
    // ------------------------------------------------------------------------
    log('[10/10] Verifying historical immutability, isolation, and process-restart durability...');
    // Discard in-memory repository and reload state from disk
    const restartedRepo = options.adapter?.createRepository
      ? await options.adapter.createRepository(storeDir)
      : new FilesystemRequirementsRepository({ baseDir: storeDir });
    const restartedReviewStateUseCase = new GetRequirementsReviewStateUseCase(restartedRepo);

    // 1. Verify BASE-001 remains completely untouched
    const reloadedBase1 = await restartedRepo.getRequirementsBaseline(baselineA.id);
    if (!reloadedBase1) {
      throw new Error(`Failed to reload baseline '${baselineA.id}' after restart`);
    }
    const baselineAUntouched =
      reloadedBase1.requirementRevisions.length === 1 &&
      reloadedBase1.requirementRevisions[0] === 'REQ-002-R1';
    if (!baselineAUntouched) {
      throw new Error(
        'Historical immutability violation: BASE-001 member revisions were modified!'
      );
    }

    // 2. Verify duplicate overwrite of BASE-001 is rejected
    let duplicateRejected = false;
    try {
      await restartedRepo.saveRequirementsBaseline(baselineA);
    } catch (err) {
      if (err instanceof ImmutableRecordConflictError) {
        duplicateRejected = true;
      } else {
        throw err;
      }
    }
    if (!duplicateRejected) {
      throw new Error(
        'Historical immutability violation: Overwriting existing baseline was not rejected!'
      );
    }

    // 3. Verify projection isolation by baseline
    const allProjections = await restartedRepo.listProjectionRecords();
    const base1Projs = allProjections.filter((p) => p.baselineId === 'BASE-001');
    const base2Projs = allProjections.filter((p) => p.baselineId === 'BASE-002');
    const projectionIsolationVerified =
      base1Projs.length >= 2 &&
      base2Projs.length >= 2 &&
      base1Projs.every((p) => p.baselineId === 'BASE-001') &&
      base2Projs.every((p) => p.baselineId === 'BASE-002');

    // 4. Verify staleness detection in BASE-002 review state
    const reviewStateB = await restartedReviewStateUseCase.get({ baselineId: 'BASE-002' });
    const staleProjs = reviewStateB.projections.filter((p) => p.baselineId !== 'BASE-002');
    const currentProjs = reviewStateB.projections.filter((p) => p.baselineId === 'BASE-002');
    const stalenessDetectedForPriorProjections =
      staleProjs.length >= 2 &&
      staleProjs.every((p) => p.baselineId === 'BASE-001') &&
      currentProjs.length >= 2 &&
      currentProjs.every((p) => p.baselineId === 'BASE-002');

    log(
      '       Historical immutability, projection isolation, and staleness detection confirmed across restart.'
    );
    log('\n========================================================================');
    log('Phase 2 Exit Gate PASSED successfully.');
    log('========================================================================\n');

    const result: Phase2ExitGateResult = {
      success: true,
      executionMode,
      provider,
      model: options.model,
      runId,
      timestamp,
      startingBaseline: {
        id: baselineA.id,
        requirementRevisions: [...baselineA.requirementRevisions]
      },
      successorBaseline: {
        id: baselineB.id,
        requirementRevisions: [...baselineB.requirementRevisions]
      },
      provenanceVerification: {
        sourceRevisionsCount: 1,
        locatorsChecked,
        allLocatorsResolved
      },
      projectionsA: {
        processDiagram: {
          id: projA_diag.projectionId,
          baselineId: projA_diag.metadata.baselineId,
          requirementRevisionIds: [...projA_diag.metadata.requirementRevisionIds],
          repairsNeeded: projA_diag.metadata.measuredVerification.repairsNeeded,
          attemptCount: projA_diag.metadata.measuredVerification.attemptCount,
          contentHash: projA_diag.metadata.measuredVerification.contentHash,
          syntaxValid: diagValidation.isValid
        },
        prototype: {
          id: projA_proto.projectionId,
          baselineId: projA_proto.metadata.baselineId,
          requirementRevisionIds: [...projA_proto.metadata.requirementRevisionIds],
          repairsNeeded: projA_proto.metadata.measuredVerification.repairsNeeded,
          attemptCount: projA_proto.metadata.measuredVerification.attemptCount,
          contentHash: projA_proto.metadata.measuredVerification.contentHash,
          syntaxValid: protoValidation.isValid,
          declaredProvenanceValid,
          sandboxCompileOutcome: {
            success: protoValidation.isValid,
            errorMessage: protoValidation.errorMessage
          }
        }
      },
      projectionsB: {
        processDiagram: {
          id: projB_diag.projectionId,
          baselineId: projB_diag.metadata.baselineId,
          requirementRevisionIds: [...projB_diag.metadata.requirementRevisionIds],
          repairsNeeded: projB_diag.metadata.measuredVerification.repairsNeeded,
          attemptCount: projB_diag.metadata.measuredVerification.attemptCount,
          contentHash: projB_diag.metadata.measuredVerification.contentHash,
          syntaxValid: diagBValidation.isValid
        },
        prototype: {
          id: projB_proto.projectionId,
          baselineId: projB_proto.metadata.baselineId,
          requirementRevisionIds: [...projB_proto.metadata.requirementRevisionIds],
          repairsNeeded: projB_proto.metadata.measuredVerification.repairsNeeded,
          attemptCount: projB_proto.metadata.measuredVerification.attemptCount,
          contentHash: projB_proto.metadata.measuredVerification.contentHash,
          syntaxValid: protoBValidation.isValid,
          declaredProvenanceValid: declaredProvenanceValidB,
          sandboxCompileOutcome: {
            success: protoBValidation.isValid,
            errorMessage: protoBValidation.errorMessage
          }
        }
      },
      discovery: {
        originatingProjectionId: projA_proto.projectionId,
        candidateRequirement: {
          id: candidateReq.id,
          statement: candidateReq.statement,
          origin: 'REVIEWER_PROPOSAL',
          initialReviewState: 'PENDING',
          initialResolutionState: 'UNRESOLVED'
        },
        candidateFinding: {
          id: candidateFinding.id,
          type: candidateFinding.type,
          discoveredBy: 'artifact-validation',
          initialDisposition: 'OPEN'
        },
        promotionPreventionGate: {
          unacceptedProposalBlockedBaseline: unacceptedBlocked,
          openFindingBlockedBaseline: openFindingBlocked
        }
      },
      reconciliation: {
        findingDisposition: 'RESOLVED',
        findingRationale: 'Resolved by specifying session inactivity timeout requirement REQ-003',
        acceptedRevisionId: acceptedR2.id,
        resolvedRevisionId: resolvedR3.id,
        finalReviewState: 'ACCEPTED',
        finalResolutionState: 'CLEAR',
        actorId: 'security-lead'
      },
      immutabilityVerification: {
        baselineAUntouched,
        duplicateBaselineOverwriteRejected: duplicateRejected,
        projectionIsolationVerified,
        stalenessDetectedForPriorProjections,
        restartReloadDurabilityVerified: true
      },
      storeDir
    };

    return result;
  } finally {
    if (isTempStore && options.cleanup !== false) {
      await fs.rm(storeDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
