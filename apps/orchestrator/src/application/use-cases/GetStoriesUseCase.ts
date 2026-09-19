import {
  createStoryId,
  createRequirementsBaselineId,
  type StoryId,
  type RequirementsBaselineId
} from '@solutions-studio/domain';
import type {
  IRequirementsRepository,
  StoryRecord
} from '../ports/persistence/IRequirementsRepository.js';
import { UnknownRequirementsBaselineError } from './ReconciliationErrors.js';

export class GetStoriesUseCase {
  constructor(private readonly repository: IRequirementsRepository) {}

  async getStory(id: StoryId | string): Promise<StoryRecord | undefined> {
    const storyId = createStoryId(id);
    return this.repository.getStory(storyId);
  }

  async listStories(baselineId?: RequirementsBaselineId | string): Promise<readonly StoryRecord[]> {
    if (baselineId) {
      const baseId = createRequirementsBaselineId(baselineId);
      const baseline = await this.repository.getRequirementsBaseline(baseId);
      if (!baseline) {
        throw new UnknownRequirementsBaselineError(baselineId);
      }
      return this.repository.listStories(baseId);
    }
    return this.repository.listStories();
  }
}
