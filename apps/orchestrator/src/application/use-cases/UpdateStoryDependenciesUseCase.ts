import { createHash } from 'node:crypto';
import {
  now,
  createStoryId,
  validateStoryDependencies,
  MissingStoryDependencyNodeError,
  StorySelfDependencyError,
  StoryDependencyCycleError,
  type Story
} from '@solutions-studio/domain';
import type { ProjectionMetadataDto } from '@solutions-studio/contracts';
import type {
  IRequirementsRepository,
  StoryRecord,
  ProjectionRecord
} from '../ports/persistence/IRequirementsRepository.js';
import { UnknownStoryError, StoryProvenanceValidationError } from './StoryProjectionErrors.js';
import { mapStoryRecordToDomainStory } from './BuildStoryDependencyGraphUseCase.js';

export interface UpdateStoryDependenciesInput {
  readonly storyId: string;
  readonly dependencies: readonly string[];
}

export function synchronizeGherkinDependencies(
  gherkinText: string,
  dependencies: readonly string[]
): string {
  const lines = gherkinText.split(/\r?\n/);
  const depTagLine = dependencies.length > 0 ? `# @depends-on: ${dependencies.join(', ')}` : null;

  let replaced = false;
  const newLines: string[] = [];

  for (const line of lines) {
    if (/^#\s*@(depends-on|dependencies)(?::)?/i.test(line.trim())) {
      if (depTagLine !== null && !replaced) {
        newLines.push(depTagLine);
        replaced = true;
      }
      // If depTagLine is null (dependencies emptied), line is omitted
    } else {
      newLines.push(line);
    }
  }

  if (depTagLine !== null && !replaced) {
    // Insert after # @requirements or other header comments, or before Feature:
    let insertIdx = -1;
    for (let i = 0; i < newLines.length; i++) {
      const l = newLines[i].trim();
      if (/^#\s*@(requirements|req|policy-constraints|baseline)(?::)?/i.test(l)) {
        insertIdx = i + 1;
      } else if (/^Feature:/i.test(l) && insertIdx === -1) {
        insertIdx = i;
        break;
      }
    }

    if (insertIdx !== -1) {
      newLines.splice(insertIdx, 0, depTagLine);
    } else {
      newLines.unshift(depTagLine);
    }
  }

  return newLines.join('\n');
}

export class UpdateStoryDependenciesUseCase {
  constructor(private readonly repository: IRequirementsRepository) {}

  async execute(input: UpdateStoryDependenciesInput): Promise<StoryRecord> {
    const targetStoryId = createStoryId(input.storyId);
    const existingStory = await this.repository.getStory(targetStoryId);
    if (!existingStory) {
      throw new UnknownStoryError(input.storyId);
    }

    return this.repository.withBaselineLock(existingStory.baselineId, async () => {
      const story = await this.repository.getStory(targetStoryId);
      if (!story) {
        throw new UnknownStoryError(input.storyId);
      }

      const baselineStories = await this.repository.listStories(story.baselineId);
      const baselineStoryMap = new Map(baselineStories.map((s) => [s.id as string, s]));

      // Validate linked projection existence and provenance
      if (!story.projectionId) {
        throw new StoryProvenanceValidationError(
          `Story '${story.id}' is missing a linked projection ID`,
          story.baselineId
        );
      }

      const linkedProjection = await this.repository.getProjectionRecord(story.projectionId);
      if (!linkedProjection) {
        throw new StoryProvenanceValidationError(
          `Missing linked projection '${story.projectionId}' for story '${story.id}'`,
          story.baselineId
        );
      }

      if (linkedProjection.baselineId !== story.baselineId) {
        throw new StoryProvenanceValidationError(
          `Cross-baseline projection mismatch: projection '${linkedProjection.id}' belongs to baseline '${linkedProjection.baselineId}', expected '${story.baselineId}'`,
          story.baselineId
        );
      }

      if (linkedProjection.artifactType !== 'stories') {
        throw new StoryProvenanceValidationError(
          `Invalid projection artifact type: projection '${linkedProjection.id}' has type '${linkedProjection.artifactType}', expected 'stories'`,
          story.baselineId
        );
      }

      // Validate no ambiguous sharing of projection across distinct stories
      const sharingStories = baselineStories.filter(
        (s) => s.id !== story.id && s.projectionId === story.projectionId
      );
      if (sharingStories.length > 0) {
        throw new StoryProvenanceValidationError(
          `Ambiguously shared projection '${story.projectionId}': shared by stories '${story.id}' and '${sharingStories.map((s) => s.id).join(', ')}'`,
          story.baselineId
        );
      }

      // Deduplicate and sort requested dependencies
      const sortedDeps = Array.from(new Set(input.dependencies)).sort((a, b) => a.localeCompare(b));

      // Validate self-dependencies
      if (sortedDeps.includes(story.id)) {
        throw new StorySelfDependencyError(story.id);
      }

      // Validate existence in baseline
      for (const dep of sortedDeps) {
        if (!baselineStoryMap.has(dep)) {
          throw new MissingStoryDependencyNodeError(story.id, dep);
        }
      }

      // Construct candidate stories to validate cycle freedom
      const candidateStories: Story[] = baselineStories.map((s) => {
        if (s.id === story.id) {
          const candidateRecord: StoryRecord = {
            ...s,
            dependencies:
              sortedDeps.length > 0
                ? Object.freeze(sortedDeps.map((d) => createStoryId(d)))
                : undefined
          };
          return mapStoryRecordToDomainStory(candidateRecord);
        }
        return mapStoryRecordToDomainStory(s);
      });

      const validation = validateStoryDependencies(candidateStories);
      if (validation.cycles.length > 0) {
        throw new StoryDependencyCycleError(validation.cycles[0]);
      }

      // Synchronize Gherkin text and recalculate contentHash
      const updatedGherkinText = synchronizeGherkinDependencies(story.gherkinText, sortedDeps);
      const newContentHash = createHash('sha256').update(updatedGherkinText).digest('hex');

      const updatedMetadata: ProjectionMetadataDto = {
        ...story.metadata,
        measuredVerification: {
          ...story.metadata.measuredVerification,
          contentHash: newContentHash,
          verifiedAt: now()
        }
      };

      const updatedStory: StoryRecord = {
        ...story,
        dependencies: Object.freeze(sortedDeps.map((d) => createStoryId(d))),
        gherkinText: updatedGherkinText,
        metadata: updatedMetadata
      };

      const updatedProjection: ProjectionRecord = {
        ...linkedProjection,
        content: updatedGherkinText,
        metadata: updatedMetadata
      };

      // Atomic paired persistence under baseline lock with rollback safety
      await this.repository.updateStoryAndProjection(updatedStory, updatedProjection);

      return updatedStory;
    });
  }
}
