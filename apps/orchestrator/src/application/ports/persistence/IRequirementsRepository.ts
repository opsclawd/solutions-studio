import type {
  SourceId,
  SourceRevisionId,
  RequirementId,
  RequirementRevisionId,
  FindingId,
  RequirementsBaselineId,
  ActorId,
  Instant,
  EvidenceLocator,
  SourceRevision,
  RequirementRevision,
  CandidateFinding,
  RequirementsBaseline,
  SourceType,
  FindingDisposition,
  RequirementReviewState,
  RequirementResolutionState,
  RequirementReconciliationAction
} from '@solutions-studio/domain';
import type {
  ProjectionMetadataDto,
  EvaluationFixtureResultDto,
  EvaluationReportDto
} from '@solutions-studio/contracts';

export interface LocatorIndexEntry {
  readonly locator: EvidenceLocator;
  readonly headingPath: string;
  readonly blockLabel: string;
  readonly blockLabelSource: 'explicit-section' | 'sequential-ordinal';
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface SourceRevisionRecord {
  readonly sourceType: SourceType | undefined;
  readonly revision: SourceRevision;
  readonly rawText: string;
  readonly locatorIndex: readonly LocatorIndexEntry[];
}

export interface CaptureSourceRevisionInput {
  readonly sourceId: SourceId;
  readonly sourceType: SourceType;
  readonly markdownText: string;
  readonly capturedAt?: Instant;
  readonly actorId?: ActorId;
}

export interface FindingReconciliationRecord {
  readonly id: string;
  readonly entityType: 'finding';
  readonly entityId: FindingId;
  readonly previousDisposition: FindingDisposition;
  readonly newDisposition: FindingDisposition;
  readonly rationale: string;
  readonly actorId?: ActorId;
  readonly recordedAt: Instant;
}

export interface RequirementReconciliationRecord {
  readonly id: string;
  readonly entityType: 'requirement';
  readonly entityId: RequirementId;
  /** The specific revision this decision produced or acted on. */
  readonly requirementRevisionId: RequirementRevisionId;
  readonly action: RequirementReconciliationAction;
  readonly previousReviewState: RequirementReviewState | undefined;
  readonly newReviewState: RequirementReviewState;
  readonly previousResolutionState?: RequirementResolutionState;
  readonly newResolutionState?: RequirementResolutionState;
  readonly rationale: string;
  readonly actorId?: ActorId;
  readonly recordedAt: Instant;
}

export type ReconciliationRecord = FindingReconciliationRecord | RequirementReconciliationRecord;

export type EvaluationRunFixtureResult = EvaluationFixtureResultDto;

export interface EvaluationRunRecord {
  readonly id: string;
  readonly corpusVersion: string;
  readonly executedAt: Instant;
  readonly fixtureResults: readonly EvaluationRunFixtureResult[];
  readonly report: EvaluationReportDto;
}

export interface ProjectionRecord {
  readonly id: string;
  readonly baselineId: RequirementsBaselineId;
  readonly requirementRevisionIds: readonly RequirementRevisionId[];
  readonly artifactType: string;
  readonly content: string;
  readonly metadata: ProjectionMetadataDto;
  readonly createdAt: Instant;
}

export class ImmutableRecordConflictError extends Error {
  constructor(
    public readonly recordPath: string,
    message?: string
  ) {
    super(message ?? `Immutable record conflict at ${recordPath}`);
    this.name = 'ImmutableRecordConflictError';
  }
}

export interface IRequirementsRepository {
  captureSourceRevision(input: CaptureSourceRevisionInput): Promise<SourceRevisionRecord>;
  getSourceRevision(id: SourceRevisionId): Promise<SourceRevisionRecord | undefined>;
  listSourceRevisions(sourceId: SourceId): Promise<readonly SourceRevision[]>;
  getLatestSourceRevision(sourceId: SourceId): Promise<SourceRevisionRecord | undefined>;
  resolveLocator(
    sourceRevisionId: SourceRevisionId,
    locator: EvidenceLocator | string
  ): Promise<LocatorIndexEntry | undefined>;
  saveRequirementRevision(revision: RequirementRevision): Promise<void>;
  getRequirementRevision(id: RequirementRevisionId): Promise<RequirementRevision | undefined>;
  listRequirementRevisions(requirementId: RequirementId): Promise<readonly RequirementRevision[]>;
  transitionRequirementRevision(
    successor: RequirementRevision,
    record: RequirementReconciliationRecord,
    expectedCurrentRevisionId?: RequirementRevisionId
  ): Promise<void>;
  saveCandidateFinding(finding: CandidateFinding): Promise<void>;
  getCandidateFinding(id: FindingId): Promise<CandidateFinding | undefined>;
  listCandidateFindings(): Promise<readonly CandidateFinding[]>;
  transitionCandidateFinding(
    finding: CandidateFinding,
    record: FindingReconciliationRecord,
    expectedCurrentDisposition?: FindingDisposition
  ): Promise<void>;
  appendReconciliationRecord(record: ReconciliationRecord): Promise<void>;
  listReconciliationRecords(
    entityType: 'finding',
    entityId: FindingId
  ): Promise<readonly FindingReconciliationRecord[]>;
  listReconciliationRecords(
    entityType: 'requirement',
    entityId: RequirementId
  ): Promise<readonly RequirementReconciliationRecord[]>;
  listReconciliationRecords(
    entityType: 'finding' | 'requirement',
    entityId: FindingId | RequirementId
  ): Promise<readonly ReconciliationRecord[]>;
  listAllReconciliationRecords(): Promise<readonly ReconciliationRecord[]>;
  saveRequirementsBaseline(
    baseline: RequirementsBaseline,
    expectedLatestRevisionIds?: readonly RequirementRevisionId[]
  ): Promise<void>;
  saveRequirementsBaselineConditional(
    baseline: RequirementsBaseline,
    expectedLatestRevisionIds: readonly RequirementRevisionId[]
  ): Promise<void>;
  getRequirementsBaseline(id: RequirementsBaselineId): Promise<RequirementsBaseline | undefined>;
  saveEvaluationRun(run: EvaluationRunRecord): Promise<void>;
  getEvaluationRun(id: string): Promise<EvaluationRunRecord | undefined>;
  listEvaluationRuns(): Promise<readonly EvaluationRunRecord[]>;
  saveProjectionRecord(projection: ProjectionRecord): Promise<void>;
  getProjectionRecord(id: string): Promise<ProjectionRecord | undefined>;
  listProjectionRecords(baselineId?: RequirementsBaselineId): Promise<readonly ProjectionRecord[]>;
}
