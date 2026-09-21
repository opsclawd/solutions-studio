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
  PolicyConstraintId,
  PolicyConstraintRevisionId,
  EngineeringDecisionId,
  PolicyConstraintRevision,
  EngineeringDecision,
  EngineeringDecisionState,
  SourceType,
  FindingDisposition,
  RequirementReviewState,
  RequirementResolutionState,
  RequirementReconciliationAction,
  StoryId,
  StoryNarrative,
  GherkinScenario,
  ValidationRunRecord,
  ValidationRunId,
  CandidateApprovalRecord,
  GovernanceApprovalId,
  GovernanceApprovalStatus,
  BacklogExportMapping,
  BacklogExportMappingId,
  BacklogExportHistoryEntry
} from '@solutions-studio/domain';
import type {
  ProjectionMetadataDto,
  EvaluationFixtureResultDto,
  EvaluationReportDto
} from '@solutions-studio/contracts';
import type { StorageHealthReport } from './IStorageHealthCheck.js';

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
  readonly policyConstraintRevisionIds?: readonly PolicyConstraintRevisionId[];
  readonly engineeringDecisionIds?: readonly EngineeringDecisionId[];
  readonly artifactType: string;
  readonly content: string;
  readonly metadata: ProjectionMetadataDto;
  readonly createdAt: Instant;
  readonly version?: number;
}

export interface StoryRecord {
  readonly id: StoryId;
  readonly baselineId: RequirementsBaselineId;
  readonly projectionId: string;
  readonly title: string;
  readonly narrative: StoryNarrative;
  readonly requirementRevisionIds: readonly RequirementRevisionId[];
  readonly policyConstraintRevisionIds?: readonly PolicyConstraintRevisionId[];
  readonly scenarios: readonly GherkinScenario[];
  readonly acceptanceCriteria: readonly string[];
  readonly gherkinText: string;
  readonly metadata: ProjectionMetadataDto;
  readonly createdAt: Instant;
  readonly dependencies?: readonly StoryId[];
  readonly version?: number;
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
  listRequirementIds(): Promise<readonly RequirementId[]>;
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
    expectedLatestRevisionIds: readonly RequirementRevisionId[],
    expectedLatestPolicyConstraintRevisionIds?: readonly PolicyConstraintRevisionId[]
  ): Promise<void>;
  getRequirementsBaseline(id: RequirementsBaselineId): Promise<RequirementsBaseline | undefined>;
  listRequirementsBaselines(): Promise<readonly RequirementsBaseline[]>;
  savePolicyConstraintRevision(revision: PolicyConstraintRevision): Promise<void>;
  getPolicyConstraintRevision(
    id: PolicyConstraintRevisionId
  ): Promise<PolicyConstraintRevision | undefined>;
  listPolicyConstraintRevisions(
    policyConstraintId: PolicyConstraintId
  ): Promise<readonly PolicyConstraintRevision[]>;
  listPolicyConstraintIds(): Promise<readonly PolicyConstraintId[]>;
  saveEngineeringDecision(decision: EngineeringDecision): Promise<void>;
  getEngineeringDecision(id: EngineeringDecisionId): Promise<EngineeringDecision | undefined>;
  listEngineeringDecisions(filter?: {
    baselineId?: RequirementsBaselineId;
    state?: EngineeringDecisionState;
  }): Promise<readonly EngineeringDecision[]>;
  updateEngineeringDecision(
    decision: EngineeringDecision,
    expectedCurrentState?: EngineeringDecisionState
  ): Promise<void>;
  saveEvaluationRun(run: EvaluationRunRecord): Promise<void>;
  getEvaluationRun(id: string): Promise<EvaluationRunRecord | undefined>;
  listEvaluationRuns(): Promise<readonly EvaluationRunRecord[]>;
  saveProjectionRecord(projection: ProjectionRecord): Promise<void>;
  updateProjectionRecord(projection: ProjectionRecord, expectedVersion?: number): Promise<void>;
  getProjectionRecord(id: string): Promise<ProjectionRecord | undefined>;
  listProjectionRecords(baselineId?: RequirementsBaselineId): Promise<readonly ProjectionRecord[]>;
  saveStory(story: StoryRecord): Promise<void>;
  updateStory(story: StoryRecord, expectedVersion?: number): Promise<void>;
  updateStoryAndProjection(
    story: StoryRecord,
    projection: ProjectionRecord,
    options?: { expectedStoryVersion?: number; expectedProjectionVersion?: number }
  ): Promise<void>;
  getStory(id: StoryId): Promise<StoryRecord | undefined>;
  listStories(baselineId?: RequirementsBaselineId): Promise<readonly StoryRecord[]>;
  withBaselineLock<T>(baselineId: RequirementsBaselineId, action: () => Promise<T>): Promise<T>;
  saveValidationRun(run: ValidationRunRecord): Promise<void>;
  getValidationRun(id: ValidationRunId | string): Promise<ValidationRunRecord | undefined>;
  listValidationRuns(filter?: { candidateSha?: string }): Promise<readonly ValidationRunRecord[]>;
  getLatestValidationRun(candidateSha: string): Promise<ValidationRunRecord | undefined>;
  saveGovernanceApproval(approval: CandidateApprovalRecord): Promise<void>;
  getGovernanceApproval(
    id: GovernanceApprovalId | string
  ): Promise<CandidateApprovalRecord | undefined>;
  listGovernanceApprovals(filter?: {
    candidateSha?: string;
    validationRunId?: string;
  }): Promise<readonly CandidateApprovalRecord[]>;
  getActiveGovernanceApproval(candidateSha: string): Promise<CandidateApprovalRecord | undefined>;
  updateGovernanceApproval(
    approval: CandidateApprovalRecord,
    expectedCurrentStatus?: GovernanceApprovalStatus
  ): Promise<void>;
  replaceGovernanceApproval(
    newApproval: CandidateApprovalRecord,
    expectedActiveApprovalId?: string
  ): Promise<void>;
  saveBacklogExportMapping(mapping: BacklogExportMapping): Promise<void>;
  getBacklogExportMapping(
    id: BacklogExportMappingId | string
  ): Promise<BacklogExportMapping | undefined>;
  findBacklogExportMapping(filter: {
    provider: string;
    externalContainer: string;
    storyId: StoryId | string;
  }): Promise<BacklogExportMapping | undefined>;
  listBacklogExportMappings(filter?: {
    baselineId?: RequirementsBaselineId | string;
    storyId?: StoryId | string;
    provider?: string;
    externalContainer?: string;
  }): Promise<readonly BacklogExportMapping[]>;
  updateBacklogExportMapping(mapping: BacklogExportMapping): Promise<void>;
  listBacklogExportHistory?(
    mappingId: BacklogExportMappingId | string
  ): Promise<readonly BacklogExportHistoryEntry[]>;
  withBacklogExportLock?<T>(
    key: { provider: string; externalContainer: string; storyId: StoryId | string },
    action: () => Promise<T>
  ): Promise<T>;
  checkStorageHealth?(): Promise<StorageHealthReport>;
  checkHealth?(): Promise<StorageHealthReport>;
}
