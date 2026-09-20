import type { z } from 'zod';
import type {
  BacklogExportMappingDtoSchema,
  ExportStoryItemSuccessResultDtoSchema,
  ExportStoryItemRejectedResultDtoSchema,
  ExportStoryItemFailedResultDtoSchema,
  ExportStoryItemResultDtoSchema,
  ExportBacklogSummaryDtoSchema,
  ExportBacklogRequestDtoSchema,
  ExportBacklogResponseDtoSchema,
  BacklogExportFilterDtoSchema,
  BacklogExportMappingListResponseDtoSchema
} from './schemas.js';

export type BacklogExportMappingDto = z.infer<typeof BacklogExportMappingDtoSchema>;
export type ExportStoryItemSuccessResultDto = z.infer<typeof ExportStoryItemSuccessResultDtoSchema>;
export type ExportStoryItemRejectedResultDto = z.infer<
  typeof ExportStoryItemRejectedResultDtoSchema
>;
export type ExportStoryItemFailedResultDto = z.infer<typeof ExportStoryItemFailedResultDtoSchema>;
export type ExportStoryItemResultDto = z.infer<typeof ExportStoryItemResultDtoSchema>;
export type ExportBacklogSummaryDto = z.infer<typeof ExportBacklogSummaryDtoSchema>;
export type ExportBacklogRequestDto = z.infer<typeof ExportBacklogRequestDtoSchema>;
export type ExportBacklogResponseDto = z.infer<typeof ExportBacklogResponseDtoSchema>;
export type BacklogExportFilterDto = z.infer<typeof BacklogExportFilterDtoSchema>;
export type BacklogExportMappingListResponseDto = z.infer<
  typeof BacklogExportMappingListResponseDtoSchema
>;
