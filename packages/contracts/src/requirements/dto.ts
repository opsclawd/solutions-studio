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
  InstantDtoSchema,
  SourceTypeSchema,
  RequirementCategorySchema,
  RequirementOriginSchema,
  CandidateRequirementOriginSchema,
  CandidateEvidenceRefDtoSchema,
  CandidateRequirementDtoSchema,
  CandidateFindingResponseDtoSchema,
  CompiledRequirementsResponseDtoSchema,
  RequirementReconciliationActionSchema,
  RequirementReconciliationRecordDtoSchema,
  FindingReconciliationRecordDtoSchema,
  ReconciliationRecordDtoSchema,
  CreateRequirementsBaselineRequestDtoSchema,
  ProjectionMetadataDtoSchema,
  ProjectionRecordDtoSchema
} from './schemas.js';

export type InstantDto = z.infer<typeof InstantDtoSchema>;
export type SourceTypeDto = z.infer<typeof SourceTypeSchema>;
export type RequirementCategoryDto = z.infer<typeof RequirementCategorySchema>;
export type RequirementOriginDto = z.infer<typeof RequirementOriginSchema>;
export type CandidateRequirementOriginDto = z.infer<typeof CandidateRequirementOriginSchema>;

export type EvidenceLocatorDto = z.infer<typeof EvidenceLocatorDtoSchema>;
export type EvidenceReferenceDto = z.infer<typeof EvidenceReferenceDtoSchema>;
export type CandidateEvidenceRefDto = z.infer<typeof CandidateEvidenceRefDtoSchema>;
export type SourceDto = z.infer<typeof SourceDtoSchema>;
export type RequirementDto = z.infer<typeof RequirementDtoSchema>;
export type SourceRevisionDto = z.infer<typeof SourceRevisionDtoSchema>;
export type RequirementRevisionDto = z.infer<typeof RequirementRevisionDtoSchema>;
export type RequirementsBaselineDto = z.infer<typeof RequirementsBaselineDtoSchema>;
export type CandidateFindingDto = z.infer<typeof CandidateFindingDtoSchema>;
export type CandidateRequirementDto = z.infer<typeof CandidateRequirementDtoSchema>;
export type CandidateFindingResponseDto = z.infer<typeof CandidateFindingResponseDtoSchema>;
export type CompiledRequirementsResponseDto = z.infer<typeof CompiledRequirementsResponseDtoSchema>;
export type RequirementReconciliationActionDto = z.infer<
  typeof RequirementReconciliationActionSchema
>;
export type RequirementReconciliationRecordDto = z.infer<
  typeof RequirementReconciliationRecordDtoSchema
>;
export type FindingReconciliationRecordDto = z.infer<typeof FindingReconciliationRecordDtoSchema>;
export type ReconciliationRecordDto = z.infer<typeof ReconciliationRecordDtoSchema>;
export type CreateRequirementsBaselineRequestDto = z.infer<
  typeof CreateRequirementsBaselineRequestDtoSchema
>;
export type ProjectionMetadataDto = z.infer<typeof ProjectionMetadataDtoSchema>;
export type ProjectionRecordDto = z.infer<typeof ProjectionRecordDtoSchema>;
