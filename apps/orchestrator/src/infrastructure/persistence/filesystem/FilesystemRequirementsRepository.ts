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
  createPolicyConstraintId,
  createPolicyConstraintRevisionId,
  createEngineeringDecisionId,
  createPolicyConstraintRevision,
  createEngineeringDecision,
  createStoryId,
  now,
  FINDING_DISPOSITIONS,
  REQUIREMENT_REVIEW_STATES,
  REQUIREMENT_RESOLUTION_STATES,
  REQUIREMENT_RECONCILIATION_ACTIONS,
  type SourceId,
  type SourceRevisionId,
  type RequirementId,
  type RequirementRevisionId,
  type FindingId,
  type RequirementsBaselineId,
  type StoryId,
  type SourceRevision,
  type RequirementRevision,
  type CandidateFinding,
  type RequirementsBaseline,
  type PolicyConstraintId,
  type PolicyConstraintRevisionId,
  type EngineeringDecisionId,
  type PolicyConstraintRevision,
  type EngineeringDecision,
  type EngineeringDecisionState,
  type EvidenceLocator,
  type SourceType,
  type BaselineMembershipViolation
} from '@solutions-studio/domain';
import type {
  IRequirementsRepository,
  SourceRevisionRecord,
  CaptureSourceRevisionInput,
  LocatorIndexEntry,
  ReconciliationRecord,
  EvaluationRunRecord,
  FindingReconciliationRecord,
  RequirementReconciliationRecord,
  ProjectionRecord,
  StoryRecord
} from '../../../application/ports/persistence/IRequirementsRepository.js';
import type { StorageHealthReport } from '../../../application/ports/persistence/IStorageHealthCheck.js';
import {
  StaleRevisionTargetError,
  UnknownRequirementRevisionError,
  UnknownPolicyConstraintRevisionError,
  UnknownEngineeringDecisionError,
  InvalidEngineeringDecisionStateError,
  FindingDispositionConflictError,
  RequirementRevisionConflictError,
  InvalidBaselineMembershipError,
  BlockedByOpenFindingsError,
  OptimisticConcurrencyConflictError,
  type BlockingFindingMatch
} from '../../../application/use-cases/ReconciliationErrors.js';
import { EvaluationRunRecordSchema } from '@solutions-studio/contracts';
import type { FindingDisposition } from '@solutions-studio/domain';
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

interface PolicyConstraintIndexData {
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

export function getRequirementLockKey(id: string): string {
  return `req:${id}`;
}

export function getPolicyConstraintLockKey(id: string): string {
  return `pol:${id}`;
}

export function getEngineeringDecisionLockKey(id: string): string {
  return `decision:${id}`;
}

export function getBaselineLockKey(id: string): string {
  return `baseline:${id}`;
}

export class FilesystemRequirementsRepository implements IRequirementsRepository {
  private readonly baseDir: string;
  private readonly entityLocks = new Map<string, Promise<void>>();

  constructor(options: FilesystemRequirementsRepositoryOptions) {
    this.baseDir = options.baseDir;
  }

  private async acquireEntityLock<T>(entityId: string, action: () => Promise<T>): Promise<T> {
    const currentLock = this.entityLocks.get(entityId) ?? Promise.resolve();
    let release: () => void;
    const nextLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.entityLocks.set(entityId, nextLock);
    try {
      await currentLock;
      return await action();
    } finally {
      release!();
      if (this.entityLocks.get(entityId) === nextLock) {
        this.entityLocks.delete(entityId);
      }
    }
  }

  private async acquireLocks<T>(
    entityIds: readonly string[],
    action: () => Promise<T>
  ): Promise<T> {
    if (entityIds.length === 0) {
      return action();
    }
    const [first, ...rest] = entityIds;
    return this.acquireEntityLock(first, () => this.acquireLocks(rest, action));
  }

  private async readRawFileIfExists(filePath: string): Promise<string | undefined> {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw err;
    }
  }

  async captureSourceRevision(input: CaptureSourceRevisionInput): Promise<SourceRevisionRecord> {
    assertSafeIdentifier(input.sourceId, 'sourceId');
    const contentHash = computeContentHash(input.markdownText);

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
        if (latestRecord.revision.contentHash === contentHash) {
          return latestRecord;
        }
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
      sourceType: input.sourceType,
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
      sourceType: (raw as { sourceType?: SourceType }).sourceType,
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

    return this.acquireEntityLock(getRequirementLockKey(revision.requirementId), async () => {
      const filePath = resolveStorePath(
        this.baseDir,
        'requirement-revisions',
        `${revision.id}.json`
      );
      const indexPath = resolveStorePath(
        this.baseDir,
        'requirement-index',
        `${revision.requirementId}.json`
      );
      const previousIndexData = await readJson<RequirementIndexData>(indexPath);

      let revWritten = false;
      let indexWritten = false;
      try {
        await writeJsonExclusive(filePath, revision);
        revWritten = true;

        const existingRevisionIds = previousIndexData?.revisionIds ?? [];
        const newRevisionIds = existingRevisionIds.includes(revision.id)
          ? existingRevisionIds
          : [...existingRevisionIds, revision.id];

        await writeJsonAtomic(indexPath, {
          latestRevisionId: revision.id,
          revisionIds: newRevisionIds
        });
        indexWritten = true;
      } catch (err) {
        if (revWritten) {
          await fs.rm(filePath, { force: true }).catch(() => {});
        }
        if (indexWritten) {
          if (previousIndexData) {
            await writeJsonAtomic(indexPath, previousIndexData).catch(() => {});
          } else {
            await fs.rm(indexPath, { force: true }).catch(() => {});
          }
        }
        throw err;
      }
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
      actorId: raw.actorId ? createActorId(raw.actorId) : undefined,
      baselineId: raw.baselineId ? createRequirementsBaselineId(raw.baselineId) : undefined,
      originatingProjectionId: raw.originatingProjectionId,
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

  async listRequirementIds(): Promise<readonly RequirementId[]> {
    const dirPath = path.resolve(this.baseDir, 'requirement-index');
    try {
      const files = await fs.readdir(dirPath);
      const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
      const result: RequirementId[] = [];
      for (const file of jsonFiles) {
        const rawId = file.replace(/\.json$/, '');
        assertSafeIdentifier(rawId, 'requirementId');
        result.push(createRequirementId(rawId));
      }
      return Object.freeze(result);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return Object.freeze([]);
      }
      throw err;
    }
  }

  async saveCandidateFinding(finding: CandidateFinding): Promise<void> {
    assertSafeIdentifier(finding.id, 'findingId');
    if (finding.disposition !== 'OPEN') {
      throw new Error(
        `Cannot create candidate finding directly with non-OPEN disposition: '${finding.disposition}'. Initial findings must be created with disposition 'OPEN'.`
      );
    }
    const filePath = resolveStorePath(this.baseDir, 'findings', `${finding.id}.json`);
    await writeJsonExclusive(filePath, finding);
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
      rationale: raw.rationale,
      actorId: raw.actorId ? createActorId(raw.actorId) : undefined,
      baselineId: raw.baselineId ? createRequirementsBaselineId(raw.baselineId) : undefined,
      originatingProjectionId: raw.originatingProjectionId
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

  private async validateFindingRecord(
    record: FindingReconciliationRecord,
    finding: CandidateFinding
  ): Promise<void> {
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

    const history = await this.listReconciliationRecords('finding', record.entityId);
    if (history.length > 0) {
      const lastRecord = history[history.length - 1];
      if (record.previousDisposition !== lastRecord.newDisposition) {
        throw new Error(
          `Transition continuity broken for finding '${record.entityId}': expected previousDisposition '${lastRecord.newDisposition}', got '${record.previousDisposition}'`
        );
      }
    } else {
      const matchesPrevious = finding.disposition === record.previousDisposition;
      const matchesAlreadyUpdated =
        record.previousDisposition === 'OPEN' && finding.disposition === record.newDisposition;
      if (!matchesPrevious && !matchesAlreadyUpdated) {
        throw new Error(
          `Transition continuity broken for finding '${record.entityId}': finding disposition '${finding.disposition}' matches neither previousDisposition '${record.previousDisposition}' nor newDisposition '${record.newDisposition}'`
        );
      }
    }
  }

  private async validateRequirementRecord(
    record: RequirementReconciliationRecord,
    rev: RequirementRevision
  ): Promise<void> {
    if (!REQUIREMENT_RECONCILIATION_ACTIONS.includes(record.action)) {
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

    const hasPrevRes = record.previousResolutionState !== undefined;
    const hasNewRes = record.newResolutionState !== undefined;
    if (hasPrevRes !== hasNewRes) {
      throw new Error(
        'Reconciliation record must supply both previousResolutionState and newResolutionState, or neither'
      );
    }
    if (
      record.previousResolutionState !== undefined &&
      !REQUIREMENT_RESOLUTION_STATES.includes(record.previousResolutionState)
    ) {
      throw new Error(
        `Invalid previousResolutionState: '${String(record.previousResolutionState)}'`
      );
    }
    if (
      record.newResolutionState !== undefined &&
      !REQUIREMENT_RESOLUTION_STATES.includes(record.newResolutionState)
    ) {
      throw new Error(`Invalid newResolutionState: '${String(record.newResolutionState)}'`);
    }

    const reviewChanged = record.previousReviewState !== record.newReviewState;
    const resolutionChanged =
      record.previousResolutionState !== undefined &&
      record.newResolutionState !== undefined &&
      record.previousResolutionState !== record.newResolutionState;

    if (record.action !== 'REVISE' && !reviewChanged && !resolutionChanged) {
      throw new Error(
        `Transition must change reviewState or resolutionState for action '${record.action}'`
      );
    }

    if (rev.requirementId !== record.entityId) {
      throw new Error(
        `Requirement revision '${record.requirementRevisionId}' belongs to requirement '${rev.requirementId}', not '${record.entityId}'`
      );
    }

    // F-59f39ea7: Boundary invariant checks against referenced revision
    if (record.newReviewState !== rev.reviewState) {
      throw new Error(
        `Reconciliation record newReviewState '${record.newReviewState}' does not match requirement revision reviewState '${rev.reviewState}'`
      );
    }
    if (
      record.newResolutionState !== undefined &&
      record.newResolutionState !== rev.resolutionState
    ) {
      throw new Error(
        `Reconciliation record newResolutionState '${record.newResolutionState}' does not match requirement revision resolutionState '${rev.resolutionState}'`
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

    // Check resolution continuity independently
    if (record.newResolutionState !== undefined) {
      const lastResolutionRecord = [...history]
        .reverse()
        .find((r) => r.newResolutionState !== undefined);
      if (lastResolutionRecord) {
        if (record.previousResolutionState !== lastResolutionRecord.newResolutionState) {
          throw new Error(
            `Resolution transition continuity broken for requirement '${record.entityId}': expected previousResolutionState '${lastResolutionRecord.newResolutionState}', got '${record.previousResolutionState}'`
          );
        }
      } else {
        // First resolution-bearing record for this requirement
        const sourceRev = rev.supersedes ? await this.getRequirementRevision(rev.supersedes) : rev;
        if (sourceRev && record.previousResolutionState !== sourceRev.resolutionState) {
          throw new Error(
            `Resolution transition continuity broken for requirement '${record.entityId}': expected initial previousResolutionState '${sourceRev.resolutionState}', got '${record.previousResolutionState}'`
          );
        }
      }
    }
  }

  async appendReconciliationRecord(record: ReconciliationRecord): Promise<void> {
    if (typeof record.rationale !== 'string' || record.rationale.trim().length === 0) {
      throw new Error('Reconciliation record rationale must be a non-empty string');
    }
    assertSafeIdentifier(record.id, 'reconciliationRecordId');

    if (record.entityType === 'finding') {
      assertSafeIdentifier(record.entityId, 'findingId');
      const finding = await this.getCandidateFinding(record.entityId);
      if (!finding) {
        throw new Error(`Referenced finding '${record.entityId}' does not exist`);
      }
      await this.validateFindingRecord(record, finding);

      const filePath = resolveStorePath(
        this.baseDir,
        path.join('reconciliation', 'finding'),
        `${record.entityId}.jsonl`
      );
      await appendJsonLine(filePath, record);
    } else if (record.entityType === 'requirement') {
      assertSafeIdentifier(record.entityId, 'requirementId');
      assertSafeIdentifier(record.requirementRevisionId, 'requirementRevisionId');

      const rev = await this.getRequirementRevision(record.requirementRevisionId);
      if (!rev) {
        throw new Error(
          `Referenced requirement revision '${record.requirementRevisionId}' does not exist`
        );
      }
      await this.validateRequirementRecord(record, rev);

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

  async transitionCandidateFinding(
    finding: CandidateFinding,
    record: FindingReconciliationRecord,
    expectedCurrentDisposition?: FindingDisposition
  ): Promise<void> {
    assertSafeIdentifier(finding.id, 'findingId');
    assertSafeIdentifier(record.id, 'reconciliationRecordId');
    if (typeof record.rationale !== 'string' || record.rationale.trim().length === 0) {
      throw new Error('Reconciliation record rationale must be a non-empty string');
    }

    return this.acquireEntityLock(finding.id, async () => {
      const current = await this.getCandidateFinding(finding.id);
      if (!current) {
        throw new Error(`Referenced finding '${finding.id}' does not exist`);
      }
      const expectedDisp = expectedCurrentDisposition ?? record.previousDisposition;
      if (current.disposition !== expectedDisp) {
        throw new FindingDispositionConflictError(
          finding.id,
          expectedDisp,
          current.disposition,
          `Concurrency conflict for finding '${finding.id}': current disposition '${current.disposition}' does not match expected '${expectedDisp}'`
        );
      }

      // Immutability checks: only disposition and rationale may change during transition
      if (current.id !== finding.id) {
        throw new Error(
          `Transition finding id mismatch: expected '${current.id}', got '${finding.id}'`
        );
      }
      if (current.type !== finding.type) {
        throw new Error(
          `Cannot mutate immutable finding type from '${current.type}' to '${finding.type}' during transition`
        );
      }
      if (current.discoveredBy !== finding.discoveredBy) {
        throw new Error(
          `Cannot mutate immutable finding discoveredBy from '${current.discoveredBy}' to '${finding.discoveredBy}' during transition`
        );
      }
      if (
        current.affectedRequirementRevisions.length !==
          finding.affectedRequirementRevisions.length ||
        !current.affectedRequirementRevisions.every(
          (val, idx) => val === finding.affectedRequirementRevisions[idx]
        )
      ) {
        throw new Error(
          `Cannot mutate immutable finding affectedRequirementRevisions during transition`
        );
      }
      if (
        current.evidence.length !== finding.evidence.length ||
        !current.evidence.every((refA, idx) => {
          const refB = finding.evidence[idx];
          return (
            refB !== undefined &&
            refA.sourceRevisionId === refB.sourceRevisionId &&
            refA.locator === refB.locator
          );
        })
      ) {
        throw new Error(`Cannot mutate immutable finding evidence during transition`);
      }

      if (record.entityType !== 'finding') {
        throw new Error(
          `Reconciliation record entityType must be 'finding', got '${record.entityType}'`
        );
      }
      if (record.entityId !== finding.id) {
        throw new Error(
          `Reconciliation record entityId '${record.entityId}' does not match finding id '${finding.id}'`
        );
      }
      if (record.previousDisposition !== current.disposition) {
        throw new Error(
          `Reconciliation record previousDisposition '${record.previousDisposition}' does not match current finding disposition '${current.disposition}'`
        );
      }
      if (record.newDisposition !== finding.disposition) {
        throw new Error(
          `Reconciliation record newDisposition '${record.newDisposition}' does not match proposed finding disposition '${finding.disposition}'`
        );
      }
      const normalizedRecordRationale = record.rationale.trim();
      const normalizedFindingRationale = (finding.rationale ?? '').trim();
      if (normalizedRecordRationale !== normalizedFindingRationale) {
        throw new Error(`Reconciliation record rationale does not match finding rationale`);
      }

      await this.validateFindingRecord(record, current);

      const findingFilePath = resolveStorePath(this.baseDir, 'findings', `${finding.id}.json`);
      const auditFilePath = resolveStorePath(
        this.baseDir,
        path.join('reconciliation', 'finding'),
        `${finding.id}.jsonl`
      );

      const previousFindingData = await readJson<CandidateFinding>(findingFilePath);
      const previousAuditContent = await this.readRawFileIfExists(auditFilePath);

      let findingWritten = false;
      let auditWritten = false;

      try {
        await writeJsonAtomic(findingFilePath, finding);
        findingWritten = true;

        await appendJsonLine(auditFilePath, record);
        auditWritten = true;
      } catch (err) {
        if (findingWritten && previousFindingData) {
          await writeJsonAtomic(findingFilePath, previousFindingData).catch(() => {});
        }
        if (auditWritten && previousAuditContent !== undefined) {
          await fs.writeFile(auditFilePath, previousAuditContent, 'utf8').catch(() => {});
        }
        throw err;
      }
    });
  }

  async transitionRequirementRevision(
    successor: RequirementRevision,
    record: RequirementReconciliationRecord,
    expectedCurrentRevisionId?: RequirementRevisionId
  ): Promise<void> {
    assertSafeIdentifier(successor.requirementId, 'requirementId');
    assertSafeIdentifier(successor.id, 'requirementRevisionId');
    assertSafeIdentifier(record.id, 'reconciliationRecordId');
    if (typeof record.rationale !== 'string' || record.rationale.trim().length === 0) {
      throw new Error('Reconciliation record rationale must be a non-empty string');
    }

    return this.acquireEntityLock(getRequirementLockKey(successor.requirementId), async () => {
      const revisions = await this.listRequirementRevisions(successor.requirementId);
      const latest = revisions.length > 0 ? revisions[revisions.length - 1] : undefined;
      const expectedId = expectedCurrentRevisionId ?? successor.supersedes;
      if (expectedId !== undefined) {
        if (!latest || latest.id !== expectedId) {
          throw new RequirementRevisionConflictError(
            successor.requirementId,
            expectedId,
            latest?.id,
            `Concurrency conflict for requirement '${successor.requirementId}': latest revision is '${latest?.id}', expected '${expectedId}'`
          );
        }
      }

      await this.validateRequirementRecord(record, successor);

      const revFilePath = resolveStorePath(
        this.baseDir,
        'requirement-revisions',
        `${successor.id}.json`
      );
      const indexPath = resolveStorePath(
        this.baseDir,
        'requirement-index',
        `${successor.requirementId}.json`
      );
      const auditFilePath = resolveStorePath(
        this.baseDir,
        path.join('reconciliation', 'requirement'),
        `${successor.requirementId}.jsonl`
      );

      const previousIndexData = await readJson<RequirementIndexData>(indexPath);
      const previousAuditContent = await this.readRawFileIfExists(auditFilePath);

      let revWritten = false;
      let indexWritten = false;
      let auditWritten = false;

      try {
        await writeJsonExclusive(revFilePath, successor);
        revWritten = true;

        const newRevisionIds = [...(previousIndexData?.revisionIds ?? []), successor.id];
        await writeJsonAtomic(indexPath, {
          latestRevisionId: successor.id,
          revisionIds: newRevisionIds
        });
        indexWritten = true;

        await appendJsonLine(auditFilePath, record);
        auditWritten = true;
      } catch (err) {
        if (revWritten) {
          await fs.rm(revFilePath, { force: true }).catch(() => {});
        }
        if (indexWritten) {
          if (previousIndexData) {
            await writeJsonAtomic(indexPath, previousIndexData).catch(() => {});
          } else {
            await fs.rm(indexPath, { force: true }).catch(() => {});
          }
        }
        if (auditWritten && previousAuditContent !== undefined) {
          await fs.writeFile(auditFilePath, previousAuditContent, 'utf8').catch(() => {});
        }
        throw err;
      }
    });
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

  async saveRequirementsBaselineConditional(
    baseline: RequirementsBaseline,
    expectedLatestRevisionIds: readonly RequirementRevisionId[],
    expectedLatestPolicyConstraintRevisionIds?: readonly PolicyConstraintRevisionId[]
  ): Promise<void> {
    assertSafeIdentifier(baseline.id, 'baselineId');

    // Manifest equality enforcement: baseline manifest must match expectations exactly
    const baselineReqSet = new Set(baseline.requirementRevisions);
    const expectedReqSet = new Set(expectedLatestRevisionIds);
    if (
      baselineReqSet.size !== expectedReqSet.size ||
      baseline.requirementRevisions.length !== expectedLatestRevisionIds.length ||
      !expectedLatestRevisionIds.every((id) => baselineReqSet.has(id))
    ) {
      const violations: BaselineMembershipViolation[] = baseline.requirementRevisions
        .filter((id) => !expectedReqSet.has(id))
        .map((id) => ({
          revisionId: id,
          requirementId: id,
          reasons: [
            'Baseline requirement revision manifest does not match expected latest revisions'
          ]
        }));
      if (violations.length === 0) {
        violations.push({
          revisionId: 'manifest-mismatch',
          requirementId: 'manifest',
          reasons: [
            'Baseline requirement revision count or elements mismatch expected latest revisions'
          ]
        });
      }
      throw new InvalidBaselineMembershipError(violations);
    }

    const baselinePolList = baseline.policyConstraintRevisions ?? [];
    const expectedPolList = expectedLatestPolicyConstraintRevisionIds ?? [];
    const baselinePolSet = new Set(baselinePolList);
    const expectedPolSet = new Set(expectedPolList);
    if (
      baselinePolSet.size !== expectedPolSet.size ||
      baselinePolList.length !== expectedPolList.length ||
      !expectedPolList.every((id) => baselinePolSet.has(id))
    ) {
      const violations: BaselineMembershipViolation[] = baselinePolList
        .filter((id) => !expectedPolSet.has(id))
        .map((id) => ({
          revisionId: id,
          requirementId: id,
          reasons: [
            'Baseline policy constraint revisions manifest does not match expected latest policy constraint revisions'
          ]
        }));
      if (violations.length === 0) {
        violations.push({
          revisionId: 'manifest-mismatch',
          requirementId: 'manifest',
          reasons: [
            'Baseline policy constraint revisions count or elements mismatch expected latest policy constraint revisions'
          ]
        });
      }
      throw new InvalidBaselineMembershipError(violations);
    }

    const reqMap = new Map<RequirementId, RequirementRevisionId>();
    for (const rawRevId of expectedLatestRevisionIds) {
      const expectedRevId = createRequirementRevisionId(rawRevId);
      assertSafeIdentifier(expectedRevId, 'requirementRevisionId');
      const rev = await this.getRequirementRevision(expectedRevId);
      if (!rev) {
        throw new UnknownRequirementRevisionError(expectedRevId);
      }
      const existing = reqMap.get(rev.requirementId);
      if (existing && existing !== expectedRevId) {
        throw new StaleRevisionTargetError(expectedRevId, existing);
      }
      reqMap.set(rev.requirementId, expectedRevId);
    }

    const polMap = new Map<PolicyConstraintId, PolicyConstraintRevisionId>();
    for (const rawPolId of expectedLatestPolicyConstraintRevisionIds ?? []) {
      const expectedPolRevId = createPolicyConstraintRevisionId(rawPolId);
      assertSafeIdentifier(expectedPolRevId, 'policyConstraintRevisionId');
      const polRev = await this.getPolicyConstraintRevision(expectedPolRevId);
      if (!polRev) {
        throw new UnknownPolicyConstraintRevisionError(expectedPolRevId);
      }
      const existing = polMap.get(polRev.policyConstraintId);
      if (existing && existing !== expectedPolRevId) {
        throw new StaleRevisionTargetError(expectedPolRevId, existing);
      }
      polMap.set(polRev.policyConstraintId, expectedPolRevId);
    }

    const sortedRequirementIds = Array.from(reqMap.keys()).sort();
    const sortedPolicyIds = Array.from(polMap.keys()).sort();

    const lockKeys = [
      ...sortedRequirementIds.map((id) => getRequirementLockKey(id)),
      ...sortedPolicyIds.map((id) => getPolicyConstraintLockKey(id))
    ].sort();

    return this.acquireLocks(lockKeys, async () => {
      for (const reqId of sortedRequirementIds) {
        const expectedRevId = reqMap.get(reqId)!;
        const allRevisions = await this.listRequirementRevisions(reqId);
        const latest = allRevisions.length > 0 ? allRevisions[allRevisions.length - 1] : undefined;
        if (!latest || latest.id !== expectedRevId) {
          throw new StaleRevisionTargetError(expectedRevId, latest?.id ?? 'none');
        }
      }

      for (const polId of sortedPolicyIds) {
        const expectedRevId = polMap.get(polId)!;
        const allRevisions = await this.listPolicyConstraintRevisions(polId);
        const latest = allRevisions.length > 0 ? allRevisions[allRevisions.length - 1] : undefined;
        if (!latest || latest.id !== expectedRevId) {
          throw new StaleRevisionTargetError(expectedRevId, latest?.id ?? 'none');
        }
      }

      // Check open blocking findings against revision lineage closure
      const allFindings = await this.listCandidateFindings();
      const openFindings = allFindings.filter((f) => f.disposition === 'OPEN');
      if (openFindings.length > 0) {
        const closure = new Set<string>();
        for (const revId of expectedLatestRevisionIds) {
          closure.add(revId);
          let curr: string | undefined = revId;
          while (curr) {
            const rev = await this.getRequirementRevision(createRequirementRevisionId(curr));
            curr = rev?.supersedes;
            if (curr) {
              if (closure.has(curr)) break;
              closure.add(curr);
            }
          }
        }

        const blockingMatches: BlockingFindingMatch[] = [];
        for (const f of openFindings) {
          for (const aff of f.affectedRequirementRevisions) {
            if (closure.has(aff)) {
              blockingMatches.push({
                ...f,
                finding: f,
                affectedRevisionId: aff,
                matchedRevisionId: aff,
                proposedRevisionId: aff
              });
              break;
            }
          }
        }

        if (blockingMatches.length > 0) {
          throw new BlockedByOpenFindingsError(blockingMatches);
        }
      }

      const filePath = resolveStorePath(this.baseDir, 'baselines', `${baseline.id}.json`);
      await writeJsonExclusive(filePath, baseline);
    });
  }

  async saveRequirementsBaseline(
    baseline: RequirementsBaseline,
    expectedLatestRevisionIds?: readonly RequirementRevisionId[],
    expectedLatestPolicyConstraintRevisionIds?: readonly PolicyConstraintRevisionId[]
  ): Promise<void> {
    if (
      expectedLatestRevisionIds !== undefined ||
      expectedLatestPolicyConstraintRevisionIds !== undefined
    ) {
      return this.saveRequirementsBaselineConditional(
        baseline,
        expectedLatestRevisionIds ?? [],
        expectedLatestPolicyConstraintRevisionIds
      );
    }
    assertSafeIdentifier(baseline.id, 'baselineId');
    const filePath = resolveStorePath(this.baseDir, 'baselines', `${baseline.id}.json`);
    await writeJsonExclusive(filePath, baseline);
  }

  async getRequirementsBaseline(
    id: RequirementsBaselineId
  ): Promise<RequirementsBaseline | undefined> {
    assertSafeIdentifier(id, 'baselineId');
    const filePath = resolveStorePath(this.baseDir, 'baselines', `${id}.json`);
    interface RawBaseline {
      readonly id: string;
      readonly requirementRevisions: readonly string[];
      readonly policyConstraintRevisions?: readonly string[];
      readonly createdAt: string;
      readonly createdBy: string;
    }
    const raw = await readJson<RawBaseline>(filePath);
    if (!raw) {
      return undefined;
    }

    return Object.freeze({
      id: createRequirementsBaselineId(raw.id),
      requirementRevisions: Object.freeze(
        raw.requirementRevisions.map((r: string) => createRequirementRevisionId(r))
      ),
      policyConstraintRevisions: Object.freeze(
        (raw.policyConstraintRevisions ?? []).map((p: string) =>
          createPolicyConstraintRevisionId(p)
        )
      ),
      createdAt: createInstant(raw.createdAt),
      createdBy: createReviewerId(raw.createdBy)
    });
  }

  async savePolicyConstraintRevision(revision: PolicyConstraintRevision): Promise<void> {
    assertSafeIdentifier(revision.id, 'policyConstraintRevisionId');
    assertSafeIdentifier(revision.policyConstraintId, 'policyConstraintId');

    return this.acquireEntityLock(
      getPolicyConstraintLockKey(revision.policyConstraintId),
      async () => {
        const filePath = resolveStorePath(
          this.baseDir,
          'policy-constraint-revisions',
          `${revision.id}.json`
        );
        const indexPath = resolveStorePath(
          this.baseDir,
          'policy-constraint-index',
          `${revision.policyConstraintId}.json`
        );
        const previousIndexData = await readJson<PolicyConstraintIndexData>(indexPath);

        if (revision.supersedes !== undefined) {
          if (!previousIndexData || previousIndexData.latestRevisionId !== revision.supersedes) {
            throw new StaleRevisionTargetError(
              revision.supersedes,
              previousIndexData?.latestRevisionId ?? 'none'
            );
          }
        } else if (
          previousIndexData &&
          previousIndexData.latestRevisionId !== undefined &&
          previousIndexData.latestRevisionId !== revision.id
        ) {
          throw new StaleRevisionTargetError(revision.id, previousIndexData.latestRevisionId);
        }

        let revWritten = false;
        let indexWritten = false;
        try {
          await writeJsonExclusive(filePath, revision);
          revWritten = true;

          const existingRevisionIds = previousIndexData?.revisionIds ?? [];
          const newRevisionIds = existingRevisionIds.includes(revision.id)
            ? existingRevisionIds
            : [...existingRevisionIds, revision.id];

          await writeJsonAtomic(indexPath, {
            latestRevisionId: revision.id,
            revisionIds: newRevisionIds
          });
          indexWritten = true;
        } catch (err) {
          if (revWritten) {
            await fs.rm(filePath, { force: true }).catch(() => {});
          }
          if (indexWritten) {
            if (previousIndexData) {
              await writeJsonAtomic(indexPath, previousIndexData).catch(() => {});
            } else {
              await fs.rm(indexPath, { force: true }).catch(() => {});
            }
          }
          throw err;
        }
      }
    );
  }

  async getPolicyConstraintRevision(
    id: PolicyConstraintRevisionId
  ): Promise<PolicyConstraintRevision | undefined> {
    assertSafeIdentifier(id, 'policyConstraintRevisionId');
    const filePath = resolveStorePath(this.baseDir, 'policy-constraint-revisions', `${id}.json`);
    const raw = await readJson<PolicyConstraintRevision>(filePath);
    if (!raw) {
      return undefined;
    }

    return createPolicyConstraintRevision({
      id: createPolicyConstraintRevisionId(raw.id),
      policyConstraintId: createPolicyConstraintId(raw.policyConstraintId),
      revision: raw.revision,
      statement: raw.statement,
      authorityReference: raw.authorityReference,
      state: raw.state,
      createdAt: createInstant(raw.createdAt),
      createdBy: raw.createdBy,
      supersedes: raw.supersedes ? createPolicyConstraintRevisionId(raw.supersedes) : undefined
    });
  }

  async listPolicyConstraintRevisions(
    policyConstraintId: PolicyConstraintId
  ): Promise<readonly PolicyConstraintRevision[]> {
    assertSafeIdentifier(policyConstraintId, 'policyConstraintId');
    const indexPath = resolveStorePath(
      this.baseDir,
      'policy-constraint-index',
      `${policyConstraintId}.json`
    );
    const index = await readJson<PolicyConstraintIndexData>(indexPath);
    if (!index?.revisionIds) {
      return Object.freeze([]);
    }

    const results: PolicyConstraintRevision[] = [];
    for (const revId of index.revisionIds) {
      const rev = await this.getPolicyConstraintRevision(createPolicyConstraintRevisionId(revId));
      if (rev) {
        results.push(rev);
      }
    }
    return Object.freeze(results);
  }

  async listPolicyConstraintIds(): Promise<readonly PolicyConstraintId[]> {
    const dirPath = path.resolve(this.baseDir, 'policy-constraint-index');
    try {
      const files = await fs.readdir(dirPath);
      const ids = files
        .filter((f) => f.endsWith('.json'))
        .map((f) => createPolicyConstraintId(f.replace(/\.json$/, '')))
        .sort();
      return Object.freeze(ids);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return Object.freeze([]);
      }
      throw err;
    }
  }

  async saveEngineeringDecision(decision: EngineeringDecision): Promise<void> {
    assertSafeIdentifier(decision.id, 'engineeringDecisionId');
    assertSafeIdentifier(decision.baselineId, 'baselineId');
    const filePath = resolveStorePath(this.baseDir, 'engineering-decisions', `${decision.id}.json`);
    await writeJsonExclusive(filePath, decision);
  }

  async updateEngineeringDecision(
    decision: EngineeringDecision,
    expectedCurrentState?: EngineeringDecisionState
  ): Promise<void> {
    assertSafeIdentifier(decision.id, 'engineeringDecisionId');
    return this.acquireEntityLock(getEngineeringDecisionLockKey(decision.id), async () => {
      const filePath = resolveStorePath(
        this.baseDir,
        'engineering-decisions',
        `${decision.id}.json`
      );
      const existing = await readJson<EngineeringDecision>(filePath);
      if (!existing) {
        throw new UnknownEngineeringDecisionError(decision.id);
      }
      if (expectedCurrentState !== undefined && existing.state !== expectedCurrentState) {
        throw new InvalidEngineeringDecisionStateError(
          `Conflict updating engineering decision '${decision.id}': expected state '${expectedCurrentState}', current state is '${existing.state}'`
        );
      }
      await writeJsonAtomic(filePath, decision);
    });
  }

  async getEngineeringDecision(
    id: EngineeringDecisionId
  ): Promise<EngineeringDecision | undefined> {
    assertSafeIdentifier(id, 'engineeringDecisionId');
    const filePath = resolveStorePath(this.baseDir, 'engineering-decisions', `${id}.json`);
    const raw = await readJson<EngineeringDecision>(filePath);
    if (!raw) {
      return undefined;
    }

    return createEngineeringDecision({
      id: createEngineeringDecisionId(raw.id),
      baselineId: createRequirementsBaselineId(raw.baselineId),
      statement: raw.statement,
      rationale: raw.rationale,
      requirementRevisionIds: (raw.requirementRevisionIds ?? []).map((r) =>
        createRequirementRevisionId(r)
      ),
      policyConstraintRevisionIds: (raw.policyConstraintRevisionIds ?? []).map((p) =>
        createPolicyConstraintRevisionId(p)
      ),
      state: raw.state,
      createdAt: createInstant(raw.createdAt),
      createdBy: raw.createdBy,
      acceptedBy: raw.acceptedBy ? createReviewerId(raw.acceptedBy) : undefined,
      acceptedAt: raw.acceptedAt ? createInstant(raw.acceptedAt) : undefined,
      supersedes: raw.supersedes ? createEngineeringDecisionId(raw.supersedes) : undefined,
      transitionRationale: raw.transitionRationale
    });
  }

  async listEngineeringDecisions(filter?: {
    baselineId?: RequirementsBaselineId;
    state?: EngineeringDecisionState;
  }): Promise<readonly EngineeringDecision[]> {
    const dirPath = path.resolve(this.baseDir, 'engineering-decisions');
    try {
      const files = await fs.readdir(dirPath);
      const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
      const results: EngineeringDecision[] = [];

      for (const file of jsonFiles) {
        const rawId = file.replace(/\.json$/, '');
        assertSafeIdentifier(rawId, 'engineeringDecisionId');
        const decision = await this.getEngineeringDecision(createEngineeringDecisionId(rawId));
        if (!decision) continue;

        if (filter?.baselineId && decision.baselineId !== filter.baselineId) {
          continue;
        }
        if (filter?.state && decision.state !== filter.state) {
          continue;
        }
        results.push(decision);
      }

      results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return Object.freeze(results);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return Object.freeze([]);
      }
      throw err;
    }
  }

  async listRequirementsBaselines(): Promise<readonly RequirementsBaseline[]> {
    const dirPath = path.resolve(this.baseDir, 'baselines');
    try {
      const files = await fs.readdir(dirPath);
      const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
      const results: RequirementsBaseline[] = [];
      for (const file of jsonFiles) {
        const rawId = file.replace(/\.json$/, '');
        assertSafeIdentifier(rawId, 'baselineId');
        const baseline = await this.getRequirementsBaseline(createRequirementsBaselineId(rawId));
        if (baseline) {
          results.push(baseline);
        }
      }
      results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return Object.freeze(results);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return Object.freeze([]);
      }
      throw err;
    }
  }

  async saveEvaluationRun(run: EvaluationRunRecord): Promise<void> {
    assertSafeIdentifier(run.id, 'runId');
    const validated = EvaluationRunRecordSchema.parse(run);
    const filePath = resolveStorePath(this.baseDir, 'evaluation-runs', `${run.id}.json`);
    await writeJsonExclusive(filePath, validated);
  }

  async getEvaluationRun(id: string): Promise<EvaluationRunRecord | undefined> {
    assertSafeIdentifier(id, 'runId');
    const filePath = resolveStorePath(this.baseDir, 'evaluation-runs', `${id}.json`);
    const raw = await readJson<unknown>(filePath);
    if (!raw) {
      return undefined;
    }

    const validated = EvaluationRunRecordSchema.parse(raw);
    return Object.freeze({
      id: validated.id,
      corpusVersion: validated.corpusVersion,
      executedAt: createInstant(validated.executedAt),
      fixtureResults: Object.freeze(validated.fixtureResults),
      report: Object.freeze(validated.report)
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

  async saveProjectionRecord(projection: ProjectionRecord): Promise<void> {
    assertSafeIdentifier(projection.id, 'projectionId');
    assertSafeIdentifier(projection.baselineId, 'baselineId');
    const filePath = resolveStorePath(this.baseDir, 'projections', `${projection.id}.json`);
    await writeJsonExclusive(filePath, {
      ...projection,
      version: projection.version ?? 1
    });
  }

  async updateProjectionRecord(
    projection: ProjectionRecord,
    expectedVersion?: number
  ): Promise<void> {
    assertSafeIdentifier(projection.id, 'projectionId');
    assertSafeIdentifier(projection.baselineId, 'baselineId');
    const filePath = resolveStorePath(this.baseDir, 'projections', `${projection.id}.json`);

    const existing = await this.getProjectionRecord(projection.id);
    if (!existing) {
      throw new Error(`Projection '${projection.id}' not found`);
    }

    const expVer = expectedVersion ?? projection.version;
    if (expVer !== undefined && existing.version !== undefined && existing.version !== expVer) {
      throw new OptimisticConcurrencyConflictError(
        `Concurrency conflict updating projection '${projection.id}': expected version ${expVer}, found ${existing.version}`
      );
    }

    const nextVersion = (existing.version ?? 1) + 1;
    await writeJsonAtomic(filePath, {
      ...projection,
      version: nextVersion
    });
  }

  async getProjectionRecord(id: string): Promise<ProjectionRecord | undefined> {
    assertSafeIdentifier(id, 'projectionId');
    const filePath = resolveStorePath(this.baseDir, 'projections', `${id}.json`);
    const record = await readJson<ProjectionRecord>(filePath);
    if (!record) {
      return undefined;
    }
    return Object.freeze({
      ...record,
      version: record.version ?? 1
    });
  }

  async listProjectionRecords(
    baselineId?: RequirementsBaselineId
  ): Promise<readonly ProjectionRecord[]> {
    const dirPath = path.resolve(this.baseDir, 'projections');
    try {
      const files = await fs.readdir(dirPath);
      const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
      const result: ProjectionRecord[] = [];
      for (const file of jsonFiles) {
        const rawId = file.replace(/\.json$/, '');
        assertSafeIdentifier(rawId, 'projectionId');
        const proj = await this.getProjectionRecord(rawId);
        if (proj) {
          if (!baselineId || proj.baselineId === baselineId) {
            result.push(proj);
          }
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

  async saveStory(story: StoryRecord): Promise<void> {
    assertSafeIdentifier(story.id, 'storyId');
    assertSafeIdentifier(story.baselineId, 'baselineId');
    const filePath = resolveStorePath(this.baseDir, 'stories', `${story.id}.json`);
    await writeJsonExclusive(filePath, {
      ...story,
      version: story.version ?? 1
    });
  }

  async updateStory(story: StoryRecord, expectedVersion?: number): Promise<void> {
    assertSafeIdentifier(story.id, 'storyId');
    assertSafeIdentifier(story.baselineId, 'baselineId');
    const filePath = resolveStorePath(this.baseDir, 'stories', `${story.id}.json`);

    const existing = await this.getStory(story.id);
    if (!existing) {
      throw new Error(`Story '${story.id}' not found`);
    }

    const expVer = expectedVersion ?? story.version;
    if (expVer !== undefined && existing.version !== undefined && existing.version !== expVer) {
      throw new OptimisticConcurrencyConflictError(
        `Concurrency conflict updating story '${story.id}': expected version ${expVer}, found ${existing.version}`
      );
    }

    const nextVersion = (existing.version ?? 1) + 1;
    await writeJsonAtomic(filePath, {
      ...story,
      version: nextVersion
    });
  }

  async updateStoryAndProjection(
    story: StoryRecord,
    projection: ProjectionRecord,
    options?: { expectedStoryVersion?: number; expectedProjectionVersion?: number }
  ): Promise<void> {
    assertSafeIdentifier(story.id, 'storyId');
    assertSafeIdentifier(story.baselineId, 'baselineId');
    assertSafeIdentifier(projection.id, 'projectionId');
    assertSafeIdentifier(projection.baselineId, 'baselineId');

    const existingStory = await this.getStory(story.id);
    if (!existingStory) {
      throw new Error(`Story '${story.id}' not found`);
    }
    const expStoryVer = options?.expectedStoryVersion ?? story.version;
    if (
      expStoryVer !== undefined &&
      existingStory.version !== undefined &&
      existingStory.version !== expStoryVer
    ) {
      throw new OptimisticConcurrencyConflictError(
        `Concurrency conflict updating story '${story.id}': expected version ${expStoryVer}, found ${existingStory.version}`
      );
    }

    const existingProj = await this.getProjectionRecord(projection.id);
    if (!existingProj) {
      throw new Error(`Projection '${projection.id}' not found`);
    }
    const expProjVer = options?.expectedProjectionVersion ?? projection.version;
    if (
      expProjVer !== undefined &&
      existingProj.version !== undefined &&
      existingProj.version !== expProjVer
    ) {
      throw new OptimisticConcurrencyConflictError(
        `Concurrency conflict updating projection '${projection.id}': expected version ${expProjVer}, found ${existingProj.version}`
      );
    }

    const nextStoryVersion = (existingStory.version ?? 1) + 1;
    const nextProjVersion = (existingProj.version ?? 1) + 1;

    const storyPath = resolveStorePath(this.baseDir, 'stories', `${story.id}.json`);
    const projectionPath = resolveStorePath(this.baseDir, 'projections', `${projection.id}.json`);

    // Backup original contents if they exist for rollback
    const originalStoryRaw = await fs.readFile(storyPath, 'utf8').catch(() => null);
    const originalProjectionRaw = await fs.readFile(projectionPath, 'utf8').catch(() => null);

    let storyWritten = false;
    try {
      await writeJsonAtomic(storyPath, {
        ...story,
        version: nextStoryVersion
      });
      storyWritten = true;
      await writeJsonAtomic(projectionPath, {
        ...projection,
        version: nextProjVersion
      });
    } catch (err) {
      if (storyWritten) {
        if (originalStoryRaw !== null) {
          await fs.writeFile(storyPath, originalStoryRaw, 'utf8').catch(() => {});
        } else {
          await fs.unlink(storyPath).catch(() => {});
        }
      }
      if (originalProjectionRaw !== null) {
        await fs.writeFile(projectionPath, originalProjectionRaw, 'utf8').catch(() => {});
      }
      throw err;
    }
  }

  async getStory(id: StoryId): Promise<StoryRecord | undefined> {
    assertSafeIdentifier(id, 'storyId');
    const filePath = resolveStorePath(this.baseDir, 'stories', `${id}.json`);
    const record = await readJson<StoryRecord>(filePath);
    if (!record) {
      return undefined;
    }
    return Object.freeze({
      ...record,
      version: record.version ?? 1,
      requirementRevisionIds: Object.freeze(record.requirementRevisionIds),
      policyConstraintRevisionIds: record.policyConstraintRevisionIds
        ? Object.freeze(record.policyConstraintRevisionIds)
        : undefined,
      scenarios: Object.freeze(
        record.scenarios.map((s) =>
          Object.freeze({
            ...s,
            requirementRevisionIds: Object.freeze(s.requirementRevisionIds),
            policyConstraintRevisionIds: s.policyConstraintRevisionIds
              ? Object.freeze(s.policyConstraintRevisionIds)
              : undefined,
            steps: Object.freeze(s.steps.map((st) => Object.freeze(st)))
          })
        )
      ),
      acceptanceCriteria: Object.freeze(record.acceptanceCriteria),
      dependencies: record.dependencies ? Object.freeze(record.dependencies) : undefined
    });
  }

  async listStories(baselineId?: RequirementsBaselineId): Promise<readonly StoryRecord[]> {
    const dirPath = path.resolve(this.baseDir, 'stories');
    try {
      const files = await fs.readdir(dirPath);
      const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
      const result: StoryRecord[] = [];
      for (const file of jsonFiles) {
        const rawId = file.replace(/\.json$/, '');
        assertSafeIdentifier(rawId, 'storyId');
        const storyId = createStoryId(rawId);
        const story = await this.getStory(storyId);
        if (story) {
          if (!baselineId || story.baselineId === baselineId) {
            result.push(story);
          }
        }
      }
      result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return Object.freeze(result);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return Object.freeze([]);
      }
      throw err;
    }
  }

  async withBaselineLock<T>(
    baselineId: RequirementsBaselineId,
    action: () => Promise<T>
  ): Promise<T> {
    assertSafeIdentifier(baselineId, 'baselineId');
    return this.acquireEntityLock(getBaselineLockKey(baselineId), action);
  }

  async checkStorageHealth(): Promise<StorageHealthReport> {
    return this.checkHealth();
  }

  async checkHealth(): Promise<StorageHealthReport> {
    const timestamp = new Date().toISOString();
    const start = Date.now();
    try {
      await fs.access(this.baseDir, fs.constants.R_OK | fs.constants.W_OK);
      return {
        status: 'healthy',
        timestamp,
        database: {
          status: 'healthy',
          latencyMs: Date.now() - start,
          details: { dialect: 'filesystem', baseDir: this.baseDir }
        }
      };
    } catch (err) {
      return {
        status: 'unhealthy',
        timestamp,
        database: {
          status: 'unhealthy',
          latencyMs: Date.now() - start,
          message: err instanceof Error ? err.message : String(err),
          details: { dialect: 'filesystem', baseDir: this.baseDir }
        }
      };
    }
  }
}
