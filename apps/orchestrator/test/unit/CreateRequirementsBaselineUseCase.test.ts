import { randomUUID } from 'node:crypto';
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
  createReviewerId,
  createRequirementsBaselineId,
  createRequirementRevision,
  createCandidateFinding,
  now,
  InvalidBaselineMembershipError,
  EmptyBaselineError,
  type RequirementRevision,
  type RequirementReviewState
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { ImmutableRecordConflictError } from '../../src/application/ports/persistence/IRequirementsRepository.js';
import { CreateRequirementsBaselineUseCase } from '../../src/application/use-cases/CreateRequirementsBaselineUseCase.js';
import { ReconcileRequirementsUseCase } from '../../src/application/use-cases/ReconcileRequirementsUseCase.js';
import {
  BlockedByOpenFindingsError,
  UnknownRequirementRevisionError,
  UnauditedRequirementRevisionError,
  UnauditedFindingDispositionError
} from '../../src/application/use-cases/ReconciliationErrors.js';

describe('CreateRequirementsBaselineUseCase', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let useCase: CreateRequirementsBaselineUseCase;
  let reconcileUseCase: ReconcileRequirementsUseCase;

  async function recordAcceptance(rev: RequirementRevision, prevReview?: RequirementReviewState) {
    await repo.appendReconciliationRecord({
      id: `REC-${randomUUID()}`,
      entityType: 'requirement',
      entityId: rev.requirementId,
      requirementRevisionId: rev.id,
      action: 'ACCEPT',
      previousReviewState: prevReview,
      newReviewState: 'ACCEPTED',
      rationale: 'Human SME verified in review',
      recordedAt: now()
    });
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baseline-usecase-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    useCase = new CreateRequirementsBaselineUseCase(repo);
    reconcileUseCase = new ReconcileRequirementsUseCase(repo);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates an immutable baseline with exact accepted revision IDs', async () => {
    const r1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R2'),
      requirementId: createRequirementId('REQ-001'),
      revision: 2,
      statement: 'Valve must close if pressure exceeds 900 PSI',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [
        {
          sourceRevisionId: createSourceRevisionId('SRC-1-R1'),
          locator: createEvidenceLocator('valve#1')
        }
      ]
    });

    const r2 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-002-R1'),
      requirementId: createRequirementId('REQ-002'),
      revision: 1,
      statement: 'System retry window is 30 seconds',
      category: 'business-rule',
      origin: 'ASSUMED', // accepted assumption does not require direct evidence
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });

    await repo.saveRequirementRevision(r1);
    await repo.saveRequirementRevision(r2);
    await recordAcceptance(r1);
    await recordAcceptance(r2);

    const baseline = await useCase.create({
      id: createRequirementsBaselineId('BASE-001'),
      requirementRevisionIds: [r1.id, r2.id],
      createdBy: createReviewerId('REV-01')
    });

    expect(baseline.id).toBe('BASE-001');
    expect(baseline.requirementRevisions).toEqual([r1.id, r2.id]);
    expect(baseline.createdBy).toBe('REV-01');

    // Verify persisted
    const loaded = await repo.getRequirementsBaseline(baseline.id);
    expect(loaded).toBeDefined();
    expect(loaded!.requirementRevisions).toEqual([r1.id, r2.id]);
  });

  it('fails deterministically for pending, rejected, and unresolved revisions', async () => {
    const rPending = createRequirementRevision({
      id: createRequirementRevisionId('REQ-PENDING-R1'),
      requirementId: createRequirementId('REQ-PENDING'),
      revision: 1,
      statement: 'Pending',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'PENDING',
      resolutionState: 'CLEAR',
      evidence: [
        { sourceRevisionId: createSourceRevisionId('S-1'), locator: createEvidenceLocator('h#1') }
      ]
    });

    const rRejected = createRequirementRevision({
      id: createRequirementRevisionId('REQ-REJECTED-R1'),
      requirementId: createRequirementId('REQ-REJECTED'),
      revision: 1,
      statement: 'Rejected',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'REJECTED',
      resolutionState: 'CLEAR',
      evidence: [
        { sourceRevisionId: createSourceRevisionId('S-1'), locator: createEvidenceLocator('h#1') }
      ]
    });

    const rUnresolved = createRequirementRevision({
      id: createRequirementRevisionId('REQ-UNRESOLVED-R1'),
      requirementId: createRequirementId('REQ-UNRESOLVED'),
      revision: 1,
      statement: 'Unresolved',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'UNRESOLVED',
      evidence: [
        { sourceRevisionId: createSourceRevisionId('S-1'), locator: createEvidenceLocator('h#1') }
      ]
    });

    await repo.saveRequirementRevision(rPending);
    await repo.saveRequirementRevision(rRejected);
    await repo.saveRequirementRevision(rUnresolved);

    await expect(
      useCase.create({
        requirementRevisionIds: [rPending.id],
        createdBy: 'REV-01'
      })
    ).rejects.toThrow(InvalidBaselineMembershipError);

    await expect(
      useCase.create({
        requirementRevisionIds: [rRejected.id],
        createdBy: 'REV-01'
      })
    ).rejects.toThrow(InvalidBaselineMembershipError);

    await expect(
      useCase.create({
        requirementRevisionIds: [rUnresolved.id],
        createdBy: 'REV-01'
      })
    ).rejects.toThrow(InvalidBaselineMembershipError);
  });

  it('fails deterministically when EXPLICIT requirement lacks evidence', async () => {
    const rNoEv = createRequirementRevision({
      id: createRequirementRevisionId('REQ-NOEV-R1'),
      requirementId: createRequirementId('REQ-NOEV'),
      revision: 1,
      statement: 'Explicit without evidence',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
      // evidence empty
    });
    await repo.saveRequirementRevision(rNoEv);

    await expect(
      useCase.create({
        requirementRevisionIds: [rNoEv.id],
        createdBy: 'REV-01'
      })
    ).rejects.toThrow(InvalidBaselineMembershipError);
  });

  it('fails deterministically on duplicate logical requirements', async () => {
    const r1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-DUP-R1'),
      requirementId: createRequirementId('REQ-DUP'),
      revision: 1,
      statement: 'First version',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    const r2 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-DUP-R2'),
      requirementId: createRequirementId('REQ-DUP'),
      revision: 2,
      statement: 'Second version',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      supersedes: r1.id
    });
    await repo.saveRequirementRevision(r1);
    await repo.saveRequirementRevision(r2);

    await expect(
      useCase.create({
        requirementRevisionIds: [r1.id, r2.id],
        createdBy: 'REV-01'
      })
    ).rejects.toThrow(InvalidBaselineMembershipError);
  });

  it('fails deterministically on empty revision IDs list', async () => {
    await expect(
      useCase.create({
        requirementRevisionIds: [],
        createdBy: 'REV-01'
      })
    ).rejects.toThrow(EmptyBaselineError);
  });

  it('fails deterministically with BlockedByOpenFindingsError when OPEN finding affects ancestor (lineage blocking)', async () => {
    const reqId = createRequirementId('REQ-LINEAGE-1');
    const r1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-LINEAGE-1-R1'),
      requirementId: reqId,
      revision: 1,
      statement: 'Initial version',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [
        { sourceRevisionId: createSourceRevisionId('S-1'), locator: createEvidenceLocator('h#1') }
      ]
    });
    const r2 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-LINEAGE-1-R2'),
      requirementId: reqId,
      revision: 2,
      statement: 'Second version',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: r1.evidence,
      supersedes: r1.id
    });
    const r3 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-LINEAGE-1-R3'),
      requirementId: reqId,
      revision: 3,
      statement: 'Third version proposed for baseline',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: r1.evidence,
      supersedes: r2.id
    });

    await repo.saveRequirementRevision(r1);
    await repo.saveRequirementRevision(r2);
    await repo.saveRequirementRevision(r3);
    await recordAcceptance(r1);

    // Finding names R1 (ancestor of R3) and is OPEN
    const openFinding = createCandidateFinding({
      id: createFindingId('FINDING-ON-R1'),
      type: 'missing-authorization',
      affectedRequirementRevisions: [r1.id],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });
    await repo.saveCandidateFinding(openFinding);

    await expect(
      useCase.create({
        requirementRevisionIds: [r3.id],
        createdBy: 'REV-01'
      })
    ).rejects.toThrow(BlockedByOpenFindingsError);
  });

  it('does NOT block baseline when finding is RESOLVED, DISMISSED_FALSE_POSITIVE, or ACCEPTED_RISK', async () => {
    const reqId = createRequirementId('REQ-NONBLOCK-1');
    const r1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-NONBLOCK-1-R1'),
      requirementId: reqId,
      revision: 1,
      statement: 'Statement 1',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(r1);
    await recordAcceptance(r1);

    const fResolved = createCandidateFinding({
      id: createFindingId('FIND-RESOLVED'),
      type: 'contradiction',
      affectedRequirementRevisions: [r1.id],
      discoveredBy: 'model'
    });
    const fDismissed = createCandidateFinding({
      id: createFindingId('FIND-DISMISSED'),
      type: 'missing-authorization',
      affectedRequirementRevisions: [r1.id],
      discoveredBy: 'model'
    });
    const fRisk = createCandidateFinding({
      id: createFindingId('FIND-RISK'),
      type: 'temporal-ambiguity',
      affectedRequirementRevisions: [r1.id],
      discoveredBy: 'model'
    });

    await repo.saveCandidateFinding(fResolved);
    await repo.saveCandidateFinding(fDismissed);
    await repo.saveCandidateFinding(fRisk);

    await reconcileUseCase.dispositionFinding({
      findingId: fResolved.id,
      disposition: 'RESOLVED',
      rationale: 'Addressed in review'
    });
    await reconcileUseCase.dispositionFinding({
      findingId: fDismissed.id,
      disposition: 'DISMISSED_FALSE_POSITIVE',
      rationale: 'False positive confirmed by architect'
    });
    await reconcileUseCase.dispositionFinding({
      findingId: fRisk.id,
      disposition: 'ACCEPTED_RISK',
      rationale: 'Risk accepted for MVP'
    });

    const baseline = await useCase.create({
      id: createRequirementsBaselineId('BASE-NONBLOCK'),
      requirementRevisionIds: [r1.id],
      createdBy: 'REV-01'
    });

    expect(baseline.id).toBe('BASE-NONBLOCK');
    expect(baseline.requirementRevisions).toEqual([r1.id]);
  });

  it('does NOT block baseline when OPEN finding affects an unrelated requirement', async () => {
    const r1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-PROPOSED-R1'),
      requirementId: createRequirementId('REQ-PROPOSED'),
      revision: 1,
      statement: 'Proposed statement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    const rUnrelated = createRequirementRevision({
      id: createRequirementRevisionId('REQ-UNRELATED-R1'),
      requirementId: createRequirementId('REQ-UNRELATED'),
      revision: 1,
      statement: 'Unrelated statement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED'
    });
    await repo.saveRequirementRevision(r1);
    await repo.saveRequirementRevision(rUnrelated);
    await recordAcceptance(r1);

    const openFinding = createCandidateFinding({
      id: createFindingId('FINDING-UNRELATED'),
      type: 'contradiction',
      affectedRequirementRevisions: [rUnrelated.id],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });
    await repo.saveCandidateFinding(openFinding);

    const baseline = await useCase.create({
      id: createRequirementsBaselineId('BASE-UNRELATED-OK'),
      requirementRevisionIds: [r1.id],
      createdBy: 'REV-01'
    });

    expect(baseline.id).toBe('BASE-UNRELATED-OK');
  });

  it('previously created baseline remains unchanged and reloadable after newer revisions exist', async () => {
    const reqId = createRequirementId('REQ-EVOLVE');
    const r1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-EVOLVE-R1'),
      requirementId: reqId,
      revision: 1,
      statement: 'Original statement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(r1);
    await recordAcceptance(r1);

    const baseline1 = await useCase.create({
      id: createRequirementsBaselineId('BASE-HISTORICAL-1'),
      requirementRevisionIds: [r1.id],
      createdBy: 'REV-01'
    });

    // Create successor revisions R2, R3
    const r2 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-EVOLVE-R2'),
      requirementId: reqId,
      revision: 2,
      statement: 'Updated statement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      supersedes: r1.id
    });
    await repo.saveRequirementRevision(r2);

    const baseline2 = await useCase.create({
      id: createRequirementsBaselineId('BASE-HISTORICAL-2'),
      requirementRevisionIds: [r2.id],
      createdBy: 'REV-01'
    });

    // Reload B1: exactly unchanged, still pointing to exact r1.id, never latest
    const reloadedB1 = await repo.getRequirementsBaseline(baseline1.id);
    expect(reloadedB1).toBeDefined();
    expect(reloadedB1!.id).toBe('BASE-HISTORICAL-1');
    expect(reloadedB1!.requirementRevisions).toEqual([r1.id]);
    expect(reloadedB1!.requirementRevisions).not.toContain(r2.id);

    // Reload B2: pointing to r2.id
    const reloadedB2 = await repo.getRequirementsBaseline(baseline2.id);
    expect(reloadedB2!.requirementRevisions).toEqual([r2.id]);
  });

  it('fails with ImmutableRecordConflictError on repeated baseline save with same ID', async () => {
    const r1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-EXCL-R1'),
      requirementId: createRequirementId('REQ-EXCL'),
      revision: 1,
      statement: 'Exclusive test',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(r1);
    await recordAcceptance(r1);

    await useCase.create({
      id: createRequirementsBaselineId('BASE-EXCL-01'),
      requirementRevisionIds: [r1.id],
      createdBy: 'REV-01'
    });

    // Attempting to overwrite existing baseline ID fails
    await expect(
      useCase.create({
        id: createRequirementsBaselineId('BASE-EXCL-01'),
        requirementRevisionIds: [r1.id],
        createdBy: 'REV-02'
      })
    ).rejects.toThrow(ImmutableRecordConflictError);
  });

  it('fails deterministically when revision ID does not exist in repository', async () => {
    await expect(
      useCase.create({
        requirementRevisionIds: [createRequirementRevisionId('NON-EXISTENT-R1')],
        createdBy: 'REV-01'
      })
    ).rejects.toThrow(UnknownRequirementRevisionError);
  });

  it('fails with UnauditedRequirementRevisionError when directly-saved ACCEPTED revision lacks human acceptance audit history', async () => {
    const r1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-UNAUDITED-R1'),
      requirementId: createRequirementId('REQ-UNAUDITED'),
      revision: 1,
      statement: 'Unaudited statement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(r1);
    // No audit record created!

    await expect(
      useCase.create({
        id: createRequirementsBaselineId('BASE-UNAUDITED-1'),
        requirementRevisionIds: [r1.id],
        createdBy: 'REV-01'
      })
    ).rejects.toThrow(UnauditedRequirementRevisionError);
  });

  it('fails with UnauditedFindingDispositionError when non-OPEN finding affecting proposed lineage closure lacks valid audit history', async () => {
    const r1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-UNAUD-F-R1'),
      requirementId: createRequirementId('REQ-UNAUD-F'),
      revision: 1,
      statement: 'Finding audit test statement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(r1);
    await recordAcceptance(r1);

    // Create finding directly into files with RESOLVED disposition but NO audit record
    const corruptFinding = createCandidateFinding({
      id: createFindingId('FIND-CORRUPT-HIST'),
      type: 'contradiction',
      affectedRequirementRevisions: [r1.id],
      discoveredBy: 'model'
    });
    await repo.saveCandidateFinding(corruptFinding);
    // Directly mutate finding file on disk to simulate missing audit log
    const findingFilePath = path.resolve(tempDir, 'findings', `${corruptFinding.id}.json`);
    await fs.writeFile(
      findingFilePath,
      JSON.stringify({ ...corruptFinding, disposition: 'RESOLVED', rationale: 'Bypassed audit' })
    );

    await expect(
      useCase.create({
        id: createRequirementsBaselineId('BASE-UNAUD-F-1'),
        requirementRevisionIds: [r1.id],
        createdBy: 'REV-01'
      })
    ).rejects.toThrow(UnauditedFindingDispositionError);
  });
});
