import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createSourceId,
  createRequirementId,
  createRequirementRevisionId,
  createFindingId,
  createRequirementsBaselineId,
  createActorId,
  createReviewerId,
  createInstant,
  createEvidenceLocator,
  createRequirementRevision,
  createCandidateFinding,
  createRequirementsBaseline
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import type { EvaluationRunRecord } from '../../src/application/ports/persistence/IRequirementsRepository.js';

describe('FilesystemRequirementsRepository — Process Restart & Reload Durability', () => {
  it('survives process restart with exact revision, evidence-locator, finding, reconciliation, and baseline identities intact', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-repo-restart-'));

    const sourceId = createSourceId('TENANT-SPEC-001');
    const mdV1 = `# 1. Overview\n\nSection 1.1: Initial baseline provision.\n\n# 2. Permanent Purge\n\nSection 2.1: Purge organization data within 5 minutes.`;
    const mdV2 = `# 1. Overview\n\nSection 1.1: Initial baseline provision.\n\n# 2. Permanent Purge\n\nSection 2.1: Purge organization data within 3 minutes.`;

    const reqId = createRequirementId('REQ-PURGE-01');
    const reqRevId = createRequirementRevisionId('REQ-PURGE-01-R1');
    const findingId = createFindingId('FIND-AUTH-01');
    const baselineId = createRequirementsBaselineId('BASE-2026-Q3');
    const runId = 'EVAL-RUN-RESTART-01';

    // Step 1: Create repository instance A and populate representative state
    let repoA: FilesystemRequirementsRepository | null = new FilesystemRequirementsRepository({
      baseDir: tempDir
    });

    const srcRec1 = await repoA.captureSourceRevision({
      sourceId,
      sourceType: 'sop',
      markdownText: mdV1
    });

    const srcRec2 = await repoA.captureSourceRevision({
      sourceId,
      sourceType: 'sop',
      markdownText: mdV2
    });

    expect(srcRec1.revision.id).toBe('TENANT-SPEC-001-R1');
    expect(srcRec2.revision.id).toBe('TENANT-SPEC-001-R2');
    expect(srcRec2.revision.supersedes).toBe(srcRec1.revision.id);

    // RequirementRevision targeting exact historical revision 1 and locator
    const reqRev = createRequirementRevision({
      id: reqRevId,
      requirementId: reqId,
      revision: 1,
      statement: 'The system permanently removes all databases within 5 minutes',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [
        {
          sourceRevisionId: srcRec1.revision.id,
          locator: createEvidenceLocator('permanent-purge#2.1')
        }
      ],
      rationale: 'Core operational safety requirement'
    });
    await repoA.saveRequirementRevision(reqRev);

    // CandidateFinding affecting the requirement revision
    const findingOpen = createCandidateFinding({
      id: findingId,
      type: 'missing-authorization',
      affectedRequirementRevisions: [reqRevId],
      evidence: [
        {
          sourceRevisionId: srcRec1.revision.id,
          locator: createEvidenceLocator('permanent-purge#2.1')
        }
      ],
      discoveredBy: 'model'
    });
    await repoA.saveCandidateFinding(findingOpen);

    const findingResolved = createCandidateFinding({
      ...findingOpen,
      disposition: 'RESOLVED',
      rationale: 'Explicit confirmation and administrator role added in review'
    });

    // Finding reconciliation record
    const findingReconciliation = {
      id: 'REC-FIND-AUTH-01',
      entityType: 'finding' as const,
      entityId: findingId,
      previousDisposition: 'OPEN' as const,
      newDisposition: 'RESOLVED' as const,
      rationale: 'Explicit confirmation and administrator role added in review',
      actorId: createActorId('ACT-LEAD-01'),
      recordedAt: createInstant('2026-09-16T14:30:00.000Z')
    };
    await repoA.transitionCandidateFinding(findingResolved, findingReconciliation, 'OPEN');

    // Requirement reconciliation record
    const reqReconciliation = {
      id: 'REC-REQ-PURGE-01',
      entityType: 'requirement' as const,
      entityId: reqId,
      requirementRevisionId: reqRevId,
      action: 'ACCEPT' as const,
      previousReviewState: undefined,
      newReviewState: 'ACCEPTED' as const,
      rationale: 'Accepted by security team after finding resolution',
      actorId: createActorId('ACT-LEAD-01'),
      recordedAt: createInstant('2026-09-16T14:35:00.000Z')
    };
    await repoA.appendReconciliationRecord(reqReconciliation);

    // RequirementsBaseline referencing accepted requirement revision
    const baseline = createRequirementsBaseline({
      id: baselineId,
      requirements: [reqRev],
      createdBy: createReviewerId('REV-SECURITY-01'),
      createdAt: createInstant('2026-09-16T15:00:00.000Z')
    });
    await repoA.saveRequirementsBaseline(baseline);

    // Evaluation run metadata/results
    const evalRun: EvaluationRunRecord = {
      id: runId,
      corpusVersion: 'v1.0',
      executedAt: createInstant('2026-09-16T15:05:00.000Z'),
      fixtureResults: [
        {
          fixtureId: 'missing-authorization-basic',
          passed: true,
          details: { assertion: 'exact locator resolved' }
        }
      ],
      summary: { total: 1, passed: 1 }
    };
    await repoA.saveEvaluationRun(evalRun);

    // Step 2: Drop all in-memory references to repoA
    repoA = null;

    // Step 3: Instantiate brand new repository instance B over the exact same baseDir
    const repoB = new FilesystemRequirementsRepository({ baseDir: tempDir });

    // Step 4: Verify SourceRevisions and supersession chain
    const loadedSrcList = await repoB.listSourceRevisions(sourceId);
    expect(loadedSrcList).toHaveLength(2);
    expect(loadedSrcList[0].id).toBe('TENANT-SPEC-001-R1');
    expect(loadedSrcList[0].revision).toBe(1);
    expect(loadedSrcList[0].supersedes).toBeUndefined();
    expect(loadedSrcList[1].id).toBe('TENANT-SPEC-001-R2');
    expect(loadedSrcList[1].revision).toBe(2);
    expect(loadedSrcList[1].supersedes).toBe('TENANT-SPEC-001-R1');

    const latestSrc = await repoB.getLatestSourceRevision(sourceId);
    expect(latestSrc?.revision.id).toBe('TENANT-SPEC-001-R2');

    // Step 5: Verify historical (superseded) SourceRevision locator resolution
    const historicalLocatorEntry = await repoB.resolveLocator(
      srcRec1.revision.id,
      'permanent-purge#2.1'
    );
    expect(historicalLocatorEntry).toBeDefined();
    expect(historicalLocatorEntry?.locator).toBe('permanent-purge#2.1');
    expect(historicalLocatorEntry?.text).toBe(
      'Section 2.1: Purge organization data within 5 minutes.'
    );

    // Newer revision has different text for the same locator name
    const newerLocatorEntry = await repoB.resolveLocator(
      srcRec2.revision.id,
      'permanent-purge#2.1'
    );
    expect(newerLocatorEntry).toBeDefined();
    expect(newerLocatorEntry?.text).toBe('Section 2.1: Purge organization data within 3 minutes.');

    // Step 6: Verify RequirementRevision reloaded unchanged
    const loadedReqRev = await repoB.getRequirementRevision(reqRevId);
    expect(loadedReqRev).toEqual(reqRev);
    expect(loadedReqRev?.evidence[0].sourceRevisionId).toBe(srcRec1.revision.id);
    expect(loadedReqRev?.evidence[0].locator).toBe('permanent-purge#2.1');

    // Step 7: Verify CandidateFinding reloaded unchanged
    const loadedFinding = await repoB.getCandidateFinding(findingId);
    expect(loadedFinding).toEqual(findingResolved);
    expect(loadedFinding?.affectedRequirementRevisions).toEqual([reqRevId]);

    // Step 8: Verify Reconciliation records reloaded in order
    const findingRecs = await repoB.listReconciliationRecords('finding', findingId);
    expect(findingRecs).toEqual([findingReconciliation]);

    const reqRecs = await repoB.listReconciliationRecords('requirement', reqId);
    expect(reqRecs).toEqual([reqReconciliation]);

    const allRecs = await repoB.listAllReconciliationRecords();
    expect(allRecs).toEqual([findingReconciliation, reqReconciliation]);

    // Step 9: Verify RequirementsBaseline reloaded unchanged
    const loadedBaseline = await repoB.getRequirementsBaseline(baselineId);
    expect(loadedBaseline).toEqual(baseline);
    expect(loadedBaseline?.requirementRevisions).toEqual([reqRevId]);

    // Step 10: Verify EvaluationRunRecord reloaded unchanged
    const loadedEvalRun = await repoB.getEvaluationRun(runId);
    expect(loadedEvalRun).toEqual(evalRun);

    // Step 11: Assert idempotent recapture of original (revision-1) content through repoB
    // (Proves accepted historical revisions cannot silently retarget to newer content and do not mint R3)
    const recapturedR1 = await repoB.captureSourceRevision({
      sourceId,
      sourceType: 'sop',
      markdownText: mdV1
    });
    expect(recapturedR1.revision.id).toBe('TENANT-SPEC-001-R1');
    expect(recapturedR1.revision.revision).toBe(1);

    const postRecaptureList = await repoB.listSourceRevisions(sourceId);
    expect(postRecaptureList).toHaveLength(2); // Still only R1 and R2

    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
