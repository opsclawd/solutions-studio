import type { z } from 'zod';
import type {
  FindingTypeSchema,
  FindingDispositionSchema,
  DiscoveredBySchema,
  FindingEvaluationDtoSchema
} from './schemas.js';

export type FindingTypeDto = z.infer<typeof FindingTypeSchema>;
export type FindingDispositionDto = z.infer<typeof FindingDispositionSchema>;
export type DiscoveredByDto = z.infer<typeof DiscoveredBySchema>;
export type FindingEvaluationDto = z.infer<typeof FindingEvaluationDtoSchema>;
