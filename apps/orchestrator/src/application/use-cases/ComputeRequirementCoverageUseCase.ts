import {
  createRequirementsBaselineId,
  computeRequirementCoverage,
  createStory,
  type BaselineRequirementCoverage,
  type Story
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../ports/persistence/IRequirementsRepository.js';
import { UnknownRequirementsBaselineError } from './ReconciliationErrors.js';

export interface ComputeRequirementCoverageInput {
  readonly baselineId: string;
}

export class ComputeRequirementCoverageUseCase {
  constructor(private readonly repository: IRequirementsRepository) {}

  async execute(input: ComputeRequirementCoverageInput): Promise<BaselineRequirementCoverage> {
    const baselineId = createRequirementsBaselineId(input.baselineId);
    const baseline = await this.repository.getRequirementsBaseline(baselineId);
    if (!baseline) {
      throw new UnknownRequirementsBaselineError(input.baselineId);
    }

    const storyRecords = await this.repository.listStories(baseline.id);

    const stories: Story[] = storyRecords.map((s) =>
      createStory({
        id: s.id,
        baselineId: s.baselineId,
        title: s.title,
        narrative: s.narrative,
        requirementRevisionIds: s.requirementRevisionIds,
        policyConstraintRevisionIds: s.policyConstraintRevisionIds,
        scenarios: s.scenarios.map((sc) => ({
          id: sc.id,
          title: sc.title,
          requirementRevisionIds: sc.requirementRevisionIds,
          policyConstraintRevisionIds: sc.policyConstraintRevisionIds,
          steps: sc.steps,
          rawText: sc.rawText
        })),
        acceptanceCriteria: s.acceptanceCriteria,
        gherkinText: s.gherkinText,
        dependencies: s.dependencies,
        createdAt: s.createdAt
      })
    );

    return computeRequirementCoverage(baseline, stories);
  }
}
