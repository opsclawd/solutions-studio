import { describe, it, expect } from 'vitest';
import {
  createRequirement,
  createRequirementId,
  createRequirementRevision,
  createRequirementRevisionId,
  createSourceRevisionId,
  createEvidenceLocator,
  createEvidenceReference,
  createActorId,
  createReviewerId,
  createRequirementsBaseline,
  createRequirementsBaselineId,
  reviseRequirement,
  REQUIREMENT_ORIGINS,
  REQUIREMENT_REVIEW_STATES,
  REQUIREMENT_RESOLUTION_STATES,
  InvalidRevisionNumberError,
  InvalidBaselineMembershipError,
  DomainError
} from '../../src/index.js';

describe('Requirement and RequirementRevision', () => {
  it('creates an immutable Requirement entity', () => {
    const req = createRequirement(createRequirementId('R-142'));
    expect(req.id).toBe('R-142');
    expect(Object.isFrozen(req)).toBe(true);
  });

  describe('Independent requirement state dimensions', () => {
    it('allows origin=ASSUMED with reviewState=ACCEPTED and resolutionState=CLEAR', () => {
      const revision = createRequirementRevision({
        id: createRequirementRevisionId('R-142@r1'),
        requirementId: createRequirementId('R-142'),
        revision: 1,
        statement: 'System assumes standard 800 PSI operating range.',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });

      expect(revision.origin).toBe('ASSUMED');
      expect(revision.reviewState).toBe('ACCEPTED');
      expect(revision.resolutionState).toBe('CLEAR');
    });

    it('supports all valid combinations of independent state dimensions', () => {
      for (const origin of REQUIREMENT_ORIGINS) {
        for (const reviewState of REQUIREMENT_REVIEW_STATES) {
          for (const resolutionState of REQUIREMENT_RESOLUTION_STATES) {
            const revision = createRequirementRevision({
              id: createRequirementRevisionId(`R-TEST@${origin}-${reviewState}-${resolutionState}`),
              requirementId: createRequirementId('R-TEST'),
              revision: 1,
              statement: 'Sample requirement statement',
              category: 'business-rule',
              origin,
              reviewState,
              resolutionState
            });

            expect(revision.origin).toBe(origin);
            expect(revision.reviewState).toBe(reviewState);
            expect(revision.resolutionState).toBe(resolutionState);
          }
        }
      }
    });

    it('proves an accepted assumption preserves origin=ASSUMED across revision transitions', () => {
      const pendingAssumption = createRequirementRevision({
        id: createRequirementRevisionId('R-142@r1'),
        requirementId: createRequirementId('R-142'),
        revision: 1,
        statement: 'Assume default valve threshold is 800 PSI',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'PENDING',
        resolutionState: 'UNRESOLVED'
      });

      const acceptedAssumption = reviseRequirement(pendingAssumption, {
        id: createRequirementRevisionId('R-142@r2'),
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });

      // The accepted revision must retain origin=ASSUMED
      expect(acceptedAssumption.origin).toBe('ASSUMED');
      expect(acceptedAssumption.reviewState).toBe('ACCEPTED');
      expect(acceptedAssumption.resolutionState).toBe('CLEAR');
      expect(acceptedAssumption.supersedes).toBe(pendingAssumption.id);

      // The original pending revision must still be PENDING
      expect(pendingAssumption.reviewState).toBe('PENDING');
      expect(pendingAssumption.resolutionState).toBe('UNRESOLVED');
    });

    it('proves changing reviewState does not alter origin or resolutionState', () => {
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('R-142@r1'),
        requirementId: createRequirementId('R-142'),
        revision: 1,
        statement: 'Statements must be verified',
        category: 'business-rule',
        origin: 'INFERRED',
        reviewState: 'PENDING',
        resolutionState: 'CONFLICTED'
      });

      const rev2 = reviseRequirement(rev1, {
        id: createRequirementRevisionId('R-142@r2'),
        reviewState: 'ACCEPTED'
      });

      expect(rev2.origin).toBe('INFERRED');
      expect(rev2.reviewState).toBe('ACCEPTED');
      expect(rev2.resolutionState).toBe('CONFLICTED');
    });
  });

  describe('Revision immutability semantics & defensive copying', () => {
    it('creates frozen objects with frozen arrays and defensively copies evidence references', () => {
      const mutableRef = {
        sourceRevisionId: createSourceRevisionId('INT-004@r1'),
        locator: createEvidenceLocator('heading#1')
      };
      const rev = createRequirementRevision({
        id: createRequirementRevisionId('R-142@r1'),
        requirementId: createRequirementId('R-142'),
        revision: 1,
        statement: 'Secondary inspection required above 800 PSI',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: [mutableRef],
        affectedActors: [createActorId('FieldLead')],
        dependencies: [createRequirementId('R-100')]
      });

      expect(Object.isFrozen(rev)).toBe(true);
      expect(Object.isFrozen(rev.evidence)).toBe(true);
      expect(Object.isFrozen(rev.evidence[0])).toBe(true);
      expect(Object.isFrozen(rev.affectedActors)).toBe(true);
      expect(Object.isFrozen(rev.dependencies)).toBe(true);

      // Mutating caller-owned object does not mutate the frozen revision's evidence
      mutableRef.sourceRevisionId = createSourceRevisionId('INT-004@r2');
      mutableRef.locator = createEvidenceLocator('other#9');
      expect(rev.evidence[0].sourceRevisionId).toBe('INT-004@r1');
      expect(rev.evidence[0].locator).toBe('heading#1');
    });

    it('reviseRequirement creates a new frozen revision without mutating previous revision', () => {
      const r1 = createRequirementRevision({
        id: createRequirementRevisionId('R-142@r1'),
        requirementId: createRequirementId('R-142'),
        revision: 1,
        statement: 'Original text',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'PENDING',
        resolutionState: 'UNRESOLVED'
      });

      const originalSnapshot = JSON.stringify(r1);

      const r2 = reviseRequirement(r1, {
        id: createRequirementRevisionId('R-142@r2'),
        statement: 'Updated text with supervisor sign-off',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });

      // Assert r2 has expected updated fields and links
      expect(r2.id).toBe('R-142@r2');
      expect(r2.requirementId).toBe('R-142');
      expect(r2.revision).toBe(2);
      expect(r2.statement).toBe('Updated text with supervisor sign-off');
      expect(r2.reviewState).toBe('ACCEPTED');
      expect(r2.resolutionState).toBe('CLEAR');
      expect(r2.supersedes).toBe(r1.id);
      expect(Object.isFrozen(r2)).toBe(true);

      // Assert r1 was not mutated in place
      expect(JSON.stringify(r1)).toBe(originalSnapshot);
      expect(r1.revision).toBe(1);
      expect(r1.reviewState).toBe('PENDING');
      expect(r1.supersedes).toBeUndefined();
    });

    it('rejects successor revision with the same ID as previous revision', () => {
      const r1 = createRequirementRevision({
        id: createRequirementRevisionId('R-142@r1'),
        requirementId: createRequirementId('R-142'),
        revision: 1,
        statement: 'Original text',
        category: 'business-rule',
        origin: 'EXPLICIT'
      });

      expect(() =>
        reviseRequirement(r1, {
          id: createRequirementRevisionId('R-142@r1'),
          statement: 'Changed text'
        })
      ).toThrow(DomainError);
    });

    it('resets reviewState to PENDING and resolutionState to UNRESOLVED when meaning or provenance changes', () => {
      const evidence = [
        createEvidenceReference(
          createSourceRevisionId('INT-004@r1'),
          createEvidenceLocator('heading#1')
        )
      ];
      const acceptedRev = createRequirementRevision({
        id: createRequirementRevisionId('R-142@r1'),
        requirementId: createRequirementId('R-142'),
        revision: 1,
        statement: 'Supervisor approval required above 800 PSI',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence
      });

      // Baseline with accepted rev succeeds
      const baseline = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASELINE-01'),
        requirements: [acceptedRev],
        createdBy: createReviewerId('REV-01')
      });
      expect(baseline.requirementRevisions).toContain('R-142@r1');

      // Material edit: changing statement without providing reviewState
      const editedSuccessor = reviseRequirement(acceptedRev, {
        id: createRequirementRevisionId('R-142@r2'),
        statement: 'Supervisor and FieldLead approval required above 1200 PSI'
      });

      expect(editedSuccessor.reviewState).toBe('PENDING');
      expect(editedSuccessor.resolutionState).toBe('UNRESOLVED');

      // Attempting to include the edited successor in a baseline fails deterministically
      expect(() =>
        createRequirementsBaseline({
          id: createRequirementsBaselineId('BASELINE-02'),
          requirements: [editedSuccessor],
          createdBy: createReviewerId('REV-01')
        })
      ).toThrow(InvalidBaselineMembershipError);

      // Once explicitly re-reviewed and accepted, it can enter a baseline
      const reaccepted = reviseRequirement(editedSuccessor, {
        id: createRequirementRevisionId('R-142@r3'),
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      const baseline2 = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASELINE-03'),
        requirements: [reaccepted],
        createdBy: createReviewerId('REV-01')
      });
      expect(baseline2.requirementRevisions).toContain('R-142@r3');
    });

    it('resets reviewState to PENDING and resolutionState to UNRESOLVED on affectedActors-only changes', () => {
      const acceptedRev = createRequirementRevision({
        id: createRequirementRevisionId('R-ACTOR@r1'),
        requirementId: createRequirementId('R-ACTOR'),
        revision: 1,
        statement: 'Supervisor approval required',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        affectedActors: [createActorId('Supervisor')]
      });

      const changedActors = reviseRequirement(acceptedRev, {
        id: createRequirementRevisionId('R-ACTOR@r2'),
        affectedActors: [createActorId('Supervisor'), createActorId('FieldLead')]
      });

      expect(changedActors.reviewState).toBe('PENDING');
      expect(changedActors.resolutionState).toBe('UNRESOLVED');

      // Unchanged actors preserves reviewState and resolutionState
      const identicalActors = reviseRequirement(acceptedRev, {
        id: createRequirementRevisionId('R-ACTOR@r3'),
        affectedActors: [createActorId('Supervisor')]
      });
      expect(identicalActors.reviewState).toBe('ACCEPTED');
      expect(identicalActors.resolutionState).toBe('CLEAR');
    });

    it('resets reviewState to PENDING and resolutionState to UNRESOLVED on dependencies-only changes', () => {
      const acceptedRev = createRequirementRevision({
        id: createRequirementRevisionId('R-DEP@r1'),
        requirementId: createRequirementId('R-DEP'),
        revision: 1,
        statement: 'Process valve sequence',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        dependencies: [createRequirementId('R-100')]
      });

      const changedDeps = reviseRequirement(acceptedRev, {
        id: createRequirementRevisionId('R-DEP@r2'),
        dependencies: [createRequirementId('R-100'), createRequirementId('R-200')]
      });

      expect(changedDeps.reviewState).toBe('PENDING');
      expect(changedDeps.resolutionState).toBe('UNRESOLVED');

      // Unchanged dependencies preserves reviewState and resolutionState
      const identicalDeps = reviseRequirement(acceptedRev, {
        id: createRequirementRevisionId('R-DEP@r3'),
        dependencies: [createRequirementId('R-100')]
      });
      expect(identicalDeps.reviewState).toBe('ACCEPTED');
      expect(identicalDeps.resolutionState).toBe('CLEAR');
    });
  });

  describe('Validation rules', () => {
    it('rejects empty statements', () => {
      expect(() =>
        createRequirementRevision({
          id: createRequirementRevisionId('R-142@r1'),
          requirementId: createRequirementId('R-142'),
          revision: 1,
          statement: '   ',
          category: 'business-rule',
          origin: 'EXPLICIT'
        })
      ).toThrow(DomainError);
    });

    it('rejects invalid revision numbers', () => {
      expect(() =>
        createRequirementRevision({
          id: createRequirementRevisionId('R-142@r0'),
          requirementId: createRequirementId('R-142'),
          revision: 0,
          statement: 'Valid statement',
          category: 'business-rule',
          origin: 'EXPLICIT'
        })
      ).toThrow(InvalidRevisionNumberError);
    });

    it('rejects invalid category, origin, reviewState, or resolutionState', () => {
      expect(() =>
        createRequirementRevision({
          id: createRequirementRevisionId('R-142@r1'),
          requirementId: createRequirementId('R-142'),
          revision: 1,
          statement: 'Valid statement',
          category: 'invalid-cat' as any,
          origin: 'EXPLICIT'
        })
      ).toThrow(DomainError);

      expect(() =>
        createRequirementRevision({
          id: createRequirementRevisionId('R-142@r1'),
          requirementId: createRequirementId('R-142'),
          revision: 1,
          statement: 'Valid statement',
          category: 'business-rule',
          origin: 'INVALID_ORIGIN' as any
        })
      ).toThrow(DomainError);
    });
  });

  describe('Compile-time nominal type enforcement', () => {
    it('enforces exact branded types on public record factories', () => {
      const reqId = createRequirementId('R-1');
      const reqRevId = createRequirementRevisionId('R-1@r1');
      const srcRevId = createSourceRevisionId('SRC@r1');

      // @ts-expect-error - rejects unbranded string in createRequirement
      createRequirement('R-1');
      // @ts-expect-error - rejects RequirementRevisionId in createRequirement
      createRequirement(reqRevId);
      createRequirementRevision({
        // @ts-expect-error - rejects unbranded string
        id: 'R-1@r1',
        // @ts-expect-error - rejects unbranded string
        requirementId: 'R-1',
        revision: 1,
        statement: 'Valid',
        category: 'business-rule',
        origin: 'EXPLICIT'
      });
      createRequirementRevision({
        id: reqRevId,
        // @ts-expect-error - rejects SourceRevisionId in requirementId position
        requirementId: srcRevId,
        revision: 1,
        statement: 'Valid',
        category: 'business-rule',
        origin: 'EXPLICIT'
      });
      expect(createRequirement(reqId).id).toBe(reqId);
    });
  });
});
