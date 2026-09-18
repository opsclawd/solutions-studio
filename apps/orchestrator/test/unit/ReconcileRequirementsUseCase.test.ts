import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createRequirementId,
  createRequirementRevisionId,
  createFindingId,
  createSourceRevisionId,
  createEvidenceLocator,
  createRequirementRevision,
  createCandidateFinding,
  createInstant,
  FindingRationaleRequiredError
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { ReconcileRequirementsUseCase } from '../../src/application/use-cases/ReconcileRequirementsUseCase.js';
import {
  AlreadyClearError,
  InvalidTransitionError,
  RationaleRequiredError,
  StaleRevisionTargetError,
  UnknownCandidateFindingError,
  UnknownRequirementRevisionError
} from '../../src/application/use-cases/ReconciliationErrors.js';

describe('ReconcileRequirementsUseCase', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let useCase: ReconcileRequirementsUseCase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconcile-usecase-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    useCase = new ReconcileRequirementsUseCase(repo);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('acceptRequirement', () => {
    it('accepts a PENDING candidate requirement creating an immutable successor and audit record', async () => {
      const reqId = createRequirementId('REQ-100');
      const r1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-100-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Auto-close valve if pressure exceeds 900 PSI',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'PENDING',
        resolutionState: 'UNRESOLVED',
        evidence: [
          {
            sourceRevisionId: createSourceRevisionId('SRC-1-R1'),
            locator: createEvidenceLocator('valve#1')
          }
        ]
      });
      await repo.saveRequirementRevision(r1);

      const r2 = await useCase.acceptRequirement({
        revisionId: r1.id,
        rationale: 'Verified with engineering lead',
        actorId: 'LEAD-1'
      });

      expect(r2.id).toBe('REQ-100-R2');
      expect(r2.revision).toBe(2);
      expect(r2.supersedes).toBe(r1.id);
      expect(r2.reviewState).toBe('ACCEPTED');
      expect(r2.resolutionState).toBe('UNRESOLVED');
      expect(r2.origin).toBe('EXPLICIT');
      expect(r2.statement).toBe(r1.statement);

      // Predecessor is untouched
      const reloadedR1 = await repo.getRequirementRevision(r1.id);
      expect(reloadedR1!.reviewState).toBe('PENDING');

      // Audit history
      const history = await repo.listReconciliationRecords('requirement', reqId);
      expect(history).toHaveLength(1);
      expect(history[0].action).toBe('ACCEPT');
      expect(history[0].previousReviewState).toBeUndefined();
      expect(history[0].newReviewState).toBe('ACCEPTED');
      expect(history[0].rationale).toBe('Verified with engineering lead');
      expect(history[0].actorId).toBe('LEAD-1');
    });

    it('accepts an explicit assumption or proposal preserving its origin', async () => {
      const reqId = createRequirementId('REQ-ASSUME-1');
      const r1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ASSUME-1-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Assume default valve threshold is 800 PSI',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'PENDING',
        resolutionState: 'UNRESOLVED'
      });
      await repo.saveRequirementRevision(r1);

      const r2 = await useCase.acceptRequirement({
        revisionId: r1.id,
        rationale: 'Accepted assumption per operations lead agreement'
      });

      expect(r2.reviewState).toBe('ACCEPTED');
      expect(r2.origin).toBe('ASSUMED'); // Origin preserved!
      expect(r2.supersedes).toBe(r1.id);

      const history = await repo.listReconciliationRecords('requirement', reqId);
      expect(history[0].action).toBe('ACCEPT');
      expect(history[0].newReviewState).toBe('ACCEPTED');
    });

    it('accepts GENERATED_PROPOSAL and REVIEWER_PROPOSAL preserving origin', async () => {
      for (const origin of ['GENERATED_PROPOSAL', 'REVIEWER_PROPOSAL'] as const) {
        const reqId = createRequirementId(`REQ-${origin}`);
        const r1 = createRequirementRevision({
          id: createRequirementRevisionId(`REQ-${origin}-R1`),
          requirementId: reqId,
          revision: 1,
          statement: `Proposal statement for ${origin}`,
          category: 'business-rule',
          origin,
          reviewState: 'PENDING',
          resolutionState: 'UNRESOLVED'
        });
        await repo.saveRequirementRevision(r1);

        const r2 = await useCase.acceptRequirement({
          revisionId: r1.id,
          rationale: `Human accepted proposal ${origin}`
        });

        expect(r2.reviewState).toBe('ACCEPTED');
        expect(r2.origin).toBe(origin);
      }
    });

    it('rejects accepting when requirement is already ACCEPTED or REJECTED', async () => {
      const reqId = createRequirementId('REQ-ALREADY-ACCEPTED');
      const r1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ALREADY-ACCEPTED-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Already accepted',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(r1);

      await expect(
        useCase.acceptRequirement({
          revisionId: r1.id,
          rationale: 'Attempt duplicate accept'
        })
      ).rejects.toThrow(InvalidTransitionError);
    });

    it('rejects accepting with empty or whitespace rationale', async () => {
      const reqId = createRequirementId('REQ-NO-RAT');
      const r1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-NO-RAT-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Pending requirement',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'PENDING'
      });
      await repo.saveRequirementRevision(r1);

      await expect(
        useCase.acceptRequirement({
          revisionId: r1.id,
          rationale: '   '
        })
      ).rejects.toThrow(RationaleRequiredError);
    });

    it('rejects accepting a stale revision target', async () => {
      const reqId = createRequirementId('REQ-STALE-1');
      const r1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-STALE-1-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'First rev',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'PENDING'
      });
      const r2 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-STALE-1-R2'),
        requirementId: reqId,
        revision: 2,
        statement: 'Second rev',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'PENDING',
        supersedes: r1.id
      });
      await repo.saveRequirementRevision(r1);
      await repo.saveRequirementRevision(r2);

      await expect(
        useCase.acceptRequirement({
          revisionId: r1.id,
          rationale: 'Targeting old revision'
        })
      ).rejects.toThrow(StaleRevisionTargetError);
    });

    it('rejects unknown revision', async () => {
      await expect(
        useCase.acceptRequirement({
          revisionId: 'NON-EXISTENT-R1',
          rationale: 'No revision'
        })
      ).rejects.toThrow(UnknownRequirementRevisionError);
    });
  });

  describe('rejectRequirement', () => {
    it('rejects a PENDING requirement creating an immutable successor with reviewState=REJECTED', async () => {
      const reqId = createRequirementId('REQ-REJ-1');
      const r1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-REJ-1-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Out of scope requirement',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'PENDING'
      });
      await repo.saveRequirementRevision(r1);

      const r2 = await useCase.rejectRequirement({
        revisionId: r1.id,
        rationale: 'Out of scope for Phase 1',
        actorId: 'LEAD-1'
      });

      expect(r2.id).toBe('REQ-REJ-1-R2');
      expect(r2.reviewState).toBe('REJECTED');
      expect(r2.supersedes).toBe(r1.id);

      const history = await repo.listReconciliationRecords('requirement', reqId);
      expect(history).toHaveLength(1);
      expect(history[0].action).toBe('REJECT');
      expect(history[0].newReviewState).toBe('REJECTED');
    });

    it('rejects non-PENDING requirements', async () => {
      const reqId = createRequirementId('REQ-REJ-2');
      const r1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-REJ-2-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Rejected requirement',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'REJECTED'
      });
      await repo.saveRequirementRevision(r1);

      await expect(
        useCase.rejectRequirement({
          revisionId: r1.id,
          rationale: 'Cannot reject again'
        })
      ).rejects.toThrow(InvalidTransitionError);
    });
  });

  describe('reviseRequirement', () => {
    it('meaning-changing edit produces successor with reviewState=PENDING and resolutionState=UNRESOLVED', async () => {
      const reqId = createRequirementId('REQ-REV-1');
      const r1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-REV-1-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Initial requirement 500 PSI',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'PENDING',
        resolutionState: 'UNRESOLVED',
        evidence: [
          {
            sourceRevisionId: createSourceRevisionId('S-1'),
            locator: createEvidenceLocator('h#1')
          }
        ]
      });
      const r2 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-REV-1-R2'),
        requirementId: reqId,
        revision: 2,
        statement: 'Initial requirement 500 PSI',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: r1.evidence,
        supersedes: r1.id
      });
      await repo.saveRequirementRevision(r1);
      await repo.saveRequirementRevision(r2);

      // Record prior acceptance + resolve on r2
      await repo.appendReconciliationRecord({
        id: 'REC-PRIOR-1',
        entityType: 'requirement',
        entityId: reqId,
        requirementRevisionId: r2.id,
        action: 'RESOLVE',
        previousReviewState: undefined,
        newReviewState: 'ACCEPTED',
        previousResolutionState: 'UNRESOLVED',
        newResolutionState: 'CLEAR',
        rationale: 'Initial acceptance and resolution',
        recordedAt: createInstant('2026-09-16T09:00:00.000Z')
      });

      const r3 = await useCase.reviseRequirement({
        revisionId: r2.id,
        statement: 'Updated requirement 800 PSI',
        rationale: 'Updated pressure threshold based on safety standard'
      });

      expect(r3.id).toBe('REQ-REV-1-R3');
      expect(r3.statement).toBe('Updated requirement 800 PSI');
      expect(r3.reviewState).toBe('PENDING'); // reset to PENDING
      expect(r3.resolutionState).toBe('UNRESOLVED'); // reset to UNRESOLVED
      expect(r3.supersedes).toBe(r2.id);

      // Old revision is untouched
      const reloadedR2 = await repo.getRequirementRevision(r2.id);
      expect(reloadedR2!.reviewState).toBe('ACCEPTED');
      expect(reloadedR2!.resolutionState).toBe('CLEAR');

      // Audit record has CLEAR -> UNRESOLVED
      const history = await repo.listReconciliationRecords('requirement', reqId);
      expect(history).toHaveLength(2);
      const revRecord = history[1];
      expect(revRecord.action).toBe('REVISE');
      expect(revRecord.previousReviewState).toBe('ACCEPTED');
      expect(revRecord.newReviewState).toBe('PENDING');
      expect(revRecord.previousResolutionState).toBe('CLEAR');
      expect(revRecord.newResolutionState).toBe('UNRESOLVED');
    });

    it('revising a REJECTED candidate acts as an explicit reopen to PENDING even when meaning is unchanged', async () => {
      const reqId = createRequirementId('REQ-REOPEN-1');
      const r1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-REOPEN-1-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Previously rejected statement',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'REJECTED',
        resolutionState: 'UNRESOLVED'
      });
      await repo.saveRequirementRevision(r1);

      await repo.appendReconciliationRecord({
        id: 'REC-REJ-INIT',
        entityType: 'requirement',
        entityId: reqId,
        requirementRevisionId: r1.id,
        action: 'REJECT',
        previousReviewState: undefined,
        newReviewState: 'REJECTED',
        rationale: 'Initially rejected',
        recordedAt: createInstant('2026-09-16T09:00:00.000Z')
      });

      const r2 = await useCase.reviseRequirement({
        revisionId: r1.id,
        rationale: 'Reopening for reconsideration in sprint 2'
      });

      expect(r2.id).toBe('REQ-REOPEN-1-R2');
      expect(r2.reviewState).toBe('PENDING'); // Explicitly reopened to PENDING!
      expect(r2.supersedes).toBe(r1.id);

      const history = await repo.listReconciliationRecords('requirement', reqId);
      expect(history).toHaveLength(2);
      expect(history[1].action).toBe('REVISE');
      expect(history[1].previousReviewState).toBe('REJECTED');
      expect(history[1].newReviewState).toBe('PENDING');
    });
  });

  describe('resolveRequirement', () => {
    it('forks a non-CLEAR revision with resolutionState=CLEAR preserving reviewState', async () => {
      const reqId = createRequirementId('REQ-RESOLVE-1');
      const r1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-RESOLVE-1-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Valve must close when commanded',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'UNRESOLVED',
        evidence: [
          {
            sourceRevisionId: createSourceRevisionId('S-1'),
            locator: createEvidenceLocator('valve#1')
          }
        ]
      });
      await repo.saveRequirementRevision(r1);

      await repo.appendReconciliationRecord({
        id: 'REC-ACCEPT-INIT',
        entityType: 'requirement',
        entityId: reqId,
        requirementRevisionId: r1.id,
        action: 'ACCEPT',
        previousReviewState: undefined,
        newReviewState: 'ACCEPTED',
        rationale: 'Accepted initial requirement',
        recordedAt: createInstant('2026-09-16T09:00:00.000Z')
      });

      const r2 = await useCase.resolveRequirement({
        revisionId: r1.id,
        rationale: 'Resolved timing ambiguity through team review',
        actorId: 'REV-01'
      });

      expect(r2.id).toBe('REQ-RESOLVE-1-R2');
      expect(r2.resolutionState).toBe('CLEAR');
      expect(r2.reviewState).toBe('ACCEPTED'); // Preserved!
      expect(r2.origin).toBe('EXPLICIT');
      expect(r2.supersedes).toBe(r1.id);

      const history = await repo.listReconciliationRecords('requirement', reqId);
      expect(history).toHaveLength(2);
      expect(history[1].action).toBe('RESOLVE');
      expect(history[1].previousResolutionState).toBe('UNRESOLVED');
      expect(history[1].newResolutionState).toBe('CLEAR');
      expect(history[1].previousReviewState).toBe('ACCEPTED');
      expect(history[1].newReviewState).toBe('ACCEPTED');
    });

    it('rejects resolving a requirement that is already CLEAR', async () => {
      const reqId = createRequirementId('REQ-ALREADY-CLEAR');
      const r1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ALREADY-CLEAR-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Clear requirement',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(r1);

      await expect(
        useCase.resolveRequirement({
          revisionId: r1.id,
          rationale: 'Already clear'
        })
      ).rejects.toThrow(AlreadyClearError);
    });
  });

  describe('dispositionFinding and reopenFinding', () => {
    it('dispositions finding to RESOLVED, DISMISSED_FALSE_POSITIVE, and ACCEPTED_RISK with auditable rationale', async () => {
      const f1 = createCandidateFinding({
        id: createFindingId('FINDING-DISP-1'),
        type: 'missing-authorization',
        discoveredBy: 'model'
      });
      await repo.saveCandidateFinding(f1);

      // RESOLVED
      const fResolved = await useCase.dispositionFinding({
        findingId: f1.id,
        disposition: 'RESOLVED',
        rationale: 'Added role requirements in R2'
      });
      expect(fResolved.disposition).toBe('RESOLVED');
      expect(fResolved.rationale).toBe('Added role requirements in R2');

      // DISMISSED_FALSE_POSITIVE
      const fDismissed = await useCase.dispositionFinding({
        findingId: f1.id,
        disposition: 'DISMISSED_FALSE_POSITIVE',
        rationale: 'Clarified that authorization is handled by outer proxy'
      });
      expect(fDismissed.disposition).toBe('DISMISSED_FALSE_POSITIVE');

      // ACCEPTED_RISK
      const fRisk = await useCase.dispositionFinding({
        findingId: f1.id,
        disposition: 'ACCEPTED_RISK',
        rationale: 'Risk accepted for internal trusted subnet'
      });
      expect(fRisk.disposition).toBe('ACCEPTED_RISK');

      const history = await repo.listReconciliationRecords('finding', f1.id);
      expect(history).toHaveLength(3);
      expect(history[0].newDisposition).toBe('RESOLVED');
      expect(history[1].newDisposition).toBe('DISMISSED_FALSE_POSITIVE');
      expect(history[2].newDisposition).toBe('ACCEPTED_RISK');
    });

    it('rejects disposition without rationale for non-OPEN states', async () => {
      const f1 = createCandidateFinding({
        id: createFindingId('FINDING-NO-RAT'),
        type: 'temporal-ambiguity',
        discoveredBy: 'model'
      });
      await repo.saveCandidateFinding(f1);

      await expect(
        useCase.dispositionFinding({
          findingId: f1.id,
          disposition: 'RESOLVED',
          rationale: '   '
        })
      ).rejects.toThrow(FindingRationaleRequiredError);
    });

    it('reopens a finding with custom or deterministic default rationale', async () => {
      const f1 = createCandidateFinding({
        id: createFindingId('FINDING-REOPEN'),
        type: 'contradiction',
        discoveredBy: 'model'
      });
      await repo.saveCandidateFinding(f1);

      await useCase.dispositionFinding({
        findingId: f1.id,
        disposition: 'RESOLVED',
        rationale: 'Prior resolution'
      });

      // Reopen with default rationale
      const reopened1 = await useCase.reopenFinding({
        findingId: f1.id
      });
      expect(reopened1.disposition).toBe('OPEN');

      const history = await repo.listReconciliationRecords('finding', f1.id);
      expect(history).toHaveLength(2);
      expect(history[0].newDisposition).toBe('RESOLVED');
      expect(history[1].previousDisposition).toBe('RESOLVED');
      expect(history[1].newDisposition).toBe('OPEN');
      expect(history[1].rationale).toBe('Reopened candidate finding');
    });

    it('rejects reopening an already OPEN finding', async () => {
      const f1 = createCandidateFinding({
        id: createFindingId('FINDING-OPEN'),
        type: 'contradiction',
        discoveredBy: 'model'
      });
      await repo.saveCandidateFinding(f1);

      await expect(
        useCase.reopenFinding({
          findingId: f1.id
        })
      ).rejects.toThrow(InvalidTransitionError);
    });

    it('rejects dispositioning or reopening unknown finding', async () => {
      await expect(
        useCase.dispositionFinding({
          findingId: 'NON-EXISTENT',
          disposition: 'RESOLVED',
          rationale: 'Some rationale'
        })
      ).rejects.toThrow(UnknownCandidateFindingError);

      await expect(
        useCase.reopenFinding({
          findingId: 'NON-EXISTENT'
        })
      ).rejects.toThrow(UnknownCandidateFindingError);
    });
  });
});
