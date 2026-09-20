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
  type FindingDisposition,
  type RequirementCategory,
  type RequirementOrigin,
  type RequirementReviewState,
  type RequirementResolutionState,
  type FindingType,
  type DiscoveredBy,
  type PolicyConstraintState,
  type RequirementReconciliationAction,
  type BaselineMembershipViolation,
  type GherkinScenario,
  type GherkinStep,
  createValidationRunRecord,
  createCandidateApprovalRecord,
  revokeCandidateApprovalRecord,
  supersedeCandidateApprovalRecord,
  UnknownGovernanceApprovalError,
  type ValidationRunRecord,
  type ValidationRunId,
  type CandidateApprovalRecord,
  type GovernanceApprovalId,
  type GovernanceApprovalStatus,
  type BacklogExportMapping,
  type BacklogExportMappingId,
  type BacklogExportHistoryEntry,
  createBacklogExportMapping
} from '@solutions-studio/domain';
import {
  ImmutableRecordConflictError,
  type IRequirementsRepository,
  type SourceRevisionRecord,
  type CaptureSourceRevisionInput,
  type LocatorIndexEntry,
  type ReconciliationRecord,
  type EvaluationRunRecord,
  type FindingReconciliationRecord,
  type RequirementReconciliationRecord,
  type ProjectionRecord,
  type StoryRecord
} from '../../../application/ports/persistence/IRequirementsRepository.js';
import type { IObjectStore } from '../../../application/ports/persistence/IObjectStore.js';
import type { ISqlDatabaseClient } from '../../../application/ports/persistence/ISqlDatabaseClient.js';
import type {
  IStorageHealthCheck,
  StorageHealthReport
} from '../../../application/ports/persistence/IStorageHealthCheck.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  StaleRevisionTargetError,
  UnknownRequirementRevisionError,
  UnknownPolicyConstraintRevisionError,
  UnknownEngineeringDecisionError,
  InvalidEngineeringDecisionStateError,
  FindingDispositionConflictError,
  RequirementRevisionConflictError,
  BlockedByOpenFindingsError,
  OptimisticConcurrencyConflictError,
  InvalidBaselineMembershipError,
  type BlockingFindingMatch
} from '../../../application/use-cases/ReconciliationErrors.js';
import {
  EvaluationRunRecordSchema,
  ValidationRunRecordDtoSchema,
  CandidateApprovalRecordDtoSchema
} from '@solutions-studio/contracts';
import { computeContentHash, deriveLocatorIndex } from '../markdown/deriveLocatorIndex.js';
import { SchemaMigrationRunner } from './SchemaMigrationRunner.js';

export interface PostgresRequirementsRepositoryOptions {
  readonly db: ISqlDatabaseClient;
  readonly objectStore: IObjectStore;
}

function assertSafeIdentifier(id: string, name: string): string {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error(`Invalid ${name}: identifier cannot be empty`);
  }
  return id.trim();
}

function isDuplicateKeyError(err: unknown): boolean {
  if (!err) return false;
  const message = (err as { message?: string }).message ?? '';
  const code = (err as { code?: string }).code;
  return message.includes('duplicate key') || message.includes('UNIQUE') || code === '23505';
}

export class PostgresRequirementsRepository
  implements IRequirementsRepository, IStorageHealthCheck
{
  readonly db: ISqlDatabaseClient;
  readonly objectStore: IObjectStore;
  private readonly baselineLocks = new Map<string, Promise<void>>();
  private readonly sessionContext = new AsyncLocalStorage<ISqlDatabaseClient>();
  private readonly heldLocks = new AsyncLocalStorage<Set<string>>();

  get activeDb(): ISqlDatabaseClient {
    return this.sessionContext.getStore() ?? this.db;
  }

  constructor(options: PostgresRequirementsRepositoryOptions) {
    this.db = options.db;
    this.objectStore = options.objectStore;
  }

  // --- SOURCE REVISIONS ---

  async captureSourceRevision(input: CaptureSourceRevisionInput): Promise<SourceRevisionRecord> {
    assertSafeIdentifier(input.sourceId, 'sourceId');
    const contentHash = computeContentHash(input.markdownText);

    return this.activeDb.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO sources (id, source_type) VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING;`,
        [input.sourceId, input.sourceType]
      );

      const latestQuery = await tx.query<{
        id: string;
        revision: number;
        content_hash: string;
      }>(
        `SELECT id, revision, content_hash
         FROM source_revisions
         WHERE source_id = $1
         ORDER BY revision DESC
         LIMIT 1;`,
        [input.sourceId]
      );

      if (latestQuery.rows.length > 0) {
        const latest = latestQuery.rows[0];
        if (latest.content_hash === contentHash) {
          const existing = await this.getSourceRevision(createSourceRevisionId(latest.id), tx);
          if (existing) {
            return existing;
          }
        }
      }

      const nextRevisionNumber = latestQuery.rows.length > 0 ? latestQuery.rows[0].revision + 1 : 1;
      const supersedesRevisionId = latestQuery.rows.length > 0 ? latestQuery.rows[0].id : undefined;

      const newRevisionId = createSourceRevisionId(`${input.sourceId}-R${nextRevisionNumber}`);
      const capturedAt = input.capturedAt ?? now();
      const locatorIndex = deriveLocatorIndex(input.markdownText);

      const blobKey = `sources/${input.sourceId}/${newRevisionId}.md`;
      await this.objectStore.putObject(blobKey, input.markdownText, {
        contentType: 'text/markdown',
        contentHash
      });

      try {
        await tx.query(
          `INSERT INTO source_revisions (
             id, source_id, revision, content_hash, captured_at, supersedes,
             source_type, raw_text, payload_ref, locator_index
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);`,
          [
            newRevisionId,
            input.sourceId,
            nextRevisionNumber,
            contentHash,
            capturedAt,
            supersedesRevisionId ?? null,
            input.sourceType,
            input.markdownText,
            blobKey,
            JSON.stringify(locatorIndex)
          ]
        );
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          throw new ImmutableRecordConflictError(
            `source-revisions/${newRevisionId}`,
            `Source revision '${newRevisionId}' already exists`
          );
        }
        throw err;
      }

      const sourceRevision = createSourceRevision({
        id: newRevisionId,
        sourceId: input.sourceId,
        revision: nextRevisionNumber,
        contentHash,
        capturedAt,
        supersedes: supersedesRevisionId ? createSourceRevisionId(supersedesRevisionId) : undefined
      });

      return Object.freeze({
        sourceType: input.sourceType,
        revision: sourceRevision,
        rawText: input.markdownText,
        locatorIndex: Object.freeze(locatorIndex)
      });
    });
  }

  async getSourceRevision(
    id: SourceRevisionId,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<SourceRevisionRecord | undefined> {
    assertSafeIdentifier(id, 'sourceRevisionId');
    const result = await executor.query<{
      id: string;
      source_id: string;
      revision: number;
      content_hash: string;
      captured_at: string | Date;
      verified_at?: string | Date | null;
      supersedes?: string | null;
      source_type?: string | null;
      raw_text?: string | null;
      payload_ref?: string | null;
      locator_index: string | readonly LocatorIndexEntry[];
    }>(`SELECT * FROM source_revisions WHERE id = $1;`, [id]);

    if (result.rows.length === 0) {
      return undefined;
    }

    const row = result.rows[0];
    let rawText = row.raw_text ?? '';
    if (!rawText && row.payload_ref) {
      const blob = await this.objectStore.getObjectString(row.payload_ref);
      if (blob) {
        rawText = blob;
      }
    }

    const rawLocators: readonly LocatorIndexEntry[] =
      typeof row.locator_index === 'string'
        ? JSON.parse(row.locator_index)
        : (row.locator_index ?? []);

    return Object.freeze({
      sourceType: row.source_type as SourceType | undefined,
      revision: createSourceRevision({
        id: createSourceRevisionId(row.id),
        sourceId: createSourceId(row.source_id),
        revision: row.revision,
        contentHash: row.content_hash,
        capturedAt: createInstant(
          row.captured_at instanceof Date ? row.captured_at.toISOString() : row.captured_at
        ),
        verifiedAt: row.verified_at
          ? createInstant(
              row.verified_at instanceof Date
                ? row.verified_at.toISOString()
                : String(row.verified_at)
            )
          : undefined,
        supersedes: row.supersedes ? createSourceRevisionId(row.supersedes) : undefined
      }),
      rawText,
      locatorIndex: Object.freeze(
        rawLocators.map((entry) =>
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

  async listSourceRevisions(
    sourceId: SourceId,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly SourceRevision[]> {
    assertSafeIdentifier(sourceId, 'sourceId');
    const result = await executor.query<{
      id: string;
      source_id: string;
      revision: number;
      content_hash: string;
      captured_at: string | Date;
      verified_at?: string | Date | null;
      supersedes?: string | null;
    }>(`SELECT * FROM source_revisions WHERE source_id = $1 ORDER BY revision ASC;`, [sourceId]);

    return Object.freeze(
      result.rows.map((row) =>
        createSourceRevision({
          id: createSourceRevisionId(row.id),
          sourceId: createSourceId(row.source_id),
          revision: row.revision,
          contentHash: row.content_hash,
          capturedAt: createInstant(
            row.captured_at instanceof Date ? row.captured_at.toISOString() : row.captured_at
          ),
          verifiedAt: row.verified_at
            ? createInstant(
                row.verified_at instanceof Date
                  ? row.verified_at.toISOString()
                  : String(row.verified_at)
              )
            : undefined,
          supersedes: row.supersedes ? createSourceRevisionId(row.supersedes) : undefined
        })
      )
    );
  }

  async getLatestSourceRevision(
    sourceId: SourceId,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<SourceRevisionRecord | undefined> {
    assertSafeIdentifier(sourceId, 'sourceId');
    const result = await executor.query<{ id: string }>(
      `SELECT id FROM source_revisions WHERE source_id = $1 ORDER BY revision DESC LIMIT 1;`,
      [sourceId]
    );
    if (result.rows.length === 0) {
      return undefined;
    }
    return this.getSourceRevision(createSourceRevisionId(result.rows[0].id), executor);
  }

  async resolveLocator(
    sourceRevisionId: SourceRevisionId,
    locator: EvidenceLocator | string,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<LocatorIndexEntry | undefined> {
    assertSafeIdentifier(sourceRevisionId, 'sourceRevisionId');
    const record = await this.getSourceRevision(sourceRevisionId, executor);
    if (!record) {
      return undefined;
    }
    return record.locatorIndex.find((e) => e.locator === locator);
  }

  // --- REQUIREMENTS ---

  async saveRequirementRevision(
    revision: RequirementRevision,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<void> {
    assertSafeIdentifier(revision.id, 'requirementRevisionId');
    assertSafeIdentifier(revision.requirementId, 'requirementId');

    await executor.query(`INSERT INTO requirements (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;`, [
      revision.requirementId
    ]);

    try {
      await executor.query(
        `INSERT INTO requirement_revisions (
           id, requirement_id, revision, statement, category, origin,
           review_state, resolution_state, evidence, rationale, actor_id,
           baseline_id, originating_projection_id, affected_actors,
           dependencies, supersedes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16);`,
        [
          revision.id,
          revision.requirementId,
          revision.revision,
          revision.statement,
          revision.category,
          revision.origin,
          revision.reviewState,
          revision.resolutionState,
          JSON.stringify(revision.evidence ?? []),
          revision.rationale ?? '',
          revision.actorId ?? null,
          revision.baselineId ?? null,
          revision.originatingProjectionId ?? null,
          revision.affectedActors ? JSON.stringify(revision.affectedActors) : null,
          revision.dependencies ? JSON.stringify(revision.dependencies) : null,
          revision.supersedes ?? null
        ]
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ImmutableRecordConflictError(
          `requirement-revisions/${revision.id}`,
          `Requirement revision '${revision.id}' already exists`
        );
      }
      throw err;
    }
  }

  async getRequirementRevision(
    id: RequirementRevisionId,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<RequirementRevision | undefined> {
    assertSafeIdentifier(id, 'requirementRevisionId');
    const result = await executor.query<{
      id: string;
      requirement_id: string;
      revision: number;
      statement: string;
      category: string;
      origin: string;
      review_state: string;
      resolution_state: string;
      evidence: string | unknown[];
      rationale: string;
      actor_id?: string | null;
      baseline_id?: string | null;
      originating_projection_id?: string | null;
      affected_actors?: string | string[] | null;
      dependencies?: string | string[] | null;
      supersedes?: string | null;
    }>(`SELECT * FROM requirement_revisions WHERE id = $1;`, [id]);

    if (result.rows.length === 0) {
      return undefined;
    }

    const row = result.rows[0];
    const rawEvidence =
      typeof row.evidence === 'string' ? JSON.parse(row.evidence) : (row.evidence ?? []);
    const rawAffectedActors = row.affected_actors
      ? typeof row.affected_actors === 'string'
        ? JSON.parse(row.affected_actors)
        : row.affected_actors
      : undefined;
    const rawDependencies = row.dependencies
      ? typeof row.dependencies === 'string'
        ? JSON.parse(row.dependencies)
        : row.dependencies
      : undefined;

    return createRequirementRevision({
      id: createRequirementRevisionId(row.id),
      requirementId: createRequirementId(row.requirement_id),
      revision: row.revision,
      statement: row.statement,
      category: row.category as RequirementCategory,
      origin: row.origin as RequirementOrigin,
      reviewState: row.review_state as RequirementReviewState,
      resolutionState: row.resolution_state as RequirementResolutionState,
      evidence: (rawEvidence as { sourceRevisionId: string; locator: string }[]).map((e) => ({
        sourceRevisionId: createSourceRevisionId(e.sourceRevisionId),
        locator: createEvidenceLocator(e.locator)
      })),
      rationale: row.rationale && row.rationale.length > 0 ? row.rationale : undefined,
      actorId: row.actor_id ? createActorId(row.actor_id) : undefined,
      baselineId: row.baseline_id ? createRequirementsBaselineId(row.baseline_id) : undefined,
      originatingProjectionId: row.originating_projection_id ?? undefined,
      affectedActors: rawAffectedActors?.map((a: string) => createActorId(a)),
      dependencies: rawDependencies?.map((d: string) => createRequirementId(d)),
      supersedes: row.supersedes ? createRequirementRevisionId(row.supersedes) : undefined
    });
  }

  async listRequirementRevisions(
    requirementId: RequirementId,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly RequirementRevision[]> {
    assertSafeIdentifier(requirementId, 'requirementId');
    const result = await executor.query<{ id: string }>(
      `SELECT id FROM requirement_revisions WHERE requirement_id = $1 ORDER BY revision ASC;`,
      [requirementId]
    );

    const revisions: RequirementRevision[] = [];
    for (const row of result.rows) {
      const rev = await this.getRequirementRevision(createRequirementRevisionId(row.id), executor);
      if (rev) {
        revisions.push(rev);
      }
    }
    return Object.freeze(revisions);
  }

  async listRequirementIds(
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly RequirementId[]> {
    const result = await executor.query<{ id: string }>(
      `SELECT id FROM requirements ORDER BY id ASC;`
    );
    return Object.freeze(result.rows.map((r) => createRequirementId(r.id)));
  }

  private async validateRequirementRecord(
    record: RequirementReconciliationRecord,
    rev: RequirementRevision,
    executor: ISqlDatabaseClient = this.activeDb
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

    const history = await this.listReconciliationRecords('requirement', record.entityId, executor);
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
        const sourceRev = rev.supersedes
          ? await this.getRequirementRevision(rev.supersedes, executor)
          : rev;
        if (sourceRev && record.previousResolutionState !== sourceRev.resolutionState) {
          throw new Error(
            `Resolution transition continuity broken for requirement '${record.entityId}': expected initial previousResolutionState '${sourceRev.resolutionState}', got '${record.previousResolutionState}'`
          );
        }
      }
    }
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

    return this.activeDb.transaction(async (tx) => {
      await tx.query(`INSERT INTO requirements (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;`, [
        successor.requirementId
      ]);
      await tx.query(`SELECT id FROM requirements WHERE id = $1 FOR UPDATE;`, [
        successor.requirementId
      ]);

      const latestQuery = await tx.query<{ id: string }>(
        `SELECT id FROM requirement_revisions
         WHERE requirement_id = $1
         ORDER BY revision DESC
         LIMIT 1 FOR UPDATE;`,
        [successor.requirementId]
      );
      const latest = latestQuery.rows.length > 0 ? latestQuery.rows[0] : undefined;
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

      await this.validateRequirementRecord(record, successor, tx);

      await tx.query(
        `INSERT INTO requirement_revisions (
           id, requirement_id, revision, statement, category, origin,
           review_state, resolution_state, evidence, rationale, actor_id,
           baseline_id, originating_projection_id, affected_actors,
           dependencies, supersedes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16);`,
        [
          successor.id,
          successor.requirementId,
          successor.revision,
          successor.statement,
          successor.category,
          successor.origin,
          successor.reviewState,
          successor.resolutionState,
          JSON.stringify(successor.evidence ?? []),
          successor.rationale ?? '',
          successor.actorId ?? null,
          successor.baselineId ?? null,
          successor.originatingProjectionId ?? null,
          successor.affectedActors ? JSON.stringify(successor.affectedActors) : null,
          successor.dependencies ? JSON.stringify(successor.dependencies) : null,
          successor.supersedes ?? null
        ]
      );

      await tx.query(
        `INSERT INTO reconciliation_records (
           id, entity_type, entity_id, requirement_revision_id, action,
           previous_review_state, new_review_state, previous_resolution_state,
           new_resolution_state, rationale, actor_id, recorded_at
         ) VALUES ($1, 'requirement', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`,
        [
          record.id,
          record.entityId,
          record.requirementRevisionId,
          record.action,
          record.previousReviewState ?? null,
          record.newReviewState,
          record.previousResolutionState ?? null,
          record.newResolutionState ?? null,
          record.rationale,
          record.actorId ?? null,
          record.recordedAt
        ]
      );
    });
  }

  // --- CANDIDATE FINDINGS ---

  async saveCandidateFinding(
    finding: CandidateFinding,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<void> {
    assertSafeIdentifier(finding.id, 'findingId');
    if (finding.disposition !== 'OPEN') {
      throw new Error(
        `Cannot create candidate finding directly with non-OPEN disposition: '${finding.disposition}'. Initial findings must be created with disposition 'OPEN'.`
      );
    }

    try {
      await executor.query(
        `INSERT INTO candidate_findings (
           id, type, affected_requirement_revisions, evidence, discovered_by,
           disposition, rationale, actor_id, baseline_id, originating_projection_id, version
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1);`,
        [
          finding.id,
          finding.type,
          JSON.stringify(finding.affectedRequirementRevisions ?? []),
          JSON.stringify(finding.evidence ?? []),
          finding.discoveredBy,
          finding.disposition,
          finding.rationale ?? null,
          finding.actorId ?? null,
          finding.baselineId ?? null,
          finding.originatingProjectionId ?? null
        ]
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ImmutableRecordConflictError(
          `findings/${finding.id}`,
          `Finding '${finding.id}' already exists`
        );
      }
      throw err;
    }
  }

  async getCandidateFinding(
    id: FindingId,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<CandidateFinding | undefined> {
    assertSafeIdentifier(id, 'findingId');
    const result = await executor.query<{
      id: string;
      type: string;
      affected_requirement_revisions: string | string[];
      evidence: string | unknown[];
      discovered_by: string;
      disposition: string;
      rationale?: string | null;
      actor_id?: string | null;
      baseline_id?: string | null;
      originating_projection_id?: string | null;
    }>(`SELECT * FROM candidate_findings WHERE id = $1;`, [id]);

    if (result.rows.length === 0) {
      return undefined;
    }

    const row = result.rows[0];
    const rawAffected =
      typeof row.affected_requirement_revisions === 'string'
        ? JSON.parse(row.affected_requirement_revisions)
        : (row.affected_requirement_revisions ?? []);
    const rawEvidence =
      typeof row.evidence === 'string' ? JSON.parse(row.evidence) : (row.evidence ?? []);

    return createCandidateFinding({
      id: createFindingId(row.id),
      type: row.type as FindingType,
      affectedRequirementRevisions: (rawAffected as string[]).map((r) =>
        createRequirementRevisionId(r)
      ),
      evidence: (rawEvidence as { sourceRevisionId: string; locator: string }[]).map((e) => ({
        sourceRevisionId: createSourceRevisionId(e.sourceRevisionId),
        locator: createEvidenceLocator(e.locator)
      })),
      discoveredBy: row.discovered_by as DiscoveredBy,
      disposition: row.disposition as FindingDisposition,
      rationale: row.rationale ?? undefined,
      actorId: row.actor_id ? createActorId(row.actor_id) : undefined,
      baselineId: row.baseline_id ? createRequirementsBaselineId(row.baseline_id) : undefined,
      originatingProjectionId: row.originating_projection_id ?? undefined
    });
  }

  async listCandidateFindings(
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly CandidateFinding[]> {
    const result = await executor.query<{ id: string }>(
      `SELECT id FROM candidate_findings ORDER BY id ASC;`
    );
    const findings: CandidateFinding[] = [];
    for (const row of result.rows) {
      const f = await this.getCandidateFinding(createFindingId(row.id), executor);
      if (f) {
        findings.push(f);
      }
    }
    return Object.freeze(findings);
  }

  private async validateFindingRecord(
    record: FindingReconciliationRecord,
    finding: CandidateFinding,
    executor: ISqlDatabaseClient = this.activeDb
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

    const history = await this.listReconciliationRecords('finding', record.entityId, executor);
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

    return this.activeDb.transaction(async (tx) => {
      await tx.query('SELECT id FROM candidate_findings WHERE id = $1 FOR UPDATE;', [finding.id]);
      const current = await this.getCandidateFinding(finding.id, tx);
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

      await this.validateFindingRecord(record, current, tx);

      const updateResult = await tx.query(
        `UPDATE candidate_findings
         SET disposition = $1, rationale = $2, version = version + 1, updated_at = NOW()
         WHERE id = $3 AND disposition = $4;`,
        [finding.disposition, finding.rationale ?? null, finding.id, expectedDisp]
      );

      if (updateResult.rowCount === 0) {
        throw new FindingDispositionConflictError(
          finding.id,
          expectedDisp,
          current.disposition,
          `Concurrency conflict for finding '${finding.id}': conditional update failed`
        );
      }

      await tx.query(
        `INSERT INTO reconciliation_records (
           id, entity_type, entity_id, previous_disposition, new_disposition,
           rationale, actor_id, recorded_at
         ) VALUES ($1, 'finding', $2, $3, $4, $5, $6, $7);`,
        [
          record.id,
          record.entityId,
          record.previousDisposition,
          record.newDisposition,
          record.rationale,
          record.actorId ?? null,
          record.recordedAt
        ]
      );
    });
  }

  // --- RECONCILIATION RECORDS ---

  async appendReconciliationRecord(
    record: ReconciliationRecord,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<void> {
    if (typeof record.rationale !== 'string' || record.rationale.trim().length === 0) {
      throw new Error('Reconciliation record rationale must be a non-empty string');
    }
    assertSafeIdentifier(record.id, 'reconciliationRecordId');

    if (record.entityType === 'finding') {
      assertSafeIdentifier(record.entityId, 'findingId');
      const finding = await this.getCandidateFinding(record.entityId, executor);
      if (!finding) {
        throw new Error(`Referenced finding '${record.entityId}' does not exist`);
      }
      await this.validateFindingRecord(record, finding, executor);

      await executor.query(
        `INSERT INTO reconciliation_records (
           id, entity_type, entity_id, previous_disposition, new_disposition,
           rationale, actor_id, recorded_at
         ) VALUES ($1, 'finding', $2, $3, $4, $5, $6, $7);`,
        [
          record.id,
          record.entityId,
          record.previousDisposition,
          record.newDisposition,
          record.rationale,
          record.actorId ?? null,
          record.recordedAt
        ]
      );
    } else if (record.entityType === 'requirement') {
      assertSafeIdentifier(record.entityId, 'requirementId');
      assertSafeIdentifier(record.requirementRevisionId, 'requirementRevisionId');

      const rev = await this.getRequirementRevision(record.requirementRevisionId, executor);
      if (!rev) {
        throw new Error(
          `Referenced requirement revision '${record.requirementRevisionId}' does not exist`
        );
      }
      await this.validateRequirementRecord(record, rev, executor);

      await executor.query(
        `INSERT INTO reconciliation_records (
           id, entity_type, entity_id, requirement_revision_id, action,
           previous_review_state, new_review_state, previous_resolution_state,
           new_resolution_state, rationale, actor_id, recorded_at
         ) VALUES ($1, 'requirement', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`,
        [
          record.id,
          record.entityId,
          record.requirementRevisionId,
          record.action,
          record.previousReviewState ?? null,
          record.newReviewState,
          record.previousResolutionState ?? null,
          record.newResolutionState ?? null,
          record.rationale,
          record.actorId ?? null,
          record.recordedAt
        ]
      );
    } else {
      throw new Error(`Unsupported entityType: '${(record as { entityType: string }).entityType}'`);
    }
  }

  async listReconciliationRecords(
    entityType: 'finding',
    entityId: FindingId,
    executor?: ISqlDatabaseClient
  ): Promise<readonly FindingReconciliationRecord[]>;
  async listReconciliationRecords(
    entityType: 'requirement',
    entityId: RequirementId,
    executor?: ISqlDatabaseClient
  ): Promise<readonly RequirementReconciliationRecord[]>;
  async listReconciliationRecords(
    entityType: 'finding' | 'requirement',
    entityId: FindingId | RequirementId,
    executor?: ISqlDatabaseClient
  ): Promise<readonly ReconciliationRecord[]>;
  async listReconciliationRecords(
    entityType: 'finding' | 'requirement',
    entityId: FindingId | RequirementId,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly ReconciliationRecord[]> {
    assertSafeIdentifier(entityId, entityType === 'finding' ? 'findingId' : 'requirementId');
    const result = await executor.query<{
      id: string;
      entity_type: string;
      entity_id: string;
      requirement_revision_id?: string | null;
      action?: string | null;
      previous_review_state?: string | null;
      new_review_state?: string | null;
      previous_resolution_state?: string | null;
      new_resolution_state?: string | null;
      previous_disposition?: string | null;
      new_disposition?: string | null;
      rationale: string;
      actor_id?: string | null;
      recorded_at: string | Date;
    }>(
      `SELECT * FROM reconciliation_records
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY recorded_at ASC, id ASC;`,
      [entityType, entityId]
    );

    return Object.freeze(
      result.rows.map((row) => {
        const recordedAt = createInstant(
          row.recorded_at instanceof Date ? row.recorded_at.toISOString() : row.recorded_at
        );
        if (row.entity_type === 'finding') {
          const rec: FindingReconciliationRecord = {
            id: row.id,
            entityType: 'finding',
            entityId: createFindingId(row.entity_id),
            previousDisposition: row.previous_disposition as FindingDisposition,
            newDisposition: row.new_disposition as FindingDisposition,
            rationale: row.rationale,
            actorId: row.actor_id ? createActorId(row.actor_id) : undefined,
            recordedAt
          };
          return rec;
        } else {
          const rec: RequirementReconciliationRecord = {
            id: row.id,
            entityType: 'requirement',
            entityId: createRequirementId(row.entity_id),
            requirementRevisionId: createRequirementRevisionId(row.requirement_revision_id!),
            action: row.action as RequirementReconciliationAction,
            previousReviewState: row.previous_review_state
              ? (row.previous_review_state as RequirementReviewState)
              : undefined,
            newReviewState: row.new_review_state as RequirementReviewState,
            previousResolutionState: row.previous_resolution_state
              ? (row.previous_resolution_state as RequirementResolutionState)
              : undefined,
            newResolutionState: row.new_resolution_state
              ? (row.new_resolution_state as RequirementResolutionState)
              : undefined,
            rationale: row.rationale,
            actorId: row.actor_id ? createActorId(row.actor_id) : undefined,
            recordedAt
          };
          return rec;
        }
      })
    );
  }

  async listAllReconciliationRecords(
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly ReconciliationRecord[]> {
    const result = await executor.query<{
      id: string;
      entity_type: string;
      entity_id: string;
      requirement_revision_id?: string | null;
      action?: string | null;
      previous_review_state?: string | null;
      new_review_state?: string | null;
      previous_resolution_state?: string | null;
      new_resolution_state?: string | null;
      previous_disposition?: string | null;
      new_disposition?: string | null;
      rationale: string;
      actor_id?: string | null;
      recorded_at: string | Date;
    }>(`SELECT * FROM reconciliation_records ORDER BY recorded_at ASC, id ASC;`);

    return Object.freeze(
      result.rows.map((row) => {
        const recordedAt = createInstant(
          row.recorded_at instanceof Date ? row.recorded_at.toISOString() : row.recorded_at
        );
        if (row.entity_type === 'finding') {
          const rec: FindingReconciliationRecord = {
            id: row.id,
            entityType: 'finding',
            entityId: createFindingId(row.entity_id),
            previousDisposition: row.previous_disposition as FindingDisposition,
            newDisposition: row.new_disposition as FindingDisposition,
            rationale: row.rationale,
            actorId: row.actor_id ? createActorId(row.actor_id) : undefined,
            recordedAt
          };
          return rec;
        } else {
          const rec: RequirementReconciliationRecord = {
            id: row.id,
            entityType: 'requirement',
            entityId: createRequirementId(row.entity_id),
            requirementRevisionId: createRequirementRevisionId(row.requirement_revision_id!),
            action: row.action as RequirementReconciliationAction,
            previousReviewState: row.previous_review_state
              ? (row.previous_review_state as RequirementReviewState)
              : undefined,
            newReviewState: row.new_review_state as RequirementReviewState,
            previousResolutionState: row.previous_resolution_state
              ? (row.previous_resolution_state as RequirementResolutionState)
              : undefined,
            newResolutionState: row.new_resolution_state
              ? (row.new_resolution_state as RequirementResolutionState)
              : undefined,
            rationale: row.rationale,
            actorId: row.actor_id ? createActorId(row.actor_id) : undefined,
            recordedAt
          };
          return rec;
        }
      })
    );
  }

  // --- BASELINES ---

  async saveRequirementsBaselineConditional(
    baseline: RequirementsBaseline,
    expectedLatestRevisionIds: readonly RequirementRevisionId[],
    expectedLatestPolicyConstraintRevisionIds?: readonly PolicyConstraintRevisionId[]
  ): Promise<void> {
    assertSafeIdentifier(baseline.id, 'baselineId');

    return this.activeDb.transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;').catch(() => {});

      // 1. Manifest equality enforcement: baseline manifest must match expectations exactly
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

      // 2. Verify existence and lock parent row + head revision for each requirement
      for (const rawRevId of expectedLatestRevisionIds) {
        const expectedRevId = createRequirementRevisionId(rawRevId);
        assertSafeIdentifier(expectedRevId, 'requirementRevisionId');

        const revCheck = await tx.query<{ requirement_id: string }>(
          `SELECT requirement_id FROM requirement_revisions WHERE id = $1;`,
          [expectedRevId]
        );
        if (revCheck.rows.length === 0) {
          throw new UnknownRequirementRevisionError(expectedRevId);
        }
        const reqId = revCheck.rows[0].requirement_id;

        await tx.query(`SELECT id FROM requirements WHERE id = $1 FOR UPDATE;`, [reqId]);

        const latestQuery = await tx.query<{ id: string }>(
          `SELECT id FROM requirement_revisions
           WHERE requirement_id = $1
           ORDER BY revision DESC
           LIMIT 1 FOR UPDATE;`,
          [reqId]
        );
        const latest = latestQuery.rows.length > 0 ? latestQuery.rows[0] : undefined;
        if (!latest || latest.id !== expectedRevId) {
          throw new StaleRevisionTargetError(expectedRevId, latest?.id ?? 'none');
        }
      }

      // 3. Verify existence and lock parent row + head revision for each policy constraint
      for (const rawPolId of expectedPolList) {
        const expectedPolRevId = createPolicyConstraintRevisionId(rawPolId);
        assertSafeIdentifier(expectedPolRevId, 'policyConstraintRevisionId');

        const polCheck = await tx.query<{ policy_constraint_id: string }>(
          `SELECT policy_constraint_id FROM policy_constraint_revisions WHERE id = $1;`,
          [expectedPolRevId]
        );
        if (polCheck.rows.length === 0) {
          throw new UnknownPolicyConstraintRevisionError(expectedPolRevId);
        }
        const polId = polCheck.rows[0].policy_constraint_id;

        await tx.query(`SELECT id FROM policy_constraints WHERE id = $1 FOR UPDATE;`, [polId]);

        const latestQuery = await tx.query<{ id: string }>(
          `SELECT id FROM policy_constraint_revisions
           WHERE policy_constraint_id = $1
           ORDER BY revision DESC
           LIMIT 1 FOR UPDATE;`,
          [polId]
        );
        const latest = latestQuery.rows.length > 0 ? latestQuery.rows[0] : undefined;
        if (!latest || latest.id !== expectedPolRevId) {
          throw new StaleRevisionTargetError(expectedPolRevId, latest?.id ?? 'none');
        }
      }

      // 3. Query candidate_findings for open blocking findings
      const openFindingsQuery = await tx.query<{
        id: string;
        type: string;
        affected_requirement_revisions: string | string[];
        evidence: string | unknown[];
        discovered_by: string;
        disposition: string;
        rationale: string | null;
      }>(
        `SELECT id, type, affected_requirement_revisions, evidence, discovered_by, disposition, rationale
         FROM candidate_findings
         WHERE disposition = 'OPEN';`
      );

      // Build lineage closure for expected requirement revisions
      const closure = new Set<string>();
      for (const revId of expectedLatestRevisionIds) {
        closure.add(revId);
        let curr: string | null = revId;
        while (curr) {
          const res: { rows: readonly { supersedes: string | null }[] } = await tx.query<{
            supersedes: string | null;
          }>(`SELECT supersedes FROM requirement_revisions WHERE id = $1;`, [curr]);
          curr = res.rows.length > 0 && res.rows[0].supersedes ? res.rows[0].supersedes : null;
          if (curr) {
            if (closure.has(curr)) break;
            closure.add(curr);
          }
        }
      }

      const blockingMatches: BlockingFindingMatch[] = [];
      for (const findingRow of openFindingsQuery.rows) {
        const rawAffected =
          typeof findingRow.affected_requirement_revisions === 'string'
            ? JSON.parse(findingRow.affected_requirement_revisions)
            : (findingRow.affected_requirement_revisions ?? []);
        const affectedList = (rawAffected as string[]) ?? [];
        for (const aff of affectedList) {
          if (closure.has(aff)) {
            blockingMatches.push({
              finding: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                id: createFindingId(findingRow.id) as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                type: findingRow.type as any,
                disposition: 'OPEN',
                affectedRequirementRevisions: affectedList.map(createRequirementRevisionId),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                evidence: [] as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                discoveredBy: findingRow.discovered_by as any,
                rationale: findingRow.rationale ?? undefined
              },
              id: createFindingId(findingRow.id),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              type: findingRow.type as any,
              disposition: 'OPEN',
              affectedRequirementRevisions: affectedList.map(createRequirementRevisionId),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              evidence: [] as any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              discoveredBy: findingRow.discovered_by as any,
              rationale: findingRow.rationale ?? undefined,
              affectedRevisionId: createRequirementRevisionId(aff),
              matchedRevisionId: createRequirementRevisionId(aff),
              proposedRevisionId: createRequirementRevisionId(aff)
            });
            break;
          }
        }
      }

      if (blockingMatches.length > 0) {
        throw new BlockedByOpenFindingsError(blockingMatches);
      }

      try {
        await tx.query(
          `INSERT INTO baselines (id, requirement_revisions, policy_constraint_revisions, created_at, created_by)
           VALUES ($1, $2, $3, $4, $5);`,
          [
            baseline.id,
            JSON.stringify(baseline.requirementRevisions),
            JSON.stringify(baseline.policyConstraintRevisions ?? []),
            baseline.createdAt,
            baseline.createdBy
          ]
        );
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          throw new ImmutableRecordConflictError(
            `baselines/${baseline.id}`,
            `Baseline '${baseline.id}' already exists`
          );
        }
        throw err;
      }
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
    for (const reqRevId of baseline.requirementRevisions) {
      assertSafeIdentifier(reqRevId, 'requirementRevisionId');
      const res = await this.activeDb.query(`SELECT 1 FROM requirement_revisions WHERE id = $1;`, [
        reqRevId
      ]);
      if (res.rows.length === 0) {
        throw new UnknownRequirementRevisionError(reqRevId);
      }
    }
    for (const polRevId of baseline.policyConstraintRevisions ?? []) {
      assertSafeIdentifier(polRevId, 'policyConstraintRevisionId');
      const res = await this.activeDb.query(
        `SELECT 1 FROM policy_constraint_revisions WHERE id = $1;`,
        [polRevId]
      );
      if (res.rows.length === 0) {
        throw new UnknownPolicyConstraintRevisionError(polRevId);
      }
    }
    try {
      await this.activeDb.query(
        `INSERT INTO baselines (id, requirement_revisions, policy_constraint_revisions, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5);`,
        [
          baseline.id,
          JSON.stringify(baseline.requirementRevisions),
          JSON.stringify(baseline.policyConstraintRevisions ?? []),
          baseline.createdAt,
          baseline.createdBy
        ]
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ImmutableRecordConflictError(
          `baselines/${baseline.id}`,
          `Baseline '${baseline.id}' already exists`
        );
      }
      throw err;
    }
  }

  async getRequirementsBaseline(
    id: RequirementsBaselineId,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<RequirementsBaseline | undefined> {
    assertSafeIdentifier(id, 'baselineId');
    const result = await executor.query<{
      id: string;
      requirement_revisions: string | string[];
      policy_constraint_revisions?: string | string[] | null;
      created_at: string | Date;
      created_by: string;
    }>(`SELECT * FROM baselines WHERE id = $1;`, [id]);

    if (result.rows.length === 0) {
      return undefined;
    }

    const row = result.rows[0];
    const rawReqs =
      typeof row.requirement_revisions === 'string'
        ? JSON.parse(row.requirement_revisions)
        : row.requirement_revisions;
    const rawPols = row.policy_constraint_revisions
      ? typeof row.policy_constraint_revisions === 'string'
        ? JSON.parse(row.policy_constraint_revisions)
        : row.policy_constraint_revisions
      : [];

    return Object.freeze({
      id: createRequirementsBaselineId(row.id),
      requirementRevisions: Object.freeze(
        (rawReqs as string[]).map((r) => createRequirementRevisionId(r))
      ),
      policyConstraintRevisions: Object.freeze(
        (rawPols as string[]).map((p) => createPolicyConstraintRevisionId(p))
      ),
      createdAt: createInstant(
        row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      ),
      createdBy: createReviewerId(row.created_by)
    });
  }

  async listRequirementsBaselines(
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly RequirementsBaseline[]> {
    const result = await executor.query<{ id: string }>(
      `SELECT id FROM baselines ORDER BY created_at ASC, id ASC;`
    );
    const baselines: RequirementsBaseline[] = [];
    for (const row of result.rows) {
      const b = await this.getRequirementsBaseline(createRequirementsBaselineId(row.id), executor);
      if (b) {
        baselines.push(b);
      }
    }
    return Object.freeze(baselines);
  }

  // --- POLICY CONSTRAINTS ---

  async savePolicyConstraintRevision(
    revision: PolicyConstraintRevision,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<void> {
    assertSafeIdentifier(revision.id, 'policyConstraintRevisionId');
    assertSafeIdentifier(revision.policyConstraintId, 'policyConstraintId');

    await executor.query(
      `INSERT INTO policy_constraints (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;`,
      [revision.policyConstraintId]
    );

    const latestQuery = await executor.query<{ id: string }>(
      `SELECT id FROM policy_constraint_revisions
       WHERE policy_constraint_id = $1
       ORDER BY revision DESC
       LIMIT 1;`,
      [revision.policyConstraintId]
    );
    const latest = latestQuery.rows.length > 0 ? latestQuery.rows[0] : undefined;

    if (revision.supersedes !== undefined) {
      if (!latest || latest.id !== revision.supersedes) {
        throw new StaleRevisionTargetError(revision.supersedes, latest?.id ?? 'none');
      }
    } else if (latest !== undefined && latest.id !== revision.id) {
      throw new StaleRevisionTargetError(revision.id, latest.id);
    }

    try {
      await executor.query(
        `INSERT INTO policy_constraint_revisions (
           id, policy_constraint_id, revision, statement, authority_reference,
           state, created_at, created_by, supersedes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
        [
          revision.id,
          revision.policyConstraintId,
          revision.revision,
          revision.statement,
          revision.authorityReference,
          revision.state,
          revision.createdAt,
          revision.createdBy,
          revision.supersedes ?? null
        ]
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ImmutableRecordConflictError(
          `policy-constraint-revisions/${revision.id}`,
          `Policy constraint revision '${revision.id}' already exists`
        );
      }
      throw err;
    }
  }

  async getPolicyConstraintRevision(
    id: PolicyConstraintRevisionId,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<PolicyConstraintRevision | undefined> {
    assertSafeIdentifier(id, 'policyConstraintRevisionId');
    const result = await executor.query<{
      id: string;
      policy_constraint_id: string;
      revision: number;
      statement: string;
      authority_reference: string;
      state: string;
      created_at: string | Date;
      created_by: string;
      supersedes?: string | null;
    }>(`SELECT * FROM policy_constraint_revisions WHERE id = $1;`, [id]);

    if (result.rows.length === 0) {
      return undefined;
    }

    const row = result.rows[0];
    return createPolicyConstraintRevision({
      id: createPolicyConstraintRevisionId(row.id),
      policyConstraintId: createPolicyConstraintId(row.policy_constraint_id),
      revision: row.revision,
      statement: row.statement,
      authorityReference: row.authority_reference,
      state: row.state as PolicyConstraintState,
      createdAt: createInstant(
        row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      ),
      createdBy: row.created_by,
      supersedes: row.supersedes ? createPolicyConstraintRevisionId(row.supersedes) : undefined
    });
  }

  async listPolicyConstraintRevisions(
    policyConstraintId: PolicyConstraintId,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly PolicyConstraintRevision[]> {
    assertSafeIdentifier(policyConstraintId, 'policyConstraintId');
    const result = await executor.query<{ id: string }>(
      `SELECT id FROM policy_constraint_revisions
       WHERE policy_constraint_id = $1
       ORDER BY revision ASC;`,
      [policyConstraintId]
    );

    const revisions: PolicyConstraintRevision[] = [];
    for (const row of result.rows) {
      const rev = await this.getPolicyConstraintRevision(
        createPolicyConstraintRevisionId(row.id),
        executor
      );
      if (rev) {
        revisions.push(rev);
      }
    }
    return Object.freeze(revisions);
  }

  async listPolicyConstraintIds(
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly PolicyConstraintId[]> {
    const result = await executor.query<{ id: string }>(
      `SELECT id FROM policy_constraints ORDER BY id ASC;`
    );
    return Object.freeze(result.rows.map((r) => createPolicyConstraintId(r.id)));
  }

  // --- ENGINEERING DECISIONS ---

  async saveEngineeringDecision(
    decision: EngineeringDecision,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<void> {
    assertSafeIdentifier(decision.id, 'engineeringDecisionId');
    assertSafeIdentifier(decision.baselineId, 'baselineId');

    try {
      await executor.query(
        `INSERT INTO engineering_decisions (
           id, baseline_id, statement, rationale, requirement_revision_ids,
           policy_constraint_revision_ids, state, created_at, created_by,
           accepted_by, accepted_at, supersedes, transition_rationale, version
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1);`,
        [
          decision.id,
          decision.baselineId,
          decision.statement,
          decision.rationale,
          JSON.stringify(decision.requirementRevisionIds ?? []),
          JSON.stringify(decision.policyConstraintRevisionIds ?? []),
          decision.state,
          decision.createdAt,
          decision.createdBy,
          decision.acceptedBy ?? null,
          decision.acceptedAt ?? null,
          decision.supersedes ?? null,
          decision.transitionRationale ?? null
        ]
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ImmutableRecordConflictError(
          `engineering-decisions/${decision.id}`,
          `Engineering decision '${decision.id}' already exists`
        );
      }
      throw err;
    }
  }

  async updateEngineeringDecision(
    decision: EngineeringDecision,
    expectedCurrentState?: EngineeringDecisionState
  ): Promise<void> {
    assertSafeIdentifier(decision.id, 'engineeringDecisionId');

    return this.activeDb.transaction(async (tx) => {
      await tx.query('SELECT id FROM engineering_decisions WHERE id = $1 FOR UPDATE;', [
        decision.id
      ]);
      const current = await this.getEngineeringDecision(decision.id, tx);
      if (!current) {
        throw new UnknownEngineeringDecisionError(decision.id);
      }

      if (expectedCurrentState !== undefined && current.state !== expectedCurrentState) {
        throw new InvalidEngineeringDecisionStateError(
          `Conflict updating engineering decision '${decision.id}': expected state '${expectedCurrentState}', current state is '${current.state}'`
        );
      }

      const updateQuery =
        expectedCurrentState !== undefined
          ? `UPDATE engineering_decisions
             SET statement = $1, rationale = $2, requirement_revision_ids = $3,
                 policy_constraint_revision_ids = $4, state = $5, accepted_by = $6,
                 accepted_at = $7, supersedes = $8, transition_rationale = $9,
                 version = version + 1, updated_at = NOW()
             WHERE id = $10 AND state = $11;`
          : `UPDATE engineering_decisions
             SET statement = $1, rationale = $2, requirement_revision_ids = $3,
                 policy_constraint_revision_ids = $4, state = $5, accepted_by = $6,
                 accepted_at = $7, supersedes = $8, transition_rationale = $9,
                 version = version + 1, updated_at = NOW()
             WHERE id = $10;`;

      const params = [
        decision.statement,
        decision.rationale,
        JSON.stringify(decision.requirementRevisionIds ?? []),
        JSON.stringify(decision.policyConstraintRevisionIds ?? []),
        decision.state,
        decision.acceptedBy ?? null,
        decision.acceptedAt ?? null,
        decision.supersedes ?? null,
        decision.transitionRationale ?? null,
        decision.id
      ];
      if (expectedCurrentState !== undefined) {
        params.push(expectedCurrentState);
      }

      const result = await tx.query(updateQuery, params);
      if (result.rowCount === 0) {
        throw new InvalidEngineeringDecisionStateError(
          `Conflict updating engineering decision '${decision.id}': conditional update failed`
        );
      }
    });
  }

  async getEngineeringDecision(
    id: EngineeringDecisionId,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<EngineeringDecision | undefined> {
    assertSafeIdentifier(id, 'engineeringDecisionId');
    const result = await executor.query<{
      id: string;
      baseline_id: string;
      statement: string;
      rationale: string;
      requirement_revision_ids: string | string[];
      policy_constraint_revision_ids: string | string[];
      state: string;
      created_at: string | Date;
      created_by: string;
      accepted_by?: string | null;
      accepted_at?: string | Date | null;
      supersedes?: string | null;
      transition_rationale?: string | null;
    }>(`SELECT * FROM engineering_decisions WHERE id = $1;`, [id]);

    if (result.rows.length === 0) {
      return undefined;
    }

    const row = result.rows[0];
    const rawReqs =
      typeof row.requirement_revision_ids === 'string'
        ? JSON.parse(row.requirement_revision_ids)
        : (row.requirement_revision_ids ?? []);
    const rawPols =
      typeof row.policy_constraint_revision_ids === 'string'
        ? JSON.parse(row.policy_constraint_revision_ids)
        : (row.policy_constraint_revision_ids ?? []);

    return createEngineeringDecision({
      id: createEngineeringDecisionId(row.id),
      baselineId: createRequirementsBaselineId(row.baseline_id),
      statement: row.statement,
      rationale: row.rationale,
      requirementRevisionIds: (rawReqs as string[]).map((r) => createRequirementRevisionId(r)),
      policyConstraintRevisionIds: (rawPols as string[]).map((p) =>
        createPolicyConstraintRevisionId(p)
      ),
      state: row.state as EngineeringDecisionState,
      createdAt: createInstant(
        row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      ),
      createdBy: row.created_by,
      acceptedBy: row.accepted_by ? createReviewerId(row.accepted_by) : undefined,
      acceptedAt: row.accepted_at
        ? createInstant(
            row.accepted_at instanceof Date
              ? row.accepted_at.toISOString()
              : String(row.accepted_at)
          )
        : undefined,
      supersedes: row.supersedes ? createEngineeringDecisionId(row.supersedes) : undefined,
      transitionRationale: row.transition_rationale ?? undefined
    });
  }

  async listEngineeringDecisions(
    filter?: {
      baselineId?: RequirementsBaselineId;
      state?: EngineeringDecisionState;
    },
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly EngineeringDecision[]> {
    let query = `SELECT id FROM engineering_decisions`;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.baselineId) {
      conditions.push(`baseline_id = $${params.length + 1}`);
      params.push(filter.baselineId);
    }
    if (filter?.state) {
      conditions.push(`state = $${params.length + 1}`);
      params.push(filter.state);
    }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ` ORDER BY created_at ASC, id ASC;`;

    const result = await executor.query<{ id: string }>(query, params);
    const decisions: EngineeringDecision[] = [];
    for (const row of result.rows) {
      const d = await this.getEngineeringDecision(createEngineeringDecisionId(row.id), executor);
      if (d) {
        decisions.push(d);
      }
    }
    return Object.freeze(decisions);
  }

  // --- EVALUATION RUNS ---

  async saveEvaluationRun(
    run: EvaluationRunRecord,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<void> {
    assertSafeIdentifier(run.id, 'runId');
    const validated = EvaluationRunRecordSchema.parse(run);

    const blobKey = `evaluation-runs/${run.id}/report.json`;
    await this.objectStore.putObject(blobKey, JSON.stringify(validated), {
      contentType: 'application/json'
    });

    try {
      await executor.query(
        `INSERT INTO evaluation_runs (
           id, corpus_version, executed_at, fixture_results, report, payload_ref
         ) VALUES ($1, $2, $3, $4, $5, $6);`,
        [
          validated.id,
          validated.corpusVersion,
          validated.executedAt,
          JSON.stringify(validated.fixtureResults),
          JSON.stringify(validated.report),
          blobKey
        ]
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ImmutableRecordConflictError(
          `evaluation-runs/${run.id}`,
          `Evaluation run '${run.id}' already exists`
        );
      }
      throw err;
    }
  }

  async getEvaluationRun(
    id: string,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<EvaluationRunRecord | undefined> {
    assertSafeIdentifier(id, 'runId');
    const result = await executor.query<{
      id: string;
      corpus_version: string;
      executed_at: string | Date;
      fixture_results: string | unknown[];
      report: string | unknown;
      payload_ref?: string | null;
    }>(`SELECT * FROM evaluation_runs WHERE id = $1;`, [id]);

    if (result.rows.length === 0) {
      return undefined;
    }

    const row = result.rows[0];
    let fixtureResults =
      typeof row.fixture_results === 'string'
        ? JSON.parse(row.fixture_results)
        : row.fixture_results;
    let report = typeof row.report === 'string' ? JSON.parse(row.report) : row.report;

    if (row.payload_ref) {
      const blobString = await this.objectStore.getObjectString(row.payload_ref);
      if (blobString) {
        const parsed = JSON.parse(blobString);
        fixtureResults = parsed.fixtureResults;
        report = parsed.report;
      }
    }

    if (
      Array.isArray(fixtureResults) &&
      fixtureResults.length === 0 &&
      Array.isArray(report?.fixtureResults) &&
      report.fixtureResults.length > 0
    ) {
      fixtureResults = report.fixtureResults;
    }

    const validated = EvaluationRunRecordSchema.parse({
      id: row.id,
      corpusVersion: row.corpus_version,
      executedAt: row.executed_at instanceof Date ? row.executed_at.toISOString() : row.executed_at,
      fixtureResults,
      report
    });

    return Object.freeze({
      id: validated.id,
      corpusVersion: validated.corpusVersion,
      executedAt: createInstant(validated.executedAt),
      fixtureResults: Object.freeze(validated.fixtureResults),
      report: Object.freeze(validated.report)
    });
  }

  async listEvaluationRuns(
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly EvaluationRunRecord[]> {
    const result = await executor.query<{ id: string }>(
      `SELECT id FROM evaluation_runs ORDER BY executed_at ASC, id ASC;`
    );
    const runs: EvaluationRunRecord[] = [];
    for (const row of result.rows) {
      const r = await this.getEvaluationRun(row.id, executor);
      if (r) {
        runs.push(r);
      }
    }
    return Object.freeze(runs);
  }

  // --- PROJECTIONS ---

  async saveProjectionRecord(
    projection: ProjectionRecord,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<void> {
    assertSafeIdentifier(projection.id, 'projectionId');
    assertSafeIdentifier(projection.baselineId, 'baselineId');

    const blobKey = `projections/${projection.id}.artifact`;
    await this.objectStore.putObject(blobKey, projection.content, {
      contentType: 'text/plain'
    });

    try {
      await executor.query(
        `INSERT INTO projections (
           id, baseline_id, requirement_revision_ids, policy_constraint_revision_ids,
           engineering_decision_ids, artifact_type, content, payload_ref, metadata,
           created_at, version
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1);`,
        [
          projection.id,
          projection.baselineId,
          JSON.stringify(projection.requirementRevisionIds),
          projection.policyConstraintRevisionIds
            ? JSON.stringify(projection.policyConstraintRevisionIds)
            : null,
          projection.engineeringDecisionIds
            ? JSON.stringify(projection.engineeringDecisionIds)
            : null,
          projection.artifactType,
          projection.content,
          blobKey,
          JSON.stringify(projection.metadata),
          projection.createdAt
        ]
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ImmutableRecordConflictError(
          `projections/${projection.id}`,
          `Projection '${projection.id}' already exists`
        );
      }
      throw err;
    }
  }

  async updateProjectionRecord(
    projection: ProjectionRecord,
    expectedVersion?: number,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<void> {
    assertSafeIdentifier(projection.id, 'projectionId');
    assertSafeIdentifier(projection.baselineId, 'baselineId');

    const blobKey = `projections/${projection.id}.artifact`;
    await this.objectStore.putObject(blobKey, projection.content, {
      contentType: 'text/plain'
    });

    const expVer = expectedVersion ?? projection.version;
    const updateQuery =
      expVer !== undefined
        ? `UPDATE projections
           SET baseline_id = $1, requirement_revision_ids = $2, policy_constraint_revision_ids = $3,
               engineering_decision_ids = $4, artifact_type = $5, content = $6, payload_ref = $7,
               metadata = $8, version = version + 1
           WHERE id = $9 AND version = $10;`
        : `UPDATE projections
           SET baseline_id = $1, requirement_revision_ids = $2, policy_constraint_revision_ids = $3,
               engineering_decision_ids = $4, artifact_type = $5, content = $6, payload_ref = $7,
               metadata = $8, version = version + 1
           WHERE id = $9;`;

    const params: unknown[] = [
      projection.baselineId,
      JSON.stringify(projection.requirementRevisionIds),
      projection.policyConstraintRevisionIds
        ? JSON.stringify(projection.policyConstraintRevisionIds)
        : null,
      projection.engineeringDecisionIds ? JSON.stringify(projection.engineeringDecisionIds) : null,
      projection.artifactType,
      projection.content,
      blobKey,
      JSON.stringify(projection.metadata),
      projection.id
    ];
    if (expVer !== undefined) {
      params.push(expVer);
    }

    const res = await executor.query(updateQuery, params);
    if (res.rowCount === 0) {
      const existing = await this.getProjectionRecord(projection.id, executor);
      if (!existing) {
        throw new Error(`Projection '${projection.id}' not found`);
      }
      throw new OptimisticConcurrencyConflictError(
        `Concurrency conflict updating projection '${projection.id}': expected version ${expVer}`
      );
    }
  }

  async getProjectionRecord(
    id: string,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<ProjectionRecord | undefined> {
    assertSafeIdentifier(id, 'projectionId');
    const result = await executor.query<{
      id: string;
      baseline_id: string;
      requirement_revision_ids: string | string[];
      policy_constraint_revision_ids?: string | string[] | null;
      engineering_decision_ids?: string | string[] | null;
      artifact_type: string;
      content: string;
      payload_ref?: string | null;
      metadata: string | unknown;
      created_at: string | Date;
      version?: number | null;
    }>(`SELECT * FROM projections WHERE id = $1;`, [id]);

    if (result.rows.length === 0) {
      return undefined;
    }

    const row = result.rows[0];
    let content = row.content;
    if (!content && row.payload_ref) {
      const blob = await this.objectStore.getObjectString(row.payload_ref);
      if (blob) {
        content = blob;
      }
    }

    const rawReqs =
      typeof row.requirement_revision_ids === 'string'
        ? JSON.parse(row.requirement_revision_ids)
        : row.requirement_revision_ids;
    const rawPols = row.policy_constraint_revision_ids
      ? typeof row.policy_constraint_revision_ids === 'string'
        ? JSON.parse(row.policy_constraint_revision_ids)
        : row.policy_constraint_revision_ids
      : undefined;
    const rawDecs = row.engineering_decision_ids
      ? typeof row.engineering_decision_ids === 'string'
        ? JSON.parse(row.engineering_decision_ids)
        : row.engineering_decision_ids
      : undefined;
    const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;

    return Object.freeze({
      id: row.id,
      baselineId: createRequirementsBaselineId(row.baseline_id),
      requirementRevisionIds: Object.freeze(
        (rawReqs as string[]).map((r) => createRequirementRevisionId(r))
      ),
      policyConstraintRevisionIds: rawPols
        ? Object.freeze((rawPols as string[]).map((p) => createPolicyConstraintRevisionId(p)))
        : undefined,
      engineeringDecisionIds: rawDecs
        ? Object.freeze((rawDecs as string[]).map((d) => createEngineeringDecisionId(d)))
        : undefined,
      artifactType: row.artifact_type,
      content,
      metadata,
      version: row.version ?? 1,
      createdAt: createInstant(
        row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      )
    });
  }

  async listProjectionRecords(
    baselineId?: RequirementsBaselineId,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly ProjectionRecord[]> {
    const query = baselineId
      ? `SELECT id FROM projections WHERE baseline_id = $1 ORDER BY created_at ASC, id ASC;`
      : `SELECT id FROM projections ORDER BY created_at ASC, id ASC;`;
    const params = baselineId ? [baselineId] : [];
    const result = await executor.query<{ id: string }>(query, params);

    const projections: ProjectionRecord[] = [];
    for (const row of result.rows) {
      const p = await this.getProjectionRecord(row.id, executor);
      if (p) {
        projections.push(p);
      }
    }
    return Object.freeze(projections);
  }

  // --- STORIES ---

  async saveStory(story: StoryRecord, executor: ISqlDatabaseClient = this.activeDb): Promise<void> {
    assertSafeIdentifier(story.id, 'storyId');
    assertSafeIdentifier(story.baselineId, 'baselineId');

    try {
      await executor.query(
        `INSERT INTO stories (
           id, baseline_id, projection_id, title, narrative, requirement_revision_ids,
           policy_constraint_revision_ids, scenarios, acceptance_criteria, gherkin_text,
           metadata, created_at, dependencies, version
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1);`,
        [
          story.id,
          story.baselineId,
          story.projectionId,
          story.title,
          JSON.stringify(story.narrative),
          JSON.stringify(story.requirementRevisionIds),
          story.policyConstraintRevisionIds
            ? JSON.stringify(story.policyConstraintRevisionIds)
            : null,
          JSON.stringify(story.scenarios),
          JSON.stringify(story.acceptanceCriteria),
          story.gherkinText,
          JSON.stringify(story.metadata),
          story.createdAt,
          story.dependencies ? JSON.stringify(story.dependencies) : null
        ]
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ImmutableRecordConflictError(
          `stories/${story.id}`,
          `Story '${story.id}' already exists`
        );
      }
      throw err;
    }
  }

  async updateStory(
    story: StoryRecord,
    expectedVersion?: number,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<void> {
    assertSafeIdentifier(story.id, 'storyId');
    assertSafeIdentifier(story.baselineId, 'baselineId');

    const expVer = expectedVersion ?? story.version;
    const updateQuery =
      expVer !== undefined
        ? `UPDATE stories
           SET baseline_id = $1, projection_id = $2, title = $3, narrative = $4,
               requirement_revision_ids = $5, policy_constraint_revision_ids = $6,
               scenarios = $7, acceptance_criteria = $8, gherkin_text = $9,
               metadata = $10, dependencies = $11, version = version + 1, updated_at = NOW()
           WHERE id = $12 AND version = $13;`
        : `UPDATE stories
           SET baseline_id = $1, projection_id = $2, title = $3, narrative = $4,
               requirement_revision_ids = $5, policy_constraint_revision_ids = $6,
               scenarios = $7, acceptance_criteria = $8, gherkin_text = $9,
               metadata = $10, dependencies = $11, version = version + 1, updated_at = NOW()
           WHERE id = $12;`;

    const params: unknown[] = [
      story.baselineId,
      story.projectionId,
      story.title,
      JSON.stringify(story.narrative),
      JSON.stringify(story.requirementRevisionIds),
      story.policyConstraintRevisionIds ? JSON.stringify(story.policyConstraintRevisionIds) : null,
      JSON.stringify(story.scenarios),
      JSON.stringify(story.acceptanceCriteria),
      story.gherkinText,
      JSON.stringify(story.metadata),
      story.dependencies ? JSON.stringify(story.dependencies) : null,
      story.id
    ];
    if (expVer !== undefined) {
      params.push(expVer);
    }

    const res = await executor.query(updateQuery, params);
    if (res.rowCount === 0) {
      const existing = await this.getStory(story.id, executor);
      if (!existing) {
        throw new Error(`Story '${story.id}' not found`);
      }
      throw new OptimisticConcurrencyConflictError(
        `Concurrency conflict updating story '${story.id}': expected version ${expVer}`
      );
    }
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

    await this.activeDb.transaction(async (tx) => {
      const expProjVer = options?.expectedProjectionVersion ?? projection.version;
      const blobKey = `projections/${projection.id}.artifact`;
      await this.objectStore.putObject(blobKey, projection.content, {
        contentType: 'text/plain'
      });

      const projQuery =
        expProjVer !== undefined
          ? `UPDATE projections
             SET baseline_id = $1, requirement_revision_ids = $2, policy_constraint_revision_ids = $3,
                 engineering_decision_ids = $4, artifact_type = $5, content = $6, payload_ref = $7,
                 metadata = $8, version = version + 1
             WHERE id = $9 AND version = $10;`
          : `UPDATE projections
             SET baseline_id = $1, requirement_revision_ids = $2, policy_constraint_revision_ids = $3,
                 engineering_decision_ids = $4, artifact_type = $5, content = $6, payload_ref = $7,
                 metadata = $8, version = version + 1
             WHERE id = $9;`;

      const projParams: unknown[] = [
        projection.baselineId,
        JSON.stringify(projection.requirementRevisionIds),
        projection.policyConstraintRevisionIds
          ? JSON.stringify(projection.policyConstraintRevisionIds)
          : null,
        projection.engineeringDecisionIds
          ? JSON.stringify(projection.engineeringDecisionIds)
          : null,
        projection.artifactType,
        projection.content,
        blobKey,
        JSON.stringify(projection.metadata),
        projection.id
      ];
      if (expProjVer !== undefined) {
        projParams.push(expProjVer);
      }

      const projRes = await tx.query(projQuery, projParams);
      if (projRes.rowCount === 0) {
        const existingProj = await this.getProjectionRecord(projection.id, tx);
        if (!existingProj) {
          throw new Error(`Projection '${projection.id}' not found`);
        }
        throw new OptimisticConcurrencyConflictError(
          `Concurrency conflict updating projection '${projection.id}': expected version ${expProjVer}`
        );
      }

      const expStoryVer = options?.expectedStoryVersion ?? story.version;
      const storyQuery =
        expStoryVer !== undefined
          ? `UPDATE stories
             SET baseline_id = $1, projection_id = $2, title = $3, narrative = $4,
                 requirement_revision_ids = $5, policy_constraint_revision_ids = $6,
                 scenarios = $7, acceptance_criteria = $8, gherkin_text = $9,
                 metadata = $10, dependencies = $11, version = version + 1, updated_at = NOW()
             WHERE id = $12 AND version = $13;`
          : `UPDATE stories
             SET baseline_id = $1, projection_id = $2, title = $3, narrative = $4,
                 requirement_revision_ids = $5, policy_constraint_revision_ids = $6,
                 scenarios = $7, acceptance_criteria = $8, gherkin_text = $9,
                 metadata = $10, dependencies = $11, version = version + 1, updated_at = NOW()
             WHERE id = $12;`;

      const storyParams: unknown[] = [
        story.baselineId,
        story.projectionId,
        story.title,
        JSON.stringify(story.narrative),
        JSON.stringify(story.requirementRevisionIds),
        story.policyConstraintRevisionIds
          ? JSON.stringify(story.policyConstraintRevisionIds)
          : null,
        JSON.stringify(story.scenarios),
        JSON.stringify(story.acceptanceCriteria),
        story.gherkinText,
        JSON.stringify(story.metadata),
        story.dependencies ? JSON.stringify(story.dependencies) : null,
        story.id
      ];
      if (expStoryVer !== undefined) {
        storyParams.push(expStoryVer);
      }

      const storyRes = await tx.query(storyQuery, storyParams);
      if (storyRes.rowCount === 0) {
        const existingStory = await this.getStory(story.id, tx);
        if (!existingStory) {
          throw new Error(`Story '${story.id}' not found`);
        }
        throw new OptimisticConcurrencyConflictError(
          `Concurrency conflict updating story '${story.id}': expected version ${expStoryVer}`
        );
      }
    });
  }

  async getStory(
    id: StoryId,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<StoryRecord | undefined> {
    assertSafeIdentifier(id, 'storyId');
    const result = await executor.query<{
      id: string;
      baseline_id: string;
      projection_id: string;
      title: string;
      narrative: string | unknown;
      requirement_revision_ids: string | string[];
      policy_constraint_revision_ids?: string | string[] | null;
      scenarios: string | unknown[];
      acceptance_criteria: string | string[];
      gherkin_text: string;
      metadata: string | unknown;
      created_at: string | Date;
      dependencies?: string | string[] | null;
      version?: number | null;
    }>(`SELECT * FROM stories WHERE id = $1;`, [id]);

    if (result.rows.length === 0) {
      return undefined;
    }

    const row = result.rows[0];
    const narrative = typeof row.narrative === 'string' ? JSON.parse(row.narrative) : row.narrative;
    const rawReqs =
      typeof row.requirement_revision_ids === 'string'
        ? JSON.parse(row.requirement_revision_ids)
        : row.requirement_revision_ids;
    const rawPols = row.policy_constraint_revision_ids
      ? typeof row.policy_constraint_revision_ids === 'string'
        ? JSON.parse(row.policy_constraint_revision_ids)
        : row.policy_constraint_revision_ids
      : undefined;
    const rawScenarios =
      typeof row.scenarios === 'string' ? JSON.parse(row.scenarios) : row.scenarios;
    const rawCriteria =
      typeof row.acceptance_criteria === 'string'
        ? JSON.parse(row.acceptance_criteria)
        : row.acceptance_criteria;
    const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    const rawDeps = row.dependencies
      ? typeof row.dependencies === 'string'
        ? JSON.parse(row.dependencies)
        : row.dependencies
      : undefined;

    return Object.freeze({
      id: createStoryId(row.id),
      baselineId: createRequirementsBaselineId(row.baseline_id),
      projectionId: row.projection_id,
      title: row.title,
      narrative: Object.freeze(narrative),
      requirementRevisionIds: Object.freeze(
        (rawReqs as string[]).map((r) => createRequirementRevisionId(r))
      ),
      policyConstraintRevisionIds: rawPols
        ? Object.freeze((rawPols as string[]).map((p) => createPolicyConstraintRevisionId(p)))
        : undefined,
      scenarios: Object.freeze(
        ((rawScenarios ?? []) as GherkinScenario[]).map((s) =>
          Object.freeze({
            ...s,
            title: s.title ?? '',
            requirementRevisionIds: Object.freeze(
              (s.requirementRevisionIds ?? []).map((r: string) => createRequirementRevisionId(r))
            ),
            policyConstraintRevisionIds: s.policyConstraintRevisionIds
              ? Object.freeze(
                  s.policyConstraintRevisionIds.map((p: string) =>
                    createPolicyConstraintRevisionId(p)
                  )
                )
              : undefined,
            steps: Object.freeze((s.steps ?? []).map((st: GherkinStep) => Object.freeze(st)))
          })
        )
      ),
      acceptanceCriteria: Object.freeze(rawCriteria as string[]),
      gherkinText: row.gherkin_text,
      metadata: Object.freeze(metadata),
      version: row.version ?? 1,
      createdAt: createInstant(
        row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      ),
      dependencies: rawDeps
        ? Object.freeze((rawDeps as string[]).map((d) => createStoryId(d)))
        : undefined
    });
  }

  async listStories(
    baselineId?: RequirementsBaselineId,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly StoryRecord[]> {
    const query = baselineId
      ? `SELECT id FROM stories WHERE baseline_id = $1 ORDER BY created_at ASC, id ASC;`
      : `SELECT id FROM stories ORDER BY created_at ASC, id ASC;`;
    const params = baselineId ? [baselineId] : [];
    const result = await executor.query<{ id: string }>(query, params);

    const stories: StoryRecord[] = [];
    for (const row of result.rows) {
      const s = await this.getStory(createStoryId(row.id), executor);
      if (s) {
        stories.push(s);
      }
    }
    return Object.freeze(stories);
  }

  // --- DISTRIBUTED BASELINE MUTEX ---

  async withBaselineLock<T>(
    baselineId: RequirementsBaselineId,
    action: () => Promise<T>
  ): Promise<T> {
    assertSafeIdentifier(baselineId, 'baselineId');
    const lockKey = `baseline:${baselineId}`;

    const currentHeld = this.heldLocks.getStore();
    if (currentHeld?.has(lockKey)) {
      return action();
    }

    const nextHeld = new Set<string>(currentHeld);
    nextHeld.add(lockKey);

    return this.heldLocks.run(nextHeld, async () => {
      // Process-level serialization queue
      const currentLock = this.baselineLocks.get(lockKey) ?? Promise.resolve();
      let release: () => void;
      const nextLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      this.baselineLocks.set(lockKey, nextLock);

      try {
        await currentLock;
        return await this.db.withSession(async (sessionClient) => {
          return this.sessionContext.run(sessionClient, async () => {
            await sessionClient.query('SELECT pg_advisory_lock(hashtext($1));', [lockKey]);
            try {
              return await action();
            } finally {
              await sessionClient.query('SELECT pg_advisory_unlock(hashtext($1));', [lockKey]);
            }
          });
        });
      } finally {
        release!();
        if (this.baselineLocks.get(lockKey) === nextLock) {
          this.baselineLocks.delete(lockKey);
        }
      }
    });
  }

  async withBacklogExportLock<T>(
    key: { provider: string; externalContainer: string; storyId: StoryId | string },
    action: () => Promise<T>
  ): Promise<T> {
    const lockKey = `bmap:${key.provider}:${key.externalContainer}:${key.storyId}`;
    return this.db.withSession(async (sessionClient) => {
      return this.sessionContext.run(sessionClient, async () => {
        await sessionClient.query('SELECT pg_advisory_lock(hashtext($1));', [lockKey]);
        try {
          return await action();
        } finally {
          await sessionClient.query('SELECT pg_advisory_unlock(hashtext($1));', [lockKey]);
        }
      });
    });
  }

  // --- HEALTH CHECK ---

  // --- GOVERNANCE AUDIT & PROMOTION INTEGRITY ---

  async saveValidationRun(
    run: ValidationRunRecord,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<void> {
    assertSafeIdentifier(run.id, 'runId');
    assertSafeIdentifier(run.candidateSha, 'candidateSha');
    const validated = ValidationRunRecordDtoSchema.parse(run);

    try {
      await executor.query(
        `INSERT INTO validation_runs (
           id, candidate_sha, executed_at, executed_by, phase, execution_mode,
           provider, model, artifacts, evidence_digest, proposed_disposition,
           summary, payload_ref
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);`,
        [
          validated.id,
          validated.candidateSha,
          validated.executedAt,
          validated.executedBy,
          validated.phase,
          validated.executionMode,
          validated.provider,
          validated.model ?? null,
          JSON.stringify(validated.artifacts),
          validated.evidenceDigest,
          validated.proposedDisposition ?? null,
          JSON.stringify(validated.summary),
          validated.payloadRef ?? null
        ]
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ImmutableRecordConflictError(
          `validation-runs/${run.id}`,
          `Validation run '${run.id}' already exists`
        );
      }
      throw err;
    }
  }

  async getValidationRun(
    id: ValidationRunId | string,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<ValidationRunRecord | undefined> {
    assertSafeIdentifier(id, 'runId');
    const result = await executor.query<{
      id: string;
      candidate_sha: string;
      executed_at: string | Date;
      executed_by: string;
      phase: string;
      execution_mode: 'deterministic-ci' | 'real-provider';
      provider: string;
      model?: string | null;
      artifacts: string | unknown[];
      evidence_digest: string;
      proposed_disposition?: string | null;
      summary: string | Record<string, unknown>;
      payload_ref?: string | null;
    }>(`SELECT * FROM validation_runs WHERE id = $1;`, [id]);

    if (result.rows.length === 0) {
      return undefined;
    }

    const row = result.rows[0];
    const artifacts = typeof row.artifacts === 'string' ? JSON.parse(row.artifacts) : row.artifacts;
    const summary = typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary;

    return createValidationRunRecord({
      id: row.id,
      candidateSha: row.candidate_sha,
      executedAt: createInstant(
        row.executed_at instanceof Date ? row.executed_at.toISOString() : String(row.executed_at)
      ),
      executedBy: row.executed_by,
      phase: row.phase,
      executionMode: row.execution_mode,
      provider: row.provider,
      model: row.model ?? undefined,
      artifacts,
      evidenceDigest: row.evidence_digest,
      proposedDisposition: (row.proposed_disposition as 'GO' | 'DESIGN_CHANGE') ?? undefined,
      summary,
      payloadRef: row.payload_ref ?? undefined
    });
  }

  async listValidationRuns(
    filter?: { candidateSha?: string },
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly ValidationRunRecord[]> {
    let query = `SELECT * FROM validation_runs`;
    const params: unknown[] = [];
    if (filter?.candidateSha) {
      query += ` WHERE LOWER(candidate_sha) = LOWER($1)`;
      params.push(filter.candidateSha);
    }
    query += ` ORDER BY executed_at DESC, id DESC;`;

    const result = await executor.query<{
      id: string;
      candidate_sha: string;
      executed_at: string | Date;
      executed_by: string;
      phase: string;
      execution_mode: 'deterministic-ci' | 'real-provider';
      provider: string;
      model?: string | null;
      artifacts: string | unknown[];
      evidence_digest: string;
      proposed_disposition?: string | null;
      summary: string | Record<string, unknown>;
      payload_ref?: string | null;
    }>(query, params);

    const records: ValidationRunRecord[] = [];
    for (const row of result.rows) {
      const artifacts =
        typeof row.artifacts === 'string' ? JSON.parse(row.artifacts) : row.artifacts;
      const summary = typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary;

      records.push(
        createValidationRunRecord({
          id: row.id,
          candidateSha: row.candidate_sha,
          executedAt: createInstant(
            row.executed_at instanceof Date
              ? row.executed_at.toISOString()
              : String(row.executed_at)
          ),
          executedBy: row.executed_by,
          phase: row.phase,
          executionMode: row.execution_mode,
          provider: row.provider,
          model: row.model ?? undefined,
          artifacts,
          evidenceDigest: row.evidence_digest,
          proposedDisposition: (row.proposed_disposition as 'GO' | 'DESIGN_CHANGE') ?? undefined,
          summary,
          payloadRef: row.payload_ref ?? undefined
        })
      );
    }
    return Object.freeze(records);
  }

  async getLatestValidationRun(
    candidateSha: string,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<ValidationRunRecord | undefined> {
    const runs = await this.listValidationRuns({ candidateSha }, executor);
    return runs.length > 0 ? runs[0] : undefined;
  }

  async saveGovernanceApproval(
    approval: CandidateApprovalRecord,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<void> {
    assertSafeIdentifier(approval.id, 'approvalId');
    assertSafeIdentifier(approval.candidateSha, 'candidateSha');
    const validated = CandidateApprovalRecordDtoSchema.parse(approval);

    try {
      await executor.query(
        `INSERT INTO governance_approvals (
           id, candidate_sha, validation_run_id, evidence_digest, decision,
           actor_id, actor_name, actor_email, actor_type, decided_at,
           rationale, supersedes, status, revocation
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);`,
        [
          validated.id,
          validated.candidateSha,
          validated.validationRunId,
          validated.evidenceDigest,
          validated.decision,
          validated.actor.id,
          validated.actor.name,
          validated.actor.email ?? null,
          validated.actor.actorType,
          validated.decidedAt,
          validated.rationale,
          validated.supersedes ?? null,
          validated.status,
          validated.status === 'REVOKED' ? JSON.stringify(validated.revocation) : null
        ]
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const message = (err as { message?: string }).message ?? '';
        if (
          message.includes('idx_governance_approvals_active_candidate') ||
          message.includes('active_candidate')
        ) {
          throw new OptimisticConcurrencyConflictError(
            `Candidate '${approval.candidateSha}' already has an active governance approval. Concurrent active approvals are forbidden.`
          );
        }
        throw new ImmutableRecordConflictError(
          `governance-approvals/${approval.id}`,
          `Governance approval '${approval.id}' already exists`
        );
      }
      throw err;
    }
  }

  async replaceGovernanceApproval(
    newApproval: CandidateApprovalRecord,
    expectedActiveApprovalId?: string,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<void> {
    assertSafeIdentifier(newApproval.id, 'approvalId');
    assertSafeIdentifier(newApproval.candidateSha, 'candidateSha');

    return executor.transaction(async (tx) => {
      const activeResult = await tx.query<{ id: string }>(
        `SELECT id FROM governance_approvals WHERE LOWER(candidate_sha) = LOWER($1) AND status = 'ACTIVE' FOR UPDATE;`,
        [newApproval.candidateSha]
      );
      const activeExisting = activeResult.rows[0];

      if (expectedActiveApprovalId !== undefined) {
        if (!activeExisting || activeExisting.id !== expectedActiveApprovalId) {
          throw new OptimisticConcurrencyConflictError(
            `Governance approval replacement conflict for candidate '${newApproval.candidateSha}': expected active approval '${expectedActiveApprovalId}', but found '${activeExisting?.id ?? 'none'}'.`
          );
        }

        const updateResult = await tx.query(
          `UPDATE governance_approvals
           SET status = 'SUPERSEDED', updated_at = NOW()
           WHERE id = $1 AND status = 'ACTIVE';`,
          [expectedActiveApprovalId]
        );
        if (updateResult.rowCount === 0) {
          throw new OptimisticConcurrencyConflictError(
            `Governance approval replacement conflict: failed to supersede '${expectedActiveApprovalId}'.`
          );
        }
      } else {
        if (activeExisting) {
          throw new OptimisticConcurrencyConflictError(
            `Candidate '${newApproval.candidateSha}' already has an active governance approval '${activeExisting.id}'. Concurrent active approvals are forbidden.`
          );
        }
      }

      await this.saveGovernanceApproval(newApproval, tx);
    });
  }

  async getGovernanceApproval(
    id: GovernanceApprovalId | string,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<CandidateApprovalRecord | undefined> {
    assertSafeIdentifier(id, 'approvalId');
    const result = await executor.query<{
      id: string;
      candidate_sha: string;
      validation_run_id: string;
      evidence_digest: string;
      decision: 'GO' | 'DESIGN_CHANGE';
      actor_id: string;
      actor_name: string;
      actor_email?: string | null;
      actor_type: 'human';
      decided_at: string | Date;
      rationale: string;
      supersedes?: string | null;
      status: 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';
      revocation?:
        | string
        | {
            revokedAt: string;
            revokedBy: { id: string; name: string; email?: string; actorType: 'human' };
            rationale: string;
          }
        | null;
    }>(`SELECT * FROM governance_approvals WHERE id = $1;`, [id]);

    if (result.rows.length === 0) {
      return undefined;
    }

    const row = result.rows[0];
    const decidedAt = createInstant(
      row.decided_at instanceof Date ? row.decided_at.toISOString() : String(row.decided_at)
    );

    const activeRecord = createCandidateApprovalRecord({
      id: row.id,
      candidateSha: row.candidate_sha,
      validationRunId: row.validation_run_id,
      evidenceDigest: row.evidence_digest,
      decision: row.decision,
      actor: {
        id: createActorId(row.actor_id),
        name: row.actor_name,
        email: row.actor_email ?? undefined,
        actorType: 'human'
      },
      decidedAt,
      rationale: row.rationale,
      supersedes: row.supersedes ?? undefined
    });

    if (row.status === 'REVOKED') {
      const revocation =
        typeof row.revocation === 'string' ? JSON.parse(row.revocation) : row.revocation!;
      return revokeCandidateApprovalRecord(
        activeRecord,
        {
          id: createActorId(revocation.revokedBy.id),
          name: revocation.revokedBy.name,
          email: revocation.revokedBy.email,
          actorType: 'human'
        },
        revocation.rationale,
        createInstant(revocation.revokedAt)
      );
    } else if (row.status === 'SUPERSEDED') {
      return supersedeCandidateApprovalRecord(activeRecord);
    } else {
      return activeRecord;
    }
  }

  async listGovernanceApprovals(
    filter?: { candidateSha?: string; validationRunId?: string },
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly CandidateApprovalRecord[]> {
    let query = `SELECT * FROM governance_approvals WHERE 1=1`;
    const params: unknown[] = [];
    if (filter?.candidateSha) {
      params.push(filter.candidateSha);
      query += ` AND LOWER(candidate_sha) = LOWER($${params.length})`;
    }
    if (filter?.validationRunId) {
      params.push(filter.validationRunId);
      query += ` AND validation_run_id = $${params.length}`;
    }
    query += ` ORDER BY decided_at DESC;`;

    const result = await executor.query<{ id: string }>(query, params);
    const records: CandidateApprovalRecord[] = [];
    for (const row of result.rows) {
      const approval = await this.getGovernanceApproval(row.id, executor);
      if (approval) {
        records.push(approval);
      }
    }
    return Object.freeze(records);
  }

  async getActiveGovernanceApproval(
    candidateSha: string,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<CandidateApprovalRecord | undefined> {
    const result = await executor.query<{ id: string }>(
      `SELECT id FROM governance_approvals WHERE LOWER(candidate_sha) = LOWER($1) AND status = 'ACTIVE' LIMIT 1;`,
      [candidateSha]
    );
    if (result.rows.length === 0) {
      return undefined;
    }
    return this.getGovernanceApproval(result.rows[0].id, executor);
  }

  async updateGovernanceApproval(
    approval: CandidateApprovalRecord,
    expectedCurrentStatus?: GovernanceApprovalStatus,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<void> {
    assertSafeIdentifier(approval.id, 'approvalId');
    const revocationJson =
      approval.status === 'REVOKED' ? JSON.stringify(approval.revocation) : null;

    const result = await executor.query(
      `UPDATE governance_approvals
       SET status = $1, revocation = $2, updated_at = NOW()
       WHERE id = $3 AND ($4::text IS NULL OR status = $4);`,
      [approval.status, revocationJson, approval.id, expectedCurrentStatus ?? null]
    );

    if (result.rowCount === 0) {
      const existing = await executor.query<{ status: string }>(
        `SELECT status FROM governance_approvals WHERE id = $1;`,
        [approval.id]
      );
      if (existing.rows.length === 0) {
        throw new UnknownGovernanceApprovalError(approval.id);
      }
      throw new OptimisticConcurrencyConflictError(
        `Governance approval '${approval.id}' status conflict: expected '${expectedCurrentStatus}', but found '${existing.rows[0].status}'.`
      );
    }
  }

  async saveBacklogExportMapping(
    mapping: BacklogExportMapping,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<void> {
    assertSafeIdentifier(mapping.id, 'mappingId');
    assertSafeIdentifier(mapping.storyId, 'storyId');
    assertSafeIdentifier(mapping.baselineId, 'baselineId');

    await executor.query(
      `INSERT INTO backlog_export_mappings (
         id, story_id, baseline_id, provider, external_container,
         external_work_item_id, external_url, export_content_hash,
         exported_at, exported_by, metadata, export_version, story_version,
         requirement_revision_ids, policy_constraint_revision_ids, history,
         export_content_hash_version, prerequisite_export_versions,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW());`,
      [
        mapping.id,
        mapping.storyId,
        mapping.baselineId,
        mapping.provider,
        mapping.externalContainer,
        mapping.externalWorkItemId,
        mapping.externalUrl ?? null,
        mapping.exportContentHash,
        mapping.exportedAt,
        mapping.exportedBy,
        JSON.stringify(mapping.metadata ?? {}),
        mapping.exportVersion ?? 1,
        mapping.storyVersion ?? 1,
        JSON.stringify(mapping.requirementRevisionIds ?? []),
        mapping.policyConstraintRevisionIds
          ? JSON.stringify(mapping.policyConstraintRevisionIds)
          : null,
        JSON.stringify(mapping.history ?? []),
        mapping.exportContentHashVersion ?? 1,
        JSON.stringify(mapping.prerequisiteExportVersions ?? {})
      ]
    );
  }

  async getBacklogExportMapping(
    id: BacklogExportMappingId | string,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<BacklogExportMapping | undefined> {
    assertSafeIdentifier(id, 'mappingId');
    const result = await executor.query<{
      id: string;
      story_id: string;
      baseline_id: string;
      provider: string;
      external_container: string;
      external_work_item_id: string;
      external_url: string | null;
      export_content_hash: string;
      exported_at: string | Date;
      exported_by: string;
      metadata: Record<string, unknown>;
      export_version?: number;
      story_version?: number;
      requirement_revision_ids?: string[];
      policy_constraint_revision_ids?: string[] | null;
      history?: BacklogExportHistoryEntry[];
      export_content_hash_version?: number;
      prerequisite_export_versions?: Record<string, number> | null;
    }>(
      `SELECT id, story_id, baseline_id, provider, external_container,
              external_work_item_id, external_url, export_content_hash,
              exported_at, exported_by, metadata, export_version, story_version,
              requirement_revision_ids, policy_constraint_revision_ids, history,
              export_content_hash_version, prerequisite_export_versions
       FROM backlog_export_mappings WHERE id = $1;`,
      [id]
    );
    if (result.rows.length === 0) {
      return undefined;
    }
    const row = result.rows[0];
    return createBacklogExportMapping({
      id: row.id,
      storyId: row.story_id,
      storyVersion: row.story_version ?? 1,
      exportVersion: row.export_version ?? 1,
      baselineId: row.baseline_id,
      requirementRevisionIds: Array.isArray(row.requirement_revision_ids)
        ? row.requirement_revision_ids
        : [],
      policyConstraintRevisionIds: Array.isArray(row.policy_constraint_revision_ids)
        ? row.policy_constraint_revision_ids
        : undefined,
      provider: row.provider,
      externalContainer: row.external_container,
      externalWorkItemId: row.external_work_item_id,
      externalUrl: row.external_url ?? undefined,
      exportContentHash: row.export_content_hash,
      exportedAt:
        row.exported_at instanceof Date ? row.exported_at.toISOString() : String(row.exported_at),
      exportedBy: row.exported_by,
      metadata: typeof row.metadata === 'object' && row.metadata !== null ? row.metadata : {},
      history: Array.isArray(row.history) ? row.history : undefined,
      exportContentHashVersion: row.export_content_hash_version ?? 1,
      prerequisiteExportVersions:
        row.prerequisite_export_versions &&
        typeof row.prerequisite_export_versions === 'object' &&
        Object.keys(row.prerequisite_export_versions).length > 0
          ? (row.prerequisite_export_versions as Record<string, number>)
          : undefined
    });
  }

  async findBacklogExportMapping(
    filter: {
      provider: string;
      externalContainer: string;
      storyId: StoryId | string;
    },
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<BacklogExportMapping | undefined> {
    assertSafeIdentifier(filter.storyId, 'storyId');
    const result = await executor.query<{
      id: string;
      story_id: string;
      baseline_id: string;
      provider: string;
      external_container: string;
      external_work_item_id: string;
      external_url: string | null;
      export_content_hash: string;
      exported_at: string | Date;
      exported_by: string;
      metadata: Record<string, unknown>;
      export_version?: number;
      story_version?: number;
      requirement_revision_ids?: string[];
      policy_constraint_revision_ids?: string[] | null;
      history?: BacklogExportHistoryEntry[];
      export_content_hash_version?: number;
      prerequisite_export_versions?: Record<string, number> | null;
    }>(
      `SELECT id, story_id, baseline_id, provider, external_container,
              external_work_item_id, external_url, export_content_hash,
              exported_at, exported_by, metadata, export_version, story_version,
              requirement_revision_ids, policy_constraint_revision_ids, history,
              export_content_hash_version, prerequisite_export_versions
       FROM backlog_export_mappings
       WHERE provider = $1 AND external_container = $2 AND story_id = $3;`,
      [filter.provider, filter.externalContainer, filter.storyId]
    );
    if (result.rows.length === 0) {
      return undefined;
    }
    const row = result.rows[0];
    return createBacklogExportMapping({
      id: row.id,
      storyId: row.story_id,
      storyVersion: row.story_version ?? 1,
      exportVersion: row.export_version ?? 1,
      baselineId: row.baseline_id,
      requirementRevisionIds: Array.isArray(row.requirement_revision_ids)
        ? row.requirement_revision_ids
        : [],
      policyConstraintRevisionIds: Array.isArray(row.policy_constraint_revision_ids)
        ? row.policy_constraint_revision_ids
        : undefined,
      provider: row.provider,
      externalContainer: row.external_container,
      externalWorkItemId: row.external_work_item_id,
      externalUrl: row.external_url ?? undefined,
      exportContentHash: row.export_content_hash,
      exportedAt:
        row.exported_at instanceof Date ? row.exported_at.toISOString() : String(row.exported_at),
      exportedBy: row.exported_by,
      metadata: typeof row.metadata === 'object' && row.metadata !== null ? row.metadata : {},
      history: Array.isArray(row.history) ? row.history : undefined,
      exportContentHashVersion: row.export_content_hash_version ?? 1,
      prerequisiteExportVersions:
        row.prerequisite_export_versions &&
        typeof row.prerequisite_export_versions === 'object' &&
        Object.keys(row.prerequisite_export_versions).length > 0
          ? (row.prerequisite_export_versions as Record<string, number>)
          : undefined
    });
  }

  async listBacklogExportMappings(
    filter?: {
      baselineId?: RequirementsBaselineId | string;
      storyId?: StoryId | string;
      provider?: string;
      externalContainer?: string;
    },
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly BacklogExportMapping[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter?.baselineId) {
      conditions.push(`baseline_id = $${idx++}`);
      params.push(filter.baselineId);
    }
    if (filter?.storyId) {
      conditions.push(`story_id = $${idx++}`);
      params.push(filter.storyId);
    }
    if (filter?.provider) {
      conditions.push(`provider = $${idx++}`);
      params.push(filter.provider);
    }
    if (filter?.externalContainer) {
      conditions.push(`external_container = $${idx++}`);
      params.push(filter.externalContainer);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await executor.query<{
      id: string;
      story_id: string;
      baseline_id: string;
      provider: string;
      external_container: string;
      external_work_item_id: string;
      external_url: string | null;
      export_content_hash: string;
      exported_at: string | Date;
      exported_by: string;
      metadata: Record<string, unknown>;
      export_version?: number;
      story_version?: number;
      requirement_revision_ids?: string[];
      policy_constraint_revision_ids?: string[] | null;
      history?: BacklogExportHistoryEntry[];
      export_content_hash_version?: number;
      prerequisite_export_versions?: Record<string, number> | null;
    }>(
      `SELECT id, story_id, baseline_id, provider, external_container,
              external_work_item_id, external_url, export_content_hash,
              exported_at, exported_by, metadata, export_version, story_version,
              requirement_revision_ids, policy_constraint_revision_ids, history,
              export_content_hash_version, prerequisite_export_versions
       FROM backlog_export_mappings
       ${whereClause}
       ORDER BY exported_at ASC, id ASC;`,
      params
    );

    return Object.freeze(
      result.rows.map((row) =>
        createBacklogExportMapping({
          id: row.id,
          storyId: row.story_id,
          storyVersion: row.story_version ?? 1,
          exportVersion: row.export_version ?? 1,
          baselineId: row.baseline_id,
          requirementRevisionIds: Array.isArray(row.requirement_revision_ids)
            ? row.requirement_revision_ids
            : [],
          policyConstraintRevisionIds: Array.isArray(row.policy_constraint_revision_ids)
            ? row.policy_constraint_revision_ids
            : undefined,
          provider: row.provider,
          externalContainer: row.external_container,
          externalWorkItemId: row.external_work_item_id,
          externalUrl: row.external_url ?? undefined,
          exportContentHash: row.export_content_hash,
          exportedAt:
            row.exported_at instanceof Date
              ? row.exported_at.toISOString()
              : String(row.exported_at),
          exportedBy: row.exported_by,
          metadata: typeof row.metadata === 'object' && row.metadata !== null ? row.metadata : {},
          history: Array.isArray(row.history) ? row.history : undefined,
          exportContentHashVersion: row.export_content_hash_version ?? 1,
          prerequisiteExportVersions:
            row.prerequisite_export_versions &&
            typeof row.prerequisite_export_versions === 'object' &&
            Object.keys(row.prerequisite_export_versions).length > 0
              ? (row.prerequisite_export_versions as Record<string, number>)
              : undefined
        })
      )
    );
  }

  async updateBacklogExportMapping(
    mapping: BacklogExportMapping,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<void> {
    assertSafeIdentifier(mapping.id, 'mappingId');
    assertSafeIdentifier(mapping.storyId, 'storyId');
    assertSafeIdentifier(mapping.baselineId, 'baselineId');

    await executor.transaction(async (tx) => {
      if (mapping.history && mapping.history.length > 0) {
        const snapshot = mapping.history[mapping.history.length - 1];
        const existing = await tx.query<{ export_content_hash: string }>(
          `SELECT export_content_hash FROM backlog_export_history WHERE mapping_id = $1 AND export_version = $2;`,
          [mapping.id, snapshot.exportVersion]
        );

        if (existing.rows.length > 0) {
          if (existing.rows[0].export_content_hash !== snapshot.exportContentHash) {
            throw new Error(
              `Immutable backlog export history conflict: mapping '${mapping.id}' export version ${snapshot.exportVersion} already recorded with different content hash`
            );
          }
        } else {
          await tx.query(
            `INSERT INTO backlog_export_history (
               id, mapping_id, export_version, baseline_id, story_id,
               story_version, requirement_revision_ids, policy_constraint_revision_ids,
               export_content_hash, exported_at, exported_by, external_work_item_id,
               external_url, update_rationale, export_content_hash_version,
               prerequisite_export_versions, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW());`,
            [
              `${mapping.id}-v${snapshot.exportVersion}`,
              mapping.id,
              snapshot.exportVersion,
              snapshot.baselineId,
              mapping.storyId,
              snapshot.storyVersion,
              JSON.stringify(snapshot.requirementRevisionIds ?? []),
              snapshot.policyConstraintRevisionIds
                ? JSON.stringify(snapshot.policyConstraintRevisionIds)
                : null,
              snapshot.exportContentHash,
              snapshot.exportedAt,
              snapshot.exportedBy,
              snapshot.externalWorkItemId,
              snapshot.externalUrl ?? null,
              snapshot.updateRationale ?? null,
              snapshot.exportContentHashVersion ?? 1,
              JSON.stringify(snapshot.prerequisiteExportVersions ?? {})
            ]
          );
        }
      }

      const result = await tx.query(
        `UPDATE backlog_export_mappings
         SET baseline_id = $1,
             external_work_item_id = $2,
             external_url = $3,
             export_content_hash = $4,
             exported_at = $5,
             exported_by = $6,
             metadata = $7,
             export_version = $8,
             story_version = $9,
             requirement_revision_ids = $10,
             policy_constraint_revision_ids = $11,
             history = $12,
             export_content_hash_version = $13,
             prerequisite_export_versions = $14,
             updated_at = NOW()
         WHERE id = $15;`,
        [
          mapping.baselineId,
          mapping.externalWorkItemId,
          mapping.externalUrl ?? null,
          mapping.exportContentHash,
          mapping.exportedAt,
          mapping.exportedBy,
          JSON.stringify(mapping.metadata ?? {}),
          mapping.exportVersion ?? 1,
          mapping.storyVersion ?? 1,
          JSON.stringify(mapping.requirementRevisionIds ?? []),
          mapping.policyConstraintRevisionIds
            ? JSON.stringify(mapping.policyConstraintRevisionIds)
            : null,
          JSON.stringify(mapping.history ?? []),
          mapping.exportContentHashVersion ?? 1,
          JSON.stringify(mapping.prerequisiteExportVersions ?? {}),
          mapping.id
        ]
      );
      if (result.rowCount === 0) {
        throw new Error(`Backlog export mapping '${mapping.id}' not found`);
      }
    });
  }

  async listBacklogExportHistory(
    mappingId: BacklogExportMappingId | string,
    executor: ISqlDatabaseClient = this.activeDb
  ): Promise<readonly BacklogExportHistoryEntry[]> {
    assertSafeIdentifier(mappingId, 'mappingId');
    const result = await executor.query<{
      export_version: number;
      baseline_id: string;
      story_version: number;
      requirement_revision_ids: unknown;
      policy_constraint_revision_ids: unknown;
      export_content_hash: string;
      exported_at: string | Date;
      exported_by: string;
      external_work_item_id: string;
      external_url: string | null;
      update_rationale: string | null;
      export_content_hash_version?: number;
      prerequisite_export_versions?: Record<string, number> | null;
    }>(
      `SELECT export_version, baseline_id, story_version,
              requirement_revision_ids, policy_constraint_revision_ids,
              export_content_hash, exported_at, exported_by,
              external_work_item_id, external_url, update_rationale,
              export_content_hash_version, prerequisite_export_versions
       FROM backlog_export_history
       WHERE mapping_id = $1
       ORDER BY export_version ASC;`,
      [mappingId]
    );

    if (result.rows.length === 0) {
      const mapping = await this.getBacklogExportMapping(mappingId, executor);
      return mapping?.history ?? Object.freeze([]);
    }

    return Object.freeze(
      result.rows.map((row) => {
        const reqRevs = Array.isArray(row.requirement_revision_ids)
          ? row.requirement_revision_ids.map((r) => createRequirementRevisionId(String(r)))
          : [];
        const polRevs = Array.isArray(row.policy_constraint_revision_ids)
          ? row.policy_constraint_revision_ids.map((p) =>
              createPolicyConstraintRevisionId(String(p))
            )
          : undefined;

        return {
          exportVersion: row.export_version,
          baselineId: createRequirementsBaselineId(row.baseline_id),
          storyVersion: row.story_version,
          requirementRevisionIds: Object.freeze(reqRevs),
          policyConstraintRevisionIds: polRevs ? Object.freeze(polRevs) : undefined,
          exportContentHash: row.export_content_hash,
          exportContentHashVersion: row.export_content_hash_version ?? 1,
          prerequisiteExportVersions:
            row.prerequisite_export_versions &&
            typeof row.prerequisite_export_versions === 'object' &&
            Object.keys(row.prerequisite_export_versions).length > 0
              ? Object.freeze({ ...row.prerequisite_export_versions })
              : undefined,
          exportedAt:
            row.exported_at instanceof Date
              ? createInstant(row.exported_at.toISOString())
              : createInstant(String(row.exported_at)),
          exportedBy: createActorId(row.exported_by),
          externalWorkItemId: row.external_work_item_id,
          externalUrl: row.external_url ?? undefined,
          updateRationale: row.update_rationale ?? undefined
        };
      })
    );
  }

  async checkStorageHealth(): Promise<StorageHealthReport> {
    return this.checkHealth();
  }

  async checkHealth(): Promise<StorageHealthReport> {
    const timestamp = new Date().toISOString();
    const dbStart = Date.now();
    let dbStatus: 'healthy' | 'unhealthy' = 'healthy';
    let dbMessage: string | undefined = undefined;
    let currentMigration = 0;
    let latestAvailableMigration = 0;

    try {
      await this.db.query('SELECT 1;');

      const runner = new SchemaMigrationRunner({ db: this.db });
      const available = await runner.loadAvailableMigrations();
      latestAvailableMigration = available.length > 0 ? available[available.length - 1].version : 0;

      const tableCheck = await this.db
        .query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT FROM information_schema.tables 
             WHERE table_schema = 'public' AND table_name = 'schema_migrations'
           );`
        )
        .catch(() => ({ rows: [] }));

      const tableExists = tableCheck.rows.length > 0 && tableCheck.rows[0].exists;
      if (!tableExists) {
        dbStatus = 'unhealthy';
        dbMessage = 'schema_migrations table does not exist or database is unmigrated';
      } else {
        const migStatus = await runner.status();
        currentMigration = migStatus.currentVersion;
        if (migStatus.pendingCount > 0 || currentMigration < latestAvailableMigration) {
          dbStatus = 'unhealthy';
          dbMessage = `Pending migrations detected: ${migStatus.pendingCount} pending (current: ${currentMigration}, latest: ${latestAvailableMigration})`;
        }
      }
    } catch (err) {
      dbStatus = 'unhealthy';
      dbMessage = err instanceof Error ? err.message : String(err);
    }
    const dbLatencyMs = Date.now() - dbStart;

    let objHealth: { status: 'healthy' | 'unhealthy'; latencyMs: number; message?: string };
    try {
      objHealth = await this.objectStore.checkHealth();
    } catch (err) {
      objHealth = {
        status: 'unhealthy',
        latencyMs: 0,
        message: err instanceof Error ? err.message : String(err)
      };
    }
    const overallHealthy = dbStatus === 'healthy' && objHealth.status === 'healthy';

    return {
      status: overallHealthy ? 'healthy' : 'unhealthy',
      timestamp,
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
        message: dbMessage,
        details: {
          dialect: 'postgresql',
          currentMigration,
          latestAvailableMigration
        }
      },
      objectStore: {
        status: objHealth.status,
        latencyMs: objHealth.latencyMs,
        message: objHealth.message
      }
    };
  }
}
