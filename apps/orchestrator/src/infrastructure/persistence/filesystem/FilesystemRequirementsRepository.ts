import fs from 'node:fs/promises';
import path from 'node:path';
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
  createSourceRevision,
  createRequirementRevision,
  createCandidateFinding,
  now,
  FINDING_DISPOSITIONS,
  REQUIREMENT_REVIEW_STATES,
  type SourceId,
  type SourceRevisionId,
  type RequirementId,
  type RequirementRevisionId,
  type FindingId,
  type RequirementsBaselineId,
  type SourceRevision,
  type RequirementRevision,
  type CandidateFinding,
  type RequirementsBaseline,
  type EvidenceLocator
} from '@solutions-studio/domain';
import type {
  IRequirementsRepository,
  SourceRevisionRecord,
  CaptureSourceRevisionInput,
  LocatorIndexEntry,
  ReconciliationRecord,
  EvaluationRunRecord,
  FindingReconciliationRecord,
  RequirementReconciliationRecord
} from '../../../application/ports/persistence/IRequirementsRepository.js';
import { computeContentHash, deriveLocatorIndex } from '../markdown/deriveLocatorIndex.js';
import {
  writeJsonExclusive,
  writeJsonAtomic,
  readJson,
  appendJsonLine,
  readJsonLines
} from './atomicFile.js';

export interface FilesystemRequirementsRepositoryOptions {
  readonly baseDir: string;
}

interface SourceIndexData {
  latestRevisionId?: string;
  revisionIds: string[];
}

interface RequirementIndexData {
  latestRevisionId?: string;
  revisionIds: string[];
}

function assertSafeIdentifier(id: string, name: string): string {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error(`Invalid ${name}: identifier cannot be empty`);
  }
  const trimmed = id.trim();
  if (
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('..') ||
    trimmed.includes('\0') ||
    path.isAbsolute(trimmed)
  ) {
    throw new Error(
      `Invalid ${name} '${id}': cannot contain path separators or traversal sequences`
    );
  }
  return trimmed;
}

function resolveStorePath(baseDir: string, subDir: string, filename: string): string {
  const storeDir = path.resolve(baseDir, subDir);
  const resolved = path.resolve(storeDir, filename);
  const rel = path.relative(storeDir, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '' || rel.includes('..')) {
    throw new Error(`Path traversal detected: '${filename}' escapes directory '${subDir}'`);
  }
  return resolved;
}

export class FilesystemRequirementsRepository implements IRequirementsRepository {
  private readonly baseDir: string;

  constructor(options: FilesystemRequirementsRepositoryOptions) {
    this.baseDir = options.baseDir;
  }

  async captureSourceRevision(input: CaptureSourceRevisionInput): Promise<SourceRevisionRecord> {
    assertSafeIdentifier(input.sourceId, 'sourceId');
    const contentHash = computeContentHash(input.markdownText);
    const contentIndexPath = resolveStorePath(
      this.baseDir,
      'source-content-index',
      `${input.sourceId}.json`
    );
    const contentMap = (await readJson<Record<string, string>>(contentIndexPath)) ?? {};

    // Decision 6: check content hash across ALL historical revisions of this source
    const existingRevisionId = contentMap[contentHash];
    if (existingRevisionId) {
      const existingRecord = await this.getSourceRevision(
        createSourceRevisionId(existingRevisionId)
      );
      if (existingRecord) {
        return existingRecord;
      }
    }

    const sourceIndexPath = resolveStorePath(
      this.baseDir,
      'source-index',
      `${input.sourceId}.json`
    );
    const sourceIndex = (await readJson<SourceIndexData>(sourceIndexPath)) ?? {
      revisionIds: []
    };

    let nextRevisionNumber = 1;
    let supersedesRevisionId: SourceRevisionId | undefined = undefined;

    if (sourceIndex.latestRevisionId) {
      const latestRecord = await this.getSourceRevision(
        createSourceRevisionId(sourceIndex.latestRevisionId)
      );
      if (latestRecord) {
        nextRevisionNumber = latestRecord.revision.revision + 1;
        supersedesRevisionId = latestRecord.revision.id;
      } else {
        nextRevisionNumber = sourceIndex.revisionIds.length + 1;
      }
    }

    const newRevisionId = createSourceRevisionId(`${input.sourceId}-R${nextRevisionNumber}`);
    assertSafeIdentifier(newRevisionId, 'sourceRevisionId');
    const sourceRevision = createSourceRevision({
      id: newRevisionId,
      sourceId: input.sourceId,
      revision: nextRevisionNumber,
      contentHash,
      capturedAt: input.capturedAt ?? now(),
      supersedes: supersedesRevisionId
    });

    const locatorIndex = deriveLocatorIndex(input.markdownText);
    const record: SourceRevisionRecord = Object.freeze({
      revision: sourceRevision,
      rawText: input.markdownText,
      locatorIndex: Object.freeze(locatorIndex)
    });

    // Write revision file exclusively (wx)
    const revisionFilePath = resolveStorePath(
      this.baseDir,
      'source-revisions',
      `${newRevisionId}.json`
    );
    await writeJsonExclusive(revisionFilePath, record);

    // Update source index atomically
    const updatedSourceIndex: SourceIndexData = {
      latestRevisionId: newRevisionId,
      revisionIds: [...sourceIndex.revisionIds, newRevisionId]
    };
    await writeJsonAtomic(sourceIndexPath, updatedSourceIndex);

    // Update source content index atomically
    const updatedContentMap: Record<string, string> = {
      ...contentMap,
      [contentHash]: newRevisionId
    };
    await writeJsonAtomic(contentIndexPath, updatedContentMap);

    return record;
  }

  async getSourceRevision(id: SourceRevisionId): Promise<SourceRevisionRecord | undefined> {
    assertSafeIdentifier(id, 'sourceRevisionId');
    const filePath = resolveStorePath(this.baseDir, 'source-revisions', `${id}.json`);
    const raw = await readJson<SourceRevisionRecord>(filePath);
    if (!raw) {
      return undefined;
    }

    return Object.freeze({
      revision: createSourceRevision({
        id: createSourceRevisionId(raw.revision.id),
        sourceId: createSourceId(raw.revision.sourceId),
        revision: raw.revision.revision,
        contentHash: raw.revision.contentHash,
        capturedAt: raw.revision.capturedAt,
        verifiedAt: raw.revision.verifiedAt,
        supersedes: raw.revision.supersedes
          ? createSourceRevisionId(raw.revision.supersedes)
          : undefined
      }),
      rawText: raw.rawText,
      locatorIndex: Object.freeze(
        raw.locatorIndex.map((entry) =>
          Object.freeze({
            locator: createEvidenceLocator(entry.locator),
            headingPath: entry.headingPath,
            blockLabel: entry.blockLabel,
            blockLabelSource: entry.blockLabelSource,
            text: entry.text,
            startLine: entry.startLine,
            endLine: entry.endLine
          })
        )
      )
    });
  }

  async listSourceRevisions(sourceId: SourceId): Promise<readonly SourceRevision[]> {
    assertSafeIdentifier(sourceId, 'sourceId');
    const sourceIndexPath = resolveStorePath(this.baseDir, 'source-index', `${sourceId}.json`);
    const sourceIndex = await readJson<SourceIndexData>(sourceIndexPath);
    if (!sourceIndex?.revisionIds) {
      return Object.freeze([]);
    }

    const result: SourceRevision[] = [];
    for (const revId of sourceIndex.revisionIds) {
      const rec = await this.getSourceRevision(createSourceRevisionId(revId));
      if (rec) {
        result.push(rec.revision);
      }
    }
    return Object.freeze(result);
  }

  async getLatestSourceRevision(sourceId: SourceId): Promise<SourceRevisionRecord | undefined> {
    assertSafeIdentifier(sourceId, 'sourceId');
    const sourceIndexPath = resolveStorePath(this.baseDir, 'source-index', `${sourceId}.json`);
    const sourceIndex = await readJson<SourceIndexData>(sourceIndexPath);
    if (!sourceIndex?.latestRevisionId) {
      return undefined;
    }
    return this.getSourceRevision(createSourceRevisionId(sourceIndex.latestRevisionId));
  }

  async resolveLocator(
    sourceRevisionId: SourceRevisionId,
    locator: EvidenceLocator | string
  ): Promise<LocatorIndexEntry | undefined> {
    assertSafeIdentifier(sourceRevisionId, 'sourceRevisionId');
    const record = await this.getSourceRevision(sourceRevisionId);
    if (!record) {
      return undefined;
    }
    return record.locatorIndex.find((e) => e.locator === locator);
  }

  async saveRequirementRevision(revision: RequirementRevision): Promise<void> {
    assertSafeIdentifier(revision.id, 'requirementRevisionId');
    assertSafeIdentifier(revision.requirementId, 'requirementId');
    const filePath = resolveStorePath(this.baseDir, 'requirement-revisions', `${revision.id}.json`);
    await writeJsonExclusive(filePath, revision);

    const indexPath = resolveStorePath(
      this.baseDir,
      'requirement-index',
      `${revision.requirementId}.json`
    );
    const existingIndex = (await readJson<RequirementIndexData>(indexPath)) ?? {
      revisionIds: []
    };
    const revisionIds = existingIndex.revisionIds.includes(revision.id)
      ? existingIndex.revisionIds
      : [...existingIndex.revisionIds, revision.id];

    await writeJsonAtomic(indexPath, {
      latestRevisionId: revision.id,
      revisionIds
    });
  }

  async getRequirementRevision(
    id: RequirementRevisionId
  ): Promise<RequirementRevision | undefined> {
    assertSafeIdentifier(id, 'requirementRevisionId');
    const filePath = resolveStorePath(this.baseDir, 'requirement-revisions', `${id}.json`);
    const raw = await readJson<RequirementRevision>(filePath);
    if (!raw) {
      return undefined;
    }

    return createRequirementRevision({
      id: createRequirementRevisionId(raw.id),
      requirementId: createRequirementId(raw.requirementId),
      revision: raw.revision,
      statement: raw.statement,
      category: raw.category,
      origin: raw.origin,
      reviewState: raw.reviewState,
      resolutionState: raw.resolutionState,
      evidence: (raw.evidence ?? []).map((e) => ({
        sourceRevisionId: createSourceRevisionId(e.sourceRevisionId),
        locator: createEvidenceLocator(e.locator)
      })),
      rationale: raw.rationale,
      affectedActors: raw.affectedActors?.map((a) => createActorId(a)),
      dependencies: raw.dependencies?.map((d) => createRequirementId(d)),
      supersedes: raw.supersedes ? createRequirementRevisionId(raw.supersedes) : undefined
    });
  }

  async listRequirementRevisions(
    requirementId: RequirementId
  ): Promise<readonly RequirementRevision[]> {
    assertSafeIdentifier(requirementId, 'requirementId');
    const indexPath = resolveStorePath(this.baseDir, 'requirement-index', `${requirementId}.json`);
    const indexData = await readJson<RequirementIndexData>(indexPath);
    if (!indexData?.revisionIds) {
      return Object.freeze([]);
    }

    const result: RequirementRevision[] = [];
    for (const id of indexData.revisionIds) {
      const rev = await this.getRequirementRevision(createRequirementRevisionId(id));
      if (rev) {
        result.push(rev);
      }
    }
    return Object.freeze(result);
  }

  async saveCandidateFinding(finding: CandidateFinding): Promise<void> {
    assertSafeIdentifier(finding.id, 'findingId');
    const filePath = resolveStorePath(this.baseDir, 'findings', `${finding.id}.json`);
    await writeJsonAtomic(filePath, finding);
  }

  async getCandidateFinding(id: FindingId): Promise<CandidateFinding | undefined> {
    assertSafeIdentifier(id, 'findingId');
    const filePath = resolveStorePath(this.baseDir, 'findings', `${id}.json`);
    const raw = await readJson<CandidateFinding>(filePath);
    if (!raw) {
      return undefined;
    }

    return createCandidateFinding({
      id: createFindingId(raw.id),
      type: raw.type,
      affectedRequirementRevisions: raw.affectedRequirementRevisions?.map((r) =>
        createRequirementRevisionId(r)
      ),
      evidence: (raw.evidence ?? []).map((e) => ({
        sourceRevisionId: createSourceRevisionId(e.sourceRevisionId),
        locator: createEvidenceLocator(e.locator)
      })),
      discoveredBy: raw.discoveredBy,
      disposition: raw.disposition,
      rationale: raw.rationale
    });
  }

  async listCandidateFindings(): Promise<readonly CandidateFinding[]> {
    const dirPath = path.resolve(this.baseDir, 'findings');
    try {
      const files = await fs.readdir(dirPath);
      const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
      const result: CandidateFinding[] = [];
      for (const file of jsonFiles) {
        const rawId = file.replace(/\.json$/, '');
        assertSafeIdentifier(rawId, 'findingId');
        const findingId = createFindingId(rawId);
        const finding = await this.getCandidateFinding(findingId);
        if (finding) {
          result.push(finding);
        }
      }
      return Object.freeze(result);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return Object.freeze([]);
      }
      throw err;
    }
  }

  async appendReconciliationRecord(record: ReconciliationRecord): Promise<void> {
    if (typeof record.rationale !== 'string' || record.rationale.trim().length === 0) {
      throw new Error('Reconciliation record rationale must be a non-empty string');
    }
    assertSafeIdentifier(record.id, 'reconciliationRecordId');

    if (record.entityType === 'finding') {
      assertSafeIdentifier(record.entityId, 'findingId');
      if (!FINDING_DISPOSITIONS.includes(record.previousDisposition)) {
        throw new Error(`Invalid previousDisposition: '${String(record.previousDisposition)}'`);
      }
      if (!FINDING_DISPOSITIONS.includes(record.newDisposition)) {
        throw new Error(`Invalid newDisposition: '${String(record.newDisposition)}'`);
      }
      if (record.previousDisposition === record.newDisposition) {
        throw new Error(
          `Transition must change disposition: previous and new are both '${record.previousDisposition}'`
        );
      }

      const finding = await this.getCandidateFinding(record.entityId);
      if (!finding) {
        throw new Error(`Referenced finding '${record.entityId}' does not exist`);
      }

      const history = await this.listReconciliationRecords('finding', record.entityId);
      if (history.length > 0) {
        const lastRecord = history[history.length - 1];
        if (record.previousDisposition !== lastRecord.newDisposition) {
          throw new Error(
            `Transition continuity broken for finding '${record.entityId}': expected previousDisposition '${lastRecord.newDisposition}', got '${record.previousDisposition}'`
          );
        }
      } else {
        // For the first audit record, previousDisposition must match the entity's prior state.
        // If the finding was already transitioned on disk (disposition === newDisposition), previousDisposition must be 'OPEN'.
        // Otherwise, previousDisposition must equal finding.disposition.
        if (
          record.previousDisposition !== finding.disposition &&
          !(record.newDisposition === finding.disposition && record.previousDisposition === 'OPEN')
        ) {
          throw new Error(
            `Transition continuity broken for finding '${record.entityId}': previousDisposition '${record.previousDisposition}' does not match finding disposition '${finding.disposition}'`
          );
        }
      }

      const filePath = resolveStorePath(
        this.baseDir,
        path.join('reconciliation', 'finding'),
        `${record.entityId}.jsonl`
      );
      await appendJsonLine(filePath, record);
    } else if (record.entityType === 'requirement') {
      assertSafeIdentifier(record.entityId, 'requirementId');
      assertSafeIdentifier(record.requirementRevisionId, 'requirementRevisionId');

      const VALID_ACTIONS = ['ACCEPT', 'REJECT', 'REVISE', 'REOPEN'] as const;
      if (!VALID_ACTIONS.includes(record.action)) {
        throw new Error(`Invalid action: '${String(record.action)}'`);
      }

      if (!REQUIREMENT_REVIEW_STATES.includes(record.newReviewState)) {
        throw new Error(`Invalid newReviewState: '${String(record.newReviewState)}'`);
      }
      if (
        record.previousReviewState !== undefined &&
        !REQUIREMENT_REVIEW_STATES.includes(record.previousReviewState)
      ) {
        throw new Error(`Invalid previousReviewState: '${String(record.previousReviewState)}'`);
      }
      if (record.previousReviewState === record.newReviewState) {
        throw new Error(
          `Transition must change reviewState: previous and new are both '${record.newReviewState}'`
        );
      }

      const rev = await this.getRequirementRevision(record.requirementRevisionId);
      if (!rev) {
        throw new Error(
          `Referenced requirement revision '${record.requirementRevisionId}' does not exist`
        );
      }
      if (rev.requirementId !== record.entityId) {
        throw new Error(
          `Requirement revision '${record.requirementRevisionId}' belongs to requirement '${rev.requirementId}', not '${record.entityId}'`
        );
      }

      const history = await this.listReconciliationRecords('requirement', record.entityId);
      if (history.length === 0) {
        if (record.previousReviewState !== undefined) {
          throw new Error(
            `First reconciliation record for requirement '${record.entityId}' must have previousReviewState undefined, got '${record.previousReviewState}'`
          );
        }
      } else {
        if (record.previousReviewState === undefined) {
          throw new Error(
            `Subsequent reconciliation record for requirement '${record.entityId}' must have a defined previousReviewState`
          );
        }
        const lastRecord = history[history.length - 1];
        if (record.previousReviewState !== lastRecord.newReviewState) {
          throw new Error(
            `Transition continuity broken for requirement '${record.entityId}': expected previousReviewState '${lastRecord.newReviewState}', got '${record.previousReviewState}'`
          );
        }
      }

      const filePath = resolveStorePath(
        this.baseDir,
        path.join('reconciliation', 'requirement'),
        `${record.entityId}.jsonl`
      );
      await appendJsonLine(filePath, record);
    } else {
      throw new Error(`Unsupported entityType: '${(record as { entityType: string }).entityType}'`);
    }
  }

  async listReconciliationRecords(
    entityType: 'finding',
    entityId: FindingId
  ): Promise<readonly FindingReconciliationRecord[]>;
  async listReconciliationRecords(
    entityType: 'requirement',
    entityId: RequirementId
  ): Promise<readonly RequirementReconciliationRecord[]>;
  async listReconciliationRecords(
    entityType: 'finding' | 'requirement',
    entityId: FindingId | RequirementId
  ): Promise<readonly ReconciliationRecord[]>;
  async listReconciliationRecords(
    entityType: 'finding' | 'requirement',
    entityId: FindingId | RequirementId
  ): Promise<readonly ReconciliationRecord[]> {
    assertSafeIdentifier(entityId, entityType === 'finding' ? 'findingId' : 'requirementId');
    const filePath = resolveStorePath(
      this.baseDir,
      path.join('reconciliation', entityType),
      `${entityId}.jsonl`
    );
    const lines = await readJsonLines<ReconciliationRecord>(filePath);
    return lines;
  }

  async listAllReconciliationRecords(): Promise<readonly ReconciliationRecord[]> {
    const results: ReconciliationRecord[] = [];
    const baseReconciliationDir = path.resolve(this.baseDir, 'reconciliation');

    for (const entityType of ['finding', 'requirement'] as const) {
      const subDir = path.resolve(baseReconciliationDir, entityType);
      try {
        const files = await fs.readdir(subDir);
        for (const file of files) {
          if (file.endsWith('.jsonl')) {
            const rawId = file.replace(/\.jsonl$/, '');
            assertSafeIdentifier(rawId, entityType === 'finding' ? 'findingId' : 'requirementId');
            const lines = await readJsonLines<ReconciliationRecord>(path.join(subDir, file));
            results.push(...lines);
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }

    results.sort((a, b) => {
      const cmp = a.recordedAt.localeCompare(b.recordedAt);
      if (cmp !== 0) return cmp;
      return a.id.localeCompare(b.id);
    });

    return Object.freeze(results);
  }

  async saveRequirementsBaseline(baseline: RequirementsBaseline): Promise<void> {
    assertSafeIdentifier(baseline.id, 'baselineId');
    const filePath = resolveStorePath(this.baseDir, 'baselines', `${baseline.id}.json`);
    await writeJsonExclusive(filePath, baseline);
  }

  async getRequirementsBaseline(
    id: RequirementsBaselineId
  ): Promise<RequirementsBaseline | undefined> {
    assertSafeIdentifier(id, 'baselineId');
    const filePath = resolveStorePath(this.baseDir, 'baselines', `${id}.json`);
    const raw = await readJson<RequirementsBaseline>(filePath);
    if (!raw) {
      return undefined;
    }

    return Object.freeze({
      id: createRequirementsBaselineId(raw.id),
      requirementRevisions: Object.freeze(
        raw.requirementRevisions.map((r) => createRequirementRevisionId(r))
      ),
      createdAt: createInstant(raw.createdAt),
      createdBy: createReviewerId(raw.createdBy)
    });
  }

  async saveEvaluationRun(run: EvaluationRunRecord): Promise<void> {
    assertSafeIdentifier(run.id, 'runId');
    const filePath = resolveStorePath(this.baseDir, 'evaluation-runs', `${run.id}.json`);
    await writeJsonAtomic(filePath, run);
  }

  async getEvaluationRun(id: string): Promise<EvaluationRunRecord | undefined> {
    assertSafeIdentifier(id, 'runId');
    const filePath = resolveStorePath(this.baseDir, 'evaluation-runs', `${id}.json`);
    const raw = await readJson<EvaluationRunRecord>(filePath);
    if (!raw) {
      return undefined;
    }

    return Object.freeze({
      id: raw.id,
      corpusVersion: raw.corpusVersion,
      executedAt: createInstant(raw.executedAt),
      fixtureResults: Object.freeze(
        raw.fixtureResults.map((fr) =>
          Object.freeze({
            fixtureId: fr.fixtureId,
            passed: fr.passed,
            ...(fr.details !== undefined ? { details: fr.details } : {})
          })
        )
      ),
      ...(raw.summary !== undefined ? { summary: raw.summary } : {})
    });
  }

  async listEvaluationRuns(): Promise<readonly EvaluationRunRecord[]> {
    const dirPath = path.resolve(this.baseDir, 'evaluation-runs');
    try {
      const files = await fs.readdir(dirPath);
      const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
      const result: EvaluationRunRecord[] = [];
      for (const file of jsonFiles) {
        const rawId = file.replace(/\.json$/, '');
        assertSafeIdentifier(rawId, 'runId');
        const run = await this.getEvaluationRun(rawId);
        if (run) {
          result.push(run);
        }
      }
      result.sort((a, b) => a.executedAt.localeCompare(b.executedAt));
      return Object.freeze(result);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return Object.freeze([]);
      }
      throw err;
    }
  }
}
