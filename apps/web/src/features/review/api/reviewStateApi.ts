import type { RequirementsReviewStateDto } from '@solutions-studio/contracts';
import { RequirementsReviewStateDtoSchema } from '@solutions-studio/contracts';
import { apiClient } from './client';

export async function getReviewState(baselineId?: string): Promise<RequirementsReviewStateDto> {
  const query = baselineId ? `?baselineId=${encodeURIComponent(baselineId)}` : '';
  const data = await apiClient<RequirementsReviewStateDto>(
    `/api/requirements/review-state${query}`,
    {
      method: 'GET'
    }
  );
  return RequirementsReviewStateDtoSchema.parse(data);
}
