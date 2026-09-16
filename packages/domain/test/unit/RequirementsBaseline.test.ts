import { describe, it, expect } from 'vitest';
import {
  createRequirementsBaseline,
  createRequirementsBaselineId,
  createReviewerId,
  createRequirementId,
  createRequirementRevisionId,
  createSourceRevisionId,
  createEvidenceLocator,
  createEvidenceReference,
  validateBaselineMembership,
  createRequirementRevision,
  InvalidBaselineMembershipError,
  DomainError
} from '../../src/index.js';

describe('RequirementsBaseline', () => {
  const validEvidence = [
    createEvidenceReference(
      createSourceRevisionId('INT-004@r1'),
      createEvidenceLocator('business-logic#1')
    )
  ];

  it('creates an immutable baseline with exact revision IDs when all requirements are valid', () => {
    const r1 = createRequirementRevision({
      id: createRequirementRevisionId('R-100@r2'),
      requirementId: createRequirementId('R-100'),
      revision: 2,
      statement: 'Valve must auto-close if pressure exceeds 900 PSI.',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: validEvidence
    });

    const r2 = createRequirementRevision({
      id: createRequirementRevisionId('R-101@r1'),
      requirementId: createRequirementId('R-101'),
      revision: 1,
      statement: 'Standard retry window is 30 seconds.',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASELINE-17'),
      requirements: [r1, r2],
      createdBy: createReviewerId('REV-01')
    });

    expect(baseline.id).toBe('BASELINE-17');
    expect(baseline.requirementRevisions).toEqual(['R-100@r2', 'R-101@r1']);
    expect(baseline.createdBy).toBe('REV-01');
    expect(Object.isFrozen(baseline)).toBe(true);
    expect(Object.isFrozen(baseline.requirementRevisions)).toBe(true);
  });

  describe('Deterministic rejection of invalid baseline membership', () => {
    it('rejects candidate with reviewState=PENDING', () => {
      const candidate = createRequirementRevision({
        id: createRequirementRevisionId('R-100@r1'),
        requirementId: createRequirementId('R-100'),
        revision: 1,
        statement: 'Pending requirement',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'PENDING',
        resolutionState: 'CLEAR',
        evidence: validEvidence
      });

      const violations = validateBaselineMembership([candidate]);
      expect(violations).toHaveLength(1);
      expect(violations[0].revisionId).toBe('R-100@r1');
      expect(violations[0].reasons.some((r) => r.includes('reviewState=ACCEPTED'))).toBe(true);

      expect(() =>
        createRequirementsBaseline({
          id: createRequirementsBaselineId('BASELINE-01'),
          requirements: [candidate],
          createdBy: createReviewerId('REV-01')
        })
      ).toThrow(InvalidBaselineMembershipError);
    });

    it('rejects candidate with reviewState=REJECTED', () => {
      const candidate = createRequirementRevision({
        id: createRequirementRevisionId('R-100@r1'),
        requirementId: createRequirementId('R-100'),
        revision: 1,
        statement: 'Rejected requirement',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'REJECTED',
        resolutionState: 'CLEAR',
        evidence: validEvidence
      });

      const violations = validateBaselineMembership([candidate]);
      expect(violations).toHaveLength(1);
      expect(violations[0].reasons.some((r) => r.includes('reviewState=ACCEPTED'))).toBe(true);
    });

    it('rejects candidate with resolutionState=CONFLICTED, UNRESOLVED, or SUPERSEDED', () => {
      const conflicted = createRequirementRevision({
        id: createRequirementRevisionId('R-101@r1'),
        requirementId: createRequirementId('R-101'),
        revision: 1,
        statement: 'Conflicted requirement',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CONFLICTED',
        evidence: validEvidence
      });

      const unresolved = createRequirementRevision({
        id: createRequirementRevisionId('R-102@r1'),
        requirementId: createRequirementId('R-102'),
        revision: 1,
        statement: 'Unresolved requirement',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'UNRESOLVED',
        evidence: validEvidence
      });

      const superseded = createRequirementRevision({
        id: createRequirementRevisionId('R-103@r1'),
        requirementId: createRequirementId('R-103'),
        revision: 1,
        statement: 'Superseded requirement',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'SUPERSEDED',
        evidence: validEvidence
      });

      const violations = validateBaselineMembership([conflicted, unresolved, superseded]);
      expect(violations).toHaveLength(3);
      for (const v of violations) {
        expect(v.reasons.some((r) => r.includes('resolutionState=CLEAR'))).toBe(true);
      }
    });

    it('rejects EXPLICIT or INFERRED requirements missing evidence references', () => {
      const noEvidenceExplicit = createRequirementRevision({
        id: createRequirementRevisionId('R-104@r1'),
        requirementId: createRequirementId('R-104'),
        revision: 1,
        statement: 'Explicit without evidence',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: []
      });

      const noEvidenceInferred = createRequirementRevision({
        id: createRequirementRevisionId('R-105@r1'),
        requirementId: createRequirementId('R-105'),
        revision: 1,
        statement: 'Inferred without evidence',
        category: 'business-rule',
        origin: 'INFERRED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: []
      });

      const violations = validateBaselineMembership([noEvidenceExplicit, noEvidenceInferred]);
      expect(violations).toHaveLength(2);
      expect(violations[0].reasons.some((r) => r.includes('at least one evidence reference'))).toBe(
        true
      );
      expect(violations[1].reasons.some((r) => r.includes('at least one evidence reference'))).toBe(
        true
      );
    });

    it('rejects multiple revisions for the same requirement in one baseline', () => {
      const r1 = createRequirementRevision({
        id: createRequirementRevisionId('R-100@r1'),
        requirementId: createRequirementId('R-100'),
        revision: 1,
        statement: 'First version',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: validEvidence
      });

      const r2 = createRequirementRevision({
        id: createRequirementRevisionId('R-100@r2'),
        requirementId: createRequirementId('R-100'),
        revision: 2,
        statement: 'Second version',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: validEvidence
      });

      const violations = validateBaselineMembership([r1, r2]);
      expect(violations).toHaveLength(1);
      expect(violations[0].revisionId).toBe('R-100@r2');
      expect(
        violations[0].reasons.some((r) => r.includes('Duplicate requirement in baseline'))
      ).toBe(true);
    });

    it('rejects an empty requirements list', () => {
      expect(() =>
        createRequirementsBaseline({
          id: createRequirementsBaselineId('BASELINE-EMPTY'),
          requirements: [],
          createdBy: createReviewerId('REV-01')
        })
      ).toThrow(DomainError);
    });
  });

  describe('Baseline membership references exact immutable revision IDs, never latest', () => {
    it('stores exact revision IDs and does not have a latest pointer field', () => {
      const r1 = createRequirementRevision({
        id: createRequirementRevisionId('R-142@r4'),
        requirementId: createRequirementId('R-142'),
        revision: 4,
        statement: 'Supervisor approval required above 800 PSI',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: validEvidence
      });

      const baseline = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASELINE-17'),
        requirements: [r1],
        createdBy: createReviewerId('REV-01')
      });

      // Assert the manifest stores the exact revision identifier R-142@r4
      expect(baseline.requirementRevisions).toContain('R-142@r4');
      expect((baseline as any).latest).toBeUndefined();
    });
  });

  describe('Compile-time nominal type enforcement', () => {
    it('enforces exact branded types on createRequirementsBaseline', () => {
      function _typeChecks() {
        const reviewerId = createReviewerId('REV-1');
        const baselineId = createRequirementsBaselineId('B-1');
        const reqRevId = createRequirementRevisionId('R-1@r1');

        // @ts-expect-error - rejects unbranded string in id
        createRequirementsBaseline({ id: 'B-1', requirements: [], createdBy: reviewerId });
        // @ts-expect-error - rejects unbranded string in createdBy
        createRequirementsBaseline({ id: baselineId, requirements: [], createdBy: 'REV-1' });
        // @ts-expect-error - rejects RequirementRevisionId in id position
        createRequirementsBaseline({ id: reqRevId, requirements: [], createdBy: reviewerId });
      }
      expect(_typeChecks).toBeDefined();
    });
  });
});
