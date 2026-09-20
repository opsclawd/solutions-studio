import { describe, it, expect } from 'vitest';
import { runPhase4ExitGate } from '../harness/runPhase4ExitGate.js';
import { createPhase4TestAdapter } from '../harness/createPhase4ExitGateAdapter.js';

describe('Phase 4.7 — End-to-End Production-Readiness Exit Gate', () => {
  it('executes the full 15-step Required Scenario deterministically', async () => {
    const adapter = createPhase4TestAdapter();
    const result = await runPhase4ExitGate({
      adapter,
      silent: true,
      cleanup: true
    });

    // High-level certification
    expect(result.success).toBe(true);
    expect(result.pilotReady).toBe(true);
    expect(result.candidateSha).toBeDefined();

    // Step 1: Persistence outcome
    expect(result.persistenceOutcome.schemaVersion).toBe(5);
    expect(result.persistenceOutcome.tablesPresent).toBe(18);
    expect(result.persistenceOutcome.migrationsApplied).toBe(5);
    expect(result.persistenceOutcome.databaseClientType).toBe('pglite');

    // Step 2: Identity boundary
    expect(result.identityOutcome.providerNeutralBoundaryVerified).toBe(true);
    expect(result.identityOutcome.personasTested).toBe(6);
    expect(result.identityOutcome.oidcMode).toBe('test');

    // Step 3: Authorization gating
    expect(result.authorizationOutcome.commandsGated).toBe(4);
    expect(result.authorizationOutcome.forbiddenErrorsCaught).toBe(4);
    expect(result.authorizationOutcome.authzFailureTelemetryEmitted).toBe(true);

    // Step 4: Handoff on Postgres
    expect(result.handoffFlowOutcome.baselineId).toBe('BASE-002');
    expect(result.handoffFlowOutcome.predecessorBaselineId).toBe('BASE-001');
    expect(result.handoffFlowOutcome.requirementCoverage).toBe(1.0);
    expect(result.handoffFlowOutcome.storyReadiness).toBe(1.0);
    expect(result.handoffFlowOutcome.handoffBundleReady).toBe(true);
    expect(result.handoffFlowOutcome.artifactHashesVerified).toBe(true);

    // Step 5: Immutable validation evidence
    expect(result.validationEvidenceOutcome.immutableRecordPersisted).toBe(true);
    expect(result.validationEvidenceOutcome.evidenceDigest).toBeDefined();
    expect(result.validationEvidenceOutcome.validationRunId).toBeDefined();

    // Step 6: Generated GO text rejection
    expect(result.generatedGoPreventionOutcome.simulatedGoTextInjected).toBe(true);
    expect(result.generatedGoPreventionOutcome.isApproved).toBe(false);
    expect(result.generatedGoPreventionOutcome.disposition).toBe('UNAPPROVED');
    expect(result.generatedGoPreventionOutcome.diagnostic).toBe('AWAITING_APPROVAL');
    expect(result.generatedGoPreventionOutcome.agentApprovalRejected).toBe(true);

    // Step 7: Human approval
    expect(result.humanApprovalOutcome.isApproved).toBe(true);
    expect(result.humanApprovalOutcome.disposition).toBe('APPROVED');
    expect(result.humanApprovalOutcome.diagnostic).toBe('PROMOTION_READY');
    expect(result.humanApprovalOutcome.actorType).toBe('human');
    expect(result.humanApprovalOutcome.approvalRecordId).toBeDefined();

    // Step 8: Backlog export safety
    expect(result.backlogExportOutcome.exportedStoryCount).toBe(2);
    expect(result.backlogExportOutcome.realExternalMutationPrevented).toBe(true);
    expect(result.backlogExportOutcome.mappingsPersisted).toBe(2);

    // Step 9: Export idempotency
    expect(result.exportIdempotencyOutcome.isIdempotent).toBe(true);
    expect(result.exportIdempotencyOutcome.providerCallsOnRepeat).toBe(0);
    expect(result.exportIdempotencyOutcome.unchangedItemCount).toBe(2);

    // Step 10: Staleness and impact tracking
    expect(result.stalenessImpactOutcome.successorBaselineId).toBe('BASE-003');
    expect(result.stalenessImpactOutcome.stalenessDetected).toBe(true);
    expect(['STALE', 'IMPACTED']).toContain(result.stalenessImpactOutcome.classification);
    expect(result.stalenessImpactOutcome.unconfirmedOverwriteBlocked).toBe(true);

    // Step 11: Backup, restore & restart
    expect(result.backupRestoreRestartOutcome.snapshotTableCount).toBe(18);
    expect(result.backupRestoreRestartOutcome.tamperDetectionVerified).toBe(true);
    expect(result.backupRestoreRestartOutcome.checksumMismatchCaught).toBe(true);
    expect(result.backupRestoreRestartOutcome.bitForBitRestorationVerified).toBe(true);
    expect(result.backupRestoreRestartOutcome.restartServerHealthy).toBe(true);

    // Step 12: Concurrency conflict behavior
    expect(result.concurrencyConflictOutcome.typedConflictErrorsVerified).toBe(true);
    expect(result.concurrencyConflictOutcome.optimisticStoryConflictCaught).toBe(true);
    expect(result.concurrencyConflictOutcome.duplicateBaselineConflictCaught).toBe(true);
    expect(result.concurrencyConflictOutcome.racingApprovalConflictCaught).toBe(true);

    // Step 13: Dependency failure safety
    expect(result.dependencyFailureSafetyOutcome.oidcFailureHandled).toBe(true);
    expect(result.dependencyFailureSafetyOutcome.persistenceFailureHandled).toBe(true);
    expect(result.dependencyFailureSafetyOutcome.generationFailureHandled).toBe(true);
    expect(result.dependencyFailureSafetyOutcome.validationFailureHandled).toBe(true);
    expect(result.dependencyFailureSafetyOutcome.backlogFailureHandled).toBe(true);
    expect(result.dependencyFailureSafetyOutcome.failClosedVerified).toBe(true);

    // Step 14: Sensitive data zero-leak redaction
    expect(result.observabilityRedactionOutcome.bearerTokenRedacted).toBe(true);
    expect(result.observabilityRedactionOutcome.passwordRedacted).toBe(true);
    expect(result.observabilityRedactionOutcome.piiEmailRedacted).toBe(true);
    expect(result.observabilityRedactionOutcome.piiPhoneRedacted).toBe(true);
    expect(result.observabilityRedactionOutcome.connectionStringRedacted).toBe(true);
    expect(result.observabilityRedactionOutcome.zeroLeakInvariantMaintained).toBe(true);

    // Step 15: Prior phase gates green
    expect(result.priorPhaseGatesOutcome.phase1Passed).toBe(true);
    expect(result.priorPhaseGatesOutcome.phase2Passed).toBe(true);
    expect(result.priorPhaseGatesOutcome.phase3Passed).toBe(true);
    expect(result.priorPhaseGatesOutcome.allPriorGatesGreen).toBe(true);
  }, 120000);
});
