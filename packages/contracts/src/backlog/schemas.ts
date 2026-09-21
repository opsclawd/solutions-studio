import { z } from 'zod';
import { isValidInstant } from '@solutions-studio/domain';

const InstantDtoSchema = z.string().refine(isValidInstant, {
  message: 'Invalid RFC 3339/ISO-8601 instant string with timezone and calendar validity'
});

export const BacklogExportHistoryEntryDtoSchema = z.object({
  exportVersion: z.number().int().positive(),
  baselineId: z.string().min(1),
  storyVersion: z.number().int().positive(),
  requirementRevisionIds: z.array(z.string().min(1)),
  policyConstraintRevisionIds: z.array(z.string().min(1)).optional(),
  exportContentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  exportContentHashVersion: z.number().int().positive().optional().default(1),
  prerequisiteExportVersions: z.record(z.number().int().positive()).optional(),
  exportedAt: InstantDtoSchema,
  exportedBy: z.string().min(1),
  externalWorkItemId: z.string().min(1),
  externalUrl: z.string().url().optional(),
  updateRationale: z.string().optional()
});

export const BacklogExportMappingDtoSchema = z.object({
  id: z.string().min(1),
  storyId: z.string().min(1),
  storyVersion: z.number().int().positive().default(1),
  exportVersion: z.number().int().positive().default(1),
  exportContentHashVersion: z.number().int().positive().optional().default(1),
  prerequisiteExportVersions: z.record(z.number().int().positive()).optional(),
  baselineId: z.string().min(1),
  requirementRevisionIds: z.array(z.string().min(1)).default([]),
  policyConstraintRevisionIds: z.array(z.string().min(1)).optional(),
  provider: z.string().min(1),
  externalContainer: z.string().min(1),
  externalWorkItemId: z.string().min(1),
  externalUrl: z.string().url().optional(),
  exportContentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  exportedAt: InstantDtoSchema,
  exportedBy: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
  history: z.array(BacklogExportHistoryEntryDtoSchema).optional().default([])
});

export const ExportStalenessClassificationDtoSchema = z.enum([
  'CURRENT',
  'STALE',
  'IMPACTED',
  'UNEXPORTED'
]);

export const StalenessCauseCategoryDtoSchema = z.enum([
  'BASELINE_SUPERSEDED',
  'REQUIREMENT_REVISION_SUPERSEDED',
  'REQUIREMENT_REMOVED_FROM_BASELINE',
  'POLICY_CONSTRAINT_SUPERSEDED',
  'POLICY_CONSTRAINT_REMOVED_FROM_BASELINE',
  'STORY_VERSION_SUPERSEDED',
  'CONTENT_HASH_MISMATCH',
  'PREREQUISITE_STALE',
  'PREREQUISITE_VERSION_SUPERSEDED'
]);

export const StalenessCauseDtoSchema = z.object({
  category: StalenessCauseCategoryDtoSchema,
  message: z.string().min(1),
  entityId: z.string().min(1),
  exportedRevision: z.string().optional(),
  currentRevision: z.string().optional()
});

export const ExportedStoryLineageDtoSchema = z.object({
  baselineId: z.string().min(1),
  storyVersion: z.number().int().positive(),
  exportVersion: z.number().int().positive(),
  exportContentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  exportContentHashVersion: z.number().int().positive().optional().default(1),
  prerequisiteExportVersions: z.record(z.number().int().positive()).optional(),
  exportedAt: InstantDtoSchema,
  externalWorkItemId: z.string().min(1),
  externalUrl: z.string().url().optional()
});

export const AdvisorySemanticImpactResultDtoSchema = z.object({
  isAdvisoryOnly: z.literal(true),
  storyId: z.string().min(1),
  semanticRiskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  reasoning: z.string().min(1),
  suggestedActions: z.array(z.string().min(1)),
  modelAssisted: z.boolean()
});

export const StoryExportStalenessReportDtoSchema = z.object({
  storyId: z.string().min(1),
  classification: ExportStalenessClassificationDtoSchema,
  causes: z.array(StalenessCauseDtoSchema),
  exportedLineage: ExportedStoryLineageDtoSchema.optional(),
  impactedByPrerequisiteStoryIds: z.array(z.string().min(1)),
  currentContentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  history: z.array(BacklogExportHistoryEntryDtoSchema).optional().default([]),
  advisorySemanticImpact: AdvisorySemanticImpactResultDtoSchema.optional()
});

export const BaselineExportStalenessReportDtoSchema = z.object({
  baselineId: z.string().min(1),
  totalStories: z.number().int().nonnegative(),
  currentCount: z.number().int().nonnegative(),
  staleCount: z.number().int().nonnegative(),
  impactedCount: z.number().int().nonnegative(),
  unexportedCount: z.number().int().nonnegative(),
  stories: z.array(StoryExportStalenessReportDtoSchema)
});

export const ExportStoryItemSuccessResultDtoSchema = z.object({
  storyId: z.string().min(1),
  status: z.enum(['created', 'updated', 'unchanged']),
  externalWorkItemId: z.string().min(1),
  externalUrl: z.string().url().optional(),
  exportContentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  exportedAt: InstantDtoSchema
});

export const ExportStoryItemSkippedStaleResultDtoSchema = z.object({
  storyId: z.string().min(1),
  status: z.literal('skipped-stale'),
  externalWorkItemId: z.string().min(1),
  externalUrl: z.string().url().optional(),
  stalenessReport: StoryExportStalenessReportDtoSchema.optional(),
  message: z.string().min(1)
});

export const ExportStoryItemRejectedResultDtoSchema = z.object({
  storyId: z.string().min(1),
  status: z.literal('rejected'),
  rejectionReasons: z.array(z.string().min(1)).min(1),
  readinessFailures: z
    .array(
      z.object({
        rule: z.string().min(1),
        message: z.string()
      })
    )
    .optional()
});

export const ExportStoryItemFailedResultDtoSchema = z.object({
  storyId: z.string().min(1),
  status: z.literal('failed'),
  errorMessage: z.string().min(1),
  errorType: z.string().min(1),
  retryable: z.boolean()
});

export const ExportStoryItemResultDtoSchema = z.discriminatedUnion('status', [
  ExportStoryItemSuccessResultDtoSchema,
  ExportStoryItemSkippedStaleResultDtoSchema,
  ExportStoryItemRejectedResultDtoSchema,
  ExportStoryItemFailedResultDtoSchema
]);

export const ExportBacklogSummaryDtoSchema = z.object({
  total: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  skippedStale: z.number().int().nonnegative().optional().default(0),
  rejected: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative()
});

export const ExportBacklogRequestDtoSchema = z.object({
  provider: z.string().min(1).optional().default('github-issues'),
  targetContainer: z.string().min(1),
  storyIds: z.array(z.string().min(1)).optional(),
  forceUpdate: z.boolean().optional().default(false),
  allowUpdateExisting: z.boolean().optional().default(false),
  updateRationale: z.string().optional(),
  propagateStaleOnly: z.boolean().optional().default(false),
  credentials: z
    .object({
      token: z.string().min(1).optional()
    })
    .optional()
});

export const ExportBacklogResponseDtoSchema = z.object({
  baselineId: z.string().min(1),
  provider: z.string().min(1),
  externalContainer: z.string().min(1),
  items: z.array(ExportStoryItemResultDtoSchema),
  summary: ExportBacklogSummaryDtoSchema,
  exportedAt: InstantDtoSchema
});

export const GetExportStalenessQueryDtoSchema = z.object({
  provider: z.string().min(1).optional().default('github-issues'),
  targetContainer: z.string().min(1).optional(),
  storyIds: z
    .union([z.string().min(1), z.array(z.string().min(1))])
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      if (Array.isArray(val)) return val;
      return val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    })
});

export const BacklogExportFilterDtoSchema = z.object({
  baselineId: z.string().optional(),
  storyId: z.string().optional(),
  provider: z.string().optional(),
  externalContainer: z.string().optional()
});

export const BacklogExportMappingListResponseDtoSchema = z.object({
  items: z.array(BacklogExportMappingDtoSchema)
});
