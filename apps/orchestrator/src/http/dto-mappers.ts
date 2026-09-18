import type {
  RequirementRevision,
  CandidateFinding,
  RequirementsBaseline
} from '@solutions-studio/domain';
import type {
  RequirementRevisionDto,
  CandidateFindingDto,
  RequirementsBaselineDto,
  ReconciliationRecordDto,
  ProjectionRecordDto,
  EvidenceExcerptDto,
  RequirementsReviewStateDto
} from '@solutions-studio/contracts';
import type {
  ReconciliationRecord,
  ProjectionRecord
} from '../application/ports/persistence/IRequirementsRepository.js';
import type {
  EvidenceExcerpt,
  RequirementsReviewState
} from '../application/use-cases/GetRequirementsReviewStateUseCase.js';

export function mapRequirementRevisionToDto(revision: RequirementRevision): RequirementRevisionDto {
  return {
    id: revision.id,
    requirementId: revision.requirementId,
    revision: revision.revision,
    statement: revision.statement,
    category: revision.category,
    origin: revision.origin,
    reviewState: revision.reviewState,
    resolutionState: revision.resolutionState,
    evidence: revision.evidence.map((e) => ({
      sourceRevisionId: e.sourceRevisionId,
      locator: e.locator
    })),
    rationale: revision.rationale,
    affectedActors: revision.affectedActors ? [...revision.affectedActors] : undefined,
    dependencies: revision.dependencies ? [...revision.dependencies] : undefined,
    supersedes: revision.supersedes
  };
}

export function mapCandidateFindingToDto(finding: CandidateFinding): CandidateFindingDto {
  return {
    id: finding.id,
    type: finding.type,
    affectedRequirementRevisions: [...finding.affectedRequirementRevisions],
    evidence: finding.evidence.map((e) => ({
      sourceRevisionId: e.sourceRevisionId,
      locator: e.locator
    })),
    discoveredBy: finding.discoveredBy,
    disposition: finding.disposition,
    rationale: finding.rationale
  };
}

export function mapRequirementsBaselineToDto(
  baseline: RequirementsBaseline
): RequirementsBaselineDto {
  return {
    id: baseline.id,
    requirementRevisions: [...baseline.requirementRevisions],
    createdAt: baseline.createdAt,
    createdBy: baseline.createdBy
  };
}

export function mapReconciliationRecordToDto(
  record: ReconciliationRecord
): ReconciliationRecordDto {
  if (record.entityType === 'requirement') {
    return {
      id: record.id,
      entityType: 'requirement',
      entityId: record.entityId,
      requirementRevisionId: record.requirementRevisionId,
      action: record.action,
      previousReviewState: record.previousReviewState,
      newReviewState: record.newReviewState,
      previousResolutionState: record.previousResolutionState,
      newResolutionState: record.newResolutionState,
      rationale: record.rationale,
      actorId: record.actorId,
      recordedAt: record.recordedAt
    };
  }

  return {
    id: record.id,
    entityType: 'finding',
    entityId: record.entityId,
    previousDisposition: record.previousDisposition,
    newDisposition: record.newDisposition,
    rationale: record.rationale,
    actorId: record.actorId,
    recordedAt: record.recordedAt
  };
}

export function mapProjectionRecordToDto(record: ProjectionRecord): ProjectionRecordDto {
  return {
    id: record.id,
    baselineId: record.baselineId,
    requirementRevisionIds: [...record.requirementRevisionIds],
    artifactType: record.artifactType,
    content: record.content,
    metadata: record.metadata,
    createdAt: record.createdAt
  };
}

export function mapEvidenceExcerptToDto(excerpt: EvidenceExcerpt): EvidenceExcerptDto {
  return {
    sourceRevisionId: excerpt.sourceRevisionId,
    locator: excerpt.locator,
    headingPath: excerpt.headingPath,
    blockLabel: excerpt.blockLabel,
    blockLabelSource: excerpt.blockLabelSource,
    text: excerpt.text,
    startLine: excerpt.startLine,
    endLine: excerpt.endLine
  };
}

export function mapReviewStateToDto(state: RequirementsReviewState): RequirementsReviewStateDto {
  return {
    baseline: state.baseline ? mapRequirementsBaselineToDto(state.baseline) : undefined,
    requirementRevisions: state.requirementRevisions.map(mapRequirementRevisionToDto),
    findings: state.findings.map(mapCandidateFindingToDto),
    reconciliationHistory: state.reconciliationHistory.map(mapReconciliationRecordToDto),
    evidenceExcerpts: state.evidenceExcerpts.map(mapEvidenceExcerptToDto),
    projections: state.projections.map(mapProjectionRecordToDto)
  };
}
