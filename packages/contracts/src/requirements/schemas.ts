import { z } from 'zod';
import {
  BacklogExportMappingDtoSchema,
  BaselineExportStalenessReportDtoSchema
} from '../backlog/schemas.js';
import {
  REQUIREMENT_CATEGORIES,
  REQUIREMENT_ORIGINS,
  CANDIDATE_REQUIREMENT_ORIGINS,
  REQUIREMENT_REVIEW_STATES,
  REQUIREMENT_RESOLUTION_STATES,
  REQUIREMENT_RECONCILIATION_ACTIONS,
  SOURCE_TYPES,
  FINDING_TYPES,
  FINDING_DISPOSITIONS,
  DISCOVERED_BY,
  POLICY_CONSTRAINT_STATES,
  ENGINEERING_DECISION_STATES,
  STORY_READINESS_RULE_IDS,
  isValidInstant
} from '@solutions-studio/domain';

export const InstantDtoSchema = z.string().refine(isValidInstant, {
  message: 'Invalid RFC 3339/ISO-8601 instant string with timezone and calendar validity'
});

export const PolicyConstraintStateSchema = z.enum(POLICY_CONSTRAINT_STATES);

export const PolicyConstraintRevisionDtoSchema = z.object({
  id: z.string().min(1),
  policyConstraintId: z.string().min(1),
  revision: z.number().int().positive(),
  statement: z.string().min(1),
  authorityReference: z.string().min(1),
  state: PolicyConstraintStateSchema,
  createdAt: InstantDtoSchema,
  createdBy: z.string().min(1),
  supersedes: z.string().min(1).optional()
});

export const CreatePolicyConstraintRevisionRequestDtoSchema = z.object({
  policyConstraintId: z.string().min(1),
  statement: z.string().min(1),
  authorityReference: z.string().min(1),
  state: PolicyConstraintStateSchema.optional().default('ACCEPTED'),
  createdBy: z.string().min(1).optional(),
  supersedes: z.string().min(1).optional()
});

export const SourceTypeSchema = z.enum(SOURCE_TYPES);
export const RequirementCategorySchema = z.enum(REQUIREMENT_CATEGORIES);
export const RequirementOriginSchema = z.enum(REQUIREMENT_ORIGINS);
export const CandidateRequirementOriginSchema = z.enum(CANDIDATE_REQUIREMENT_ORIGINS);

export const EvidenceLocatorDtoSchema = z.string().min(1);

export const EvidenceReferenceDtoSchema = z.object({
  sourceRevisionId: z.string().min(1),
  locator: EvidenceLocatorDtoSchema
});

export const SourceDtoSchema = z.object({
  id: z.string().min(1),
  sourceType: SourceTypeSchema
});

export const RequirementDtoSchema = z.object({
  id: z.string().min(1)
});

export const SourceRevisionDtoSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  revision: z.number().int().positive(),
  contentHash: z.string().min(1),
  capturedAt: InstantDtoSchema,
  verifiedAt: InstantDtoSchema.optional(),
  supersedes: z.string().min(1).optional()
});

export const RequirementRevisionDtoSchema = z.object({
  id: z.string().min(1),
  requirementId: z.string().min(1),
  revision: z.number().int().positive(),
  statement: z.string().min(1),
  category: z.enum(REQUIREMENT_CATEGORIES),
  origin: z.enum(REQUIREMENT_ORIGINS),
  reviewState: z.enum(REQUIREMENT_REVIEW_STATES),
  resolutionState: z.enum(REQUIREMENT_RESOLUTION_STATES),
  evidence: z.array(EvidenceReferenceDtoSchema),
  rationale: z.string().optional(),
  actorId: z.string().min(1).optional(),
  baselineId: z.string().min(1).optional(),
  originatingProjectionId: z.string().min(1).optional(),
  affectedActors: z.array(z.string().min(1)).optional(),
  dependencies: z.array(z.string().min(1)).optional(),
  supersedes: z.string().min(1).optional()
});

export const RequirementsBaselineDtoSchema = z.object({
  id: z.string().min(1),
  requirementRevisions: z.array(z.string().min(1)),
  policyConstraintRevisions: z.array(z.string().min(1)).optional(),
  createdAt: InstantDtoSchema,
  createdBy: z.string().min(1)
});

export const ListRequirementsBaselinesResponseDtoSchema = z.array(RequirementsBaselineDtoSchema);

export const CandidateFindingDtoSchema = z.object({
  id: z.string().min(1),
  type: z.enum(FINDING_TYPES),
  affectedRequirementRevisions: z.array(z.string().min(1)),
  evidence: z.array(EvidenceReferenceDtoSchema),
  discoveredBy: z.enum(DISCOVERED_BY),
  disposition: z.enum(FINDING_DISPOSITIONS),
  rationale: z.string().optional(),
  actorId: z.string().min(1).optional(),
  baselineId: z.string().min(1).optional(),
  originatingProjectionId: z.string().min(1).optional()
});

export const CandidateEvidenceRefDtoSchema = EvidenceReferenceDtoSchema;

export const CandidateRequirementDtoSchema = z.object({
  requirementKey: z.string().min(1),
  statement: z.string().min(1),
  category: RequirementCategorySchema,
  origin: CandidateRequirementOriginSchema,
  evidence: z.array(CandidateEvidenceRefDtoSchema),
  rationale: z.string().optional()
});

export const CandidateFindingResponseDtoSchema = z.object({
  findingKey: z.string().min(1),
  type: z.enum(FINDING_TYPES),
  relatedRequirementKeys: z.array(z.string().min(1)),
  evidence: z.array(CandidateEvidenceRefDtoSchema),
  rationale: z.string().min(1)
});

export const CompiledRequirementsResponseDtoSchema = z
  .object({
    requirements: z.array(CandidateRequirementDtoSchema),
    findings: z.array(CandidateFindingResponseDtoSchema)
  })
  .superRefine((data, ctx) => {
    const seenRequirementKeys = new Set<string>();
    for (let i = 0; i < data.requirements.length; i++) {
      const key = data.requirements[i].requirementKey;
      if (seenRequirementKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate requirementKey: '${key}'`,
          path: ['requirements', i, 'requirementKey']
        });
      } else {
        seenRequirementKeys.add(key);
      }
    }

    const seenFindingKeys = new Set<string>();
    for (let i = 0; i < data.findings.length; i++) {
      const key = data.findings[i].findingKey;
      if (seenFindingKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate findingKey: '${key}'`,
          path: ['findings', i, 'findingKey']
        });
      } else {
        seenFindingKeys.add(key);
      }
    }
  });

export const RequirementReconciliationActionSchema = z.enum(REQUIREMENT_RECONCILIATION_ACTIONS);

export const RequirementReconciliationRecordDtoSchema = z
  .object({
    id: z.string().min(1),
    entityType: z.literal('requirement'),
    entityId: z.string().min(1),
    requirementRevisionId: z.string().min(1),
    action: RequirementReconciliationActionSchema,
    previousReviewState: z.enum(REQUIREMENT_REVIEW_STATES).optional(),
    newReviewState: z.enum(REQUIREMENT_REVIEW_STATES),
    previousResolutionState: z.enum(REQUIREMENT_RESOLUTION_STATES).optional(),
    newResolutionState: z.enum(REQUIREMENT_RESOLUTION_STATES).optional(),
    rationale: z
      .string()
      .min(1)
      .refine((s) => s.trim().length > 0, {
        message: 'Rationale must be a non-empty string'
      }),
    actorId: z.string().min(1).optional(),
    recordedAt: InstantDtoSchema
  })
  .superRefine((data, ctx) => {
    const hasPrev = data.previousResolutionState !== undefined;
    const hasNext = data.newResolutionState !== undefined;

    if (hasPrev !== hasNext) {
      if (hasNext && !hasPrev) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'previousResolutionState is required when newResolutionState is present',
          path: ['previousResolutionState']
        });
      } else {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'newResolutionState is required when previousResolutionState is present',
          path: ['newResolutionState']
        });
      }
    } else if (hasPrev && hasNext) {
      if (data.previousResolutionState === data.newResolutionState && data.action !== 'REVISE') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Resolution states cannot be identical for action '${data.action}'`,
          path: ['newResolutionState']
        });
      }
    }
  });

export const FindingReconciliationRecordDtoSchema = z
  .object({
    id: z.string().min(1),
    entityType: z.literal('finding'),
    entityId: z.string().min(1),
    previousDisposition: z.enum(FINDING_DISPOSITIONS),
    newDisposition: z.enum(FINDING_DISPOSITIONS),
    rationale: z
      .string()
      .min(1)
      .refine((s) => s.trim().length > 0, {
        message: 'Rationale must be a non-empty string'
      }),
    actorId: z.string().min(1).optional(),
    recordedAt: InstantDtoSchema
  })
  .superRefine((data, ctx) => {
    if (data.previousDisposition === data.newDisposition) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Transition must change disposition: previous and new are both '${data.previousDisposition}'`,
        path: ['newDisposition']
      });
    }
  });

export const ReconciliationRecordDtoSchema = z.union([
  RequirementReconciliationRecordDtoSchema,
  FindingReconciliationRecordDtoSchema
]);

export const CreateRequirementsBaselineRequestDtoSchema = z.object({
  id: z.string().min(1).optional(),
  requirementRevisions: z.array(z.string().min(1)).min(1),
  policyConstraintRevisions: z.array(z.string().min(1)).optional(),
  createdBy: z.string().min(1).optional(),
  createdAt: InstantDtoSchema.optional()
});

export const ProjectionMetadataDtoSchema = z.object({
  baselineId: z.string().min(1),
  requirementRevisionIds: z.array(z.string().min(1)).min(1),
  policyConstraintRevisionIds: z.array(z.string().min(1)).optional(),
  engineeringDecisionIds: z.array(z.string().min(1)).optional(),
  artifactType: z.string().min(1),
  declaredProvenance: z.object({
    baselineId: z.string().min(1),
    requirementRevisionIds: z.array(z.string().min(1)).min(1),
    policyConstraintRevisionIds: z.array(z.string().min(1)).optional(),
    engineeringDecisionIds: z.array(z.string().min(1)).optional()
  }),
  configuredExecution: z.object({
    provider: z.string().min(1),
    model: z.string().optional(),
    artifactType: z.string().min(1)
  }),
  measuredVerification: z.object({
    repairsNeeded: z.number().int().nonnegative(),
    attemptCount: z.number().int().positive(),
    contentHash: z.string().min(1),
    verifiedAt: InstantDtoSchema
  })
});

export const ProjectionRecordDtoSchema = z.object({
  id: z.string().min(1),
  baselineId: z.string().min(1),
  requirementRevisionIds: z.array(z.string().min(1)).min(1),
  policyConstraintRevisionIds: z.array(z.string().min(1)).optional(),
  engineeringDecisionIds: z.array(z.string().min(1)).optional(),
  artifactType: z.string().min(1),
  content: z.string().min(1),
  metadata: ProjectionMetadataDtoSchema,
  createdAt: InstantDtoSchema
});

export const AcceptRequirementRequestDtoSchema = z.object({
  rationale: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, { message: 'Rationale must be non-empty' }),
  actorId: z.string().min(1).optional(),
  newRevisionId: z.string().min(1).optional()
});

export const RejectRequirementRequestDtoSchema = z.object({
  rationale: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, { message: 'Rationale must be non-empty' }),
  actorId: z.string().min(1).optional(),
  newRevisionId: z.string().min(1).optional()
});

export const ResolveRequirementRequestDtoSchema = z.object({
  rationale: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, { message: 'Rationale must be non-empty' }),
  actorId: z.string().min(1).optional(),
  newRevisionId: z.string().min(1).optional()
});

export const ReviseRequirementRequestDtoSchema = z.object({
  statement: z.string().min(1).optional(),
  category: RequirementCategorySchema.optional(),
  origin: RequirementOriginSchema.optional(),
  evidence: z.array(EvidenceReferenceDtoSchema).optional(),
  affectedActors: z.array(z.string().min(1)).optional(),
  dependencies: z.array(z.string().min(1)).optional(),
  rationale: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, { message: 'Rationale must be non-empty' }),
  actorId: z.string().min(1).optional(),
  newRevisionId: z.string().min(1).optional()
});

export const DispositionFindingRequestDtoSchema = z.object({
  disposition: z.enum(FINDING_DISPOSITIONS),
  rationale: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, { message: 'Rationale must be non-empty' }),
  actorId: z.string().min(1).optional()
});

export const ReopenFindingRequestDtoSchema = z.object({
  rationale: z.string().optional(),
  actorId: z.string().min(1).optional()
});

export const GenerateProjectionRequestDtoSchema = z.object({
  artifactType: z.enum([
    'process-diagram',
    'state-diagram',
    'prototype',
    'sql-schema',
    'openapi',
    'stories'
  ]),
  prompt: z.string().min(1).optional()
});

export const EvidenceExcerptDtoSchema = z.object({
  sourceRevisionId: z.string().min(1),
  locator: EvidenceLocatorDtoSchema,
  headingPath: z.string(),
  blockLabel: z.string(),
  blockLabelSource: z.enum(['explicit-section', 'sequential-ordinal']).optional(),
  text: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive()
});

export const RevisionLineageEntryDtoSchema = z.object({
  revisionId: z.string().min(1),
  requirementId: z.string().min(1)
});

export const RequirementsReviewStateDtoSchema = z.object({
  baseline: RequirementsBaselineDtoSchema.optional(),
  requirementRevisions: z.array(RequirementRevisionDtoSchema),
  findings: z.array(CandidateFindingDtoSchema),
  reconciliationHistory: z.array(ReconciliationRecordDtoSchema),
  evidenceExcerpts: z.array(EvidenceExcerptDtoSchema),
  projections: z.array(ProjectionRecordDtoSchema),
  revisionLineage: z.array(RevisionLineageEntryDtoSchema),
  availableBaselines: z.array(z.string().min(1)).optional()
});

export const DiscoveryDiscoveredBySchema = z.enum(['human', 'artifact-validation']);

export const RecordRequirementDiscoveryRequestDtoSchema = z.object({
  statement: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, { message: 'Statement must be non-empty' }),
  category: RequirementCategorySchema,
  rationale: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, { message: 'Rationale must be non-empty' }),
  actorId: z.string().min(1).optional(),
  baselineId: z.string().min(1).optional(),
  originatingProjectionId: z.string().min(1).optional(),
  affectedActors: z.array(z.string().min(1)).optional(),
  dependencies: z.array(z.string().min(1)).optional(),
  evidence: z.array(EvidenceReferenceDtoSchema).optional(),
  requirementId: z.string().min(1).optional(),
  revisionId: z.string().min(1).optional()
});

export const RecordFindingDiscoveryRequestDtoSchema = z.object({
  type: z.enum(FINDING_TYPES),
  discoveredBy: DiscoveryDiscoveredBySchema,
  rationale: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, { message: 'Rationale must be non-empty' }),
  actorId: z.string().min(1).optional(),
  baselineId: z.string().min(1).optional(),
  originatingProjectionId: z.string().min(1).optional(),
  affectedRequirementRevisions: z.array(z.string().min(1)).optional(),
  evidence: z.array(EvidenceReferenceDtoSchema).optional(),
  findingId: z.string().min(1).optional()
});

export const EngineeringDecisionStateSchema = z.enum(ENGINEERING_DECISION_STATES);

export const EngineeringDecisionDtoSchema = z.object({
  id: z.string().min(1),
  baselineId: z.string().min(1),
  statement: z.string().min(1),
  rationale: z.string().min(1),
  requirementRevisionIds: z.array(z.string().min(1)),
  policyConstraintRevisionIds: z.array(z.string().min(1)),
  state: EngineeringDecisionStateSchema,
  createdAt: InstantDtoSchema,
  createdBy: z.string().min(1),
  acceptedBy: z.string().min(1).optional(),
  acceptedAt: InstantDtoSchema.optional(),
  supersedes: z.string().min(1).optional(),
  transitionRationale: z.string().min(1).optional()
});

export const CreateEngineeringDecisionRequestDtoSchema = z.object({
  id: z.string().min(1).optional(),
  baselineId: z.string().min(1),
  statement: z.string().min(1),
  rationale: z.string().min(1),
  requirementRevisionIds: z.array(z.string().min(1)).default([]),
  policyConstraintRevisionIds: z.array(z.string().min(1)).default([]),
  createdBy: z.string().min(1).optional(),
  supersedes: z.string().min(1).optional()
});

export const TransitionEngineeringDecisionRequestDtoSchema = z.object({
  newState: EngineeringDecisionStateSchema,
  rationale: z.string().min(1),
  actorId: z.string().min(1).optional()
});

export const AuthorityBundleDtoSchema = z.object({
  baseline: RequirementsBaselineDtoSchema,
  requirements: z.array(RequirementRevisionDtoSchema),
  policyConstraints: z.array(PolicyConstraintRevisionDtoSchema)
});

export const StoryNarrativeDtoSchema = z.object({
  role: z.string().min(1),
  feature: z.string().min(1),
  benefit: z.string().min(1),
  rawText: z.string().optional()
});

export const GherkinStepKeywordSchema = z.enum(['Given', 'When', 'Then', 'And', 'But']);

export const GherkinStepDtoSchema = z.object({
  keyword: GherkinStepKeywordSchema,
  text: z.string().min(1)
});

export const GherkinScenarioDtoSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  requirementRevisionIds: z.array(z.string().min(1)).min(1),
  policyConstraintRevisionIds: z.array(z.string().min(1)).optional(),
  steps: z.array(GherkinStepDtoSchema).min(1),
  rawText: z.string().optional()
});

export const StoryDtoSchema = z.object({
  id: z.string().min(1),
  baselineId: z.string().min(1),
  projectionId: z.string().min(1).optional(),
  title: z.string().min(1),
  narrative: StoryNarrativeDtoSchema,
  requirementRevisionIds: z.array(z.string().min(1)).min(1),
  policyConstraintRevisionIds: z.array(z.string().min(1)).optional(),
  scenarios: z.array(GherkinScenarioDtoSchema).min(1),
  acceptanceCriteria: z.array(z.string().min(1)),
  gherkinText: z.string().min(1),
  dependencies: z.array(z.string().min(1)).optional(),
  version: z.number().int().positive().optional(),
  metadata: ProjectionMetadataDtoSchema.optional(),
  createdAt: InstantDtoSchema
});

export const GenerateStoryRequestDtoSchema = z.object({
  prompt: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  autoRecordDiscoveries: z.boolean().optional()
});

export const ListStoriesResponseDtoSchema = z.array(StoryDtoSchema);

export const StoryReadinessRuleIdSchema = z.enum(STORY_READINESS_RULE_IDS);

export const StoryReadinessFailureDtoSchema = z.object({
  ruleId: z.string().min(1),
  message: z.string().min(1),
  affectedIds: z.array(z.string()),
  details: z.record(z.unknown()).optional()
});

export const StoryReadinessPolicyDtoSchema = z.object({
  requireSqlProjection: z.boolean().optional(),
  requireOpenApiProjection: z.boolean().optional(),
  allowDeferredEngineeringDecisions: z.boolean().optional(),
  blockingFindingTypes: z.array(z.enum(FINDING_TYPES)).optional()
});

export const StoryReadinessReportDtoSchema = z.object({
  storyId: z.string().min(1),
  baselineId: z.string().min(1),
  status: z.enum(['implementation-ready', 'not-ready']),
  isReady: z.boolean(),
  evaluatedAt: InstantDtoSchema,
  failures: z.array(StoryReadinessFailureDtoSchema),
  passedRules: z.array(z.string()),
  policy: StoryReadinessPolicyDtoSchema.optional()
});

export const ListStoryReadinessReportsResponseDtoSchema = z.array(StoryReadinessReportDtoSchema);

export const RequirementCoverageEntryDtoSchema = z.object({
  requirementRevisionId: z.string().min(1),
  coveringStoryIds: z.array(z.string().min(1)),
  coverageCount: z.number().int().nonnegative()
});

export const BaselineRequirementCoverageDtoSchema = z.object({
  baselineId: z.string().min(1),
  totalRequirements: z.number().int().nonnegative(),
  coveredCount: z.number().int().nonnegative(),
  uncoveredCount: z.number().int().nonnegative(),
  multiCoveredCount: z.number().int().nonnegative(),
  coveredRequirements: z.array(RequirementCoverageEntryDtoSchema),
  uncoveredRequirementRevisionIds: z.array(z.string().min(1)),
  multiCoveredRequirements: z.array(RequirementCoverageEntryDtoSchema),
  isFullyCovered: z.boolean(),
  computedAt: InstantDtoSchema
});

export const StoryDependencyGraphNodeDtoSchema = z.object({
  storyId: z.string().min(1),
  title: z.string().min(1),
  requirementRevisionIds: z.array(z.string().min(1)),
  dependencies: z.array(z.string().min(1)),
  dependents: z.array(z.string().min(1)),
  readinessStatus: z.enum(['implementation-ready', 'not-ready']).optional(),
  isReady: z.boolean().optional()
});

export const StoryDependencyGraphEdgeDtoSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1)
});

export const StoryDependencyGraphValidationResultDtoSchema = z.object({
  isValid: z.boolean(),
  errors: z.array(z.string()),
  missingNodeIds: z.array(z.string()),
  selfDependencies: z.array(z.string()),
  cycles: z.array(z.array(z.string()))
});

export const StoryDependencyGraphDtoSchema = z.object({
  baselineId: z.string().min(1),
  nodes: z.array(StoryDependencyGraphNodeDtoSchema),
  edges: z.array(StoryDependencyGraphEdgeDtoSchema),
  executionOrder: z.array(z.string()),
  isAcyclic: z.boolean(),
  hasCycles: z.boolean(),
  cycles: z.array(z.array(z.string())),
  validation: StoryDependencyGraphValidationResultDtoSchema,
  createdAt: InstantDtoSchema
});

export const UpdateStoryDependenciesRequestDtoSchema = z.object({
  dependencies: z.array(z.string().min(1))
});

export const EngineeringHandoffSummaryDtoSchema = z.object({
  totalStories: z.number().int().nonnegative(),
  readyStories: z.number().int().nonnegative(),
  nonReadyStories: z.number().int().nonnegative(),
  totalRequirements: z.number().int().nonnegative(),
  coveredRequirements: z.number().int().nonnegative(),
  openBlockingFindings: z.number().int().nonnegative(),
  isHandoffReady: z.boolean()
});

export const EngineeringHandoffBundleDtoSchema = z.object({
  baseline: RequirementsBaselineDtoSchema,
  authorityBundle: AuthorityBundleDtoSchema,
  engineeringDecisions: z.array(EngineeringDecisionDtoSchema),
  sqlProjection: ProjectionRecordDtoSchema.optional(),
  openApiProjection: ProjectionRecordDtoSchema.optional(),
  stories: z.array(StoryDtoSchema),
  readinessReports: z.array(StoryReadinessReportDtoSchema),
  coverage: BaselineRequirementCoverageDtoSchema,
  dependencyGraph: StoryDependencyGraphDtoSchema,
  blockingFindings: z.array(CandidateFindingDtoSchema),
  unresolvedRequirements: z.array(RequirementRevisionDtoSchema),
  summary: EngineeringHandoffSummaryDtoSchema,
  exportMappings: z.array(BacklogExportMappingDtoSchema).optional(),
  stalenessSummary: BaselineExportStalenessReportDtoSchema.optional()
});
