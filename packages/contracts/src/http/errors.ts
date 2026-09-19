import { z } from 'zod';

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'RATIONALE_REQUIRED',
  'EMPTY_BASELINE',
  'REQUIREMENT_REVISION_NOT_FOUND',
  'FINDING_NOT_FOUND',
  'BASELINE_NOT_FOUND',
  'PROJECTION_NOT_FOUND',
  'SOURCE_REVISION_NOT_FOUND',
  'STALE_REVISION_TARGET',
  'INVALID_TRANSITION',
  'BLOCKED_BY_OPEN_FINDINGS',
  'UNAUDITED_RECONCILIATION',
  'ARTIFACT_GENERATION_FAILED',
  'INTERNAL_ERROR'
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const ApiErrorDtoSchema = z.object({
  code: z.enum(API_ERROR_CODES),
  message: z.string().min(1),
  details: z.unknown().optional()
});

export type ApiErrorDto = z.infer<typeof ApiErrorDtoSchema>;
