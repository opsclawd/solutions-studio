import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import {
  createRequirementsBaselineId,
  createStoryId,
  createActorId,
  createReviewerId,
  createBacklogExportMapping,
  createBacklogExportMappingId,
  now
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { PostgresRequirementsRepository } from '../../../src/infrastructure/persistence/postgres/PostgresRequirementsRepository.js';
import { PGliteDatabaseClient } from '../../../src/infrastructure/persistence/postgres/PGliteDatabaseClient.js';
import { SchemaMigrationRunner } from '../../../src/infrastructure/persistence/postgres/SchemaMigrationRunner.js';
import { InMemoryObjectStore } from '../../../src/infrastructure/persistence/object-store/InMemoryObjectStore.js';
import { ImmutableRecordConflictError } from '../../../src/application/ports/persistence/IRequirementsRepository.js';

describe('BacklogExportMapping Persistence & Process-Restart Durability', () => {
  describe('FilesystemRequirementsRepository', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-bmap-test-'));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('persists mapping, survives repository re-instantiation, and enforces unique constraints', async () => {
      const repo1 = new FilesystemRequirementsRepository({ baseDir: tempDir });

      const mappingId = createBacklogExportMappingId('bmap-fs-1');
      const storyId = createStoryId('STORY-FS-1');
      const baselineId = createRequirementsBaselineId('BASE-FS-1');

      const mapping = createBacklogExportMapping({
        id: mappingId,
        storyId,
        baselineId,
        provider: 'github-issues',
        externalContainer: 'acme/repo',
        externalWorkItemId: '101',
        externalUrl: 'https://github.com/acme/repo/issues/101',
        exportContentHash: 'a'.repeat(64),
        exportedAt: '2026-09-20T10:00:00.000Z',
        exportedBy: 'actor-1',
        metadata: { tag: 'initial' }
      });

      await repo1.saveBacklogExportMapping(mapping);

      // Simulate process restart by re-instantiating repository
      const repo2 = new FilesystemRequirementsRepository({ baseDir: tempDir });

      const loaded = await repo2.getBacklogExportMapping(mappingId);
      expect(loaded).toBeDefined();
      expect(loaded?.id).toBe(mappingId);
      expect(loaded?.storyId).toBe(storyId);
      expect(loaded?.baselineId).toBe(baselineId);
      expect(loaded?.provider).toBe('github-issues');
      expect(loaded?.externalContainer).toBe('acme/repo');
      expect(loaded?.externalWorkItemId).toBe('101');
      expect(loaded?.exportContentHash).toBe('a'.repeat(64));
      expect(loaded?.metadata).toEqual({ tag: 'initial' });

      // Find by (provider, container, storyId)
      const found = await repo2.findBacklogExportMapping({
        provider: 'github-issues',
        externalContainer: 'acme/repo',
        storyId
      });
      expect(found).toBeDefined();
      expect(found?.id).toBe(mappingId);

      // Update mapping
      const updatedMapping = createBacklogExportMapping({
        ...mapping,
        exportContentHash: 'b'.repeat(64),
        exportedAt: '2026-09-20T11:00:00.000Z',
        metadata: { tag: 'updated' }
      });
      await repo2.updateBacklogExportMapping(updatedMapping);

      // Re-instantiate again
      const repo3 = new FilesystemRequirementsRepository({ baseDir: tempDir });
      const reloaded = await repo3.getBacklogExportMapping(mappingId);
      expect(reloaded?.exportContentHash).toBe('b'.repeat(64));
      expect(reloaded?.metadata).toEqual({ tag: 'updated' });

      // Unique constraint enforcement: cannot save duplicate (provider, externalContainer, storyId) with different ID
      const duplicateMapping = createBacklogExportMapping({
        id: createBacklogExportMappingId('bmap-fs-2'),
        storyId,
        baselineId,
        provider: 'github-issues',
        externalContainer: 'acme/repo',
        externalWorkItemId: '102',
        exportContentHash: 'c'.repeat(64),
        exportedAt: '2026-09-20T12:00:00.000Z',
        exportedBy: 'actor-2'
      });

      await expect(repo3.saveBacklogExportMapping(duplicateMapping)).rejects.toThrow(
        ImmutableRecordConflictError
      );
    });
  });

  describe('PostgresRequirementsRepository', () => {
    let pglite: PGlite;
    let dbClient: PGliteDatabaseClient;
    let objectStore: InMemoryObjectStore;

    beforeEach(async () => {
      pglite = new PGlite();
      dbClient = new PGliteDatabaseClient({ pgliteInstance: pglite });
      const runner = new SchemaMigrationRunner({ db: dbClient });
      await runner.migrate();
      objectStore = new InMemoryObjectStore();
    }, 30000);

    afterEach(async () => {
      await dbClient.close().catch(() => {});
      await pglite.close().catch(() => {});
    });

    it('persists mapping, survives restart, and enforces unique and foreign key constraints', async () => {
      const repo1 = new PostgresRequirementsRepository({
        db: dbClient,
        objectStore
      });

      // Setup prerequisite baseline and story
      const baselineId = createRequirementsBaselineId('BASE-PG-1');
      await repo1.saveRequirementsBaseline({
        id: baselineId,
        requirementRevisions: [],
        policyConstraintRevisions: [],
        createdAt: now(),
        createdBy: createReviewerId('REVIEWER-1')
      });

      const storyId = createStoryId('STORY-PG-1');
      await repo1.saveStory({
        id: storyId,
        baselineId,
        projectionId: 'proj-1',
        title: 'PG Story',
        narrative: { role: 'user', feature: 'feature', benefit: 'benefit' },
        requirementRevisionIds: [],
        scenarios: [],
        acceptanceCriteria: ['AC1'],
        gherkinText: 'Feature: Test',
        metadata: {
          baselineId,
          requirementRevisionIds: [],
          artifactType: 'stories',
          declaredProvenance: { baselineId, requirementRevisionIds: [] },
          configuredExecution: { provider: 'fake', artifactType: 'stories' },
          measuredVerification: {
            repairsNeeded: 0,
            attemptCount: 1,
            contentHash: 'h1',
            verifiedAt: now()
          }
        },
        createdAt: now()
      });

      const mappingId = createBacklogExportMappingId('bmap-pg-1');
      const mapping = createBacklogExportMapping({
        id: mappingId,
        storyId,
        baselineId,
        provider: 'github-issues',
        externalContainer: 'acme/pg-repo',
        externalWorkItemId: '201',
        externalUrl: 'https://github.com/acme/pg-repo/issues/201',
        exportContentHash: 'd'.repeat(64),
        exportedAt: '2026-09-20T10:00:00.000Z',
        exportedBy: createActorId('actor-pg'),
        metadata: { branch: 'develop' }
      });

      await repo1.saveBacklogExportMapping(mapping);

      // Simulate restart by re-instantiating PostgresRequirementsRepository
      const repo2 = new PostgresRequirementsRepository({
        db: dbClient,
        objectStore
      });

      const loaded = await repo2.getBacklogExportMapping(mappingId);
      expect(loaded).toBeDefined();
      expect(loaded?.id).toBe(mappingId);
      expect(loaded?.storyId).toBe(storyId);
      expect(loaded?.baselineId).toBe(baselineId);
      expect(loaded?.externalWorkItemId).toBe('201');
      expect(loaded?.exportContentHash).toBe('d'.repeat(64));
      expect(loaded?.metadata).toEqual({ branch: 'develop' });

      // Find by composite key
      const found = await repo2.findBacklogExportMapping({
        provider: 'github-issues',
        externalContainer: 'acme/pg-repo',
        storyId
      });
      expect(found).toBeDefined();
      expect(found?.id).toBe(mappingId);

      // Update mapping
      const updatedMapping = createBacklogExportMapping({
        ...mapping,
        exportContentHash: 'e'.repeat(64),
        exportedAt: '2026-09-20T12:00:00.000Z',
        metadata: { branch: 'main' }
      });
      await repo2.updateBacklogExportMapping(updatedMapping);

      const reloaded = await repo2.getBacklogExportMapping(mappingId);
      expect(reloaded?.exportContentHash).toBe('e'.repeat(64));
      expect(reloaded?.metadata).toEqual({ branch: 'main' });

      // Unique constraint enforcement on (provider, external_container, story_id)
      const duplicateMapping = createBacklogExportMapping({
        id: createBacklogExportMappingId('bmap-pg-2'),
        storyId,
        baselineId,
        provider: 'github-issues',
        externalContainer: 'acme/pg-repo',
        externalWorkItemId: '202',
        exportContentHash: 'f'.repeat(64),
        exportedAt: '2026-09-20T13:00:00.000Z',
        exportedBy: createActorId('actor-pg')
      });

      await expect(repo2.saveBacklogExportMapping(duplicateMapping)).rejects.toThrow();
    });
  });
});
