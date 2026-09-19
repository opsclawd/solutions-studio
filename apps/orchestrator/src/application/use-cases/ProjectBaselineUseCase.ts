import { createHash, randomUUID } from 'node:crypto';
import {
  now,
  EmptyBaselineError,
  createRequirementsBaselineId,
  type RequirementsBaselineId,
  type RequirementRevision
} from '@solutions-studio/domain';
import type { ProjectionMetadataDto } from '@solutions-studio/contracts';
import type {
  IRequirementsRepository,
  ProjectionRecord
} from '../ports/persistence/IRequirementsRepository.js';
import type {
  GenerateArtifactUseCase,
  GenerateArtifactOptions
} from './GenerateArtifactUseCase.js';
import type {
  BaselineProjectionResult,
  GeneratePrototypeProjectionUseCase
} from './GeneratePrototypeProjectionUseCase.js';
import type { GenerateSqlSchemaProjectionUseCase } from './GenerateSqlSchemaProjectionUseCase.js';
import type { GenerateOpenApiProjectionUseCase } from './GenerateOpenApiProjectionUseCase.js';
import type { GenerateStoriesProjectionUseCase } from './GenerateStoriesProjectionUseCase.js';
import {
  UnknownRequirementRevisionError,
  UnknownRequirementsBaselineError
} from './ReconciliationErrors.js';

export interface ProjectBaselineInput {
  readonly baselineId: RequirementsBaselineId | string;
  readonly artifactType:
    'process-diagram' | 'state-diagram' | 'prototype' | 'sql-schema' | 'openapi' | 'stories';
  readonly prompt?: string;
  readonly options?: GenerateArtifactOptions;
  readonly id?: string;
}

export type { BaselineProjectionResult };

export class ProjectBaselineUseCase {
  constructor(
    private readonly generateArtifactUseCase: GenerateArtifactUseCase,
    private readonly repository: IRequirementsRepository,
    private readonly providerName: string = 'fake',
    private readonly generatePrototypeProjectionUseCase?: GeneratePrototypeProjectionUseCase,
    private readonly generateSqlSchemaProjectionUseCase?: GenerateSqlSchemaProjectionUseCase,
    private readonly generateOpenApiProjectionUseCase?: GenerateOpenApiProjectionUseCase,
    private readonly generateStoriesProjectionUseCase?: GenerateStoriesProjectionUseCase
  ) {}

  async project(input: ProjectBaselineInput): Promise<BaselineProjectionResult> {
    if (input.artifactType === 'prototype') {
      if (!this.generatePrototypeProjectionUseCase) {
        throw new Error(
          'GeneratePrototypeProjectionUseCase not configured on ProjectBaselineUseCase'
        );
      }
      return this.generatePrototypeProjectionUseCase.execute({
        baselineId: input.baselineId,
        prompt: input.prompt,
        options: input.options,
        id: input.id
      });
    }

    if (input.artifactType === 'sql-schema') {
      if (!this.generateSqlSchemaProjectionUseCase) {
        throw new Error(
          'GenerateSqlSchemaProjectionUseCase not configured on ProjectBaselineUseCase'
        );
      }
      return this.generateSqlSchemaProjectionUseCase.execute({
        baselineId: input.baselineId,
        prompt: input.prompt,
        options: input.options,
        id: input.id
      });
    }

    if (input.artifactType === 'openapi') {
      if (!this.generateOpenApiProjectionUseCase) {
        throw new Error(
          'GenerateOpenApiProjectionUseCase not configured on ProjectBaselineUseCase'
        );
      }
      return this.generateOpenApiProjectionUseCase.execute({
        baselineId: input.baselineId,
        prompt: input.prompt,
        options: input.options,
        id: input.id
      });
    }

    if (input.artifactType === 'stories') {
      if (!this.generateStoriesProjectionUseCase) {
        throw new Error(
          'GenerateStoriesProjectionUseCase not configured on ProjectBaselineUseCase'
        );
      }
      return this.generateStoriesProjectionUseCase.execute({
        baselineId: input.baselineId,
        prompt: input.prompt,
        options: input.options,
        id: input.id
      });
    }

    const baselineId = createRequirementsBaselineId(input.baselineId);
    const baseline = await this.repository.getRequirementsBaseline(baselineId);
    if (!baseline) {
      throw new UnknownRequirementsBaselineError(input.baselineId);
    }

    if (!baseline.requirementRevisions || baseline.requirementRevisions.length === 0) {
      throw new EmptyBaselineError();
    }

    const revisions: RequirementRevision[] = [];
    for (const revId of baseline.requirementRevisions) {
      const rev = await this.repository.getRequirementRevision(revId);
      if (!rev) {
        throw new UnknownRequirementRevisionError(revId);
      }
      revisions.push(rev);
    }

    const defaultPrompt =
      `Generate a Mermaid ${input.artifactType} for requirements baseline ${baseline.id}:\n` +
      revisions.map((r) => `- [${r.id}] ${r.statement}`).join('\n');

    const prompt = input.prompt ?? defaultPrompt;
    const generationResult = await this.generateArtifactUseCase.generateFromPrompt(
      prompt,
      input.options
    );

    const contentHash = createHash('sha256').update(generationResult.content).digest('hex');

    const metadata: ProjectionMetadataDto = {
      baselineId: baseline.id,
      requirementRevisionIds: [...baseline.requirementRevisions],
      artifactType: input.artifactType,
      declaredProvenance: {
        baselineId: baseline.id,
        requirementRevisionIds: [...baseline.requirementRevisions]
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
      baselineId: baseline.id,
      requirementRevisionIds: baseline.requirementRevisions,
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

  async getProjection(projectionId: string): Promise<ProjectionRecord | undefined> {
    return this.repository.getProjectionRecord(projectionId);
  }
}
