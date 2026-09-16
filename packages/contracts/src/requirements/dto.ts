import type { z } from 'zod';
import type {
  EvidenceLocatorDtoSchema,
  EvidenceReferenceDtoSchema,
  SourceDtoSchema,
  RequirementDtoSchema,
  SourceRevisionDtoSchema,
  RequirementRevisionDtoSchema,
  RequirementsBaselineDtoSchema,
  CandidateFindingDtoSchema,
  InstantDtoSchema
} from './schemas.js';

export type InstantDto = z.infer<typeof InstantDtoSchema>;
export type EvidenceLocatorDto = z.infer<typeof EvidenceLocatorDtoSchema>;
export type EvidenceReferenceDto = z.infer<typeof EvidenceReferenceDtoSchema>;
export type SourceDto = z.infer<typeof SourceDtoSchema>;
export type RequirementDto = z.infer<typeof RequirementDtoSchema>;
export type SourceRevisionDto = z.infer<typeof SourceRevisionDtoSchema>;
export type RequirementRevisionDto = z.infer<typeof RequirementRevisionDtoSchema>;
export type RequirementsBaselineDto = z.infer<typeof RequirementsBaselineDtoSchema>;
export type CandidateFindingDto = z.infer<typeof CandidateFindingDtoSchema>;
