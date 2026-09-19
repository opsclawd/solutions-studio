import type {
  CreateRequirementsBaselineRequestDto,
  RequirementsBaselineDto,
  ListRequirementsBaselinesResponseDto
} from '@solutions-studio/contracts';
import {
  RequirementsBaselineDtoSchema,
  ListRequirementsBaselinesResponseDtoSchema
} from '@solutions-studio/contracts';
import { apiClient } from './client';

export async function createBaseline(
  body: CreateRequirementsBaselineRequestDto
): Promise<RequirementsBaselineDto> {
  const data = await apiClient<RequirementsBaselineDto>('/api/baselines', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  return RequirementsBaselineDtoSchema.parse(data);
}

export async function listBaselines(): Promise<readonly RequirementsBaselineDto[]> {
  const data = await apiClient<ListRequirementsBaselinesResponseDto>('/api/baselines', {
    method: 'GET'
  });
  return ListRequirementsBaselinesResponseDtoSchema.parse(data);
}
