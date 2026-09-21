import type {
  RequirementsBaselineId,
  StoryId,
  BacklogExportMapping,
  AuthenticatedActor
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../ports/persistence/IRequirementsRepository.js';

export interface GetBacklogExportMappingsInput {
  readonly baselineId?: RequirementsBaselineId | string;
  readonly storyId?: StoryId | string;
  readonly provider?: string;
  readonly externalContainer?: string;
  readonly actor: AuthenticatedActor;
}

export class GetBacklogExportMappingsUseCase {
  constructor(private readonly repository: IRequirementsRepository) {}

  async execute(input: GetBacklogExportMappingsInput): Promise<readonly BacklogExportMapping[]> {
    return this.repository.listBacklogExportMappings({
      baselineId: input.baselineId,
      storyId: input.storyId,
      provider: input.provider,
      externalContainer: input.externalContainer
    });
  }
}
