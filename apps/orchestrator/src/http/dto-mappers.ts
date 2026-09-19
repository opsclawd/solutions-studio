import type {
  RequirementRevision,
  CandidateFinding,
  RequirementsBaseline,
  PolicyConstraintRevision,
  EngineeringDecision,
  AuthorityBundle,
  StoryReadinessReport,
  BaselineRequirementCoverage,
  StoryDependencyGraph
} from '@solutions-studio/domain';
import type {
  RequirementRevisionDto,
  CandidateFindingDto,
  RequirementsBaselineDto,
  ReconciliationRecordDto,
  ProjectionRecordDto,
  EvidenceExcerptDto,
  RequirementsReviewStateDto,
  PolicyConstraintRevisionDto,
  EngineeringDecisionDto,
  AuthorityBundleDto,
  StoryDto,
  StoryReadinessReportDto,
  BaselineRequirementCoverageDto,
  StoryDependencyGraphDto,
  EngineeringHandoffBundleDto
} from '@solutions-studio/contracts';
import type {
  ReconciliationRecord,
  ProjectionRecord,
  StoryRecord
} from '../application/ports/persistence/IRequirementsRepository.js';
import type { EngineeringHandoffBundle } from '../application/use-cases/GetEngineeringHandoffBundleUseCase.js';

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
    actorId: revision.actorId,
    baselineId: revision.baselineId,
    originatingProjectionId: revision.originatingProjectionId,
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
    rationale: finding.rationale,
    actorId: finding.actorId,
    baselineId: finding.baselineId,
    originatingProjectionId: finding.originatingProjectionId
  };
}

export function mapRequirementsBaselineToDto(
  baseline: RequirementsBaseline
): RequirementsBaselineDto {
  return {
    id: baseline.id,
    requirementRevisions: [...baseline.requirementRevisions],
    ...(baseline.policyConstraintRevisions && baseline.policyConstraintRevisions.length > 0
      ? { policyConstraintRevisions: [...baseline.policyConstraintRevisions] }
      : {}),
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
    policyConstraintRevisionIds: record.policyConstraintRevisionIds
      ? [...record.policyConstraintRevisionIds]
      : undefined,
    engineeringDecisionIds: record.engineeringDecisionIds
      ? [...record.engineeringDecisionIds]
      : undefined,
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
    projections: state.projections.map(mapProjectionRecordToDto),
    revisionLineage: state.revisionLineage.map((entry) => ({
      revisionId: entry.revisionId,
      requirementId: entry.requirementId
    })),
    availableBaselines: state.availableBaselines ? [...state.availableBaselines] : undefined
  };
}

export function mapPolicyConstraintRevisionToDto(
  revision: PolicyConstraintRevision
): PolicyConstraintRevisionDto {
  return {
    id: revision.id,
    policyConstraintId: revision.policyConstraintId,
    revision: revision.revision,
    statement: revision.statement,
    authorityReference: revision.authorityReference,
    state: revision.state,
    createdAt: revision.createdAt,
    createdBy: revision.createdBy,
    supersedes: revision.supersedes
  };
}

export function mapEngineeringDecisionToDto(decision: EngineeringDecision): EngineeringDecisionDto {
  return {
    id: decision.id,
    baselineId: decision.baselineId,
    statement: decision.statement,
    rationale: decision.rationale,
    requirementRevisionIds: [...decision.requirementRevisionIds],
    policyConstraintRevisionIds: [...decision.policyConstraintRevisionIds],
    state: decision.state,
    createdAt: decision.createdAt,
    createdBy: decision.createdBy,
    acceptedBy: decision.acceptedBy,
    acceptedAt: decision.acceptedAt,
    supersedes: decision.supersedes,
    transitionRationale: decision.transitionRationale
  };
}

export function mapAuthorityBundleToDto(bundle: AuthorityBundle): AuthorityBundleDto {
  return {
    baseline: mapRequirementsBaselineToDto(bundle.baseline),
    requirements: bundle.requirements.map(mapRequirementRevisionToDto),
    policyConstraints: bundle.policyConstraints.map(mapPolicyConstraintRevisionToDto)
  };
}

export function mapStoryRecordToDto(record: StoryRecord): StoryDto {
  return {
    id: record.id,
    baselineId: record.baselineId,
    projectionId: record.projectionId,
    title: record.title,
    narrative: {
      role: record.narrative.role,
      feature: record.narrative.feature,
      benefit: record.narrative.benefit,
      rawText: record.narrative.rawText
    },
    requirementRevisionIds: [...record.requirementRevisionIds],
    policyConstraintRevisionIds: record.policyConstraintRevisionIds
      ? [...record.policyConstraintRevisionIds]
      : undefined,
    scenarios: record.scenarios.map((s) => ({
      id: s.id,
      title: s.title,
      requirementRevisionIds: [...s.requirementRevisionIds],
      policyConstraintRevisionIds: s.policyConstraintRevisionIds
        ? [...s.policyConstraintRevisionIds]
        : undefined,
      steps: s.steps.map((st) => ({
        keyword: st.keyword,
        text: st.text
      })),
      rawText: s.rawText
    })),
    acceptanceCriteria: [...record.acceptanceCriteria],
    gherkinText: record.gherkinText,
    dependencies: record.dependencies ? [...record.dependencies] : [],
    metadata: record.metadata,
    createdAt: record.createdAt
  };
}

export function mapStoryReadinessReportToDto(
  report: StoryReadinessReport
): StoryReadinessReportDto {
  return {
    storyId: report.storyId,
    baselineId: report.baselineId,
    status: report.status,
    isReady: report.isReady,
    evaluatedAt: report.evaluatedAt,
    failures: report.failures.map((f) => ({
      ruleId: f.ruleId,
      message: f.message,
      affectedIds: [...f.affectedIds],
      ...(f.details !== undefined ? { details: f.details } : {})
    })),
    passedRules: [...report.passedRules],
    ...(report.policy !== undefined
      ? {
          policy: {
            requireSqlProjection: report.policy.requireSqlProjection,
            requireOpenApiProjection: report.policy.requireOpenApiProjection,
            allowDeferredEngineeringDecisions: report.policy.allowDeferredEngineeringDecisions,
            blockingFindingTypes: report.policy.blockingFindingTypes
              ? [...report.policy.blockingFindingTypes]
              : undefined
          }
        }
      : {})
  };
}

export function mapBaselineRequirementCoverageToDto(
  coverage: BaselineRequirementCoverage
): BaselineRequirementCoverageDto {
  return {
    baselineId: coverage.baselineId,
    totalRequirements: coverage.totalRequirements,
    coveredCount: coverage.coveredCount,
    uncoveredCount: coverage.uncoveredCount,
    multiCoveredCount: coverage.multiCoveredCount,
    coveredRequirements: coverage.coveredRequirements.map((c) => ({
      requirementRevisionId: c.requirementRevisionId,
      coveringStoryIds: [...c.coveringStoryIds],
      coverageCount: c.coverageCount
    })),
    uncoveredRequirementRevisionIds: [...coverage.uncoveredRequirementRevisionIds],
    multiCoveredRequirements: coverage.multiCoveredRequirements.map((c) => ({
      requirementRevisionId: c.requirementRevisionId,
      coveringStoryIds: [...c.coveringStoryIds],
      coverageCount: c.coverageCount
    })),
    isFullyCovered: coverage.isFullyCovered,
    computedAt: coverage.computedAt
  };
}

export function mapStoryDependencyGraphToDto(graph: StoryDependencyGraph): StoryDependencyGraphDto {
  return {
    baselineId: graph.baselineId,
    nodes: graph.nodes.map((n) => ({
      storyId: n.storyId,
      title: n.title,
      requirementRevisionIds: [...n.requirementRevisionIds],
      dependencies: [...n.dependencies],
      dependents: [...n.dependents],
      readinessStatus: n.readinessStatus,
      isReady: n.isReady
    })),
    edges: graph.edges.map((e) => ({
      from: e.from,
      to: e.to
    })),
    executionOrder: [...graph.executionOrder],
    isAcyclic: graph.isAcyclic,
    hasCycles: graph.hasCycles,
    cycles: graph.cycles.map((c) => [...c]),
    validation: {
      isValid: graph.validation.isValid,
      errors: [...graph.validation.errors],
      missingNodeIds: [...graph.validation.missingNodeIds],
      selfDependencies: [...graph.validation.selfDependencies],
      cycles: graph.validation.cycles.map((c) => [...c])
    },
    createdAt: graph.createdAt
  };
}

export function mapEngineeringHandoffBundleToDto(
  bundle: EngineeringHandoffBundle
): EngineeringHandoffBundleDto {
  return {
    baseline: mapRequirementsBaselineToDto(bundle.baseline),
    authorityBundle: mapAuthorityBundleToDto(bundle.authorityBundle),
    engineeringDecisions: bundle.engineeringDecisions.map(mapEngineeringDecisionToDto),
    sqlProjection: bundle.sqlProjection
      ? mapProjectionRecordToDto(bundle.sqlProjection)
      : undefined,
    openApiProjection: bundle.openApiProjection
      ? mapProjectionRecordToDto(bundle.openApiProjection)
      : undefined,
    stories: bundle.stories.map(mapStoryRecordToDto),
    readinessReports: bundle.readinessReports.map(mapStoryReadinessReportToDto),
    coverage: mapBaselineRequirementCoverageToDto(bundle.coverage),
    dependencyGraph: mapStoryDependencyGraphToDto(bundle.dependencyGraph),
    blockingFindings: bundle.blockingFindings.map(mapCandidateFindingToDto),
    unresolvedRequirements: bundle.unresolvedRequirements.map(mapRequirementRevisionToDto),
    summary: { ...bundle.summary }
  };
}
