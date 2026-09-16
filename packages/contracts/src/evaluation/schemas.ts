import { z } from 'zod';
import { FINDING_TYPES, FINDING_DISPOSITIONS, DISCOVERED_BY } from '@solutions-studio/domain';

export const FindingTypeSchema = z.enum(FINDING_TYPES);

export const FindingDispositionSchema = z.enum(FINDING_DISPOSITIONS);

export const DiscoveredBySchema = z.enum(DISCOVERED_BY);

export const FindingEvaluationDtoSchema = z.object({
  findingId: z.string().min(1),
  type: FindingTypeSchema,
  disposition: FindingDispositionSchema,
  discoveredBy: DiscoveredBySchema,
  rationale: z.string().optional()
});
