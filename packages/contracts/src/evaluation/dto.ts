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
  SafeFixtureIdSchema,
  EvaluationFixtureDtoSchema,
  EvaluationManifestEntryDtoSchema,
  EvaluationManifestDtoSchema,
  SourceLineageMapEntrySchema,
  ScoreCountersSchema,
  RequirementMatchDetailSchema,
  RequirementMismatchDetailSchema,
  FindingMatchDetailSchema,
  FindingMismatchDetailSchema,
  RejectedCompilerRequirementSchema,
  RejectedCompilerFindingSchema,
  FixtureScorerResultSchema,
  GenerationTokensDtoSchema,
  GenerationMetadataDtoSchema,
  FixtureExecutionErrorSchema,
  CompletedFixtureExecutedSchema,
  CompletedFixtureMeasuredSchema,
  CompletedFixtureResultSchema,
  FailedFixtureResultSchema,
  EvaluationFixtureResultSchema,
  RollupMetricSchema,
  AggregateCategoryScoresSchema,
  RequestedProvenanceSchema,
  DeclaredSourceDeclarationSchema,
  DeclaredFixtureDeclarationSchema,
  DeclaredProvenanceSchema,
  ConfiguredProvenanceSchema,
  VerifiedProvenanceSchema,
  ProvenanceLayersSchema,
  ReportArtifactsSchema,
  EvaluationReportSchema,
  EvaluationRunRecordSchema
} from './schemas.js';

export type AvailableValueDto<T> =
  { status: 'available'; value: T } | { status: 'unavailable'; reason: string };

export type FindingTypeDto = z.infer<typeof FindingTypeSchema>;
export type FindingDispositionDto = z.infer<typeof FindingDispositionSchema>;
export type DiscoveredByDto = z.infer<typeof DiscoveredBySchema>;
export type FindingEvaluationDto = z.infer<typeof FindingEvaluationDtoSchema>;

export type FixtureCategoryDto = z.infer<typeof FixtureCategorySchema>;
export type EvidenceExpectationDto = EvidenceReferenceDto;
export type SafeFixtureIdDto = z.infer<typeof SafeFixtureIdSchema>;
export type EvaluationSourceDto = z.infer<typeof EvaluationSourceDtoSchema>;
export type ExpectedRequirementDto = z.infer<typeof ExpectedRequirementDtoSchema>;
export type ExpectedFindingDto = z.infer<typeof ExpectedFindingDtoSchema>;
export type ExpectedNonFindingDto = z.infer<typeof ExpectedNonFindingDtoSchema>;
export type EvaluationFixtureDto = z.infer<typeof EvaluationFixtureDtoSchema>;
export type EvaluationManifestEntryDto = z.infer<typeof EvaluationManifestEntryDtoSchema>;
export type EvaluationManifestDto = z.infer<typeof EvaluationManifestDtoSchema>;

export type SourceLineageMapEntryDto = z.infer<typeof SourceLineageMapEntrySchema>;
export type ScoreCountersDto = z.infer<typeof ScoreCountersSchema>;
export type RequirementMatchDetailDto = z.infer<typeof RequirementMatchDetailSchema>;
export type RequirementMismatchDetailDto = z.infer<typeof RequirementMismatchDetailSchema>;
export type FindingMatchDetailDto = z.infer<typeof FindingMatchDetailSchema>;
export type FindingMismatchDetailDto = z.infer<typeof FindingMismatchDetailSchema>;
export type RejectedCompilerRequirementDto = z.infer<typeof RejectedCompilerRequirementSchema>;
export type RejectedCompilerFindingDto = z.infer<typeof RejectedCompilerFindingSchema>;
export type FixtureScorerResultDto = z.infer<typeof FixtureScorerResultSchema>;
export type GenerationTokensDto = z.infer<typeof GenerationTokensDtoSchema>;
export type GenerationMetadataDto = z.infer<typeof GenerationMetadataDtoSchema>;
export type FixtureExecutionErrorDto = z.infer<typeof FixtureExecutionErrorSchema>;
export type CompletedFixtureExecutedDto = z.infer<typeof CompletedFixtureExecutedSchema>;
export type CompletedFixtureMeasuredDto = z.infer<typeof CompletedFixtureMeasuredSchema>;
export type CompletedFixtureResultDto = z.infer<typeof CompletedFixtureResultSchema>;
export type FailedFixtureResultDto = z.infer<typeof FailedFixtureResultSchema>;
export type EvaluationFixtureResultDto = z.infer<typeof EvaluationFixtureResultSchema>;
export type RollupMetricDto = z.infer<typeof RollupMetricSchema>;
export type AggregateCategoryScoresDto = z.infer<typeof AggregateCategoryScoresSchema>;
export type RequestedProvenanceDto = z.infer<typeof RequestedProvenanceSchema>;
export type DeclaredSourceDeclarationDto = z.infer<typeof DeclaredSourceDeclarationSchema>;
export type DeclaredFixtureDeclarationDto = z.infer<typeof DeclaredFixtureDeclarationSchema>;
export type DeclaredProvenanceDto = z.infer<typeof DeclaredProvenanceSchema>;
export type ConfiguredProvenanceDto = z.infer<typeof ConfiguredProvenanceSchema>;
export type VerifiedProvenanceDto = z.infer<typeof VerifiedProvenanceSchema>;
export type ProvenanceLayersDto = z.infer<typeof ProvenanceLayersSchema>;
export type ReportArtifactsDto = z.infer<typeof ReportArtifactsSchema>;
export type EvaluationReportDto = z.infer<typeof EvaluationReportSchema>;
export type EvaluationRunRecordDto = z.infer<typeof EvaluationRunRecordSchema>;
