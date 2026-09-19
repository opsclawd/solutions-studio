import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createSourceId,
  createRequirementId,
  createRequirementRevisionId,
  createFindingId,
  createRequirementsBaselineId,
  createReviewerId,
  createRequirementRevision,
  createCandidateFinding,
  createRequirementsBaseline,
  now
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { GetRequirementsReviewStateUseCase } from '../../src/application/use-cases/GetRequirementsReviewStateUseCase.js';
import { UnknownRequirementsBaselineError } from '../../src/application/use-cases/ReconciliationErrors.js';

describe('GetRequirementsReviewStateUseCase', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let useCase: GetRequirementsReviewStateUseCase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-state-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    useCase = new GetRequirementsReviewStateUseCase(repo);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty state when repository is empty', async () => {
    const state = await useCase.get();
    expect(state.baseline).toBeUndefined();
    expect(state.requirementRevisions).toEqual([]);
    expect(state.findings).toEqual([]);
    expect(state.reconciliationHistory).toEqual([]);
    expect(state.evidenceExcerpts).toEqual([]);
    expect(state.projections).toEqual([]);
    expect(state.revisionLineage).toEqual([]);
  });

  it('throws UnknownRequirementsBaselineError when baseline is not found', async () => {
    await expect(useCase.get({ baselineId: 'NONEXISTENT' })).rejects.toThrow(
      UnknownRequirementsBaselineError
    );
  });

  it('returns latest revisions and resolves evidence in global mode', async () => {
    const src = await repo.captureSourceRevision({
      sourceId: createSourceId('SRC-001'),
      sourceType: 'sop',
      markdownText: '# Security Policy\n\nAll data must be encrypted at rest.'
    });

    const req1Rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Original statement',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: [
        {
          sourceRevisionId: src.revision.id,
          locator: src.locatorIndex[0].locator
        }
      ]
    });

    const req1Rev2 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R2'),
      requirementId: createRequirementId('REQ-001'),
      revision: 2,
      statement: 'Updated statement',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [
        {
          sourceRevisionId: src.revision.id,
          locator: src.locatorIndex[0].locator
        }
      ],
      supersedes: req1Rev1.id
    });

    const req2Rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-002-R1'),
      requirementId: createRequirementId('REQ-002'),
      revision: 1,
      statement: 'Second requirement',
      category: 'data-constraint',
      origin: 'EXPLICIT',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: []
    });

    await repo.saveRequirementRevision(req1Rev1);
    await repo.saveRequirementRevision(req1Rev2);
    await repo.saveRequirementRevision(req2Rev1);

    const finding = createCandidateFinding({
      id: createFindingId('FIND-001'),
      type: 'missing-authorization',
      affectedRequirementRevisions: [req1Rev1.id],
      evidence: [],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });
    await repo.saveCandidateFinding(finding);

    const unrelatedFinding = createCandidateFinding({
      id: createFindingId('FIND-999'),
      type: 'contradiction',
      affectedRequirementRevisions: [createRequirementRevisionId('REQ-OTHER-R1')],
      evidence: [],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });
    await repo.saveCandidateFinding(unrelatedFinding);

    const reqUnrelated = createRequirementRevision({
      id: createRequirementRevisionId('REQ-UNRELATED-R1'),
      requirementId: createRequirementId('REQ-UNRELATED'),
      revision: 1,
      statement: 'Unrelated requirement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: []
    });
    await repo.saveRequirementRevision(reqUnrelated);

    await repo.appendReconciliationRecord({
      id: 'rec-1',
      entityType: 'requirement',
      entityId: createRequirementId('REQ-001'),
      requirementRevisionId: req1Rev2.id,
      action: 'ACCEPT',
      previousReviewState: undefined,
      newReviewState: 'ACCEPTED',
      rationale: 'Approved',
      recordedAt: now()
    });

    await repo.appendReconciliationRecord({
      id: 'rec-2',
      entityType: 'requirement',
      entityId: createRequirementId('REQ-UNRELATED'),
      requirementRevisionId: createRequirementRevisionId('REQ-UNRELATED-R1'),
      action: 'ACCEPT',
      previousReviewState: undefined,
      newReviewState: 'ACCEPTED',
      rationale: 'Unrelated',
      recordedAt: now()
    });

    const state = await useCase.get();
    expect(state.baseline).toBeUndefined();
    expect(state.requirementRevisions).toHaveLength(3);
    expect(state.requirementRevisions.map((r) => r.id)).toEqual([
      'REQ-001-R2',
      'REQ-002-R1',
      'REQ-UNRELATED-R1'
    ]);

    expect(state.findings).toHaveLength(1);
    expect(state.findings[0].id).toBe('FIND-001');

    expect(state.reconciliationHistory).toHaveLength(2);
    expect(state.reconciliationHistory.map((r) => r.id)).toEqual(['rec-1', 'rec-2']);

    expect(state.evidenceExcerpts).toHaveLength(1);
    expect(state.evidenceExcerpts[0].sourceRevisionId).toBe(src.revision.id);
    expect(state.evidenceExcerpts[0].text).toContain('All data must be encrypted');
  });

  it('returns baseline-anchored state with projections', async () => {
    const req1Rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Statement 1',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: []
    });
    await repo.saveRequirementRevision(req1Rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [req1Rev1],
      createdBy: createReviewerId('lead-reviewer'),
      createdAt: now()
    });
    await repo.saveRequirementsBaseline(baseline);

    await repo.saveProjectionRecord({
      id: 'PROJ-001',
      baselineId: baseline.id,
      requirementRevisionIds: [req1Rev1.id],
      artifactType: 'process-diagram',
      content: 'flowchart TD\nA-->B',
      metadata: {
        baselineId: baseline.id,
        requirementRevisionIds: [req1Rev1.id],
        artifactType: 'process-diagram',
        declaredProvenance: {
          baselineId: baseline.id,
          requirementRevisionIds: [req1Rev1.id]
        },
        configuredExecution: {
          provider: 'test',
          artifactType: 'process-diagram'
        },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'hash',
          verifiedAt: now()
        }
      },
      createdAt: now()
    });

    const state = await useCase.get({ baselineId: 'BASE-001' });
    expect(state.baseline?.id).toBe('BASE-001');
    expect(state.requirementRevisions).toHaveLength(1);
    expect(state.requirementRevisions[0].id).toBe('REQ-001-R1');
    expect(state.projections).toHaveLength(1);
    expect(state.projections[0].id).toBe('PROJ-001');
  });

  it('includes ancestor revision in revisionLineage even if not in latest revisions or reconciliation history', async () => {
    const req1Rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'First version',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: []
    });
    const req1Rev2 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R2'),
      requirementId: createRequirementId('REQ-001'),
      revision: 2,
      statement: 'Second version',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [],
      supersedes: req1Rev1.id
    });
    await repo.saveRequirementRevision(req1Rev1);
    await repo.saveRequirementRevision(req1Rev2);

    // Append a reconciliation record only pointing to successor R2
    await repo.appendReconciliationRecord({
      id: 'rec-1',
      entityType: 'requirement',
      entityId: createRequirementId('REQ-001'),
      requirementRevisionId: req1Rev2.id,
      action: 'ACCEPT',
      previousReviewState: undefined,
      newReviewState: 'ACCEPTED',
      rationale: 'Accepted revision 2',
      recordedAt: now()
    });

    const state = await useCase.get();
    expect(state.requirementRevisions.map((r) => r.id)).toEqual(['REQ-001-R2']);
    // Both R1 and R2 are in revisionLineage, mapped to REQ-001
    expect(state.revisionLineage).toEqual(
      expect.arrayContaining([
        { revisionId: 'REQ-001-R1', requirementId: 'REQ-001' },
        { revisionId: 'REQ-001-R2', requirementId: 'REQ-001' }
      ])
    );
  });

  it('includes candidate findings with zero affectedRequirementRevisions in findings array', async () => {
    const req1Rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'First version',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: []
    });
    await repo.saveRequirementRevision(req1Rev1);

    const repoWideFinding = createCandidateFinding({
      id: createFindingId('FIND-UNATTACHED-001'),
      type: 'missing-authorization',
      affectedRequirementRevisions: [],
      evidence: [],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });
    await repo.saveCandidateFinding(repoWideFinding);

    const attachedFinding = createCandidateFinding({
      id: createFindingId('FIND-ATTACHED-001'),
      type: 'missing-authorization',
      affectedRequirementRevisions: [req1Rev1.id],
      evidence: [],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });
    await repo.saveCandidateFinding(attachedFinding);

    const outOfScopeFinding = createCandidateFinding({
      id: createFindingId('FIND-OUTOFSCOPE-001'),
      type: 'missing-authorization',
      affectedRequirementRevisions: [createRequirementRevisionId('REQ-OTHER-R1')],
      evidence: [],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });
    await repo.saveCandidateFinding(outOfScopeFinding);

    const state = await useCase.get();
    const findingIds = state.findings.map((f) => f.id);
    expect(findingIds).toContain('FIND-UNATTACHED-001');
    expect(findingIds).toContain('FIND-ATTACHED-001');
    expect(findingIds).not.toContain('FIND-OUTOFSCOPE-001');
  });

  it('hydrates candidate requirement revisions associated with baseline or its projections', async () => {
    const baselineRev = createRequirementRevision({
      id: createRequirementRevisionId('REQ-002-R1'),
      requirementId: createRequirementId('REQ-002'),
      revision: 1,
      statement: 'Base requirement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: []
    });
    await repo.saveRequirementRevision(baselineRev);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [baselineRev],
      createdBy: createReviewerId('reviewer-1'),
      createdAt: now()
    });
    await repo.saveRequirementsBaseline(baseline);

    // Save a projection bound to BASE-001
    await repo.saveProjectionRecord({
      id: 'PROJ-001',
      baselineId: baseline.id,
      requirementRevisionIds: [baselineRev.id],
      artifactType: 'process-diagram',
      content: 'graph TD; A --> B;',
      metadata: {
        baselineId: 'BASE-001',
        requirementRevisionIds: ['REQ-002-R1'],
        artifactType: 'process-diagram',
        declaredProvenance: {
          baselineId: 'BASE-001',
          requirementRevisionIds: ['REQ-002-R1']
        },
        configuredExecution: {
          provider: 'fake',
          artifactType: 'process-diagram'
        },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'hash-1',
          verifiedAt: now()
        }
      },
      createdAt: now()
    });

    // Candidate discovery 1: associated directly with baselineId
    const candidateRev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-DISC-001-R1'),
      requirementId: createRequirementId('REQ-DISC-001'),
      revision: 1,
      statement: 'Discovered candidate 1',
      category: 'business-rule',
      origin: 'REVIEWER_PROPOSAL',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: [],
      baselineId: baseline.id
    });
    await repo.saveRequirementRevision(candidateRev1);

    // Candidate discovery 2: associated via originatingProjectionId
    const candidateRev2 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-DISC-002-R1'),
      requirementId: createRequirementId('REQ-DISC-002'),
      revision: 1,
      statement: 'Discovered candidate 2',
      category: 'business-rule',
      origin: 'REVIEWER_PROPOSAL',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: [],
      originatingProjectionId: 'PROJ-001'
    });
    await repo.saveRequirementRevision(candidateRev2);

    // Candidate discovery 3: associated with a different baseline BASE-002
    const otherCandidateRev = createRequirementRevision({
      id: createRequirementRevisionId('REQ-OTHER-001-R1'),
      requirementId: createRequirementId('REQ-OTHER-001'),
      revision: 1,
      statement: 'Other candidate',
      category: 'business-rule',
      origin: 'REVIEWER_PROPOSAL',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: [],
      baselineId: createRequirementsBaselineId('BASE-002')
    });
    await repo.saveRequirementRevision(otherCandidateRev);

    const state = await useCase.get({ baselineId: 'BASE-001' });

    expect(state.baseline?.id).toBe('BASE-001');
    const revIds = state.requirementRevisions.map((r) => r.id);
    expect(revIds).toContain('REQ-002-R1');
    expect(revIds).toContain('REQ-DISC-001-R1');
    expect(revIds).toContain('REQ-DISC-002-R1');
    expect(revIds).not.toContain('REQ-OTHER-001-R1');
  });

  it('hydrates candidate discoveries to their latest revision when reconciled', async () => {
    const baseRev = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Base requirement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: []
    });
    await repo.saveRequirementRevision(baseRev);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [baseRev],
      createdBy: createReviewerId('lead'),
      createdAt: now()
    });
    await repo.saveRequirementsBaseline(baseline);

    // Discovered R1
    const candidateR1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-DISC-R1'),
      requirementId: createRequirementId('REQ-DISC'),
      revision: 1,
      statement: 'Discovered candidate R1',
      category: 'business-rule',
      origin: 'REVIEWER_PROPOSAL',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: [],
      baselineId: baseline.id
    });
    await repo.saveRequirementRevision(candidateR1);

    // Reconciled R2 (ACCEPTED & CLEAR)
    const candidateR2 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-DISC-R2'),
      requirementId: createRequirementId('REQ-DISC'),
      revision: 2,
      statement: 'Reconciled candidate R2',
      category: 'business-rule',
      origin: 'REVIEWER_PROPOSAL',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [],
      supersedes: candidateR1.id,
      baselineId: baseline.id
    });
    await repo.saveRequirementRevision(candidateR2);

    const state = await useCase.get({ baselineId: 'BASE-001' });

    const discRev = state.requirementRevisions.find((r) => r.requirementId === 'REQ-DISC');
    expect(discRev).toBeDefined();
    expect(discRev?.id).toBe('REQ-DISC-R2');
    expect(discRev?.revision).toBe(2);
    expect(discRev?.reviewState).toBe('ACCEPTED');
    expect(discRev?.resolutionState).toBe('CLEAR');
  });

  it('lists all baselines through listBaselines() and includes availableBaselines in state', async () => {
    const baseRev = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Base requirement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: []
    });
    await repo.saveRequirementRevision(baseRev);

    const base1 = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [baseRev],
      createdBy: createReviewerId('lead'),
      createdAt: now()
    });
    const base2 = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-002'),
      requirements: [baseRev],
      createdBy: createReviewerId('lead'),
      createdAt: now()
    });
    await repo.saveRequirementsBaseline(base1);
    await repo.saveRequirementsBaseline(base2);

    const baselines = await useCase.listBaselines();
    expect(baselines.map((b) => b.id)).toEqual(['BASE-001', 'BASE-002']);

    const state = await useCase.get({ baselineId: 'BASE-001' });
    expect(state.availableBaselines).toEqual(['BASE-001', 'BASE-002']);
  });
});
