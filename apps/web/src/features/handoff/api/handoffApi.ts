import type {
  EngineeringHandoffBundleDto,
  StoryDependencyGraphDto,
  StoryDto,
  UpdateStoryDependenciesRequestDto
} from '@solutions-studio/contracts';
import {
  EngineeringHandoffBundleDtoSchema,
  StoryDependencyGraphDtoSchema,
  StoryDtoSchema
} from '@solutions-studio/contracts';
import { apiClient } from '@/features/review/api/client';
import { listBaselines as listBaselinesFromApi } from '@/features/review/api/baselinesApi';

export async function getEngineeringHandoffBundle(
  baselineId: string
): Promise<EngineeringHandoffBundleDto> {
  const data = await apiClient<EngineeringHandoffBundleDto>(
    `/api/baselines/${encodeURIComponent(baselineId)}/handoff`,
    {
      method: 'GET'
    }
  );
  return EngineeringHandoffBundleDtoSchema.parse(data);
}

export async function getStoryDependencyGraph(
  baselineId: string,
  options?: { includeReadiness?: boolean; strict?: boolean }
): Promise<StoryDependencyGraphDto> {
  const params = new URLSearchParams();
  if (options?.includeReadiness !== undefined) {
    params.set('includeReadiness', String(options.includeReadiness));
  }
  if (options?.strict !== undefined) {
    params.set('strict', String(options.strict));
  }
  const query = params.toString() ? `?${params.toString()}` : '';

  const data = await apiClient<StoryDependencyGraphDto>(
    `/api/baselines/${encodeURIComponent(baselineId)}/dependency-graph${query}`,
    {
      method: 'GET'
    }
  );
  return StoryDependencyGraphDtoSchema.parse(data);
}

export async function updateStoryDependencies(
  storyId: string,
  dependencies: string[]
): Promise<StoryDto> {
  const payload: UpdateStoryDependenciesRequestDto = {
    dependencies
  };
  const data = await apiClient<StoryDto>(
    `/api/stories/${encodeURIComponent(storyId)}/dependencies`,
    {
      method: 'PUT',
      body: JSON.stringify(payload)
    }
  );
  return StoryDtoSchema.parse(data);
}

export async function listAvailableBaselines(): Promise<string[]> {
  try {
    const baselines = await listBaselinesFromApi();
    return baselines.map((b) => b.id);
  } catch {
    return [];
  }
}
