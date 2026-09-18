import { z } from 'zod';
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
  isValidInstant
} from '@solutions-studio/domain';

export const InstantDtoSchema = z.string().refine(isValidInstant, {
  message: 'Invalid RFC 3339/ISO-8601 instant string with timezone and calendar validity'
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
  affectedActors: z.array(z.string().min(1)).optional(),
  dependencies: z.array(z.string().min(1)).optional(),
  supersedes: z.string().min(1).optional()
});

export const RequirementsBaselineDtoSchema = z.object({
  id: z.string().min(1),
  requirementRevisions: z.array(z.string().min(1)),
  createdAt: InstantDtoSchema,
  createdBy: z.string().min(1)
});

export const CandidateFindingDtoSchema = z.object({
  id: z.string().min(1),
  type: z.enum(FINDING_TYPES),
  affectedRequirementRevisions: z.array(z.string().min(1)),
  evidence: z.array(EvidenceReferenceDtoSchema),
  discoveredBy: z.enum(DISCOVERED_BY),
  disposition: z.enum(FINDING_DISPOSITIONS),
  rationale: z.string().optional()
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
  createdBy: z.string().min(1),
  createdAt: InstantDtoSchema.optional()
});

export const ProjectionMetadataDtoSchema = z.object({
  baselineId: z.string().min(1),
  requirementRevisionIds: z.array(z.string().min(1)).min(1),
  artifactType: z.string().min(1),
  declaredProvenance: z.object({
    baselineId: z.string().min(1),
    requirementRevisionIds: z.array(z.string().min(1)).min(1)
  }),
  configuredExecution: z.object({
    provider: z.string().min(1),
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
  artifactType: z.string().min(1),
  content: z.string().min(1),
  metadata: ProjectionMetadataDtoSchema,
  createdAt: InstantDtoSchema
});
