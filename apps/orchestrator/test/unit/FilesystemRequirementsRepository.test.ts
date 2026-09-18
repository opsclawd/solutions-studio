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
import {
  StaleRevisionTargetError,
  UnknownRequirementRevisionError
} from '../../src/application/use-cases/ReconciliationErrors.js';
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
    expect(record.sourceType).toBe('sop');
    expect(latest?.sourceType).toBe('sop');

    const fetched = await repo.getSourceRevision(createSourceRevisionId('SRC-001-R1'));
    expect(fetched?.sourceType).toBe('sop');
  });

  it('persists and round-trips sourceType across capture and getSourceRevision for distinct source types', async () => {
    const types = ['policy', 'interview', 'schema', 'spreadsheet', 'sop'] as const;
    for (const st of types) {
      const sourceId = createSourceId(`SRC-TYPE-${st.toUpperCase()}`);
      const captured = await repo.captureSourceRevision({
        sourceId,
        sourceType: st,
        markdownText: `# Title\n\nContent for ${st}.`
      });
      expect(captured.sourceType).toBe(st);

      const fetched = await repo.getSourceRevision(captured.revision.id);
      expect(fetched).toBeDefined();
      expect(fetched?.sourceType).toBe(st);

      const latest = await repo.getLatestSourceRevision(sourceId);
      expect(latest?.sourceType).toBe(st);
    }
  });

  it('loads legacy source revision with missing sourceType as undefined without fabricating fallback', async () => {
    const revId = 'LEGACY-SRC-001-R1';
    const sourceId = createSourceId('LEGACY-SRC-001');
    const rawRecordWithoutSourceType = {
      revision: {
        id: revId,
        sourceId: sourceId as string,
        revision: 1,
        contentHash: 'hash-legacy-123',
        capturedAt: '2026-09-01T00:00:00.000Z',
        verifiedAt: '2026-09-01T00:00:00.000Z'
      },
      rawText: '# Legacy Document\n\nSome text.',
      locatorIndex: [
        {
          locator: 'legacy-document#1',
          headingPath: 'Legacy Document',
          blockLabel: '1',
          blockLabelSource: 'sequential-ordinal',
          text: 'Some text.',
          startLine: 3,
          endLine: 3
        }
      ]
    };

    const dir = path.join(tempDir, 'source-revisions');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, `${revId}.json`),
      JSON.stringify(rawRecordWithoutSourceType, null, 2),
      'utf8'
    );

    const loaded = await repo.getSourceRevision(createSourceRevisionId(revId));
    expect(loaded).toBeDefined();
    expect(loaded?.sourceType).toBeUndefined();
    expect(loaded?.revision.id).toBe(revId);
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

  it('repro Bug 4: creates a new revision on revert to prior content (A -> B -> A), preserving latest pointer and chronological order', async () => {
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

    // Re-capturing original md1 content after md2 must create R3 with supersedes R2
    const recReimport1 = await repo.captureSourceRevision({
      sourceId,
      sourceType: 'sop',
      markdownText: md1
    });

    expect(recReimport1.revision.id).toBe('SRC-004-R3');
    expect(recReimport1.revision.revision).toBe(3);
    expect(recReimport1.revision.supersedes).toBe('SRC-004-R2');

    const latestAfter = await repo.getLatestSourceRevision(sourceId);
    expect(latestAfter?.revision.id).toBe('SRC-004-R3');

    const filesOnDisk = await fs.readdir(path.join(tempDir, 'source-revisions'));
    expect(filesOnDisk.sort()).toEqual(['SRC-004-R1.json', 'SRC-004-R2.json', 'SRC-004-R3.json']);

    const listed = await repo.listSourceRevisions(sourceId);
    expect(listed).toHaveLength(3);
    expect(listed.map((r) => r.id)).toEqual(['SRC-004-R1', 'SRC-004-R2', 'SRC-004-R3']);
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

  it('lists all requirement IDs and handles empty repository', async () => {
    const emptyList = await repo.listRequirementIds();
    expect(emptyList).toEqual([]);

    const reqRev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'First requirement',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: []
    });

    const reqRev2 = createRequirementRevision({
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

    await repo.saveRequirementRevision(reqRev1);
    await repo.saveRequirementRevision(reqRev2);

    const ids = await repo.listRequirementIds();
    expect(ids).toEqual(['REQ-001', 'REQ-002']);
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
    const fixtureResults = [
      {
        fixtureId: 'missing-authorization-basic',
        status: 'failed' as const,
        error: {
          name: 'Error',
          message: 'Sample test error',
          phase: 'capture' as const
        }
      }
    ];

    const runId = 'RUN-2026-09-16-01';
    const executedAt = createInstant('2026-09-16T12:00:00.000Z');
    const corpusVersion = 'v1.0';

    const run: EvaluationRunRecord = {
      id: runId,
      corpusVersion,
      executedAt,
      fixtureResults,
      report: {
        reportSchemaVersion: '1.0.0',
        runId,
        executedAt,
        corpusVersion,
        corpusIdentity: 'test-corpus-identity-sha256',
        candidateSha: { status: 'available', value: 'cand-sha-123' },
        fixtureOrder: ['missing-authorization-basic'],
        fixtureResults,
        aggregateScores: {
          totalFixtures: 1,
          completedFixtures: 0,
          failedFixtures: 1,
          requirementsByCategory: {},
          findingsByCategory: {},
          unclassifiedFindingsCount: 0
        },
        reportArtifacts: {
          jsonReportPath: { status: 'available', value: 'reports/eval.json' },
          jsonReportDigest: { status: 'available', value: 'digest-1' },
          markdownReportPath: { status: 'unavailable', reason: 'None' },
          markdownReportDigest: { status: 'unavailable', reason: 'None' }
        },
        provenance: {
          requested: {
            candidateSha: { status: 'available', value: 'cand-sha-123' },
            providerMode: 'fixture-replay',
            providerName: 'fixture-replay',
            manifestPath: 'manifests/corpus.v1.json',
            outputReportPath: { status: 'available', value: 'reports/eval.json' },
            storeDir: { status: 'unavailable', reason: 'In-memory' }
          },
          declared: {
            manifestVersion: 'v1.0',
            manifestHash: 'manifest-hash-1',
            canonicalizationVersion: 'v1',
            corpusIdentity: 'test-corpus-identity-sha256',
            fixtureOrder: ['missing-authorization-basic'],
            fixtures: []
          },
          configured: {
            compilerVersion: '1.0.0',
            promptVersion: '1.0.0',
            gatewayConfig: {},
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch
          },
          verified: {
            schemaValidation: true,
            corpusLineageValid: true,
            persistenceVerified: true,
            reportDigest: 'report-digest-1'
          }
        }
      }
    };

    await repo.saveEvaluationRun(run);

    const reloaded = await repo.getEvaluationRun(run.id);
    expect(reloaded).toEqual(run);

    const list = await repo.listEvaluationRuns();
    expect(list).toEqual([run]);

    // Enforce write-once immutability: overwriting existing run must reject with ImmutableRecordConflictError
    await expect(repo.saveEvaluationRun(run)).rejects.toThrow(ImmutableRecordConflictError);
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
        } as any)
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
      ).rejects.toThrow(/Cannot create candidate finding directly with non-OPEN disposition/i);

      // Verify duplicate save of existing finding is blocked with ImmutableRecordConflictError
      await expect(repo.saveCandidateFinding(finding)).rejects.toThrow(
        ImmutableRecordConflictError
      );

      // Verify direct overwrite attempt (e.g. clearing affectedRequirementRevisions) is blocked
      await expect(
        repo.saveCandidateFinding(
          createCandidateFinding({
            id: findingId,
            type: 'missing-authorization',
            discoveredBy: 'human',
            affectedRequirementRevisions: []
          })
        )
      ).rejects.toThrow(ImmutableRecordConflictError);

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

    it('transitionCandidateFinding rejects attempts to alter immutable finding fields (type, targets, evidence, discoveredBy)', async () => {
      const findingId = createFindingId('FIND-IMMUTABLE-1');
      const revId = createRequirementRevisionId('REQ-REV-1');
      const finding = createCandidateFinding({
        id: findingId,
        type: 'contradiction',
        affectedRequirementRevisions: [revId],
        evidence: [
          {
            sourceRevisionId: createSourceRevisionId('SRC-1-R1'),
            locator: createEvidenceLocator('section#1')
          }
        ],
        discoveredBy: 'model'
      });
      await repo.saveCandidateFinding(finding);

      const makeRecord = (recId: string) => ({
        id: recId,
        entityType: 'finding' as const,
        entityId: findingId,
        previousDisposition: 'OPEN' as const,
        newDisposition: 'RESOLVED' as const,
        rationale: 'Valid transition rationale',
        recordedAt: createInstant('2026-09-16T12:00:00.000Z')
      });

      // 1. Attempt to change type
      const forgedType = createCandidateFinding({
        ...finding,
        type: 'missing-authorization',
        disposition: 'RESOLVED',
        rationale: 'Changed type'
      });
      await expect(
        repo.transitionCandidateFinding(forgedType, makeRecord('REC-IMM-1'), 'OPEN')
      ).rejects.toThrow(/Cannot mutate immutable finding type/i);

      // 2. Attempt to change affectedRequirementRevisions (clearing targets)
      const forgedTargets = createCandidateFinding({
        ...finding,
        affectedRequirementRevisions: [],
        disposition: 'RESOLVED',
        rationale: 'Cleared targets'
      });
      await expect(
        repo.transitionCandidateFinding(forgedTargets, makeRecord('REC-IMM-2'), 'OPEN')
      ).rejects.toThrow(/Cannot mutate immutable finding affectedRequirementRevisions/i);

      // 3. Attempt to change evidence
      const forgedEvidence = createCandidateFinding({
        ...finding,
        evidence: [],
        disposition: 'RESOLVED',
        rationale: 'Cleared evidence'
      });
      await expect(
        repo.transitionCandidateFinding(forgedEvidence, makeRecord('REC-IMM-3'), 'OPEN')
      ).rejects.toThrow(/Cannot mutate immutable finding evidence/i);

      // 4. Attempt to change discoveredBy
      const forgedDiscoverer = createCandidateFinding({
        ...finding,
        discoveredBy: 'human',
        disposition: 'RESOLVED',
        rationale: 'Changed discoverer'
      });
      await expect(
        repo.transitionCandidateFinding(forgedDiscoverer, makeRecord('REC-IMM-4'), 'OPEN')
      ).rejects.toThrow(/Cannot mutate immutable finding discoveredBy/i);
    });

    it('transitionCandidateFinding rejects record/finding mismatches (entityId, previousDisposition, newDisposition, rationale, entityType), preserving finding state and audit history', async () => {
      const findingId = createFindingId('FIND-MISMATCH-1');
      const finding = createCandidateFinding({
        id: findingId,
        type: 'contradiction',
        discoveredBy: 'model',
        disposition: 'OPEN'
      });
      await repo.saveCandidateFinding(finding);

      const validUpdated = createCandidateFinding({
        ...finding,
        disposition: 'RESOLVED',
        rationale: 'Valid resolution rationale'
      });

      // 1. entityId mismatch
      const wrongEntityRecord = {
        id: 'REC-MIS-1',
        entityType: 'finding' as const,
        entityId: createFindingId('FIND-OTHER-99'),
        previousDisposition: 'OPEN' as const,
        newDisposition: 'RESOLVED' as const,
        rationale: 'Valid resolution rationale',
        recordedAt: createInstant('2026-09-16T12:00:00.000Z')
      };
      await expect(
        repo.transitionCandidateFinding(validUpdated, wrongEntityRecord, 'OPEN')
      ).rejects.toThrow(/entityId 'FIND-OTHER-99' does not match finding id 'FIND-MISMATCH-1'/i);

      let onDisk = await repo.getCandidateFinding(findingId);
      expect(onDisk?.disposition).toBe('OPEN');
      let audit = await repo.listReconciliationRecords('finding', findingId);
      expect(audit).toHaveLength(0);

      // 2. previousDisposition mismatch
      const wrongPrevRecord = {
        id: 'REC-MIS-2',
        entityType: 'finding' as const,
        entityId: findingId,
        previousDisposition: 'RESOLVED' as const,
        newDisposition: 'DISMISSED_FALSE_POSITIVE' as const,
        rationale: 'Valid resolution rationale',
        recordedAt: createInstant('2026-09-16T12:00:00.000Z')
      };
      const validDismissed = createCandidateFinding({
        ...finding,
        disposition: 'DISMISSED_FALSE_POSITIVE',
        rationale: 'Valid resolution rationale'
      });
      await expect(
        repo.transitionCandidateFinding(validDismissed, wrongPrevRecord, 'OPEN')
      ).rejects.toThrow(
        /previousDisposition 'RESOLVED' does not match current finding disposition 'OPEN'/i
      );

      onDisk = await repo.getCandidateFinding(findingId);
      expect(onDisk?.disposition).toBe('OPEN');
      audit = await repo.listReconciliationRecords('finding', findingId);
      expect(audit).toHaveLength(0);

      // 3. newDisposition mismatch
      const wrongNewDispRecord = {
        id: 'REC-MIS-3',
        entityType: 'finding' as const,
        entityId: findingId,
        previousDisposition: 'OPEN' as const,
        newDisposition: 'DISMISSED_FALSE_POSITIVE' as const,
        rationale: 'Valid resolution rationale',
        recordedAt: createInstant('2026-09-16T12:00:00.000Z')
      };
      await expect(
        repo.transitionCandidateFinding(validUpdated, wrongNewDispRecord, 'OPEN')
      ).rejects.toThrow(
        /newDisposition 'DISMISSED_FALSE_POSITIVE' does not match proposed finding disposition 'RESOLVED'/i
      );

      onDisk = await repo.getCandidateFinding(findingId);
      expect(onDisk?.disposition).toBe('OPEN');
      audit = await repo.listReconciliationRecords('finding', findingId);
      expect(audit).toHaveLength(0);

      // 4. rationale mismatch
      const wrongRationaleRecord = {
        id: 'REC-MIS-4',
        entityType: 'finding' as const,
        entityId: findingId,
        previousDisposition: 'OPEN' as const,
        newDisposition: 'RESOLVED' as const,
        rationale: 'Completely different rationale',
        recordedAt: createInstant('2026-09-16T12:00:00.000Z')
      };
      await expect(
        repo.transitionCandidateFinding(validUpdated, wrongRationaleRecord, 'OPEN')
      ).rejects.toThrow(/rationale does not match/i);

      onDisk = await repo.getCandidateFinding(findingId);
      expect(onDisk?.disposition).toBe('OPEN');
      audit = await repo.listReconciliationRecords('finding', findingId);
      expect(audit).toHaveLength(0);

      // 5. entityType mismatch
      const wrongEntityTypeRecord = {
        id: 'REC-MIS-5',
        entityType: 'requirement' as any,
        entityId: findingId as any,
        previousDisposition: 'OPEN' as const,
        newDisposition: 'RESOLVED' as const,
        rationale: 'Valid resolution rationale',
        recordedAt: createInstant('2026-09-16T12:00:00.000Z')
      };
      await expect(
        repo.transitionCandidateFinding(validUpdated, wrongEntityTypeRecord, 'OPEN')
      ).rejects.toThrow(/entityType must be 'finding'/i);

      onDisk = await repo.getCandidateFinding(findingId);
      expect(onDisk?.disposition).toBe('OPEN');
      audit = await repo.listReconciliationRecords('finding', findingId);
      expect(audit).toHaveLength(0);
    });

    it('saveRequirementsBaselineConditional saves baseline when expected latest revisions match', async () => {
      const reqId = createRequirementId('REQ-CAS-1');
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-CAS-1-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Statement 1',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(rev1);

      const baselineId = createRequirementsBaselineId('BASE-CAS-1');
      const baseline = createRequirementsBaseline({
        id: baselineId,
        requirements: [rev1],
        createdBy: createReviewerId('REV-1'),
        createdAt: createInstant('2026-09-16T12:00:00.000Z')
      });

      await repo.saveRequirementsBaselineConditional(baseline, [rev1.id]);

      const reloaded = await repo.getRequirementsBaseline(baselineId);
      expect(reloaded).toBeDefined();
      expect(reloaded?.id).toBe(baselineId);
      expect(reloaded?.requirementRevisions).toEqual([rev1.id]);
    });

    it('saveRequirementsBaselineConditional rejects with StaleRevisionTargetError when expected revision is stale', async () => {
      const reqId = createRequirementId('REQ-CAS-2');
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-CAS-2-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Statement 1',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(rev1);

      const rev2 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-CAS-2-R2'),
        requirementId: reqId,
        revision: 2,
        statement: 'Statement 2',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        supersedes: rev1.id
      });
      await repo.saveRequirementRevision(rev2);

      const baselineId = createRequirementsBaselineId('BASE-CAS-2');
      const baseline = createRequirementsBaseline({
        id: baselineId,
        requirements: [rev1],
        createdBy: createReviewerId('REV-1'),
        createdAt: createInstant('2026-09-16T12:00:00.000Z')
      });

      await expect(repo.saveRequirementsBaselineConditional(baseline, [rev1.id])).rejects.toThrow(
        StaleRevisionTargetError
      );

      expect(await repo.getRequirementsBaseline(baselineId)).toBeUndefined();
    });

    it('saveRequirementsBaselineConditional rejects with UnknownRequirementRevisionError when expected revision does not exist', async () => {
      const nonExistentRevId = createRequirementRevisionId('REQ-NONEXISTENT-R1');
      const baselineId = createRequirementsBaselineId('BASE-CAS-3');
      const baseline = {
        id: baselineId,
        requirementRevisions: [nonExistentRevId],
        createdBy: createReviewerId('REV-1'),
        createdAt: createInstant('2026-09-16T12:00:00.000Z')
      };

      await expect(
        repo.saveRequirementsBaselineConditional(baseline, [nonExistentRevId])
      ).rejects.toThrow(UnknownRequirementRevisionError);

      expect(await repo.getRequirementsBaseline(baselineId)).toBeUndefined();
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
