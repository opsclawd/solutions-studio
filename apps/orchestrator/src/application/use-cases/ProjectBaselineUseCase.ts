import { createHash, randomUUID } from 'node:crypto';
import {
  now,
  EmptyBaselineError,
  type RequirementsBaseline,
  type RequirementRevision
} from '@solutions-studio/domain';
import type { ProjectionMetadataDto } from '@solutions-studio/contracts';
import type {
  IRequirementsRepository,
  ProjectionRecord
} from '../ports/persistence/IRequirementsRepository.js';
import type {
  GenerateArtifactUseCase,
  GenerateArtifactOptions,
  RepairAttemptRecord
} from './GenerateArtifactUseCase.js';
import { UnknownRequirementRevisionError } from './ReconciliationErrors.js';

export interface ProjectBaselineInput {
  readonly baseline: RequirementsBaseline;
  readonly artifactType: 'process-diagram' | 'state-diagram';
  readonly prompt?: string;
  readonly options?: GenerateArtifactOptions;
  readonly id?: string;
}

export interface BaselineProjectionResult {
  readonly projectionId: string;
  readonly content: string;
  readonly metadata: ProjectionMetadataDto;
  readonly repairHistory: readonly RepairAttemptRecord[];
}

export class ProjectBaselineUseCase {
  constructor(
    private readonly generateArtifactUseCase: GenerateArtifactUseCase,
    private readonly repository: IRequirementsRepository,
    private readonly providerName: string = 'fake'
  ) {}

  async project(input: ProjectBaselineInput): Promise<BaselineProjectionResult> {
    if (
      !input.baseline ||
      !input.baseline.requirementRevisions ||
      input.baseline.requirementRevisions.length === 0
    ) {
      throw new EmptyBaselineError();
    }

    const revisions: RequirementRevision[] = [];
    for (const revId of input.baseline.requirementRevisions) {
      const rev = await this.repository.getRequirementRevision(revId);
      if (!rev) {
        throw new UnknownRequirementRevisionError(revId);
      }
      revisions.push(rev);
    }

    const defaultPrompt =
      `Generate a Mermaid ${input.artifactType} for requirements baseline ${input.baseline.id}:\n` +
      revisions.map((r) => `- [${r.id}] ${r.statement}`).join('\n');

    const prompt = input.prompt ?? defaultPrompt;
    const generationResult = await this.generateArtifactUseCase.generateFromPrompt(
      prompt,
      input.options
    );

    const contentHash = createHash('sha256').update(generationResult.content).digest('hex');

    const metadata: ProjectionMetadataDto = {
      baselineId: input.baseline.id,
      requirementRevisionIds: [...input.baseline.requirementRevisions],
      artifactType: input.artifactType,
      declaredProvenance: {
        baselineId: input.baseline.id,
        requirementRevisionIds: [...input.baseline.requirementRevisions]
      },
      configuredExecution: {
        provider: this.providerName,
        artifactType: input.artifactType
      },
      measuredVerification: {
        repairsNeeded: generationResult.repairsNeeded,
        attemptCount: generationResult.repairHistory.length + 1,
        contentHash,
        verifiedAt: now()
      }
    };

    const projectionId = input.id ?? `PROJ-${randomUUID()}`;
    const record: ProjectionRecord = {
      id: projectionId,
      baselineId: input.baseline.id,
      requirementRevisionIds: input.baseline.requirementRevisions,
      artifactType: input.artifactType,
      content: generationResult.content,
      metadata,
      createdAt: now()
    };

    await this.repository.saveProjectionRecord(record);

    return {
      projectionId,
      content: generationResult.content,
      metadata,
      repairHistory: generationResult.repairHistory
    };
  }
}
