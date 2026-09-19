import { describe, it, expect } from 'vitest';
import { runPhase2ExitGate } from '../harness/runPhase2ExitGate.js';
import { createPhase2TestAdapter } from '../harness/createPhase2ExitGateAdapter.js';

describe('Phase 2.7 — End-to-End Phase 2 Exit Gate & Candidate Validation', () => {
  it('executes the full 10-step Required Scenario deterministically', async () => {
    const adapter = createPhase2TestAdapter();
    const result = await runPhase2ExitGate({
      adapter,
      silent: true
    });

    // Complete 10-step exit gate must succeed
    expect(result.success).toBe(true);
    expect(result.executionMode).toBe('deterministic-ci');
    expect(result.provider).toBe('fake');

    // Step 1: Baseline identities
    expect(result.startingBaseline.id).toBe('BASE-001');
    expect(result.startingBaseline.requirementRevisions).toEqual(['REQ-002-R1']);

    // Step 2: Evidence provenance & locator resolution
    expect(result.provenanceVerification.allLocatorsResolved).toBe(true);
    expect(result.provenanceVerification.locatorsChecked).toBeGreaterThan(0);

    // Step 3: Process diagram projection from BASE-001 with closed-loop repair
    const diagA = result.projectionsA.processDiagram;
    expect(diagA.baselineId).toBe('BASE-001');
    expect(diagA.requirementRevisionIds).toEqual(['REQ-002-R1']);
    expect(diagA.syntaxValid).toBe(true);
    expect(diagA.repairsNeeded).toBeLessThanOrEqual(2);
    expect(diagA.attemptCount).toBeGreaterThanOrEqual(1);

    // Step 4: Interactive prototype projection from BASE-001
    const protoA = result.projectionsA.prototype;
    expect(protoA.baselineId).toBe('BASE-001');
    expect(protoA.requirementRevisionIds).toEqual(['REQ-002-R1']);
    expect(protoA.syntaxValid).toBe(true);
    expect(protoA.declaredProvenanceValid).toBe(true);
    expect(protoA.sandboxCompileOutcome.success).toBe(true);

    // Step 5 & 6: Discovery non-authoritative candidate state & promotion prevention gates
    expect(result.discovery.candidateRequirement.origin).toBe('REVIEWER_PROPOSAL');
    expect(result.discovery.candidateRequirement.initialReviewState).toBe('PENDING');
    expect(result.discovery.candidateRequirement.initialResolutionState).toBe('UNRESOLVED');
    expect(result.discovery.candidateFinding.initialDisposition).toBe('OPEN');
    expect(result.discovery.candidateFinding.discoveredBy).toBe('artifact-validation');

    // Negative assertions: artifact directly promoting itself is strictly rejected
    expect(result.discovery.promotionPreventionGate.unacceptedProposalBlockedBaseline).toBe(true);
    expect(result.discovery.promotionPreventionGate.openFindingBlockedBaseline).toBe(true);

    // Step 7: Human reconciliation
    expect(result.reconciliation.findingDisposition).toBe('RESOLVED');
    expect(result.reconciliation.finalReviewState).toBe('ACCEPTED');
    expect(result.reconciliation.finalResolutionState).toBe('CLEAR');
    expect(result.reconciliation.acceptedRevisionId).toMatch(/REQ-003-R2/);
    expect(result.reconciliation.resolvedRevisionId).toMatch(/REQ-003-R3/);

    // Step 8: Successor baseline BASE-002
    expect(result.successorBaseline.id).toBe('BASE-002');
    expect(result.successorBaseline.requirementRevisions).toEqual([
      'REQ-002-R1',
      result.reconciliation.resolvedRevisionId
    ]);

    // Step 9: Projections regenerated from BASE-002
    const diagB = result.projectionsB.processDiagram;
    expect(diagB.baselineId).toBe('BASE-002');
    expect(diagB.requirementRevisionIds).toContain('REQ-002-R1');
    expect(diagB.requirementRevisionIds).toContain(result.reconciliation.resolvedRevisionId);
    expect(diagB.syntaxValid).toBe(true);

    const protoB = result.projectionsB.prototype;
    expect(protoB.baselineId).toBe('BASE-002');
    expect(protoB.requirementRevisionIds).toContain('REQ-002-R1');
    expect(protoB.requirementRevisionIds).toContain(result.reconciliation.resolvedRevisionId);
    expect(protoB.syntaxValid).toBe(true);
    expect(protoB.declaredProvenanceValid).toBe(true);
    expect(protoB.sandboxCompileOutcome.success).toBe(true);

    // Step 10: Immutability, isolation, and restart reload durability
    expect(result.immutabilityVerification.baselineAUntouched).toBe(true);
    expect(result.immutabilityVerification.duplicateBaselineOverwriteRejected).toBe(true);
    expect(result.immutabilityVerification.projectionIsolationVerified).toBe(true);
    expect(result.immutabilityVerification.stalenessDetectedForPriorProjections).toBe(true);
    expect(result.immutabilityVerification.restartReloadDurabilityVerified).toBe(true);
  });
});
