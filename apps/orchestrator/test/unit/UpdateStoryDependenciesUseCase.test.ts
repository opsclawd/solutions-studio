import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {
  createRequirementsBaselineId,
  createStoryId,
  createRequirementRevisionId,
  now,
  StoryDependencyCycleError,
  StorySelfDependencyError,
  MissingStoryDependencyNodeError
} from '@solutions-studio/domain';
import { UpdateStoryDependenciesUseCase } from '../../src/application/use-cases/UpdateStoryDependenciesUseCase.js';
import type {
  IRequirementsRepository,
  StoryRecord,
  ProjectionRecord
} from '../../src/application/ports/persistence/IRequirementsRepository.js';
import {
  UnknownStoryError,
  StoryProvenanceValidationError
} from '../../src/application/use-cases/StoryProjectionErrors.js';
import type { ProjectionMetadataDto } from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';

describe('UpdateStoryDependenciesUseCase', () => {
  const baselineId = createRequirementsBaselineId('BASE-001');
  const req1 = createRequirementRevisionId('REQ-001-R1');

  const mockMetadata: ProjectionMetadataDto = {
    baselineId: baselineId as string,
    requirementRevisionIds: [req1 as string],
    artifactType: 'stories',
    declaredProvenance: {
      baselineId: baselineId as string,
      requirementRevisionIds: [req1 as string]
    },
    configuredExecution: { provider: 'fake', artifactType: 'stories' },
    measuredVerification: {
      attemptCount: 1,
      repairsNeeded: 0,
      contentHash: 'hash-init',
      verifiedAt: now()
    }
  };

  let stories: Map<string, StoryRecord>;
  let projections: Map<string, ProjectionRecord>;
  let mockRepository: Partial<IRequirementsRepository>;
  let useCase: UpdateStoryDependenciesUseCase;

  beforeEach(() => {
    stories = new Map();
    projections = new Map();

    const story1: StoryRecord = {
      id: createStoryId('STORY-001'),
      baselineId,
      projectionId: 'PROJ-001',
      title: 'Story 1',
      narrative: { role: 'user', feature: 'feature 1', benefit: 'benefit 1' },
      requirementRevisionIds: [req1],
      policyConstraintRevisionIds: [],
      scenarios: [
        {
          title: 'S1',
          requirementRevisionIds: [req1],
          steps: [{ keyword: 'Given', text: 'x' }]
        }
      ],
      acceptanceCriteria: ['AC1'],
      gherkinText: 'Feature: Story 1\n\nScenario: S1\nGiven x',
      dependencies: [],
      metadata: mockMetadata,
      createdAt: now()
    };

    const proj1: ProjectionRecord = {
      id: 'PROJ-001',
      baselineId,
      requirementRevisionIds: [req1],
      artifactType: 'stories',
      content: story1.gherkinText,
      metadata: mockMetadata,
      createdAt: now()
    };

    const story2: StoryRecord = {
      id: createStoryId('STORY-002'),
      baselineId,
      projectionId: 'PROJ-002',
      title: 'Story 2',
      narrative: { role: 'user', feature: 'feature 2', benefit: 'benefit 2' },
      requirementRevisionIds: [req1],
      policyConstraintRevisionIds: [],
      scenarios: [
        {
          title: 'S2',
          requirementRevisionIds: [req1],
          steps: [{ keyword: 'Given', text: 'y' }]
        }
      ],
      acceptanceCriteria: ['AC1'],
      gherkinText: 'Feature: Story 2\n# @depends-on: STORY-001\n\nScenario: S2\nGiven y',
      dependencies: [createStoryId('STORY-001')],
      metadata: mockMetadata,
      createdAt: now()
    };

    const proj2: ProjectionRecord = {
      id: 'PROJ-002',
      baselineId,
      requirementRevisionIds: [req1],
      artifactType: 'stories',
      content: story2.gherkinText,
      metadata: mockMetadata,
      createdAt: now()
    };

    stories.set('STORY-001', story1);
    stories.set('STORY-002', story2);
    projections.set('PROJ-001', proj1);
    projections.set('PROJ-002', proj2);

    mockRepository = {
      getStory: async (id) => stories.get(id as string) ?? undefined,
      listStories: async () => Array.from(stories.values()),
      withBaselineLock: async (_bId, fn) => fn(),
      updateStory: async (story) => {
        stories.set(story.id as string, story);
      },
      getProjectionRecord: async (id) => projections.get(id) ?? undefined,
      updateProjectionRecord: async (rec) => {
        projections.set(rec.id, rec);
      },
      updateStoryAndProjection: async (story, projection) => {
        stories.set(story.id as string, story);
        projections.set(projection.id, projection);
      }
    };

    useCase = new UpdateStoryDependenciesUseCase(mockRepository as IRequirementsRepository);
  });

  it('throws UnknownStoryError if story does not exist', async () => {
    await expect(useCase.execute({ storyId: 'NON-EXISTENT', dependencies: [] })).rejects.toThrow(
      UnknownStoryError
    );
  });

  it('throws StorySelfDependencyError if story depends on itself', async () => {
    await expect(
      useCase.execute({ storyId: 'STORY-001', dependencies: ['STORY-001'] })
    ).rejects.toThrow(StorySelfDependencyError);
  });

  it('throws MissingStoryDependencyNodeError if dependency is not in the baseline', async () => {
    await expect(
      useCase.execute({ storyId: 'STORY-001', dependencies: ['STORY-999'] })
    ).rejects.toThrow(MissingStoryDependencyNodeError);
  });

  it('throws StoryDependencyCycleError if adding dependency creates a cycle', async () => {
    await expect(
      useCase.execute({ storyId: 'STORY-001', dependencies: ['STORY-002'] })
    ).rejects.toThrow(StoryDependencyCycleError);
  });

  it('throws StoryProvenanceValidationError if story has no projectionId or projection does not exist', async () => {
    const s2 = stories.get('STORY-002')!;
    stories.set('STORY-002', { ...s2, projectionId: 'PROJ-NONEXISTENT' });

    await expect(useCase.execute({ storyId: 'STORY-002', dependencies: [] })).rejects.toThrow(
      StoryProvenanceValidationError
    );
  });

  it('throws StoryProvenanceValidationError if linked projection belongs to a different baseline', async () => {
    const p2 = projections.get('PROJ-002')!;
    projections.set('PROJ-002', { ...p2, baselineId: createRequirementsBaselineId('OTHER-BASE') });

    await expect(useCase.execute({ storyId: 'STORY-002', dependencies: [] })).rejects.toThrow(
      StoryProvenanceValidationError
    );
  });

  it('throws StoryProvenanceValidationError if linked projection is not of type stories', async () => {
    const p2 = projections.get('PROJ-002')!;
    projections.set('PROJ-002', { ...p2, artifactType: 'sql-schema' });

    await expect(useCase.execute({ storyId: 'STORY-002', dependencies: [] })).rejects.toThrow(
      StoryProvenanceValidationError
    );
  });

  it('throws StoryProvenanceValidationError if projection link is ambiguously shared across stories', async () => {
    const s1 = stories.get('STORY-001')!;
    stories.set('STORY-001', { ...s1, projectionId: 'PROJ-002' }); // Both STORY-001 and STORY-002 point to PROJ-002

    await expect(useCase.execute({ storyId: 'STORY-002', dependencies: [] })).rejects.toThrow(
      StoryProvenanceValidationError
    );
  });

  it('updates dependencies, synchronizes Gherkin # @depends-on tag, and updates projection record', async () => {
    const updated = await useCase.execute({
      storyId: 'STORY-002',
      dependencies: []
    });

    expect(updated.dependencies).toEqual([]);
    expect(updated.gherkinText).not.toContain('# @depends-on');
    expect(stories.get('STORY-002')?.dependencies).toEqual([]);

    // Check projection record update
    const proj2 = projections.get('PROJ-002');
    expect(proj2).toBeDefined();
    expect(proj2?.content).toBe(updated.gherkinText);
    expect(proj2?.content).not.toContain('# @depends-on');
  });

  it('adds # @depends-on tag into Gherkin when new dependencies are added', async () => {
    const story3: StoryRecord = {
      id: createStoryId('STORY-003'),
      baselineId,
      projectionId: 'PROJ-003',
      title: 'Story 3',
      narrative: { role: 'user', feature: 'feature 3', benefit: 'benefit 3' },
      requirementRevisionIds: [req1],
      policyConstraintRevisionIds: [],
      scenarios: [
        {
          title: 'S3',
          requirementRevisionIds: [req1],
          steps: [{ keyword: 'Given', text: 'z' }]
        }
      ],
      acceptanceCriteria: ['AC1'],
      gherkinText: 'Feature: Story 3\n\nScenario: S3\nGiven z',
      dependencies: [],
      metadata: mockMetadata,
      createdAt: now()
    };
    const proj3: ProjectionRecord = {
      id: 'PROJ-003',
      baselineId,
      requirementRevisionIds: [req1],
      artifactType: 'stories',
      content: story3.gherkinText,
      metadata: mockMetadata,
      createdAt: now()
    };
    stories.set('STORY-003', story3);
    projections.set('PROJ-003', proj3);

    const updated = await useCase.execute({
      storyId: 'STORY-003',
      dependencies: ['STORY-001', 'STORY-002']
    });

    expect(updated.dependencies).toEqual(['STORY-001', 'STORY-002']);
    expect(updated.gherkinText).toContain('# @depends-on: STORY-001, STORY-002');
  });

  describe('Rollback Safety with FilesystemRequirementsRepository', () => {
    let tempDir: string;
    let fsRepo: FilesystemRequirementsRepository;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rollback-test-'));
      fsRepo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    });

    it('rolls back story update if writing projection fails', async () => {
      const initialStory: StoryRecord = {
        id: createStoryId('STORY-ROLLBACK'),
        baselineId,
        projectionId: 'PROJ-ROLLBACK',
        title: 'Original Story',
        narrative: { role: 'dev', feature: 'feat', benefit: 'ben' },
        requirementRevisionIds: [req1],
        policyConstraintRevisionIds: [],
        scenarios: [],
        acceptanceCriteria: [],
        gherkinText: 'Feature: Original',
        dependencies: [],
        metadata: mockMetadata,
        createdAt: now()
      };
      await fsRepo.saveStory(initialStory);

      // Mutated story and an invalid projection whose path cannot be written (directory conflict or invalid path)
      const mutatedStory: StoryRecord = {
        ...initialStory,
        title: 'Mutated Story',
        gherkinText: 'Feature: Mutated'
      };

      // Create a directory at the projection's destination to make writeJsonAtomic throw EISDIR
      const projPath = path.join(tempDir, 'projections', 'PROJ-FAIL.json');
      await fs.mkdir(projPath, { recursive: true });

      const failingProjection: ProjectionRecord = {
        id: 'PROJ-FAIL',
        baselineId,
        requirementRevisionIds: [req1],
        artifactType: 'stories',
        content: 'Feature: Fail',
        metadata: mockMetadata,
        createdAt: now()
      };

      await expect(
        fsRepo.updateStoryAndProjection(mutatedStory, failingProjection)
      ).rejects.toThrow();

      // Assert that story on disk was rolled back to its original state
      const storyOnDisk = await fsRepo.getStory(initialStory.id);
      expect(storyOnDisk?.title).toBe('Original Story');
      expect(storyOnDisk?.gherkinText).toBe('Feature: Original');
    });
  });
});
