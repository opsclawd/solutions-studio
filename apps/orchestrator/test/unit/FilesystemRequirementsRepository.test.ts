import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSourceId,
  createSourceRevisionId,
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
import {
  ImmutableRecordConflictError,
  type EvaluationRunRecord
} from '../../src/application/ports/persistence/IRequirementsRepository.js';
import { computeContentHash } from '../../src/infrastructure/persistence/markdown/deriveLocatorIndex.js';
import { writeJsonExclusive } from '../../src/infrastructure/persistence/filesystem/atomicFile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('FilesystemRequirementsRepository', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-repo-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('captures new source revision with content hash and revision=1', async () => {
    const md = `# Overview\n\nFirst paragraph.`;
    const sourceId = createSourceId('SRC-001');

    const record = await repo.captureSourceRevision({
      sourceId,
      sourceType: 'sop',
      markdownText: md
    });

    expect(record.revision.id).toBe('SRC-001-R1');
    expect(record.revision.sourceId).toBe(sourceId);
    expect(record.revision.revision).toBe(1);
    expect(record.revision.contentHash).toBe(computeContentHash(md));
    expect(record.revision.supersedes).toBeUndefined();
    expect(record.rawText).toBe(md);
    expect(record.locatorIndex).toHaveLength(1);
    expect(record.locatorIndex[0].locator).toBe('overview#1');

    const listed = await repo.listSourceRevisions(sourceId);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe('SRC-001-R1');

    const latest = await repo.getLatestSourceRevision(sourceId);
    expect(latest?.revision.id).toBe('SRC-001-R1');
  });

  it('idempotently recaptures byte-identical latest content without creating a new revision', async () => {
    const md = `# Overview\n\nContent body.`;
    const sourceId = createSourceId('SRC-002');

    const rec1 = await repo.captureSourceRevision({
      sourceId,
      sourceType: 'policy',
      markdownText: md
    });

    const rec2 = await repo.captureSourceRevision({
      sourceId,
      sourceType: 'policy',
      markdownText: md
    });

    expect(rec2.revision.id).toBe(rec1.revision.id);
    expect(rec2.revision.revision).toBe(1);

    const revisionsOnDisk = await fs.readdir(path.join(tempDir, 'source-revisions'));
    expect(revisionsOnDisk).toEqual(['SRC-002-R1.json']);

    const listed = await repo.listSourceRevisions(sourceId);
    expect(listed).toHaveLength(1);
  });

  it('creates new revision with supersedes link when content changes', async () => {
    const md1 = `# System\n\nVersion 1.`;
    const md2 = `# System\n\nVersion 2 updated.`;
    const sourceId = createSourceId('SRC-003');

    const rec1 = await repo.captureSourceRevision({
      sourceId,
      sourceType: 'interview',
      markdownText: md1
    });

    const rec2 = await repo.captureSourceRevision({
      sourceId,
      sourceType: 'interview',
      markdownText: md2
    });

    expect(rec2.revision.id).toBe('SRC-003-R2');
    expect(rec2.revision.revision).toBe(2);
    expect(rec2.revision.supersedes).toBe(rec1.revision.id);
    expect(rec2.revision.contentHash).not.toBe(rec1.revision.contentHash);

    const listed = await repo.listSourceRevisions(sourceId);
    expect(listed).toHaveLength(2);
    expect(listed[0].id).toBe('SRC-003-R1');
    expect(listed[1].id).toBe('SRC-003-R2');

    const latest = await repo.getLatestSourceRevision(sourceId);
    expect(latest?.revision.id).toBe('SRC-003-R2');
  });

  it('idempotently recaptures historical (non-latest) content without creating a new revision (Finding 3 fix)', async () => {
    const md1 = `# Doc\n\nOriginal version 1 content.`;
    const md2 = `# Doc\n\nUpdated version 2 content.`;
    const sourceId = createSourceId('SRC-004');

    const rec1 = await repo.captureSourceRevision({
      sourceId,
      sourceType: 'sop',
      markdownText: md1
    });
    const rec2 = await repo.captureSourceRevision({
      sourceId,
      sourceType: 'sop',
      markdownText: md2
    });

    expect(rec1.revision.revision).toBe(1);
    expect(rec2.revision.revision).toBe(2);

    // Latest is currently R2
    const latestBefore = await repo.getLatestSourceRevision(sourceId);
    expect(latestBefore?.revision.id).toBe('SRC-004-R2');

    // Re-capturing original md1 content must return R1, NOT mint a spurious R3
    const recReimport1 = await repo.captureSourceRevision({
      sourceId,
      sourceType: 'sop',
      markdownText: md1
    });

    expect(recReimport1.revision.id).toBe('SRC-004-R1');
    expect(recReimport1.revision.revision).toBe(1);

    const filesOnDisk = await fs.readdir(path.join(tempDir, 'source-revisions'));
    expect(filesOnDisk.sort()).toEqual(['SRC-004-R1.json', 'SRC-004-R2.json']);

    const listed = await repo.listSourceRevisions(sourceId);
    expect(listed).toHaveLength(2);
  });

  it('preserves addressability of historical revisions and locator indexes after newer revisions exist', async () => {
    const md1 = `# 1. Procurement\n\nSection 1.1: Limit is $1000.`;
    const md2 = `# 1. Procurement\n\nSection 1.1: Limit is $2000.`;
    const sourceId = createSourceId('SRC-005');

    const rec1 = await repo.captureSourceRevision({
      sourceId,
      sourceType: 'policy',
      markdownText: md1
    });
    await repo.captureSourceRevision({
      sourceId,
      sourceType: 'policy',
      markdownText: md2
    });

    // Old revision R1 is still directly addressable
    const fetchedR1 = await repo.getSourceRevision(rec1.revision.id);
    expect(fetchedR1).toBeDefined();
    expect(fetchedR1?.revision.revision).toBe(1);

    // Old locator is resolvable against R1
    const locR1 = await repo.resolveLocator(rec1.revision.id, 'procurement#1.1');
    expect(locR1).toBeDefined();
    expect(locR1?.text).toBe('Section 1.1: Limit is $1000.');
  });

  it('resolveLocator is exact and total: returns entry for matching locator, undefined for missing or wrong revision', async () => {
    const md = `# Section A\n\nContent A.\n\n# Section B\n\nContent B.`;
    const sourceId = createSourceId('SRC-006');
    const rec = await repo.captureSourceRevision({
      sourceId,
      sourceType: 'sop',
      markdownText: md
    });

    const entry = await repo.resolveLocator(rec.revision.id, 'section-a#1');
    expect(entry).toBeDefined();
    expect(entry?.text).toBe('Content A.');

    const missingEntry = await repo.resolveLocator(rec.revision.id, 'section-c#1');
    expect(missingEntry).toBeUndefined();

    const nonExistentRev = await repo.resolveLocator(
      createSourceRevisionId('NONEXISTENT-R1'),
      'section-a#1'
    );
    expect(nonExistentRev).toBeUndefined();
  });

  it('resolves locator against real fixture content (missing-authorization-basic/source.md)', async () => {
    const fixturePath = path.resolve(
      __dirname,
      '../evaluation/fixtures/missing-authorization-basic/source.md'
    );
    const markdownText = fsSync.readFileSync(fixturePath, 'utf-8');

    const sourceId = createSourceId('TENANT-SPEC-001');
    const rec = await repo.captureSourceRevision({
      sourceId,
      sourceType: 'sop',
      markdownText
    });

    const entry = await repo.resolveLocator(rec.revision.id, 'permanent-data-purge#3.1');
    expect(entry).toBeDefined();
    expect(entry?.locator).toBe('permanent-data-purge#3.1');
    expect(entry?.text).toContain('permanently removes all databases');
  });

  it('enforces immutability: exclusive write fails if file already exists, leaving file intact', async () => {
    const filePath = path.join(tempDir, 'source-revisions', 'SRC-COLLIDE-R1.json');
    const originalData = { revision: { id: 'SRC-COLLIDE-R1', revision: 1 } };
    await writeJsonExclusive(filePath, originalData);

    const conflictData = { revision: { id: 'SRC-COLLIDE-R1', revision: 2 } };
    await expect(writeJsonExclusive(filePath, conflictData)).rejects.toThrow(
      ImmutableRecordConflictError
    );

    const raw = await fs.readFile(filePath, 'utf-8');
    expect(JSON.parse(raw)).toEqual(originalData);
  });

  it('persists and reloads RequirementRevision with evidence references', async () => {
    const reqRev = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'System must purge tenant data within 5 minutes',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'PENDING',
      resolutionState: 'CLEAR',
      evidence: [
        {
          sourceRevisionId: createSourceRevisionId('SRC-001-R1'),
          locator: createEvidenceLocator('permanent-data-purge#3.1')
        }
      ],
      rationale: 'Purge timing rule'
    });

    await repo.saveRequirementRevision(reqRev);

    const reloaded = await repo.getRequirementRevision(reqRev.id);
    expect(reloaded).toEqual(reqRev);

    const list = await repo.listRequirementRevisions(reqRev.requirementId);
    expect(list).toEqual([reqRev]);
  });

  it('persists and reloads CandidateFinding', async () => {
    const finding = createCandidateFinding({
      id: createFindingId('FIND-001'),
      type: 'missing-authorization',
      affectedRequirementRevisions: [createRequirementRevisionId('REQ-001-R1')],
      evidence: [
        {
          sourceRevisionId: createSourceRevisionId('SRC-001-R1'),
          locator: createEvidenceLocator('permanent-data-purge#3.1')
        }
      ],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });

    await repo.saveCandidateFinding(finding);

    const reloaded = await repo.getCandidateFinding(finding.id);
    expect(reloaded).toEqual(finding);

    const list = await repo.listCandidateFindings();
    expect(list).toEqual([finding]);
  });

  it('persists and reloads RequirementsBaseline', async () => {
    const reqRev = createRequirementRevision({
      id: createRequirementRevisionId('REQ-002-R1'),
      requirementId: createRequirementId('REQ-002'),
      revision: 1,
      statement: 'Authorized administrators can export audit logs',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: [
        {
          sourceRevisionId: createSourceRevisionId('SRC-002-R1'),
          locator: createEvidenceLocator('audit-export#1.1')
        }
      ]
    });

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [reqRev],
      createdBy: createReviewerId('REV-001')
    });

    await repo.saveRequirementsBaseline(baseline);

    const reloaded = await repo.getRequirementsBaseline(baseline.id);
    expect(reloaded).toEqual(baseline);
  });

  it('persists and reloads EvaluationRunRecord', async () => {
    const run: EvaluationRunRecord = {
      id: 'RUN-2026-09-16-01',
      corpusVersion: 'v1.0',
      executedAt: createInstant('2026-09-16T12:00:00.000Z'),
      fixtureResults: [
        {
          fixtureId: 'missing-authorization-basic',
          passed: true,
          details: { checks: 5 }
        },
        {
          fixtureId: 'canonical-messy-discovery-package',
          passed: true
        }
      ],
      summary: { total: 2, passed: 2 }
    };

    await repo.saveEvaluationRun(run);

    const reloaded = await repo.getEvaluationRun(run.id);
    expect(reloaded).toEqual(run);

    const list = await repo.listEvaluationRuns();
    expect(list).toEqual([run]);
  });

  it('records and lists finding reconciliation records in append order', async () => {
    const findingId = createFindingId('FIND-002');
    const finding = createCandidateFinding({
      id: findingId,
      type: 'contradiction',
      discoveredBy: 'model'
    });
    await repo.saveCandidateFinding(finding);

    const rec1 = {
      id: 'REC-F1',
      entityType: 'finding' as const,
      entityId: findingId,
      previousDisposition: 'OPEN' as const,
      newDisposition: 'RESOLVED' as const,
      rationale: 'Patched in revision 2 with explicit caller validation',
      actorId: createActorId('ACT-001'),
      recordedAt: createInstant('2026-09-16T10:00:00.000Z')
    };
    const rec2 = {
      id: 'REC-F2',
      entityType: 'finding' as const,
      entityId: findingId,
      previousDisposition: 'RESOLVED' as const,
      newDisposition: 'OPEN' as const,
      rationale: 'Regression observed in edge case',
      actorId: createActorId('ACT-002'),
      recordedAt: createInstant('2026-09-16T11:00:00.000Z')
    };

    await repo.appendReconciliationRecord(rec1);
    await repo.appendReconciliationRecord(rec2);

    const records = await repo.listReconciliationRecords('finding', findingId);
    expect(records).toEqual([rec1, rec2]);
  });

  it('records and lists requirement reconciliation records with conditional previousReviewState (Finding 2 fix)', async () => {
    const reqId = createRequirementId('REQ-003');
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-003-R1'),
      requirementId: reqId,
      revision: 1,
      statement: 'Initial requirement statement',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED'
    });
    const rev2 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-003-R2'),
      requirementId: reqId,
      revision: 2,
      statement: 'Updated timeout constraint from 10m to 5m',
      category: 'business-rule',
      origin: 'EXPLICIT',
      supersedes: rev1.id
    });
    await repo.saveRequirementRevision(rev1);
    await repo.saveRequirementRevision(rev2);

    const rec1 = {
      id: 'REC-R1',
      entityType: 'requirement' as const,
      entityId: reqId,
      requirementRevisionId: rev1.id,
      action: 'ACCEPT' as const,
      previousReviewState: undefined,
      newReviewState: 'ACCEPTED' as const,
      rationale: 'Initial human acceptance of compiled candidate',
      actorId: createActorId('ACT-001'),
      recordedAt: createInstant('2026-09-16T09:00:00.000Z')
    };

    const rec2 = {
      id: 'REC-R2',
      entityType: 'requirement' as const,
      entityId: reqId,
      requirementRevisionId: rev2.id,
      action: 'REVISE' as const,
      previousReviewState: 'ACCEPTED' as const,
      newReviewState: 'PENDING' as const,
      rationale: 'Updated timeout constraint from 10m to 5m',
      actorId: createActorId('ACT-001'),
      recordedAt: createInstant('2026-09-16T10:00:00.000Z')
    };

    await repo.appendReconciliationRecord(rec1);
    await repo.appendReconciliationRecord(rec2);

    const records = await repo.listReconciliationRecords('requirement', reqId);
    expect(records).toEqual([rec1, rec2]);
    expect(records[0].previousReviewState).toBeUndefined();
    expect(records[1].previousReviewState).toBe('ACCEPTED');
  });

  it('listAllReconciliationRecords merges both finding and requirement records ordered by recordedAt', async () => {
    const findingId = createFindingId('FIND-003');
    const reqId = createRequirementId('REQ-004');

    const finding = createCandidateFinding({
      id: findingId,
      type: 'missing-authorization',
      discoveredBy: 'human'
    });
    await repo.saveCandidateFinding(finding);

    const rev = createRequirementRevision({
      id: createRequirementRevisionId('REQ-004-R1'),
      requirementId: reqId,
      revision: 1,
      statement: 'Accepted without modification',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'ACCEPTED'
    });
    await repo.saveRequirementRevision(rev);

    const recFinding = {
      id: 'REC-F-EARLY',
      entityType: 'finding' as const,
      entityId: findingId,
      previousDisposition: 'OPEN' as const,
      newDisposition: 'ACCEPTED_RISK' as const,
      rationale: 'Legacy component risk accepted by security lead',
      recordedAt: createInstant('2026-09-16T08:00:00.000Z')
    };

    const recReq = {
      id: 'REC-R-LATER',
      entityType: 'requirement' as const,
      entityId: reqId,
      requirementRevisionId: rev.id,
      action: 'ACCEPT' as const,
      previousReviewState: undefined,
      newReviewState: 'ACCEPTED' as const,
      rationale: 'Accepted without modification',
      recordedAt: createInstant('2026-09-16T09:00:00.000Z')
    };

    await repo.appendReconciliationRecord(recReq);
    await repo.appendReconciliationRecord(recFinding);

    const all = await repo.listAllReconciliationRecords();
    expect(all).toHaveLength(2);
    expect(all[0]).toEqual(recFinding);
    expect(all[1]).toEqual(recReq);
  });

  describe('Path traversal and separator safety', () => {
    it('rejects path traversal or separators in source operations', async () => {
      await expect(
        repo.captureSourceRevision({
          sourceId: createSourceId('../../escaped-source'),
          sourceType: 'sop',
          markdownText: '# Heading\n\nContent'
        })
      ).rejects.toThrow(/path separators or traversal/i);

      await expect(
        repo.captureSourceRevision({
          sourceId: createSourceId('sub/source'),
          sourceType: 'sop',
          markdownText: '# Heading\n\nContent'
        })
      ).rejects.toThrow(/path separators or traversal/i);

      await expect(
        repo.getSourceRevision(createSourceRevisionId('../../escaped-rev'))
      ).rejects.toThrow(/path separators or traversal/i);

      await expect(
        repo.listSourceRevisions(createSourceId('../../escaped-source'))
      ).rejects.toThrow(/path separators or traversal/i);

      await expect(
        repo.getLatestSourceRevision(createSourceId('../../escaped-source'))
      ).rejects.toThrow(/path separators or traversal/i);

      await expect(
        repo.resolveLocator(createSourceRevisionId('../../escaped-rev'), 'heading#1')
      ).rejects.toThrow(/path separators or traversal/i);
    });

    it('rejects path traversal or separators in requirement operations', async () => {
      await expect(
        repo.saveRequirementRevision(
          createRequirementRevision({
            id: createRequirementRevisionId('../../escaped-req-rev'),
            requirementId: createRequirementId('REQ-OK'),
            revision: 1,
            statement: 'Test',
            category: 'business-rule',
            origin: 'EXPLICIT'
          })
        )
      ).rejects.toThrow(/path separators or traversal/i);

      await expect(
        repo.saveRequirementRevision(
          createRequirementRevision({
            id: createRequirementRevisionId('REQ-OK-R1'),
            requirementId: createRequirementId('../../escaped-req'),
            revision: 1,
            statement: 'Test',
            category: 'business-rule',
            origin: 'EXPLICIT'
          })
        )
      ).rejects.toThrow(/path separators or traversal/i);

      await expect(
        repo.getRequirementRevision(createRequirementRevisionId('../../escaped-req-rev'))
      ).rejects.toThrow(/path separators or traversal/i);

      await expect(
        repo.listRequirementRevisions(createRequirementId('../../escaped-req'))
      ).rejects.toThrow(/path separators or traversal/i);
    });

    it('rejects path traversal or separators in finding operations', async () => {
      await expect(
        repo.saveCandidateFinding(
          createCandidateFinding({
            id: createFindingId('../../escaped-finding'),
            type: 'contradiction',
            discoveredBy: 'model'
          })
        )
      ).rejects.toThrow(/path separators or traversal/i);

      await expect(
        repo.getCandidateFinding(createFindingId('../../escaped-finding'))
      ).rejects.toThrow(/path separators or traversal/i);
    });

    it('rejects path traversal or separators in reconciliation operations', async () => {
      await expect(
        repo.appendReconciliationRecord({
          id: 'REC-1',
          entityType: 'finding',
          entityId: createFindingId('../../escaped-finding'),
          previousDisposition: 'OPEN',
          newDisposition: 'RESOLVED',
          rationale: 'Valid rationale',
          recordedAt: createInstant('2026-09-16T10:00:00.000Z')
        })
      ).rejects.toThrow(/path separators or traversal/i);

      await expect(
        repo.listReconciliationRecords('finding', createFindingId('../../escaped-finding'))
      ).rejects.toThrow(/path separators or traversal/i);

      await expect(
        repo.listReconciliationRecords('requirement', createRequirementId('../../escaped-req'))
      ).rejects.toThrow(/path separators or traversal/i);
    });

    it('rejects path traversal or separators in baseline operations', async () => {
      const validReq = createRequirementRevision({
        id: createRequirementRevisionId('REQ-BASE-R1'),
        requirementId: createRequirementId('REQ-BASE-1'),
        revision: 1,
        statement: 'Valid statement',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });

      await expect(
        repo.saveRequirementsBaseline(
          createRequirementsBaseline({
            id: createRequirementsBaselineId('../../escaped-base'),
            requirements: [validReq],
            createdBy: createReviewerId('REV-1'),
            createdAt: createInstant('2026-09-16T12:00:00.000Z')
          })
        )
      ).rejects.toThrow(/path separators or traversal/i);

      await expect(
        repo.getRequirementsBaseline(createRequirementsBaselineId('../../escaped-base'))
      ).rejects.toThrow(/path separators or traversal/i);
    });

    it('rejects path traversal or separators in evaluation run operations', async () => {
      await expect(
        repo.saveEvaluationRun({
          id: '../../escaped-run',
          corpusVersion: 'v1',
          executedAt: createInstant('2026-09-16T12:00:00.000Z'),
          fixtureResults: []
        })
      ).rejects.toThrow(/path separators or traversal/i);

      await expect(repo.getEvaluationRun('../../escaped-run')).rejects.toThrow(
        /path separators or traversal/i
      );
    });
  });

  describe('Reconciliation audit trail validation', () => {
    it('rejects requirement reconciliation record with empty or whitespace rationale', async () => {
      const reqId = createRequirementId('REQ-VAL-1');
      const rev = createRequirementRevision({
        id: createRequirementRevisionId('REQ-VAL-1-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Statement',
        category: 'business-rule',
        origin: 'EXPLICIT'
      });
      await repo.saveRequirementRevision(rev);

      await expect(
        repo.appendReconciliationRecord({
          id: 'REC-VAL-1',
          entityType: 'requirement',
          entityId: reqId,
          requirementRevisionId: rev.id,
          action: 'ACCEPT',
          previousReviewState: undefined,
          newReviewState: 'ACCEPTED',
          rationale: '   ',
          recordedAt: createInstant('2026-09-16T10:00:00.000Z')
        })
      ).rejects.toThrow(/rationale/i);
    });

    it('rejects first requirement record if previousReviewState is defined', async () => {
      const reqId = createRequirementId('REQ-VAL-2');
      const rev = createRequirementRevision({
        id: createRequirementRevisionId('REQ-VAL-2-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Statement',
        category: 'business-rule',
        origin: 'EXPLICIT'
      });
      await repo.saveRequirementRevision(rev);

      await expect(
        repo.appendReconciliationRecord({
          id: 'REC-VAL-2',
          entityType: 'requirement',
          entityId: reqId,
          requirementRevisionId: rev.id,
          action: 'ACCEPT',
          previousReviewState: 'ACCEPTED',
          newReviewState: 'PENDING',
          rationale: 'Initial acceptance cannot have prior review state',
          recordedAt: createInstant('2026-09-16T10:00:00.000Z')
        })
      ).rejects.toThrow(/must have previousReviewState undefined/i);
    });

    it('rejects subsequent requirement record if previousReviewState is undefined', async () => {
      const reqId = createRequirementId('REQ-VAL-3');
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-VAL-3-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Statement 1',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED'
      });
      const rev2 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-VAL-3-R2'),
        requirementId: reqId,
        revision: 2,
        statement: 'Statement 2',
        category: 'business-rule',
        origin: 'EXPLICIT',
        supersedes: rev1.id
      });
      await repo.saveRequirementRevision(rev1);
      await repo.saveRequirementRevision(rev2);

      await repo.appendReconciliationRecord({
        id: 'REC-VAL-3A',
        entityType: 'requirement',
        entityId: reqId,
        requirementRevisionId: rev1.id,
        action: 'ACCEPT',
        previousReviewState: undefined,
        newReviewState: 'ACCEPTED',
        rationale: 'Initial accept',
        recordedAt: createInstant('2026-09-16T10:00:00.000Z')
      });

      await expect(
        repo.appendReconciliationRecord({
          id: 'REC-VAL-3B',
          entityType: 'requirement',
          entityId: reqId,
          requirementRevisionId: rev2.id,
          action: 'REVISE',
          previousReviewState: undefined,
          newReviewState: 'PENDING',
          rationale: 'Subsequent decision claiming no prior state',
          recordedAt: createInstant('2026-09-16T11:00:00.000Z')
        })
      ).rejects.toThrow(/must have a defined previousReviewState/i);
    });

    it('rejects subsequent requirement record if previousReviewState is mismatched', async () => {
      const reqId = createRequirementId('REQ-VAL-4');
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-VAL-4-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Statement 1',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED'
      });
      const rev2 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-VAL-4-R2'),
        requirementId: reqId,
        revision: 2,
        statement: 'Statement 2',
        category: 'business-rule',
        origin: 'EXPLICIT',
        supersedes: rev1.id
      });
      await repo.saveRequirementRevision(rev1);
      await repo.saveRequirementRevision(rev2);

      await repo.appendReconciliationRecord({
        id: 'REC-VAL-4A',
        entityType: 'requirement',
        entityId: reqId,
        requirementRevisionId: rev1.id,
        action: 'ACCEPT',
        previousReviewState: undefined,
        newReviewState: 'ACCEPTED',
        rationale: 'Initial accept',
        recordedAt: createInstant('2026-09-16T10:00:00.000Z')
      });

      await expect(
        repo.appendReconciliationRecord({
          id: 'REC-VAL-4B',
          entityType: 'requirement',
          entityId: reqId,
          requirementRevisionId: rev2.id,
          action: 'REVISE',
          previousReviewState: 'REJECTED',
          newReviewState: 'PENDING',
          rationale: 'Contradicts prior ACCEPTED state',
          recordedAt: createInstant('2026-09-16T11:00:00.000Z')
        })
      ).rejects.toThrow(/Transition continuity broken/i);
    });

    it('rejects requirement record if referenced revision does not exist or belongs to another requirement', async () => {
      const reqId = createRequirementId('REQ-VAL-5');

      await expect(
        repo.appendReconciliationRecord({
          id: 'REC-VAL-5A',
          entityType: 'requirement',
          entityId: reqId,
          requirementRevisionId: createRequirementRevisionId('NON-EXISTENT-R1'),
          action: 'ACCEPT',
          previousReviewState: undefined,
          newReviewState: 'ACCEPTED',
          rationale: 'Valid rationale',
          recordedAt: createInstant('2026-09-16T10:00:00.000Z')
        })
      ).rejects.toThrow(/does not exist/i);

      const otherReqId = createRequirementId('REQ-VAL-OTHER');
      const otherRev = createRequirementRevision({
        id: createRequirementRevisionId('REQ-VAL-OTHER-R1'),
        requirementId: otherReqId,
        revision: 1,
        statement: 'Other statement',
        category: 'business-rule',
        origin: 'EXPLICIT'
      });
      await repo.saveRequirementRevision(otherRev);

      await expect(
        repo.appendReconciliationRecord({
          id: 'REC-VAL-5B',
          entityType: 'requirement',
          entityId: reqId,
          requirementRevisionId: otherRev.id,
          action: 'ACCEPT',
          previousReviewState: undefined,
          newReviewState: 'ACCEPTED',
          rationale: 'Valid rationale',
          recordedAt: createInstant('2026-09-16T10:00:00.000Z')
        })
      ).rejects.toThrow(/belongs to requirement/i);
    });

    it('rejects finding reconciliation with empty rationale or invalid disposition enum', async () => {
      const findingId = createFindingId('FIND-VAL-1');
      const finding = createCandidateFinding({
        id: findingId,
        type: 'contradiction',
        discoveredBy: 'model'
      });
      await repo.saveCandidateFinding(finding);

      await expect(
        repo.appendReconciliationRecord({
          id: 'REC-VF-1',
          entityType: 'finding',
          entityId: findingId,
          previousDisposition: 'OPEN',
          newDisposition: 'RESOLVED',
          rationale: '',
          recordedAt: createInstant('2026-09-16T10:00:00.000Z')
        })
      ).rejects.toThrow(/rationale/i);

      await expect(
        repo.appendReconciliationRecord({
          id: 'REC-VF-2',
          entityType: 'finding',
          entityId: findingId,
          previousDisposition: 'OPEN',
          newDisposition: 'REOPEN' as any,
          rationale: 'Invalid enum value',
          recordedAt: createInstant('2026-09-16T10:00:00.000Z')
        })
      ).rejects.toThrow(/Invalid newDisposition/i);
    });

    it('rejects finding reconciliation if referenced finding does not exist', async () => {
      await expect(
        repo.appendReconciliationRecord({
          id: 'REC-VF-3',
          entityType: 'finding',
          entityId: createFindingId('FIND-DOES-NOT-EXIST'),
          previousDisposition: 'OPEN',
          newDisposition: 'RESOLVED',
          rationale: 'Valid rationale',
          recordedAt: createInstant('2026-09-16T10:00:00.000Z')
        })
      ).rejects.toThrow(/does not exist/i);
    });

    it('rejects finding reconciliation with mismatched previous disposition', async () => {
      const findingId = createFindingId('FIND-VAL-2');
      const finding = createCandidateFinding({
        id: findingId,
        type: 'contradiction',
        discoveredBy: 'model'
      });
      await repo.saveCandidateFinding(finding);

      // First record mismatched with finding's initial OPEN state
      await expect(
        repo.appendReconciliationRecord({
          id: 'REC-VF-4A',
          entityType: 'finding',
          entityId: findingId,
          previousDisposition: 'RESOLVED',
          newDisposition: 'OPEN',
          rationale: 'Mismatched initial disposition',
          recordedAt: createInstant('2026-09-16T10:00:00.000Z')
        })
      ).rejects.toThrow(/Transition continuity broken/i);

      // Now append valid first record
      await repo.appendReconciliationRecord({
        id: 'REC-VF-4B',
        entityType: 'finding',
        entityId: findingId,
        previousDisposition: 'OPEN',
        newDisposition: 'RESOLVED',
        rationale: 'First valid resolution',
        recordedAt: createInstant('2026-09-16T10:00:00.000Z')
      });

      // Subsequent record claiming previous was OPEN instead of RESOLVED
      await expect(
        repo.appendReconciliationRecord({
          id: 'REC-VF-4C',
          entityType: 'finding',
          entityId: findingId,
          previousDisposition: 'OPEN',
          newDisposition: 'ACCEPTED_RISK',
          rationale: 'Contradicts last record newDisposition',
          recordedAt: createInstant('2026-09-16T11:00:00.000Z')
        })
      ).rejects.toThrow(/Transition continuity broken/i);
    });

    it('validates resolution transitions across RESOLVE, meaning-changing REVISE, and second RESOLVE', async () => {
      const reqId = createRequirementId('REQ-RES-01');
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-RES-01-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Statement 1',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'PENDING',
        resolutionState: 'UNRESOLVED'
      });
      const rev2 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-RES-01-R2'),
        requirementId: reqId,
        revision: 2,
        statement: 'Statement 1',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'UNRESOLVED',
        supersedes: rev1.id
      });
      const rev3 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-RES-01-R3'),
        requirementId: reqId,
        revision: 3,
        statement: 'Statement 1',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        supersedes: rev2.id
      });
      const rev4 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-RES-01-R4'),
        requirementId: reqId,
        revision: 4,
        statement: 'Meaning changed statement',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'PENDING',
        resolutionState: 'UNRESOLVED',
        supersedes: rev3.id
      });
      const rev5 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-RES-01-R5'),
        requirementId: reqId,
        revision: 5,
        statement: 'Meaning changed statement',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'PENDING',
        resolutionState: 'CLEAR',
        supersedes: rev4.id
      });

      await repo.saveRequirementRevision(rev1);
      await repo.saveRequirementRevision(rev2);
      await repo.saveRequirementRevision(rev3);
      await repo.saveRequirementRevision(rev4);
      await repo.saveRequirementRevision(rev5);

      // 1. ACCEPT (no resolution change)
      await repo.appendReconciliationRecord({
        id: 'REC-RES-1',
        entityType: 'requirement',
        entityId: reqId,
        requirementRevisionId: rev2.id,
        action: 'ACCEPT',
        previousReviewState: undefined,
        newReviewState: 'ACCEPTED',
        rationale: 'Accept candidate',
        recordedAt: createInstant('2026-09-16T10:00:00.000Z')
      });

      // 2. RESOLVE (UNRESOLVED -> CLEAR, reviewState remains ACCEPTED)
      await repo.appendReconciliationRecord({
        id: 'REC-RES-2',
        entityType: 'requirement',
        entityId: reqId,
        requirementRevisionId: rev3.id,
        action: 'RESOLVE',
        previousReviewState: 'ACCEPTED',
        newReviewState: 'ACCEPTED',
        previousResolutionState: 'UNRESOLVED',
        newResolutionState: 'CLEAR',
        rationale: 'Resolved ambiguity',
        recordedAt: createInstant('2026-09-16T10:10:00.000Z')
      });

      // 3. REVISE meaning (CLEAR -> UNRESOLVED, reviewState resets to PENDING)
      await repo.appendReconciliationRecord({
        id: 'REC-RES-3',
        entityType: 'requirement',
        entityId: reqId,
        requirementRevisionId: rev4.id,
        action: 'REVISE',
        previousReviewState: 'ACCEPTED',
        newReviewState: 'PENDING',
        previousResolutionState: 'CLEAR',
        newResolutionState: 'UNRESOLVED',
        rationale: 'Meaning changed',
        recordedAt: createInstant('2026-09-16T10:20:00.000Z')
      });

      // 4. Second RESOLVE (UNRESOLVED -> CLEAR, reviewState stays PENDING)
      await repo.appendReconciliationRecord({
        id: 'REC-RES-4',
        entityType: 'requirement',
        entityId: reqId,
        requirementRevisionId: rev5.id,
        action: 'RESOLVE',
        previousReviewState: 'PENDING',
        newReviewState: 'PENDING',
        previousResolutionState: 'UNRESOLVED',
        newResolutionState: 'CLEAR',
        rationale: 'Resolved again',
        recordedAt: createInstant('2026-09-16T10:30:00.000Z')
      });

      const history = await repo.listReconciliationRecords('requirement', reqId);
      expect(history).toHaveLength(4);
      expect(history[1].action).toBe('RESOLVE');
      expect(history[1].previousResolutionState).toBe('UNRESOLVED');
      expect(history[1].newResolutionState).toBe('CLEAR');
      expect(history[2].previousResolutionState).toBe('CLEAR');
      expect(history[2].newResolutionState).toBe('UNRESOLVED');
      expect(history[3].previousResolutionState).toBe('UNRESOLVED');
      expect(history[3].newResolutionState).toBe('CLEAR');
    });

    it('rejects one-sided resolution fields and resolution continuity failures', async () => {
      const reqId = createRequirementId('REQ-RES-02');
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-RES-02-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Statement 1',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'PENDING',
        resolutionState: 'UNRESOLVED'
      });
      const rev2 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-RES-02-R2'),
        requirementId: reqId,
        revision: 2,
        statement: 'Statement 1',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        supersedes: rev1.id
      });
      await repo.saveRequirementRevision(rev1);
      await repo.saveRequirementRevision(rev2);

      // One-sided: only newResolutionState
      await expect(
        repo.appendReconciliationRecord({
          id: 'REC-BAD-RES-1',
          entityType: 'requirement',
          entityId: reqId,
          requirementRevisionId: rev2.id,
          action: 'RESOLVE',
          previousReviewState: undefined,
          newReviewState: 'ACCEPTED',
          newResolutionState: 'CLEAR',
          rationale: 'Missing previousResolutionState',
          recordedAt: createInstant('2026-09-16T10:00:00.000Z')
        } as any)
      ).rejects.toThrow(/both previousResolutionState and newResolutionState/i);

      // Broken initial resolution continuity: rev1 has UNRESOLVED, record claims CLEAR
      await expect(
        repo.appendReconciliationRecord({
          id: 'REC-BAD-RES-2',
          entityType: 'requirement',
          entityId: reqId,
          requirementRevisionId: rev2.id,
          action: 'RESOLVE',
          previousReviewState: undefined,
          newReviewState: 'ACCEPTED',
          previousResolutionState: 'CLEAR',
          newResolutionState: 'CLEAR',
          rationale: 'Mismatched initial resolution state',
          recordedAt: createInstant('2026-09-16T10:00:00.000Z')
        })
      ).rejects.toThrow(/Resolution transition continuity broken/i);

      // Valid first record
      await repo.appendReconciliationRecord({
        id: 'REC-GOOD-RES-1',
        entityType: 'requirement',
        entityId: reqId,
        requirementRevisionId: rev2.id,
        action: 'RESOLVE',
        previousReviewState: undefined,
        newReviewState: 'ACCEPTED',
        previousResolutionState: 'UNRESOLVED',
        newResolutionState: 'CLEAR',
        rationale: 'Initial resolve',
        recordedAt: createInstant('2026-09-16T10:00:00.000Z')
      });

      // Broken subsequent continuity: claims previous was UNRESOLVED instead of CLEAR
      const rev3 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-RES-02-R3'),
        requirementId: reqId,
        revision: 3,
        statement: 'Statement 2',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'PENDING',
        resolutionState: 'CLEAR',
        supersedes: rev2.id
      });
      await repo.saveRequirementRevision(rev3);

      await expect(
        repo.appendReconciliationRecord({
          id: 'REC-BAD-RES-3',
          entityType: 'requirement',
          entityId: reqId,
          requirementRevisionId: rev3.id,
          action: 'RESOLVE',
          previousReviewState: 'ACCEPTED',
          newReviewState: 'PENDING',
          previousResolutionState: 'UNRESOLVED', // should be CLEAR
          newResolutionState: 'CLEAR',
          rationale: 'Wrong previous resolution',
          recordedAt: createInstant('2026-09-16T10:05:00.000Z')
        })
      ).rejects.toThrow(/Resolution transition continuity broken/i);

      // Rejects record when neither review nor resolution changes for non-REVISE action
      await expect(
        repo.appendReconciliationRecord({
          id: 'REC-NOOP-1',
          entityType: 'requirement',
          entityId: reqId,
          requirementRevisionId: rev2.id,
          action: 'ACCEPT',
          previousReviewState: 'ACCEPTED',
          newReviewState: 'ACCEPTED',
          rationale: 'No review or resolution change',
          recordedAt: createInstant('2026-09-16T10:10:00.000Z')
        })
      ).rejects.toThrow(/Transition must change reviewState or resolutionState/i);
    });
  });

  describe('Atomic transitions and projection records', () => {
    it('transitionCandidateFinding atomically updates finding and records audit record', async () => {
      const findingId = createFindingId('FIND-ATOMIC-1');
      const finding = createCandidateFinding({
        id: findingId,
        type: 'missing-authorization',
        discoveredBy: 'human'
      });
      await repo.saveCandidateFinding(finding);

      // Verify direct disposition change is blocked
      await expect(
        repo.saveCandidateFinding({
          ...finding,
          disposition: 'RESOLVED'
        })
      ).rejects.toThrow(/Direct disposition mutation/i);

      // Verify atomic transition succeeds
      const updatedFinding = createCandidateFinding({
        ...finding,
        disposition: 'RESOLVED',
        rationale: 'Resolved by lead engineer'
      });
      const record = {
        id: 'REC-F-ATOMIC-1',
        entityType: 'finding' as const,
        entityId: findingId,
        previousDisposition: 'OPEN' as const,
        newDisposition: 'RESOLVED' as const,
        rationale: 'Resolved by lead engineer',
        actorId: createActorId('ACT-LEAD'),
        recordedAt: createInstant('2026-09-16T12:00:00.000Z')
      };

      await repo.transitionCandidateFinding(updatedFinding, record, 'OPEN');

      const reloaded = await repo.getCandidateFinding(findingId);
      expect(reloaded?.disposition).toBe('RESOLVED');

      const audit = await repo.listReconciliationRecords('finding', findingId);
      expect(audit).toHaveLength(1);
      expect(audit[0].newDisposition).toBe('RESOLVED');
    });

    it('transitionCandidateFinding rejects CAS conflict when expectedCurrentDisposition does not match', async () => {
      const findingId = createFindingId('FIND-ATOMIC-2');
      const finding = createCandidateFinding({
        id: findingId,
        type: 'missing-authorization',
        discoveredBy: 'human'
      });
      await repo.saveCandidateFinding(finding);

      const updated = createCandidateFinding({
        ...finding,
        disposition: 'RESOLVED',
        rationale: 'Conflict test rationale'
      });
      const record = {
        id: 'REC-F-ATOMIC-2',
        entityType: 'finding' as const,
        entityId: findingId,
        previousDisposition: 'OPEN' as const,
        newDisposition: 'RESOLVED' as const,
        rationale: 'Conflict test',
        recordedAt: createInstant('2026-09-16T12:00:00.000Z')
      };

      await expect(repo.transitionCandidateFinding(updated, record, 'RESOLVED')).rejects.toThrow(
        /Concurrency conflict/i
      );
    });

    it('transitionRequirementRevision atomically creates successor and audit record', async () => {
      const reqId = createRequirementId('REQ-ATOMIC-1');
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ATOMIC-1-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Statement R1',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'PENDING'
      });
      await repo.saveRequirementRevision(rev1);

      const rev2 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ATOMIC-1-R2'),
        requirementId: reqId,
        revision: 2,
        statement: 'Statement R1',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        supersedes: rev1.id
      });
      const record = {
        id: 'REC-REQ-ATOMIC-1',
        entityType: 'requirement' as const,
        entityId: reqId,
        requirementRevisionId: rev2.id,
        action: 'ACCEPT' as const,
        previousReviewState: undefined,
        newReviewState: 'ACCEPTED' as const,
        rationale: 'Accepted by SME',
        actorId: createActorId('ACT-SME'),
        recordedAt: createInstant('2026-09-16T12:00:00.000Z')
      };

      await repo.transitionRequirementRevision(rev2, record, rev1.id);

      const reloadedRev2 = await repo.getRequirementRevision(rev2.id);
      expect(reloadedRev2?.reviewState).toBe('ACCEPTED');

      const revisions = await repo.listRequirementRevisions(reqId);
      expect(revisions.map((r) => r.id)).toEqual([rev1.id, rev2.id]);

      const audit = await repo.listReconciliationRecords('requirement', reqId);
      expect(audit).toHaveLength(1);
      expect(audit[0].action).toBe('ACCEPT');
    });

    it('transitionRequirementRevision rejects CAS conflict when expected current revision does not match', async () => {
      const reqId = createRequirementId('REQ-ATOMIC-2');
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ATOMIC-2-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Statement R1',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'PENDING'
      });
      await repo.saveRequirementRevision(rev1);

      const rev2 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ATOMIC-2-R2'),
        requirementId: reqId,
        revision: 2,
        statement: 'Statement R2',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        supersedes: rev1.id
      });
      const record = {
        id: 'REC-REQ-ATOMIC-2',
        entityType: 'requirement' as const,
        entityId: reqId,
        requirementRevisionId: rev2.id,
        action: 'ACCEPT' as const,
        previousReviewState: undefined,
        newReviewState: 'ACCEPTED' as const,
        rationale: 'Conflict test',
        recordedAt: createInstant('2026-09-16T12:00:00.000Z')
      };

      await expect(
        repo.transitionRequirementRevision(
          rev2,
          record,
          createRequirementRevisionId('REQ-ATOMIC-2-R99')
        )
      ).rejects.toThrow(/Concurrency conflict/i);
    });

    it('persists and reloads projection records with list queries', async () => {
      const baseId = createRequirementsBaselineId('BASE-001');
      const record = {
        id: 'PROJ-TEST-001',
        baselineId: baseId,
        requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
        artifactType: 'process-diagram' as const,
        content: 'graph TD\n  A --> B',
        metadata: {
          baselineId: baseId,
          requirementRevisionIds: ['REQ-001-R1'],
          artifactType: 'process-diagram',
          declaredProvenance: {
            baselineId: baseId,
            requirementRevisionIds: ['REQ-001-R1']
          },
          configuredExecution: {
            provider: 'fake',
            artifactType: 'process-diagram'
          },
          measuredVerification: {
            repairsNeeded: 0,
            attemptCount: 1,
            contentHash: 'abc123hash',
            verifiedAt: createInstant('2026-09-16T12:00:00.000Z')
          }
        },
        createdAt: createInstant('2026-09-16T12:00:00.000Z')
      };

      await repo.saveProjectionRecord(record);

      const reloaded = await repo.getProjectionRecord('PROJ-TEST-001');
      expect(reloaded).toBeDefined();
      expect(reloaded?.baselineId).toBe(baseId);
      expect(reloaded?.content).toBe('graph TD\n  A --> B');
      expect(reloaded?.metadata.measuredVerification.repairsNeeded).toBe(0);

      const listAll = await repo.listProjectionRecords();
      expect(listAll).toHaveLength(1);
      expect(listAll[0].id).toBe('PROJ-TEST-001');

      const listByBaseline = await repo.listProjectionRecords(baseId);
      expect(listByBaseline).toHaveLength(1);

      const listByOther = await repo.listProjectionRecords(
        createRequirementsBaselineId('BASE-OTHER')
      );
      expect(listByOther).toHaveLength(0);
    });
  });
});
