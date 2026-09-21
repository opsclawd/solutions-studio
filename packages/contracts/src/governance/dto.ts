import type { z } from 'zod';
import type {
  ValidationArtifactDtoSchema,
  ValidationArtifactInputDtoSchema,
  ValidationRunRecordDtoSchema,
  ApprovalActorDtoSchema,
  ApprovalRevocationDtoSchema,
  CandidateApprovalRecordDtoSchema,
  CreateApprovalRequestDtoSchema,
  RevokeApprovalRequestDtoSchema,
  RecordValidationRunRequestDtoSchema,
  CandidatePromotionStatusDtoSchema,
  GovernanceAuditExportDtoSchema,
  ArtifactVerificationResultDtoSchema
} from './schemas.js';

export type ValidationArtifactDto = z.infer<typeof ValidationArtifactDtoSchema>;
export type ValidationArtifactInputDto = z.infer<typeof ValidationArtifactInputDtoSchema>;
export type ValidationRunRecordDto = z.infer<typeof ValidationRunRecordDtoSchema>;
export type ApprovalActorDto = z.infer<typeof ApprovalActorDtoSchema>;
export type ApprovalRevocationDto = z.infer<typeof ApprovalRevocationDtoSchema>;
export type CandidateApprovalRecordDto = z.infer<typeof CandidateApprovalRecordDtoSchema>;
export type CreateApprovalRequestDto = z.infer<typeof CreateApprovalRequestDtoSchema>;
export type RevokeApprovalRequestDto = z.infer<typeof RevokeApprovalRequestDtoSchema>;
export type RecordValidationRunRequestDto = z.infer<typeof RecordValidationRunRequestDtoSchema>;
export type CandidatePromotionStatusDto = z.infer<typeof CandidatePromotionStatusDtoSchema>;
export type ArtifactVerificationResultDto = z.infer<typeof ArtifactVerificationResultDtoSchema>;
export type GovernanceAuditExportDto = z.infer<typeof GovernanceAuditExportDtoSchema>;
