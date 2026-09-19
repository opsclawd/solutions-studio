import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runPhase3ExitGate } from '../harness/runPhase3ExitGate.js';
import { createPhase3TestAdapter } from '../harness/createPhase3ExitGateAdapter.js';
import { generateMarkdownReport } from '../../scripts/run-phase-3-exit-gate.js';

describe('Phase 3.7 — End-to-End Engineering Handoff Exit Gate & Candidate Validation', () => {
  it('executes the full 15-step Required Scenario deterministically', async () => {
    const adapter = createPhase3TestAdapter();
    const result = await runPhase3ExitGate({
      adapter,
      silent: true,
      cleanup: false
    });

    try {
      // Complete 15-step exit gate must succeed
      expect(result.success).toBe(true);
      expect(result.executionMode).toBe('deterministic-ci');
      expect(result.provider).toBe('fake');

      // Observed identities for all 6 generated projections must match provider
      expect(result.observedIdentities).toHaveLength(6);
      expect(result.observedIdentities.every((id) => id.provider === 'fake')).toBe(true);

      // Step 1: Starting baseline identities & policy constraints
      expect(result.startingBaseline.id).toBe('BASE-001');
      expect(result.startingBaseline.requirementRevisions).toEqual([
        'REQ-ORD-01-R1',
        'REQ-ORD-02-R1'
      ]);
      expect(result.startingBaseline.policyConstraintRevisions).toEqual(['POL-SEC-01-R1']);

      // Step 2 & 3: SQL projection & isolated PostgreSQL runtime (PGlite)
      expect(result.sqlValidationOutcome.isValid).toBe(true);
      expect(result.sqlValidationOutcome.repairsNeededA).toBeLessThanOrEqual(2);
      expect(result.sqlValidationOutcome.repairsNeededB).toBeLessThanOrEqual(2);

      // Step 4: OpenAPI projection & structural validation (3.1.0) & schema cross-validation
      expect(result.openApiValidationOutcome.isValid).toBe(true);
      expect(result.openApiValidationOutcome.openApiVersion).toBe('3.1.0');
      expect(result.openApiValidationOutcome.crossValidationPassed).toBe(true);
      expect(result.openApiValidationOutcome.repairsNeededA).toBeLessThanOrEqual(2);
      expect(result.openApiValidationOutcome.repairsNeededB).toBeLessThanOrEqual(2);

      // Step 5: Technical choice represented as EngineeringDecision (not business requirement)
      expect(result.initialEngineeringDecision.id).toBe('ED-001');
      expect(result.initialEngineeringDecision.baselineId).toBe('BASE-001');
      expect(result.initialEngineeringDecision.initialStartingState).toBe('PROPOSED');
      expect(result.initialEngineeringDecision.state).toBe('ACCEPTED');

      // Step 6 & 7: Product ambiguity represented as finding & fail-closed readiness gate
      expect(result.discoveryAndReadinessGate.candidateFindingId).toBe('FIND-001');
      expect(result.discoveryAndReadinessGate.findingType).toBe('incomplete-state-machine');
      expect(result.discoveryAndReadinessGate.initialDisposition).toBe('OPEN');
      expect(result.discoveryAndReadinessGate.candidateStoryId).toBe('STORY-ORD-001-CANDIDATE');
      expect(result.discoveryAndReadinessGate.readinessFailedClosed).toBe(true);
      expect(result.discoveryAndReadinessGate.blockingRuleId).toBe('no-blocking-open-findings');
      expect(result.discoveryAndReadinessGate.handoffBlocked).toBe(true);

      // Step 8: Human authority reconciliation & dynamic revision lineage resolution
      expect(result.reconciliation.findingDisposition).toBe('RESOLVED');
      expect(result.reconciliation.finalReviewState).toBe('ACCEPTED');
      expect(result.reconciliation.finalResolutionState).toBe('CLEAR');
      expect(result.reconciliation.revisedRevisionId).toMatch(/REQ-ORD-01-R2/);
      expect(result.reconciliation.acceptedRevisionId).toMatch(/REQ-ORD-01-R3/);
      expect(result.reconciliation.resolvedRevisionId).toMatch(/REQ-ORD-01-R4/);

      // Successor baseline BASE-002 binds to resolved requirement revision
      expect(result.successorBaseline.id).toBe('BASE-002');
      expect(result.successorBaseline.requirementRevisions).toEqual([
        result.reconciliation.resolvedRevisionId,
        'REQ-ORD-02-R1'
      ]);
      expect(result.successorBaseline.policyConstraintRevisions).toEqual(['POL-SEC-01-R1']);

      // Step 9: Successor engineering decision ED-002 supersedes ED-001 on BASE-002
      expect(result.successorEngineeringDecision.id).toBe('ED-002');
      expect(result.successorEngineeringDecision.baselineId).toBe('BASE-002');
      expect(result.successorEngineeringDecision.supersedes).toBe('ED-001');
      expect(result.successorEngineeringDecision.state).toBe('ACCEPTED');

      // Step 10: Stories generated and traceable
      expect(result.storiesOutcome.count).toBe(2);
      expect(result.storiesOutcome.storyIds).toEqual(['STORY-001', 'STORY-002']);
      expect(result.storiesOutcome.allTraceable).toBe(true);
      expect(result.storiesOutcome.gherkinValid).toBe(true);
      expect(result.storiesOutcome.repairsNeededStory1).toBe(0);
      expect(result.storiesOutcome.repairsNeededStory2).toBe(0);
      expect(result.storiesOutcome.projectionHashes['STORY-001']).toBeDefined();
      expect(result.storiesOutcome.projectionHashes['STORY-002']).toBeDefined();

      // Step 11: Requirement coverage is deterministic
      expect(result.coverageOutcome.totalRequirements).toBe(2);
      expect(result.coverageOutcome.coveredCount).toBe(2);
      expect(result.coverageOutcome.uncoveredCount).toBe(0);
      expect(result.coverageOutcome.isFullyCovered).toBe(true);

      // Step 12: Story readiness is deterministic
      expect(result.finalReadinessOutcome.allStoriesReady).toBe(true);
      expect(result.finalReadinessOutcome.readyCount).toBe(2);
      expect(result.finalReadinessOutcome.nonReadyCount).toBe(0);

      // Step 13: Story dependency graph is valid, acyclic, machine-readable
      expect(result.dependencyGraphOutcome.isAcyclic).toBe(true);
      expect(result.dependencyGraphOutcome.isValid).toBe(true);
      expect(result.dependencyGraphOutcome.nodeCount).toBe(2);
      expect(result.dependencyGraphOutcome.edgeCount).toBe(1);

      // Step 14: Engineering handoff bundle is implementation-ready
      expect(result.handoffBundle.isHandoffReady).toBe(true);
      expect(result.handoffBundle.summary.openBlockingFindings).toBe(0);
      expect(result.handoffBundle.summary.readyStories).toBe(2);
      expect(result.handoffBundle.summary.coveredRequirements).toBe(2);
      expect(result.handoffBundle.contentHashesVerified).toBe(true);
      expect(result.handoffBundle.engineeringDecisionsCount).toBeGreaterThanOrEqual(1);

      // Verify hashes for all 4 contract and story projections are defined and non-empty
      expect(result.handoffBundle.hashes.sql).toMatch(/^[a-f0-9]{64}$/);
      expect(result.handoffBundle.hashes.openApi).toMatch(/^[a-f0-9]{64}$/);
      expect(result.handoffBundle.hashes.story1).toMatch(/^[a-f0-9]{64}$/);
      expect(result.handoffBundle.hashes.story2).toMatch(/^[a-f0-9]{64}$/);

      // Step 15: Historical immutability, predecessor isolation, process restart durability
      expect(result.immutabilityVerification.baselineAUntouched).toBe(true);
      expect(result.immutabilityVerification.duplicateBaselineOverwriteRejected).toBe(true);
      expect(result.immutabilityVerification.predecessorProjectionsIsolated).toBe(true);
      expect(result.immutabilityVerification.restartReloadDurabilityVerified).toBe(true);
      expect(result.immutabilityVerification.predecessorSnapshotsVerified).toBe(true);
      expect(result.immutabilityVerification.snapshotCount).toBe(6);
      expect(result.immutabilityVerification.reloadedProcessPid).not.toBe(process.pid);

      // Independent inspection of persisted artifacts on disk
      const story1Path = path.join(result.storeDir, 'stories', 'STORY-001.json');
      const story1Json = JSON.parse(await fs.readFile(story1Path, 'utf8'));
      expect(story1Json.gherkinText).toContain(
        `@requirements:${result.reconciliation.resolvedRevisionId}`
      );
      expect(story1Json.baselineId).toBe('BASE-002');

      const story2Path = path.join(result.storeDir, 'stories', 'STORY-002.json');
      const story2Json = JSON.parse(await fs.readFile(story2Path, 'utf8'));
      expect(story2Json.gherkinText).toContain('@requirements:REQ-ORD-02-R1');
      expect(story2Json.baselineId).toBe('BASE-002');
      expect(story2Json.dependencies).toEqual(['STORY-001']);
    } finally {
      await fs.rm(result.storeDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 30000);

  it('rejects injected test adapter when provider is non-fake (fake-as-real guard)', async () => {
    const adapter = createPhase3TestAdapter();
    await expect(
      runPhase3ExitGate({
        provider: 'agy',
        model: 'gemini-3.8-flash-high',
        adapter,
        silent: true
      })
    ).rejects.toThrow(/Injected test adapter rejected/);
  });

  it('rejects real-provider execution when model is not explicitly provided', async () => {
    await expect(
      runPhase3ExitGate({
        provider: 'agy',
        silent: true
      })
    ).rejects.toThrow(/Model must be explicitly specified/);
  });

  it('adversarial witness: fails closed when same-ID predecessor content is mutated', async () => {
    const adapter = createPhase3TestAdapter();
    await expect(
      runPhase3ExitGate({
        adapter,
        adversarialMutatePredecessor: true,
        silent: true
      })
    ).rejects.toThrow(/Historical immutability violation/);
  }, 30000);

  it('runner report generation correctly renders measured values and suppresses positive invariants on run failure', async () => {
    const adapter = createPhase3TestAdapter();
    const passingResult = await runPhase3ExitGate({
      adapter,
      silent: true
    });

    const failedRun = {
      runIndex: 1,
      runId: 'RUN-FAIL-001',
      durationMs: 4200,
      success: false,
      error: 'Simulated connection timeout during schema generation'
    };

    const mixedSummaries = [
      failedRun,
      {
        runIndex: 2,
        runId: 'RUN-PASS-002',
        durationMs: 12500,
        success: true,
        result: passingResult
      }
    ];

    const mixedReport = generateMarkdownReport(
      { provider: 'fake', runs: 2, cleanup: true, silent: true },
      mixedSummaries,
      16700
    );

    // Negative assertion: status must be FAILED and positive invariant witness must be suppressed
    expect(mixedReport).toContain('**FAILED (One or more runs failed)**');
    expect(mixedReport).toContain('Invariants NOT certified: One or more validation runs failed.');
    expect(mixedReport).toContain('Simulated connection timeout during schema generation');

    // Positive assertion: when all runs succeed, measured report is affirmative
    const allPassingSummaries = [
      {
        runIndex: 1,
        runId: 'RUN-PASS-001',
        durationMs: 11000,
        success: true,
        result: passingResult
      }
    ];

    const passingReport = generateMarkdownReport(
      { provider: 'fake', runs: 1, cleanup: true, silent: true },
      allPassingSummaries,
      11000
    );

    expect(passingReport).toContain('**PASSED (All runs successful)**');
    expect(passingReport).toContain('## Invariants Witness');
    expect(passingReport).toContain('100% (2/2)');
    expect(passingReport).toContain('2/2');
    expect(passingReport).toContain('Verified');
  }, 30000);
});
