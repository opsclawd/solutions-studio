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
  StaleRevisionTargetError,
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

  it('repro Bug 3: rejects creating baseline with a non-latest (stale) revision when requirement has subsequent revisions', async () => {
    const reqId = createRequirementId('REQ-STALE-LINEAGE');
    const r1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-STALE-LINEAGE-R1'),
      requirementId: reqId,
      revision: 1,
      statement: 'Initial statement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED'
    });
    await repo.saveRequirementRevision(r1);

    // Accept R1 -> creates R2 (ACCEPTED, UNRESOLVED)
    const r2 = await reconcileUseCase.acceptRequirement({
      revisionId: r1.id,
      rationale: 'Accepted initial draft'
    });

    // Resolve R2 -> creates R3 (ACCEPTED, CLEAR)
    const r3 = await reconcileUseCase.resolveRequirement({
      revisionId: r2.id,
      rationale: 'Cleared all ambiguities'
    });

    // Meaning-changing revise R3 -> creates R4 (PENDING, UNRESOLVED)
    const r4 = await reconcileUseCase.reviseRequirement({
      revisionId: r3.id,
      statement: 'Materially revised statement requiring re-review',
      rationale: 'Requested scope change'
    });

    // Reject R4 -> creates R5 (REJECTED, UNRESOLVED)
    const r5 = await reconcileUseCase.rejectRequirement({
      revisionId: r4.id,
      rationale: 'Scope change rejected by lead architect'
    });

    expect(r5.revision).toBe(5);
    expect(r5.reviewState).toBe('REJECTED');

    // Attempting to baseline R3 (which is ACCEPTED and CLEAR, but STALE because current latest is R5)
    // must be rejected with StaleRevisionTargetError
    let thrownError: unknown;
    try {
      await useCase.create({
        id: createRequirementsBaselineId('BASE-STALE-TEST'),
        requirementRevisionIds: [r3.id],
        createdBy: 'REV-LEAD-01'
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(StaleRevisionTargetError);
    const staleErr = thrownError as StaleRevisionTargetError;
    expect(staleErr.revisionId).toBe(r3.id);
    expect(staleErr.latestRevisionId).toBe(r5.id);

    // Baseline was not saved
    expect(
      await repo.getRequirementsBaseline(createRequirementsBaselineId('BASE-STALE-TEST'))
    ).toBeUndefined();
  });

  it('repro Bug 1: open findings cannot be silently rewritten to unblock a baseline', async () => {
    const reqId = createRequirementId('REQ-FINDING-MUTATION');
    const r1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-FINDING-MUTATION-R1'),
      requirementId: reqId,
      revision: 1,
      statement: 'Safety valve specification',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(r1);
    await recordAcceptance(r1);

    // Create an OPEN contradiction finding affecting r1
    const findingId = createFindingId('FIND-CONTRADICT-01');
    const openFinding = createCandidateFinding({
      id: findingId,
      type: 'contradiction',
      affectedRequirementRevisions: [r1.id],
      discoveredBy: 'model',
      disposition: 'OPEN',
      rationale: 'Contradiction with standard safety policy'
    });
    await repo.saveCandidateFinding(openFinding);

    // Baseline creation MUST fail because open finding blocks r1
    await expect(
      useCase.create({
        id: createRequirementsBaselineId('BASE-BLOCKED-1'),
        requirementRevisionIds: [r1.id],
        createdBy: 'REV-01'
      })
    ).rejects.toThrow(BlockedByOpenFindingsError);

    // Direct save rewrite attempt: try to overwrite finding with affectedRequirementRevisions: []
    const strippedFinding = createCandidateFinding({
      ...openFinding,
      affectedRequirementRevisions: []
    });
    await expect(repo.saveCandidateFinding(strippedFinding)).rejects.toThrow(
      ImmutableRecordConflictError
    );

    // Transition rewrite attempt: try to pass forged affectedRequirementRevisions: [] through transition
    await expect(
      repo.transitionCandidateFinding(
        createCandidateFinding({
          ...openFinding,
          affectedRequirementRevisions: [],
          disposition: 'RESOLVED',
          rationale: 'Attempted forge'
        }),
        {
          id: 'REC-FORGED-1',
          entityType: 'finding',
          entityId: findingId,
          previousDisposition: 'OPEN',
          newDisposition: 'RESOLVED',
          rationale: 'Attempted forge',
          recordedAt: now()
        },
        'OPEN'
      )
    ).rejects.toThrow(/Cannot mutate immutable finding affectedRequirementRevisions/i);

    // Baseline creation MUST STILL fail with BlockedByOpenFindingsError
    await expect(
      useCase.create({
        id: createRequirementsBaselineId('BASE-BLOCKED-1'),
        requirementRevisionIds: [r1.id],
        createdBy: 'REV-01'
      })
    ).rejects.toThrow(BlockedByOpenFindingsError);

    // Finding remains OPEN, still affects r1, and has 0 reconciliation records
    const onDiskFinding = await repo.getCandidateFinding(findingId);
    expect(onDiskFinding).toBeDefined();
    expect(onDiskFinding!.disposition).toBe('OPEN');
    expect(onDiskFinding!.affectedRequirementRevisions).toEqual([r1.id]);

    const reconciliationHistory = await repo.listReconciliationRecords('finding', findingId);
    expect(reconciliationHistory).toHaveLength(0);
  });

  it('falsely attributed finding reconciliation record cannot unblock the affected requirement in baseline creation', async () => {
    const reqId = createRequirementId('REQ-FALSE-ATTRIB-1');
    const r1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-FALSE-ATTRIB-1-R1'),
      requirementId: reqId,
      revision: 1,
      statement: 'Sensitive access controls requirement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(r1);
    await recordAcceptance(r1);

    const findingId = createFindingId('FIND-BLOCKING-1');
    const openFinding = createCandidateFinding({
      id: findingId,
      type: 'missing-authorization',
      affectedRequirementRevisions: [r1.id],
      discoveredBy: 'model',
      disposition: 'OPEN',
      rationale: 'Missing role-based check'
    });
    await repo.saveCandidateFinding(openFinding);

    // Initial baseline fails because finding is OPEN
    await expect(
      useCase.create({
        id: createRequirementsBaselineId('BASE-ATTRIB-BLOCKED-1'),
        requirementRevisionIds: [r1.id],
        createdBy: 'REV-01'
      })
    ).rejects.toThrow(BlockedByOpenFindingsError);

    // Attempting to resolve via transitionCandidateFinding with a record claiming another entityId fails
    const resolvedFinding = createCandidateFinding({
      ...openFinding,
      disposition: 'RESOLVED',
      rationale: 'Legitimate resolution rationale'
    });
    const falselyAttributedRecord = {
      id: 'REC-ATTRIB-FALSE-1',
      entityType: 'finding' as const,
      entityId: createFindingId('FIND-SOME-OTHER-ID'),
      previousDisposition: 'OPEN' as const,
      newDisposition: 'RESOLVED' as const,
      rationale: 'Legitimate resolution rationale',
      recordedAt: now()
    };
    await expect(
      repo.transitionCandidateFinding(resolvedFinding, falselyAttributedRecord, 'OPEN')
    ).rejects.toThrow(/entityId 'FIND-SOME-OTHER-ID' does not match finding id 'FIND-BLOCKING-1'/i);

    // Now test governance gate: even if storage had a non-OPEN finding whose audit trail
    // has a falsely attributed entityId, baseline creation MUST reject it
    const findingFilePath = path.join(tempDir, 'findings', `${findingId}.json`);
    await fs.writeFile(
      findingFilePath,
      JSON.stringify({
        ...openFinding,
        disposition: 'RESOLVED',
        rationale: 'Legitimate resolution rationale'
      }),
      'utf8'
    );
    const auditFilePath = path.join(tempDir, 'reconciliation', 'finding', `${findingId}.jsonl`);
    await fs.mkdir(path.dirname(auditFilePath), { recursive: true });
    await fs.writeFile(auditFilePath, JSON.stringify(falselyAttributedRecord) + '\n', 'utf8');

    // Baseline creation MUST fail with UnauditedFindingDispositionError
    await expect(
      useCase.create({
        id: createRequirementsBaselineId('BASE-ATTRIB-BLOCKED-2'),
        requirementRevisionIds: [r1.id],
        createdBy: 'REV-01'
      })
    ).rejects.toThrow(UnauditedFindingDispositionError);

    // And if the audit record has a mismatched rationale, baseline creation MUST ALSO reject it
    const mismatchedRationaleRecord = {
      id: 'REC-ATTRIB-FALSE-2',
      entityType: 'finding' as const,
      entityId: findingId,
      previousDisposition: 'OPEN' as const,
      newDisposition: 'RESOLVED' as const,
      rationale: 'Different rationale that does not match persisted finding decision',
      recordedAt: now()
    };
    await fs.writeFile(auditFilePath, JSON.stringify(mismatchedRationaleRecord) + '\n', 'utf8');

    await expect(
      useCase.create({
        id: createRequirementsBaselineId('BASE-ATTRIB-BLOCKED-3'),
        requirementRevisionIds: [r1.id],
        createdBy: 'REV-01'
      })
    ).rejects.toThrow(UnauditedFindingDispositionError);

    // Baseline was not saved in either case
    expect(
      await repo.getRequirementsBaseline(createRequirementsBaselineId('BASE-ATTRIB-BLOCKED-2'))
    ).toBeUndefined();
    expect(
      await repo.getRequirementsBaseline(createRequirementsBaselineId('BASE-ATTRIB-BLOCKED-3'))
    ).toBeUndefined();
  });

  it('controlled concurrency test: pauses baseline creation after initial reads, commits a successor, and proves conditional save rejects stale baseline', async () => {
    const reqId = createRequirementId('REQ-CONCURRENT-1');
    const r1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-CONCURRENT-1-R1'),
      requirementId: reqId,
      revision: 1,
      statement: 'Initial requirement statement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(r1);
    await recordAcceptance(r1);

    const baselineId = createRequirementsBaselineId('BASE-CONCURRENT-TEST');

    let pauseResolve: () => void;
    const pausePromise = new Promise<void>((resolve) => {
      pauseResolve = resolve;
    });
    let resumeResolve: () => void;
    const resumePromise = new Promise<void>((resolve) => {
      resumeResolve = resolve;
    });

    const originalListCandidateFindings = repo.listCandidateFindings.bind(repo);
    let paused = false;
    repo.listCandidateFindings = async () => {
      const findings = await originalListCandidateFindings();
      if (!paused) {
        paused = true;
        pauseResolve();
        await resumePromise;
      }
      return findings;
    };

    // Start baseline creation in background
    const baselineCreationPromise = useCase.create({
      id: baselineId,
      requirementRevisionIds: [r1.id],
      createdBy: 'REV-CONCURRENT-01'
    });

    // Wait until baseline creation has completed its initial reads and pauses
    await pausePromise;

    // While baseline creation is paused, a concurrent actor commits a successor revision (r2)
    const r2 = await reconcileUseCase.reviseRequirement({
      revisionId: r1.id,
      statement: 'Revised statement while baseline creation is in-flight',
      rationale: 'Concurrent architectural revision'
    });

    // Verify r2 is now the latest revision
    const allRevisions = await repo.listRequirementRevisions(reqId);
    expect(allRevisions[allRevisions.length - 1].id).toBe(r2.id);

    // Resume baseline creation so it attempts conditional save
    resumeResolve!();

    // Baseline creation MUST reject because r1 is now stale
    let thrownError: unknown;
    try {
      await baselineCreationPromise;
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(StaleRevisionTargetError);
    const staleErr = thrownError as StaleRevisionTargetError;
    expect(staleErr.revisionId).toBe(r1.id);
    expect(staleErr.latestRevisionId).toBe(r2.id);

    // Ensure stale baseline was NEVER persisted
    expect(await repo.getRequirementsBaseline(baselineId)).toBeUndefined();
  });
});
