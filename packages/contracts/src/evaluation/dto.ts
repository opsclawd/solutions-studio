import type { z } from 'zod';
import type { EvidenceReferenceDto } from '../requirements/dto.js';
import type {
  FindingTypeSchema,
  FindingDispositionSchema,
  DiscoveredBySchema,
  FindingEvaluationDtoSchema,
  FixtureCategorySchema,
  EvaluationSourceDtoSchema,
  ExpectedRequirementDtoSchema,
  ExpectedFindingDtoSchema,
  ExpectedNonFindingDtoSchema,
  EvaluationFixtureDtoSchema,
  EvaluationManifestEntryDtoSchema,
  EvaluationManifestDtoSchema
} from './schemas.js';

export type FindingTypeDto = z.infer<typeof FindingTypeSchema>;
export type FindingDispositionDto = z.infer<typeof FindingDispositionSchema>;
export type DiscoveredByDto = z.infer<typeof DiscoveredBySchema>;
export type FindingEvaluationDto = z.infer<typeof FindingEvaluationDtoSchema>;

export type FixtureCategoryDto = z.infer<typeof FixtureCategorySchema>;
export type EvidenceExpectationDto = EvidenceReferenceDto;
export type EvaluationSourceDto = z.infer<typeof EvaluationSourceDtoSchema>;
export type ExpectedRequirementDto = z.infer<typeof ExpectedRequirementDtoSchema>;
export type ExpectedFindingDto = z.infer<typeof ExpectedFindingDtoSchema>;
export type ExpectedNonFindingDto = z.infer<typeof ExpectedNonFindingDtoSchema>;
export type EvaluationFixtureDto = z.infer<typeof EvaluationFixtureDtoSchema>;
export type EvaluationManifestEntryDto = z.infer<typeof EvaluationManifestEntryDtoSchema>;
export type EvaluationManifestDto = z.infer<typeof EvaluationManifestDtoSchema>;
