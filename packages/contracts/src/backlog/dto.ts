import type { z } from 'zod';
import type {
  BacklogExportHistoryEntryDtoSchema,
  BacklogExportMappingDtoSchema,
  ExportStalenessClassificationDtoSchema,
  StalenessCauseCategoryDtoSchema,
  StalenessCauseDtoSchema,
  ExportedStoryLineageDtoSchema,
  StoryExportStalenessReportDtoSchema,
  BaselineExportStalenessReportDtoSchema,
  AdvisorySemanticImpactResultDtoSchema,
  ExportStoryItemSuccessResultDtoSchema,
  ExportStoryItemSkippedStaleResultDtoSchema,
  ExportStoryItemRejectedResultDtoSchema,
  ExportStoryItemFailedResultDtoSchema,
  ExportStoryItemResultDtoSchema,
  ExportBacklogSummaryDtoSchema,
  ExportBacklogRequestDtoSchema,
  ExportBacklogResponseDtoSchema,
  GetExportStalenessQueryDtoSchema,
  BacklogExportFilterDtoSchema,
  BacklogExportMappingListResponseDtoSchema
} from './schemas.js';

export type BacklogExportHistoryEntryDto = z.infer<typeof BacklogExportHistoryEntryDtoSchema>;
export type BacklogExportMappingDto = z.infer<typeof BacklogExportMappingDtoSchema>;
export type ExportStalenessClassificationDto = z.infer<
  typeof ExportStalenessClassificationDtoSchema
>;
export type StalenessCauseCategoryDto = z.infer<typeof StalenessCauseCategoryDtoSchema>;
export type StalenessCauseDto = z.infer<typeof StalenessCauseDtoSchema>;
export type ExportedStoryLineageDto = z.infer<typeof ExportedStoryLineageDtoSchema>;
export type StoryExportStalenessReportDto = z.infer<typeof StoryExportStalenessReportDtoSchema>;
export type BaselineExportStalenessReportDto = z.infer<
  typeof BaselineExportStalenessReportDtoSchema
>;
export type AdvisorySemanticImpactResultDto = z.infer<typeof AdvisorySemanticImpactResultDtoSchema>;
export type ExportStoryItemSuccessResultDto = z.infer<typeof ExportStoryItemSuccessResultDtoSchema>;
export type ExportStoryItemSkippedStaleResultDto = z.infer<
  typeof ExportStoryItemSkippedStaleResultDtoSchema
>;
export type ExportStoryItemRejectedResultDto = z.infer<
  typeof ExportStoryItemRejectedResultDtoSchema
>;
export type ExportStoryItemFailedResultDto = z.infer<typeof ExportStoryItemFailedResultDtoSchema>;
export type ExportStoryItemResultDto = z.infer<typeof ExportStoryItemResultDtoSchema>;
export type ExportBacklogSummaryDto = z.infer<typeof ExportBacklogSummaryDtoSchema>;
export type ExportBacklogRequestDto = z.input<typeof ExportBacklogRequestDtoSchema>;
export type ExportBacklogResponseDto = z.infer<typeof ExportBacklogResponseDtoSchema>;
export type GetExportStalenessQueryDto = z.input<typeof GetExportStalenessQueryDtoSchema>;
export type BacklogExportFilterDto = z.infer<typeof BacklogExportFilterDtoSchema>;
export type BacklogExportMappingListResponseDto = z.infer<
  typeof BacklogExportMappingListResponseDtoSchema
>;
