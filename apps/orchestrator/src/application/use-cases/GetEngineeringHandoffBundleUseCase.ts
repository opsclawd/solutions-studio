import { createHash } from 'node:crypto';
import {
  createRequirementsBaselineId,
  type RequirementsBaseline,
  type AuthorityBundle,
  type EngineeringDecision,
  type StoryReadinessReport,
  type BaselineRequirementCoverage,
  type StoryDependencyGraph,
  type CandidateFinding,
  type RequirementRevision,
  type BacklogExportMapping
} from '@solutions-studio/domain';
import type { BaselineExportStalenessReportDto } from '@solutions-studio/contracts';
import type {
  IRequirementsRepository,
  ProjectionRecord,
  StoryRecord
} from '../ports/persistence/IRequirementsRepository.js';
import type { GetAuthorityBundleUseCase } from './GetAuthorityBundleUseCase.js';
import type { EvaluateStoryReadinessUseCase } from './EvaluateStoryReadinessUseCase.js';
import type { ComputeRequirementCoverageUseCase } from './ComputeRequirementCoverageUseCase.js';
import type { BuildStoryDependencyGraphUseCase } from './BuildStoryDependencyGraphUseCase.js';
import type { EvaluateExportStalenessUseCase } from './EvaluateExportStalenessUseCase.js';
import { UnknownRequirementsBaselineError } from './ReconciliationErrors.js';

export interface EngineeringHandoffSummary {
  readonly totalStories: number;
  readonly readyStories: number;
  readonly nonReadyStories: number;
  readonly totalRequirements: number;
  readonly coveredRequirements: number;
  readonly openBlockingFindings: number;
  readonly isHandoffReady: boolean;
}

export interface EngineeringHandoffBundle {
  readonly baseline: RequirementsBaseline;
  readonly authorityBundle: AuthorityBundle;
  readonly engineeringDecisions: readonly EngineeringDecision[];
  readonly sqlProjection: ProjectionRecord | undefined;
  readonly openApiProjection: ProjectionRecord | undefined;
  readonly stories: readonly StoryRecord[];
  readonly readinessReports: readonly StoryReadinessReport[];
  readonly coverage: BaselineRequirementCoverage;
  readonly dependencyGraph: StoryDependencyGraph;
  readonly blockingFindings: readonly CandidateFinding[];
  readonly unresolvedRequirements: readonly RequirementRevision[];
  readonly summary: EngineeringHandoffSummary;
  readonly exportMappings?: readonly BacklogExportMapping[];
  readonly stalenessSummary?: BaselineExportStalenessReportDto;
}

export interface GetEngineeringHandoffBundleInput {
  readonly baselineId: string;
}

export class GetEngineeringHandoffBundleUseCase {
  constructor(
    private readonly repository: IRequirementsRepository,
    private readonly getAuthorityBundleUseCase: GetAuthorityBundleUseCase,
    private readonly evaluateStoryReadinessUseCase: EvaluateStoryReadinessUseCase,
    private readonly computeRequirementCoverageUseCase: ComputeRequirementCoverageUseCase,
    private readonly buildStoryDependencyGraphUseCase: BuildStoryDependencyGraphUseCase,
    private readonly evaluateExportStalenessUseCase?: EvaluateExportStalenessUseCase
  ) {}

  async execute(input: GetEngineeringHandoffBundleInput): Promise<EngineeringHandoffBundle> {
    const baselineId = createRequirementsBaselineId(input.baselineId);

    // Build the handoff bundle from a single baseline-locked snapshot
    return this.repository.withBaselineLock(baselineId, async () => {
      const baseline = await this.repository.getRequirementsBaseline(baselineId);
      if (!baseline) {
        throw new UnknownRequirementsBaselineError(input.baselineId);
      }

      // 1. Authority Bundle (baseline, requirements, policy constraints)
      const authorityBundle = await this.getAuthorityBundleUseCase.execute({
        baselineId: input.baselineId
      });

      // 2. Engineering Decisions
      const engineeringDecisions = await this.repository.listEngineeringDecisions({
        baselineId
      });

      // 3. Latest Projections (optional on fresh baselines)
      const projections = await this.repository.listProjectionRecords(baselineId);

      const sqlProjections = projections
        .filter((p) => p.artifactType === 'sql-schema')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const sqlProjection = sqlProjections.length > 0 ? sqlProjections[0] : undefined;

      const openApiProjections = projections
        .filter((p) => p.artifactType === 'openapi')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const openApiProjection = openApiProjections.length > 0 ? openApiProjections[0] : undefined;

      // 4. Stories
      const stories = await this.repository.listStories(baselineId);

      // 5. Story Readiness Reports (evaluated once from this snapshot)
      const readinessReports = await this.evaluateStoryReadinessUseCase.executeForBaseline(
        input.baselineId
      );

      // 6. Requirement Coverage
      const coverage = await this.computeRequirementCoverageUseCase.execute({
        baselineId: input.baselineId
      });

      // 7. Story Dependency Graph (constructed using snapshot stories and readiness reports)
      const dependencyGraph = await this.buildStoryDependencyGraphUseCase.execute({
        baselineId: input.baselineId,
        includeReadiness: true,
        stories,
        readinessReports
      });

      // 8. Blocking Open Findings affecting baseline requirements
      const baselineReqSet = new Set<string>(baseline.requirementRevisions);
      const allFindings = await this.repository.listCandidateFindings();
      const blockingFindings = allFindings.filter((finding) => {
        if (finding.disposition !== 'OPEN') {
          return false;
        }
        if (finding.baselineId === baseline.id) {
          return true;
        }
        return finding.affectedRequirementRevisions.some((r) => baselineReqSet.has(r));
      });

      // 9. Unresolved Requirements
      const unresolvedRequirements = authorityBundle.requirements.filter(
        (r) => r.reviewState !== 'ACCEPTED' || r.resolutionState !== 'CLEAR'
      );

      // 10. Cryptographic verification & Lineage integrity validation
      const isSqlVerified = sqlProjection
        ? Boolean(sqlProjection.metadata?.measuredVerification?.contentHash) &&
          createHash('sha256').update(sqlProjection.content).digest('hex') ===
            sqlProjection.metadata.measuredVerification.contentHash
        : true;

      const isOpenApiVerified = openApiProjection
        ? Boolean(openApiProjection.metadata?.measuredVerification?.contentHash) &&
          createHash('sha256').update(openApiProjection.content).digest('hex') ===
            openApiProjection.metadata.measuredVerification.contentHash
        : true;

      const areStoriesVerified =
        stories.length > 0 &&
        stories.every((story) => {
          const expectedHash = createHash('sha256').update(story.gherkinText).digest('hex');
          if (story.metadata?.measuredVerification?.contentHash !== expectedHash) {
            return false;
          }
          if (!story.projectionId) {
            return false;
          }
          const linkedProj = projections.find((p) => p.id === story.projectionId);
          if (!linkedProj) {
            return false;
          }
          if (
            linkedProj.baselineId !== story.baselineId ||
            linkedProj.artifactType !== 'stories' ||
            linkedProj.content !== story.gherkinText
          ) {
            return false;
          }
          const projHash = createHash('sha256').update(linkedProj.content).digest('hex');
          return linkedProj.metadata?.measuredVerification?.contentHash === projHash;
        });

      // 11. Summary & Closed-form Deterministic isHandoffReady Predicate
      const totalStories = stories.length;
      const readyStories = readinessReports.filter((r) => r.isReady).length;
      const nonReadyStories = totalStories - readyStories;
      const totalRequirements = baseline.requirementRevisions.length;
      const coveredRequirements = coverage.coveredCount;
      const openBlockingFindings = blockingFindings.length;

      const isHandoffReady =
        totalStories > 0 &&
        readyStories === totalStories &&
        coverage.isFullyCovered &&
        dependencyGraph.isAcyclic &&
        dependencyGraph.validation.isValid &&
        openBlockingFindings === 0 &&
        unresolvedRequirements.length === 0 &&
        isSqlVerified &&
        isOpenApiVerified &&
        areStoriesVerified;

      const summary: EngineeringHandoffSummary = Object.freeze({
        totalStories,
        readyStories,
        nonReadyStories,
        totalRequirements,
        coveredRequirements,
        openBlockingFindings,
        isHandoffReady
      });

      const exportMappings =
        (await this.repository.listBacklogExportMappings?.({
          baselineId
        })) ?? [];

      let stalenessSummary: BaselineExportStalenessReportDto | undefined = undefined;
      if (this.evaluateExportStalenessUseCase) {
        stalenessSummary = await this.evaluateExportStalenessUseCase.execute({
          baselineId: input.baselineId
        });
      }

      return Object.freeze({
        baseline,
        authorityBundle,
        engineeringDecisions,
        sqlProjection,
        openApiProjection,
        stories,
        readinessReports,
        coverage,
        dependencyGraph,
        blockingFindings,
        unresolvedRequirements,
        summary,
        exportMappings,
        stalenessSummary
      });
    });
  }
}
