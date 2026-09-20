import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createBacklogExportMapping,
  createBacklogExportMappingId,
  createRequirementsBaselineId,
  createStoryId,
  createActorId,
  createAuthenticatedActor,
  now
} from '@solutions-studio/domain';
import { GetBacklogExportMappingsUseCase } from '../../src/application/use-cases/GetBacklogExportMappingsUseCase.js';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('GetBacklogExportMappingsUseCase', () => {
  let tempDir: string;
  let repository: FilesystemRequirementsRepository;
  let useCase: GetBacklogExportMappingsUseCase;

  const actor = createAuthenticatedActor({
    id: 'test-actor',
    name: 'Test Actor',
    actorType: 'human',
    capabilities: ['backlog:export']
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'get-mappings-test-'));
    repository = new FilesystemRequirementsRepository({ baseDir: tempDir });
    useCase = new GetBacklogExportMappingsUseCase(repository);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('lists mappings filtered by baseline and story', async () => {
    const baseline1 = createRequirementsBaselineId('BASE-1');
    const baseline2 = createRequirementsBaselineId('BASE-2');
    const story1 = createStoryId('STORY-1');
    const story2 = createStoryId('STORY-2');

    const m1 = createBacklogExportMapping({
      id: createBacklogExportMappingId('MAP-1'),
      storyId: story1,
      baselineId: baseline1,
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '101',
      exportContentHash: 'a'.repeat(64),
      exportedAt: now(),
      exportedBy: createActorId('actor-1')
    });

    const m2 = createBacklogExportMapping({
      id: createBacklogExportMappingId('MAP-2'),
      storyId: story2,
      baselineId: baseline2,
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '102',
      exportContentHash: 'b'.repeat(64),
      exportedAt: now(),
      exportedBy: createActorId('actor-1')
    });

    await repository.saveBacklogExportMapping(m1);
    await repository.saveBacklogExportMapping(m2);

    const all = await useCase.execute({ actor });
    expect(all).toHaveLength(2);

    const filteredBaseline = await useCase.execute({ baselineId: baseline1, actor });
    expect(filteredBaseline).toHaveLength(1);
    expect(filteredBaseline[0].id).toBe('MAP-1');

    const filteredStory = await useCase.execute({ storyId: story2, actor });
    expect(filteredStory).toHaveLength(1);
    expect(filteredStory[0].id).toBe('MAP-2');
  });
});
