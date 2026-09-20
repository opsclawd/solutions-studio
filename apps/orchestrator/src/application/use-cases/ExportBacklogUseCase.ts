import { randomUUID } from 'node:crypto';
import {
  createRequirementsBaselineId,
  createStoryId,
  createBacklogExportMapping,
  createBacklogExportMappingId,
  StoryNotReadyForExportError,
  now,
  type AuthenticatedActor,
  type Story,
  type BacklogExportMapping,
  type BacklogExportHistoryEntry
} from '@solutions-studio/domain';
import type {
  ExportBacklogResponseDto,
  ExportStoryItemResultDto
} from '@solutions-studio/contracts';
import type { IRequirementsRepository } from '../ports/persistence/IRequirementsRepository.js';
import type { IAuthorizationPolicy } from '../ports/identity/IAuthorizationPolicy.js';
import type { GetAuthorityBundleUseCase } from './GetAuthorityBundleUseCase.js';
import type { EvaluateStoryReadinessUseCase } from './EvaluateStoryReadinessUseCase.js';
import type { BuildStoryDependencyGraphUseCase } from './BuildStoryDependencyGraphUseCase.js';
import { EvaluateExportStalenessUseCase } from './EvaluateExportStalenessUseCase.js';
import { UnknownRequirementsBaselineError } from './ReconciliationErrors.js';
import { UnknownStoryError } from './StoryProjectionErrors.js';
import { mapStoryRecordToDomainStory } from './storyMappers.js';
import {
  computeStoryContentHash,
  matchesStoryContentHash,
  type IBacklogExportGateway,
  type BacklogExportPayload,
  type BacklogExportPrerequisiteRef,
  RealBacklogMutationForbiddenError,
  ProviderRateLimitError,
  ProviderServerUnavailableError,
  ProviderNetworkError
} from '../ports/backlog/index.js';

export interface ExportBacklogInput {
  readonly baselineId: string;
  readonly targetContainer: string;
  readonly provider?: string;
  readonly storyIds?: readonly string[];
  readonly forceUpdate?: boolean;
  readonly allowUpdateExisting?: boolean;
  readonly updateRationale?: string;
  readonly propagateStaleOnly?: boolean;
  readonly credentials?: {
    readonly token?: string;
  };
  readonly actor: AuthenticatedActor;
}

export type BacklogGatewayResolver =
  IBacklogExportGateway | ((providerId: string) => IBacklogExportGateway);

function isRetryableError(error: unknown): boolean {
  if (error instanceof ProviderRateLimitError) return true;
  if (error instanceof ProviderServerUnavailableError) return true;
  if (error instanceof ProviderNetworkError) return true;
  return false;
}

export class ExportBacklogUseCase {
  private readonly evaluateExportStalenessUseCase: EvaluateExportStalenessUseCase;

  constructor(
    private readonly repository: IRequirementsRepository,
    private readonly gatewayResolver: BacklogGatewayResolver,
    private readonly authorizer: IAuthorizationPolicy,
    private readonly getAuthorityBundleUseCase: GetAuthorityBundleUseCase,
    private readonly evaluateStoryReadinessUseCase: EvaluateStoryReadinessUseCase,
    private readonly buildStoryDependencyGraphUseCase: BuildStoryDependencyGraphUseCase,
    evaluateExportStalenessUseCase?: EvaluateExportStalenessUseCase
  ) {
    this.evaluateExportStalenessUseCase =
      evaluateExportStalenessUseCase ??
      new EvaluateExportStalenessUseCase(
        repository,
        getAuthorityBundleUseCase,
        buildStoryDependencyGraphUseCase,
        authorizer
      );
  }

  private resolveGateway(providerId: string): IBacklogExportGateway {
    if (typeof this.gatewayResolver === 'function') {
      return this.gatewayResolver(providerId);
    }
    return this.gatewayResolver;
  }

  async execute(input: ExportBacklogInput): Promise<ExportBacklogResponseDto> {
    // 1. Authorize actor
    this.authorizer.authorize(input.actor, 'backlog:export');

    const baselineId = createRequirementsBaselineId(input.baselineId);

    // 2. Execute within baseline lock for deterministic snapshot
    return this.repository.withBaselineLock(baselineId, async () => {
      const baseline = await this.repository.getRequirementsBaseline(baselineId);
      if (!baseline) {
        throw new UnknownRequirementsBaselineError(input.baselineId);
      }

      const defaultProvider =
        typeof this.gatewayResolver === 'function'
          ? 'github-issues'
          : this.gatewayResolver.providerId;
      const requestedProvider = input.provider ?? defaultProvider;
      const gateway = this.resolveGateway(requestedProvider);
      if (input.provider && gateway.providerId !== input.provider) {
        throw new Error(
          `Gateway provider mismatch: requested '${input.provider}' but gateway resolved to '${gateway.providerId}'`
        );
      }
      const providerId = gateway.providerId;

      // 3. Load snapshot assets
      const authorityBundle = await this.getAuthorityBundleUseCase.execute({
        baselineId: input.baselineId
      });

      const engineeringDecisions = await this.repository.listEngineeringDecisions({
        baselineId
      });

      const storyRecords = await this.repository.listStories(baselineId);
      const allStories: Story[] = storyRecords.map(mapStoryRecordToDomainStory);

      // Validate requested storyIds if supplied
      if (input.storyIds && input.storyIds.length > 0) {
        const availableStoryIds = new Set(allStories.map((s) => s.id));
        for (const reqStoryId of input.storyIds) {
          if (!availableStoryIds.has(createStoryId(reqStoryId))) {
            throw new UnknownStoryError(reqStoryId);
          }
        }
      }

      // 4. Evaluate story readiness
      const readinessReports = await this.evaluateStoryReadinessUseCase.executeForBaseline(
        input.baselineId
      );
      const readinessMap = new Map(readinessReports.map((r) => [r.storyId, r]));

      // 5. Compute dependency graph & topological execution order
      const dependencyGraph = await this.buildStoryDependencyGraphUseCase.execute({
        baselineId: input.baselineId,
        includeReadiness: true,
        stories: storyRecords,
        readinessReports
      });

      // Sort candidate stories by topological order
      const orderMap = new Map<string, number>();
      if (dependencyGraph.executionOrder && dependencyGraph.executionOrder.length > 0) {
        dependencyGraph.executionOrder.forEach((id, idx) => orderMap.set(id, idx));
      }

      const sortedStories = [...allStories].sort((a, b) => {
        const orderA = orderMap.has(a.id) ? orderMap.get(a.id)! : 999999;
        const orderB = orderMap.has(b.id) ? orderMap.get(b.id)! : 999999;
        return orderA - orderB || a.id.localeCompare(b.id);
      });

      let candidateStories =
        input.storyIds && input.storyIds.length > 0
          ? sortedStories.filter((s) => input.storyIds!.includes(s.id))
          : sortedStories;

      // Evaluate staleness to carry deterministic classifications into export decisions
      const stalenessReport = await this.evaluateExportStalenessUseCase.execute({
        baselineId: input.baselineId,
        provider: providerId,
        targetContainer: input.targetContainer,
        actor: input.actor
      });
      const stalenessMap = new Map(stalenessReport.stories.map((s) => [s.storyId, s]));

      // If propagateStaleOnly is requested, export only STALE or IMPACTED stories
      if (input.propagateStaleOnly) {
        const staleOrImpactedIds = new Set(
          stalenessReport.stories
            .filter((s) => s.classification === 'STALE' || s.classification === 'IMPACTED')
            .map((s) => s.storyId)
        );
        candidateStories = candidateStories.filter((s) => staleOrImpactedIds.has(s.id));
      }

      const items: ExportStoryItemResultDto[] = [];
      const processedMappings = new Map<string, BacklogExportMapping>();

      // 6. Process candidate stories
      for (const story of candidateStories) {
        const report = readinessMap.get(story.id);
        const isReady = report ? report.isReady : false;

        if (!isReady) {
          const reasons =
            report?.failures && report.failures.length > 0
              ? report.failures.map((f) => f.ruleId)
              : ['story-not-ready'];
          const failures = report?.failures?.map((f) => ({
            rule: f.ruleId,
            message: f.message
          }));

          // If specifically requested by ID, throw typed error
          if (input.storyIds && input.storyIds.length > 0) {
            throw new StoryNotReadyForExportError(story.id, reasons);
          }

          items.push({
            storyId: story.id,
            status: 'rejected',
            rejectionReasons: reasons.length > 0 ? reasons : ['failed-readiness'],
            readinessFailures: failures
          });
          continue;
        }

        // Build prerequisite references with external issue IDs where mapped
        const prerequisites: BacklogExportPrerequisiteRef[] = [];
        for (const depId of story.dependencies ?? []) {
          let mappedDep = processedMappings.get(depId);
          if (!mappedDep) {
            mappedDep = await this.repository.findBacklogExportMapping({
              provider: providerId,
              externalContainer: input.targetContainer,
              storyId: depId
            });
          }
          const depStory = allStories.find((s) => s.id === depId);
          prerequisites.push({
            storyId: depId,
            externalWorkItemId: mappedDep?.externalWorkItemId,
            title: depStory?.title
          });
        }

        const contentHash = computeStoryContentHash({
          story,
          baselineId: baseline.id,
          engineeringDecisionIds: engineeringDecisions.map((d) => d.id),
          prerequisites
        });

        const executeWithLock = this.repository.withBacklogExportLock
          ? <T>(action: () => Promise<T>) =>
              this.repository.withBacklogExportLock!(
                {
                  provider: providerId,
                  externalContainer: input.targetContainer,
                  storyId: story.id
                },
                action
              )
          : <T>(action: () => Promise<T>) => action();

        await executeWithLock(async () => {
          // Check for existing mapping
          let existingMapping = await this.repository.findBacklogExportMapping({
            provider: providerId,
            externalContainer: input.targetContainer,
            storyId: story.id
          });

          const currentStoryRecord = storyRecords.find((r) => r.id === story.id);
          const currentStoryVersion = currentStoryRecord?.version ?? story.version ?? 1;

          const reqRevisionSet = new Set(story.requirementRevisionIds);
          const storyReqRevs = authorityBundle.requirements.filter((r) => reqRevisionSet.has(r.id));

          const policyRevisionSet = new Set(story.policyConstraintRevisionIds ?? []);
          const storyPolicyRevs = authorityBundle.policyConstraints.filter((p) =>
            policyRevisionSet.has(p.id)
          );

          // If no local mapping, attempt remote reconciliation with provider
          // (recovering from prior provider-success-plus-persistence-failure)
          if (!existingMapping && gateway.findWorkItem) {
            try {
              const remoteItem = await gateway.findWorkItem({
                targetContainer: input.targetContainer,
                payload: {
                  story,
                  baseline,
                  requirements: storyReqRevs,
                  policyConstraints: storyPolicyRevs,
                  engineeringDecisions,
                  contentHash,
                  targetContainer: input.targetContainer,
                  prerequisites,
                  exportVersion: 1,
                  history: []
                },
                credentials: input.credentials
              });
              if (remoteItem) {
                const recoveredMapping = createBacklogExportMapping({
                  id: createBacklogExportMappingId(randomUUID()),
                  storyId: story.id,
                  storyVersion: currentStoryVersion,
                  exportVersion: 1,
                  baselineId: baseline.id,
                  provider: providerId,
                  externalContainer: input.targetContainer,
                  externalWorkItemId: remoteItem.externalWorkItemId,
                  externalUrl: remoteItem.externalUrl,
                  exportContentHash: contentHash,
                  requirementRevisionIds: story.requirementRevisionIds ?? [],
                  policyConstraintRevisionIds: story.policyConstraintRevisionIds ?? [],
                  exportedAt: now(),
                  exportedBy: input.actor.id,
                  metadata: { ...remoteItem.metadata, reconciled: true },
                  history: []
                });
                await this.repository.saveBacklogExportMapping(recoveredMapping);
                existingMapping = recoveredMapping;
              }
            } catch {
              // Remote lookup failed, proceed to normal flow
            }
          }

          const storyStaleness = stalenessMap.get(story.id);

          const isContentHashEqual = existingMapping
            ? matchesStoryContentHash({
                mappingHash: existingMapping.exportContentHash,
                mappingHashVersion: existingMapping.exportContentHashVersion,
                currentStory: story,
                mappingBaselineId: existingMapping.baselineId,
                currentBaselineId: baseline.id,
                engineeringDecisionIds: engineeringDecisions.map((d) => d.id),
                prerequisites
              })
            : false;

          const isCurrent =
            !storyStaleness ||
            storyStaleness.classification === 'CURRENT' ||
            (storyStaleness.classification === 'UNEXPORTED' && Boolean(existingMapping));

          // Idempotency check: unchanged story produces 0 provider calls
          // Only unchanged if content hash matches AND classification is CURRENT AND not forceUpdate
          if (existingMapping && isContentHashEqual && isCurrent && !input.forceUpdate) {
            processedMappings.set(story.id, existingMapping);
            items.push({
              storyId: story.id,
              status: 'unchanged',
              externalWorkItemId: existingMapping.externalWorkItemId,
              externalUrl: existingMapping.externalUrl,
              exportContentHash: existingMapping.exportContentHash,
              exportedAt: existingMapping.exportedAt
            });
            return;
          }

          // Fail closed: if existing mapping differs / is STALE / is IMPACTED and allowUpdateExisting/forceUpdate is NOT granted, skip
          if (existingMapping && !input.allowUpdateExisting && !input.forceUpdate) {
            processedMappings.set(story.id, existingMapping);

            items.push({
              storyId: story.id,
              status: 'skipped-stale',
              externalWorkItemId: existingMapping.externalWorkItemId,
              externalUrl: existingMapping.externalUrl,
              stalenessReport: storyStaleness,
              message: `Story '${story.id}' already exported (work item #${existingMapping.externalWorkItemId}) has changed or is stale (${storyStaleness?.classification ?? 'CHANGED'}). Explicit confirmation (allowUpdateExisting: true) is required to update.`
            });
            return;
          }

          if (existingMapping) {
            // Explicit update of existing work item
            const prereqExportVersions: Record<string, number> = {};
            for (const depId of story.dependencies ?? []) {
              const depMapping =
                processedMappings.get(depId) ??
                (await this.repository.findBacklogExportMapping({
                  storyId: depId,
                  provider: providerId,
                  externalContainer: input.targetContainer
                }));
              if (depMapping) {
                prereqExportVersions[depId] = depMapping.exportVersion;
              }
            }

            const nextExportVersion = (existingMapping.exportVersion ?? 1) + 1;
            const historyEntry: BacklogExportHistoryEntry = {
              exportVersion: existingMapping.exportVersion ?? 1,
              storyVersion: existingMapping.storyVersion ?? 1,
              baselineId: existingMapping.baselineId,
              exportContentHash: existingMapping.exportContentHash,
              exportContentHashVersion: existingMapping.exportContentHashVersion ?? 1,
              prerequisiteExportVersions: existingMapping.prerequisiteExportVersions,
              requirementRevisionIds: existingMapping.requirementRevisionIds ?? [],
              policyConstraintRevisionIds: existingMapping.policyConstraintRevisionIds ?? [],
              exportedAt: existingMapping.exportedAt,
              exportedBy: existingMapping.exportedBy,
              externalWorkItemId: existingMapping.externalWorkItemId,
              externalUrl: existingMapping.externalUrl,
              updateRationale: input.updateRationale
            };
            const updatedHistory = [...(existingMapping.history ?? []), historyEntry];

            const payload: BacklogExportPayload = {
              story,
              baseline,
              requirements: storyReqRevs,
              policyConstraints: storyPolicyRevs,
              engineeringDecisions,
              contentHash,
              targetContainer: input.targetContainer,
              prerequisites,
              exportVersion: nextExportVersion,
              history: updatedHistory
            };

            try {
              const result = await gateway.updateWorkItem({
                targetContainer: input.targetContainer,
                payload,
                credentials: input.credentials,
                existingMapping
              });

              const updatedMapping = createBacklogExportMapping({
                id: existingMapping.id,
                storyId: story.id,
                storyVersion: currentStoryVersion,
                exportVersion: nextExportVersion,
                exportContentHashVersion: 2,
                prerequisiteExportVersions: prereqExportVersions,
                baselineId: baseline.id,
                provider: providerId,
                externalContainer: input.targetContainer,
                externalWorkItemId: result.externalWorkItemId,
                externalUrl: result.externalUrl ?? existingMapping.externalUrl,
                exportContentHash: contentHash,
                requirementRevisionIds: story.requirementRevisionIds ?? [],
                policyConstraintRevisionIds: story.policyConstraintRevisionIds ?? [],
                exportedAt: now(),
                exportedBy: input.actor.id,
                metadata: result.metadata ?? existingMapping.metadata,
                history: updatedHistory
              });

              await this.repository.updateBacklogExportMapping(updatedMapping);
              processedMappings.set(story.id, updatedMapping);

              items.push({
                storyId: story.id,
                status: 'updated',
                externalWorkItemId: updatedMapping.externalWorkItemId,
                externalUrl: updatedMapping.externalUrl,
                exportContentHash: updatedMapping.exportContentHash,
                exportedAt: updatedMapping.exportedAt
              });
            } catch (err) {
              if (err instanceof RealBacklogMutationForbiddenError) {
                throw err;
              }
              items.push({
                storyId: story.id,
                status: 'failed',
                errorMessage: err instanceof Error ? err.message : String(err),
                errorType: err instanceof Error ? err.constructor.name : 'UnknownError',
                retryable: isRetryableError(err)
              });
            }
          } else {
            // Create new work item
            const payload: BacklogExportPayload = {
              story,
              baseline,
              requirements: storyReqRevs,
              policyConstraints: storyPolicyRevs,
              engineeringDecisions,
              contentHash,
              targetContainer: input.targetContainer,
              prerequisites,
              exportVersion: 1,
              history: []
            };

            try {
              const result = await gateway.createWorkItem({
                targetContainer: input.targetContainer,
                payload,
                credentials: input.credentials
              });

              const prereqExportVersions: Record<string, number> = {};
              for (const depId of story.dependencies ?? []) {
                const depMapping =
                  processedMappings.get(depId) ??
                  (await this.repository.findBacklogExportMapping({
                    storyId: depId,
                    provider: providerId,
                    externalContainer: input.targetContainer
                  }));
                if (depMapping) {
                  prereqExportVersions[depId] = depMapping.exportVersion;
                }
              }

              const newMapping = createBacklogExportMapping({
                id: createBacklogExportMappingId(randomUUID()),
                storyId: story.id,
                storyVersion: currentStoryVersion,
                exportVersion: 1,
                exportContentHashVersion: 2,
                prerequisiteExportVersions: prereqExportVersions,
                baselineId: baseline.id,
                provider: providerId,
                externalContainer: input.targetContainer,
                externalWorkItemId: result.externalWorkItemId,
                externalUrl: result.externalUrl,
                exportContentHash: contentHash,
                requirementRevisionIds: story.requirementRevisionIds ?? [],
                policyConstraintRevisionIds: story.policyConstraintRevisionIds ?? [],
                exportedAt: now(),
                exportedBy: input.actor.id,
                metadata: result.metadata,
                history: []
              });

              await this.repository.saveBacklogExportMapping(newMapping);
              processedMappings.set(story.id, newMapping);

              items.push({
                storyId: story.id,
                status: 'created',
                externalWorkItemId: newMapping.externalWorkItemId,
                externalUrl: newMapping.externalUrl,
                exportContentHash: newMapping.exportContentHash,
                exportedAt: newMapping.exportedAt
              });
            } catch (err) {
              if (err instanceof RealBacklogMutationForbiddenError) {
                throw err;
              }
              items.push({
                storyId: story.id,
                status: 'failed',
                errorMessage: err instanceof Error ? err.message : String(err),
                errorType: err instanceof Error ? err.constructor.name : 'UnknownError',
                retryable: isRetryableError(err)
              });
            }
          }
        });
      }

      const summary = {
        total: items.length,
        created: items.filter((i) => i.status === 'created').length,
        updated: items.filter((i) => i.status === 'updated').length,
        unchanged: items.filter((i) => i.status === 'unchanged').length,
        skippedStale: items.filter((i) => i.status === 'skipped-stale').length,
        rejected: items.filter((i) => i.status === 'rejected').length,
        failed: items.filter((i) => i.status === 'failed').length
      };

      return {
        baselineId: baseline.id,
        provider: providerId,
        externalContainer: input.targetContainer,
        items,
        summary,
        exportedAt: now()
      };
    });
  }
}
