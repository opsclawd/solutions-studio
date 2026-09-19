import type {
  GenerateProjectionRequestDto,
  ProjectionRecordDto
} from '@solutions-studio/contracts';
import { ProjectionRecordDtoSchema } from '@solutions-studio/contracts';
import { apiClient } from './client';

export async function generateProjection(
  baselineId: string,
  body: GenerateProjectionRequestDto
): Promise<ProjectionRecordDto> {
  const data = await apiClient<ProjectionRecordDto>(
    `/api/baselines/${encodeURIComponent(baselineId)}/projections`,
    {
      method: 'POST',
      body: JSON.stringify(body)
    }
  );
  return ProjectionRecordDtoSchema.parse(data);
}

export async function listProjections(baselineId: string): Promise<readonly ProjectionRecordDto[]> {
  const data = await apiClient<readonly ProjectionRecordDto[]>(
    `/api/baselines/${encodeURIComponent(baselineId)}/projections`,
    {
      method: 'GET'
    }
  );
  if (!Array.isArray(data)) {
    throw new Error('Expected array of projections from server');
  }
  return data.map((item) => ProjectionRecordDtoSchema.parse(item));
}

export async function getProjection(
  baselineId: string,
  projectionId: string
): Promise<ProjectionRecordDto> {
  const data = await apiClient<ProjectionRecordDto>(
    `/api/baselines/${encodeURIComponent(baselineId)}/projections/${encodeURIComponent(projectionId)}`,
    {
      method: 'GET'
    }
  );
  return ProjectionRecordDtoSchema.parse(data);
}
