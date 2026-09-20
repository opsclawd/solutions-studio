import { z } from 'zod';
import { InstantDtoSchema } from '../requirements/schemas.js';

export const BacklogExportMappingDtoSchema = z.object({
  id: z.string().min(1),
  storyId: z.string().min(1),
  baselineId: z.string().min(1),
  provider: z.string().min(1),
  externalContainer: z.string().min(1),
  externalWorkItemId: z.string().min(1),
  externalUrl: z.string().url().optional(),
  exportContentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  exportedAt: InstantDtoSchema,
  exportedBy: z.string().min(1),
  metadata: z.record(z.unknown()).optional()
});

export const ExportStoryItemSuccessResultDtoSchema = z.object({
  storyId: z.string().min(1),
  status: z.enum(['created', 'updated', 'unchanged']),
  externalWorkItemId: z.string().min(1),
  externalUrl: z.string().url().optional(),
  exportContentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  exportedAt: InstantDtoSchema
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
  ExportStoryItemRejectedResultDtoSchema,
  ExportStoryItemFailedResultDtoSchema
]);

export const ExportBacklogSummaryDtoSchema = z.object({
  total: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative()
});

export const ExportBacklogRequestDtoSchema = z.object({
  provider: z.string().min(1).default('github-issues'),
  targetContainer: z.string().min(1),
  storyIds: z.array(z.string().min(1)).optional(),
  forceUpdate: z.boolean().optional().default(false),
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

export const BacklogExportFilterDtoSchema = z.object({
  baselineId: z.string().optional(),
  storyId: z.string().optional(),
  provider: z.string().optional(),
  externalContainer: z.string().optional()
});

export const BacklogExportMappingListResponseDtoSchema = z.object({
  items: z.array(BacklogExportMappingDtoSchema)
});
