import { describe, it, expect } from 'vitest';
import {
  createCandidateFinding,
  createFindingId,
  createRequirementRevisionId,
  createSourceRevisionId,
  createEvidenceLocator,
  createRequirementId,
  resolveFinding,
  dismissAsFalsePositive,
  acceptRisk,
  reopenFinding,
  createEvidenceReference,
  createActorId,
  createRequirementsBaselineId,
  FINDING_DISPOSITIONS,
  FindingRationaleRequiredError,
  DomainError
} from '../../src/index.js';

describe('CandidateFinding', () => {
  it('creates an open candidate finding by default', () => {
    const evidence = [
      createEvidenceReference(
        createSourceRevisionId('INT-004@r1'),
        createEvidenceLocator('heading#1')
      )
    ];
    const finding = createCandidateFinding({
      id: createFindingId('FINDING-01'),
      type: 'contradiction',
      affectedRequirementRevisions: [
        createRequirementRevisionId('R-142@r1'),
        createRequirementRevisionId('R-143@r1')
      ],
      evidence,
      discoveredBy: 'model'
    });

    expect(finding.id).toBe('FINDING-01');
    expect(finding.type).toBe('contradiction');
    expect(finding.disposition).toBe('OPEN');
    expect(finding.affectedRequirementRevisions).toEqual(['R-142@r1', 'R-143@r1']);
    expect(finding.rationale).toBeUndefined();
    expect(Object.isFrozen(finding)).toBe(true);
  });

  it('defensively recreates and freezes each evidence reference', () => {
    const mutableRef = {
      sourceRevisionId: createSourceRevisionId('INT-004@r1'),
      locator: createEvidenceLocator('heading#1')
    };
    const finding = createCandidateFinding({
      id: createFindingId('FINDING-01'),
      type: 'contradiction',
      evidence: [mutableRef],
      discoveredBy: 'model'
    });

    expect(Object.isFrozen(finding.evidence)).toBe(true);
    expect(Object.isFrozen(finding.evidence[0])).toBe(true);

    mutableRef.sourceRevisionId = createSourceRevisionId('INT-004@r2');
    mutableRef.locator = createEvidenceLocator('other#9');

    expect(finding.evidence[0].sourceRevisionId).toBe('INT-004@r1');
    expect(finding.evidence[0].locator).toBe('heading#1');
  });

  it('supports all four standard finding dispositions: OPEN, RESOLVED, DISMISSED_FALSE_POSITIVE, ACCEPTED_RISK', () => {
    expect(FINDING_DISPOSITIONS).toContain('OPEN');
    expect(FINDING_DISPOSITIONS).toContain('RESOLVED');
    expect(FINDING_DISPOSITIONS).toContain('DISMISSED_FALSE_POSITIVE');
    expect(FINDING_DISPOSITIONS).toContain('ACCEPTED_RISK');

    for (const disposition of FINDING_DISPOSITIONS) {
      const finding = createCandidateFinding({
        id: createFindingId(`FINDING-${disposition}`),
        type: 'missing-authorization',
        discoveredBy: 'heuristic',
        disposition,
        rationale: disposition !== 'OPEN' ? 'Auditable rationale' : undefined
      });
      expect(finding.disposition).toBe(disposition);
    }
  });

  describe('Direct factory audit invariant for terminal dispositions', () => {
    const terminalDispositions = ['RESOLVED', 'DISMISSED_FALSE_POSITIVE', 'ACCEPTED_RISK'] as const;

    for (const disposition of terminalDispositions) {
      it(`rejects ${disposition} when rationale is omitted, empty, or whitespace-only`, () => {
        expect(() =>
          createCandidateFinding({
            id: createFindingId('FINDING-TEST'),
            type: 'temporal-ambiguity',
            discoveredBy: 'model',
            disposition
          })
        ).toThrow(FindingRationaleRequiredError);

        expect(() =>
          createCandidateFinding({
            id: createFindingId('FINDING-TEST'),
            type: 'temporal-ambiguity',
            discoveredBy: 'model',
            disposition,
            rationale: ''
          })
        ).toThrow(FindingRationaleRequiredError);

        expect(() =>
          createCandidateFinding({
            id: createFindingId('FINDING-TEST'),
            type: 'temporal-ambiguity',
            discoveredBy: 'model',
            disposition,
            rationale: '   '
          })
        ).toThrow(FindingRationaleRequiredError);
      });
    }
  });

  it('transitions to RESOLVED, requiring non-empty rationale, returning a new frozen object', () => {
    const openFinding = createCandidateFinding({
      id: createFindingId('FINDING-01'),
      type: 'temporal-ambiguity',
      discoveredBy: 'model'
    });

    expect(() => resolveFinding(openFinding, '')).toThrow(FindingRationaleRequiredError);
    expect(() => resolveFinding(openFinding, '   ')).toThrow(FindingRationaleRequiredError);

    const resolved = resolveFinding(
      openFinding,
      'Clarified SLA with product owner; 4-hour window agreed.'
    );

    expect(resolved.disposition).toBe('RESOLVED');
    expect(resolved.rationale).toBe('Clarified SLA with product owner; 4-hour window agreed.');
    expect(Object.isFrozen(resolved)).toBe(true);

    // Original finding remains OPEN and untouched
    expect(openFinding.disposition).toBe('OPEN');
    expect(openFinding.rationale).toBeUndefined();
  });

  it('transitions to DISMISSED_FALSE_POSITIVE, requiring rationale without mutating previous', () => {
    const finding = createCandidateFinding({
      id: createFindingId('FINDING-02'),
      type: 'unsupported-assumption',
      discoveredBy: 'model'
    });

    expect(() => dismissAsFalsePositive(finding, '')).toThrow(FindingRationaleRequiredError);

    const dismissed = dismissAsFalsePositive(
      finding,
      'Heuristic misidentified SOP reference as unverified assumption.'
    );

    expect(dismissed.disposition).toBe('DISMISSED_FALSE_POSITIVE');
    expect(dismissed.rationale).toBe(
      'Heuristic misidentified SOP reference as unverified assumption.'
    );
    expect(finding.disposition).toBe('OPEN');
  });

  it('transitions to ACCEPTED_RISK, requiring rationale without mutating previous', () => {
    const finding = createCandidateFinding({
      id: createFindingId('FINDING-03'),
      type: 'data-boundary-ambiguity',
      discoveredBy: 'human'
    });

    expect(() => acceptRisk(finding, '')).toThrow(FindingRationaleRequiredError);

    const accepted = acceptRisk(
      finding,
      'Accepting edge case cardinality constraint until Phase 2 integration.'
    );

    expect(accepted.disposition).toBe('ACCEPTED_RISK');
    expect(finding.disposition).toBe('OPEN');
  });

  it('reopens a resolved finding without mutating the resolved finding', () => {
    const finding = createCandidateFinding({
      id: createFindingId('FINDING-04'),
      type: 'missing-failure-recovery',
      discoveredBy: 'artifact-validation'
    });

    const resolved = resolveFinding(finding, 'Fixed in revision 2');
    const reopened = reopenFinding(resolved, 'New evidence reveals failure case still exists');

    expect(reopened.disposition).toBe('OPEN');
    expect(reopened.rationale).toBe('New evidence reveals failure case still exists');
    expect(resolved.disposition).toBe('RESOLVED');
  });

  it('accepts and preserves baselineId, originatingProjectionId, and actorId across disposition transitions and reopen', () => {
    const finding = createCandidateFinding({
      id: createFindingId('FINDING-CTX'),
      type: 'missing-authorization',
      discoveredBy: 'artifact-validation',
      baselineId: createRequirementsBaselineId('BASELINE-001'),
      originatingProjectionId: 'PROJ-001',
      actorId: createActorId('auditor-1')
    });

    expect(finding.baselineId).toBe('BASELINE-001');
    expect(finding.originatingProjectionId).toBe('PROJ-001');
    expect(finding.actorId).toBe('auditor-1');
    expect(Object.isFrozen(finding)).toBe(true);

    const resolved = resolveFinding(finding, 'Resolution rationale');
    expect(resolved.baselineId).toBe('BASELINE-001');
    expect(resolved.originatingProjectionId).toBe('PROJ-001');
    expect(resolved.actorId).toBe('auditor-1');

    const reopened = reopenFinding(resolved, 'Reopen rationale');
    expect(reopened.baselineId).toBe('BASELINE-001');
    expect(reopened.originatingProjectionId).toBe('PROJ-001');
    expect(reopened.actorId).toBe('auditor-1');

    const dismissed = dismissAsFalsePositive(finding, 'Dismissal rationale');
    expect(dismissed.baselineId).toBe('BASELINE-001');
    expect(dismissed.originatingProjectionId).toBe('PROJ-001');
    expect(dismissed.actorId).toBe('auditor-1');

    const riskAccepted = acceptRisk(finding, 'Accept risk rationale');
    expect(riskAccepted.baselineId).toBe('BASELINE-001');
    expect(riskAccepted.originatingProjectionId).toBe('PROJ-001');
    expect(riskAccepted.actorId).toBe('auditor-1');
  });

  it('rejects invalid finding type or discoveredBy values', () => {
    expect(() =>
      createCandidateFinding({
        id: createFindingId('FINDING-ERR'),
        type: 'invalid-type' as any,
        discoveredBy: 'model'
      })
    ).toThrow(DomainError);

    expect(() =>
      createCandidateFinding({
        id: createFindingId('FINDING-ERR'),
        type: 'contradiction',
        discoveredBy: 'alien' as any
      })
    ).toThrow(DomainError);
  });

  describe('Compile-time nominal type enforcement', () => {
    it('enforces exact branded types on createCandidateFinding', () => {
      const findingId = createFindingId('F-1');
      const reqId = createRequirementId('R-1');

      // @ts-expect-error - rejects unbranded string in id
      createCandidateFinding({ id: 'F-1', type: 'contradiction', discoveredBy: 'model' });
      // @ts-expect-error - rejects RequirementId in FindingId position
      createCandidateFinding({ id: reqId, type: 'contradiction', discoveredBy: 'model' });
      createCandidateFinding({
        id: findingId,
        type: 'contradiction',
        discoveredBy: 'model',
        // @ts-expect-error - rejects unbranded string in affectedRequirementRevisions
        affectedRequirementRevisions: ['R-1@r1']
      });
    });
  });
});
