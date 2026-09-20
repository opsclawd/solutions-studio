import {
  createRequirementsBaselineId,
  buildStoryDependencyGraph,
  type Story,
  type StoryDependencyGraph,
  type StoryReadinessReport
} from '@solutions-studio/domain';
import type {
  IRequirementsRepository,
  StoryRecord
} from '../ports/persistence/IRequirementsRepository.js';
import type { EvaluateStoryReadinessUseCase } from './EvaluateStoryReadinessUseCase.js';
import { UnknownRequirementsBaselineError } from './ReconciliationErrors.js';

export interface BuildStoryDependencyGraphInput {
  readonly baselineId: string;
  readonly includeReadiness?: boolean;
  readonly strict?: boolean;
  readonly stories?: readonly StoryRecord[];
  readonly readinessReports?: readonly StoryReadinessReport[];
}

import { mapStoryRecordToDomainStory } from './storyMappers.js';
export { mapStoryRecordToDomainStory };

export class BuildStoryDependencyGraphUseCase {
  constructor(
    private readonly repository: IRequirementsRepository,
    private readonly evaluateStoryReadinessUseCase?: EvaluateStoryReadinessUseCase
  ) {}

  async execute(input: BuildStoryDependencyGraphInput): Promise<StoryDependencyGraph> {
    const baselineId = createRequirementsBaselineId(input.baselineId);
    const baseline = await this.repository.getRequirementsBaseline(baselineId);
    if (!baseline) {
      throw new UnknownRequirementsBaselineError(input.baselineId);
    }

    const storyRecords = input.stories ?? (await this.repository.listStories(baselineId));
    const stories: Story[] = storyRecords.map(mapStoryRecordToDomainStory);

    let readinessReports: readonly StoryReadinessReport[] | undefined = input.readinessReports;
    if (!readinessReports && input.includeReadiness && this.evaluateStoryReadinessUseCase) {
      readinessReports = await this.evaluateStoryReadinessUseCase.executeForBaseline(
        input.baselineId
      );
    }

    return buildStoryDependencyGraph({
      baselineId,
      stories,
      readinessReports,
      strict: input.strict
    });
  }
}
