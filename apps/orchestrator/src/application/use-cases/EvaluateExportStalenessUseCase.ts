import {
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createPolicyConstraintRevisionId,
  evaluateExportStaleness,
  type AuthenticatedActor,
  type Story,
  type BacklogExportMapping,
  type RequirementRevision,
  type PolicyConstraintRevision,
  type AdvisorySemanticImpactResult
} from '@solutions-studio/domain';
import type { BaselineExportStalenessReportDto } from '@solutions-studio/contracts';
import type { IRequirementsRepository } from '../ports/persistence/IRequirementsRepository.js';
import type { IAuthorizationPolicy } from '../ports/identity/IAuthorizationPolicy.js';
import type { GetAuthorityBundleUseCase } from './GetAuthorityBundleUseCase.js';
import type { BuildStoryDependencyGraphUseCase } from './BuildStoryDependencyGraphUseCase.js';
import type { ISemanticImpactAdvisor } from '../ports/backlog/ISemanticImpactAdvisor.js';
import { UnknownRequirementsBaselineError } from './ReconciliationErrors.js';
import { mapStoryRecordToDomainStory } from './storyMappers.js';
import {
  computeStoryContentHash,
  matchesStoryContentHash
} from '../ports/backlog/computeStoryContentHash.js';
import { type ITelemetryRegistry, TelemetryProvider } from '../ports/observability/index.js';

export interface EvaluateExportStalenessInput {
  readonly baselineId: string;
  readonly provider?: string;
  readonly targetContainer?: string;
  readonly storyIds?: readonly string[];
  readonly actor?: AuthenticatedActor;
}

export class EvaluateExportStalenessUseCase {
  constructor(
    private readonly repository: IRequirementsRepository,
    private readonly getAuthorityBundleUseCase: GetAuthorityBundleUseCase,
    private readonly buildStoryDependencyGraphUseCase: BuildStoryDependencyGraphUseCase,
    private readonly authorizer?: IAuthorizationPolicy,
    private readonly semanticImpactAdvisor?: ISemanticImpactAdvisor,
    private readonly telemetryRegistry: ITelemetryRegistry = TelemetryProvider.default
  ) {}

  async execute(input: EvaluateExportStalenessInput): Promise<BaselineExportStalenessReportDto> {
    if (input.actor && this.authorizer) {
      this.authorizer.authorize(input.actor, 'backlog:export');
    }

    const baselineId = createRequirementsBaselineId(input.baselineId);

    return this.repository.withBaselineLock(baselineId, async () => {
      const baseline = await this.repository.getRequirementsBaseline(baselineId);
      if (!baseline) {
        throw new UnknownRequirementsBaselineError(input.baselineId);
      }

      const authorityBundle = await this.getAuthorityBundleUseCase.execute({
        baselineId: input.baselineId
      });

      const engineeringDecisions = await this.repository.listEngineeringDecisions({
        baselineId
      });
      const engineeringDecisionIds = engineeringDecisions.map((d) => d.id);

      const activeRequirementMap = new Map<string, string>();
      for (const req of authorityBundle.requirements) {
        activeRequirementMap.set(req.requirementId, req.id);
      }

      const activePolicyConstraintMap = new Map<string, string>();
      for (const pol of authorityBundle.policyConstraints) {
        activePolicyConstraintMap.set(pol.policyConstraintId, pol.id);
      }

      const storyRecords = await this.repository.listStories(baselineId);
      const allStories: Story[] = storyRecords.map(mapStoryRecordToDomainStory);

      const mappings = await this.repository.listBacklogExportMappings({
        provider: input.provider,
        externalContainer: input.targetContainer
      });

      const relevantMappings = mappings.filter((m) => {
        if (input.provider && m.provider !== input.provider) return false;
        if (input.targetContainer && m.externalContainer !== input.targetContainer) return false;
        return true;
      });

      const reqRevisionCache = new Map<string, RequirementRevision>();
      for (const req of authorityBundle.requirements) {
        reqRevisionCache.set(req.id, req);
      }
      for (const m of relevantMappings) {
        for (const revId of m.requirementRevisionIds ?? []) {
          if (!reqRevisionCache.has(revId)) {
            const fetched = await this.repository.getRequirementRevision(
              createRequirementRevisionId(revId)
            );
            if (fetched) {
              reqRevisionCache.set(revId, fetched);
            }
          }
        }
      }

      const polRevisionCache = new Map<string, PolicyConstraintRevision>();
      for (const pol of authorityBundle.policyConstraints) {
        polRevisionCache.set(pol.id, pol);
      }
      for (const m of relevantMappings) {
        for (const revId of m.policyConstraintRevisionIds ?? []) {
          if (!polRevisionCache.has(revId)) {
            const fetched = await this.repository.getPolicyConstraintRevision(
              createPolicyConstraintRevisionId(revId)
            );
            if (fetched) {
              polRevisionCache.set(revId, fetched);
            }
          }
        }
      }

      const dependencyGraph = await this.buildStoryDependencyGraphUseCase.execute({
        baselineId: input.baselineId,
        stories: storyRecords
      });

      const mappingByStoryId = new Map<string, BacklogExportMapping>();
      for (const m of relevantMappings) {
        mappingByStoryId.set(m.storyId, m);
      }

      const lookupRequirementRevision = (revId: string) => {
        const r = reqRevisionCache.get(revId);
        if (!r) return undefined;
        return {
          requirementId: r.requirementId,
          revision: r.revision,
          supersedes: r.supersedes
        };
      };

      const lookupPolicyConstraintRevision = (revId: string) => {
        const p = polRevisionCache.get(revId);
        if (!p) return undefined;
        return {
          policyConstraintId: p.policyConstraintId,
          revision: p.revision
        };
      };

      const computeStoryHash = (story: Story): string => {
        const prerequisites = (story.dependencies ?? []).map((depId) => {
          const depMapping = mappingByStoryId.get(depId);
          const depStory = allStories.find((s) => s.id === depId);
          return {
            storyId: depId,
            externalWorkItemId: depMapping?.externalWorkItemId,
            title: depStory?.title
          };
        });
        return computeStoryContentHash({
          story,
          prerequisites
        });
      };

      const matchesStoryHash = (mapping: BacklogExportMapping, story: Story): boolean => {
        const prerequisites = (story.dependencies ?? []).map((depId) => {
          const depMapping = mappingByStoryId.get(depId);
          const depStory = allStories.find((s) => s.id === depId);
          return {
            storyId: depId,
            externalWorkItemId: depMapping?.externalWorkItemId,
            title: depStory?.title
          };
        });
        return matchesStoryContentHash({
          mappingHash: mapping.exportContentHash,
          mappingHashVersion: mapping.exportContentHashVersion,
          currentStory: story,
          mappingBaselineId: mapping.baselineId,
          currentBaselineId: baseline.id,
          engineeringDecisionIds,
          prerequisites
        });
      };

      const advisorySemanticImpacts = new Map<string, AdvisorySemanticImpactResult>();
      if (this.semanticImpactAdvisor) {
        for (const story of allStories) {
          try {
            const impact = await this.semanticImpactAdvisor.analyzeImpact(story, baseline);
            advisorySemanticImpacts.set(story.id, impact);
          } catch {
            // Advisory impact analysis is non-blocking
          }
        }
      }

      const report = evaluateExportStaleness({
        baseline,
        stories: allStories,
        mappings: relevantMappings,
        dependencyGraph,
        activeRequirementMap,
        activePolicyConstraintMap,
        lookupRequirementRevision,
        lookupPolicyConstraintRevision,
        computeStoryHash,
        matchesStoryHash,
        advisorySemanticImpacts,
        targetStoryIds: input.storyIds
      });

      this.telemetryRegistry.setGauge(
        'solutions_studio_export_staleness_count',
        report.currentCount,
        { classification: 'CURRENT' }
      );
      this.telemetryRegistry.setGauge(
        'solutions_studio_export_staleness_count',
        report.staleCount,
        { classification: 'STALE' }
      );
      this.telemetryRegistry.setGauge(
        'solutions_studio_export_staleness_count',
        report.impactedCount,
        { classification: 'IMPACTED' }
      );
      this.telemetryRegistry.setGauge(
        'solutions_studio_export_staleness_count',
        report.unexportedCount,
        { classification: 'UNEXPORTED' }
      );

      return {
        baselineId: report.baselineId,
        totalStories: report.totalStories,
        currentCount: report.currentCount,
        staleCount: report.staleCount,
        impactedCount: report.impactedCount,
        unexportedCount: report.unexportedCount,
        stories: report.stories.map((s) => ({
          storyId: s.storyId,
          classification: s.classification,
          causes: s.causes.map((c) => ({
            category: c.category,
            message: c.message,
            entityId: c.entityId,
            exportedRevision: c.exportedRevision,
            currentRevision: c.currentRevision
          })),
          exportedLineage: s.exportedLineage
            ? {
                baselineId: s.exportedLineage.baselineId,
                storyVersion: s.exportedLineage.storyVersion,
                exportVersion: s.exportedLineage.exportVersion,
                exportContentHash: s.exportedLineage.exportContentHash,
                exportContentHashVersion: s.exportedLineage.exportContentHashVersion ?? 1,
                prerequisiteExportVersions: s.exportedLineage.prerequisiteExportVersions
                  ? { ...s.exportedLineage.prerequisiteExportVersions }
                  : undefined,
                exportedAt: s.exportedLineage.exportedAt,
                externalWorkItemId: s.exportedLineage.externalWorkItemId,
                externalUrl: s.exportedLineage.externalUrl
              }
            : undefined,
          impactedByPrerequisiteStoryIds: [...s.impactedByPrerequisiteStoryIds],
          currentContentHash: s.currentContentHash,
          history: s.history
            ? s.history.map((h) => ({
                exportVersion: h.exportVersion,
                baselineId: h.baselineId,
                storyVersion: h.storyVersion,
                requirementRevisionIds: [...h.requirementRevisionIds],
                policyConstraintRevisionIds: h.policyConstraintRevisionIds
                  ? [...h.policyConstraintRevisionIds]
                  : undefined,
                exportContentHash: h.exportContentHash,
                exportContentHashVersion: h.exportContentHashVersion ?? 1,
                prerequisiteExportVersions: h.prerequisiteExportVersions
                  ? { ...h.prerequisiteExportVersions }
                  : undefined,
                exportedAt: h.exportedAt,
                exportedBy: h.exportedBy,
                externalWorkItemId: h.externalWorkItemId,
                externalUrl: h.externalUrl,
                updateRationale: h.updateRationale
              }))
            : [],
          advisorySemanticImpact: s.advisorySemanticImpact
            ? {
                isAdvisoryOnly: s.advisorySemanticImpact.isAdvisoryOnly,
                storyId: s.advisorySemanticImpact.storyId,
                semanticRiskLevel: s.advisorySemanticImpact.semanticRiskLevel,
                reasoning: s.advisorySemanticImpact.reasoning,
                suggestedActions: [...s.advisorySemanticImpact.suggestedActions],
                modelAssisted: s.advisorySemanticImpact.modelAssisted
              }
            : undefined
        }))
      };
    });
  }
}
