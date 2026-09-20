import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { seedReviewFixture } from '../../scripts/seed-review-fixture.js';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';

describe('Review Fixture Integrity', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-fixture-test-'));
    await seedReviewFixture(tempDir);
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('verifies that every seeded story resolves to a valid projection and hashes match exact content', async () => {
    const stories = await repo.listStories();
    expect(stories.length).toBeGreaterThan(0);

    for (const story of stories) {
      // 1. Every story must have a projectionId
      expect(story.projectionId).toBeDefined();
      expect(typeof story.projectionId).toBe('string');

      // 2. The projection record must exist in the repository
      const proj = await repo.getProjectionRecord(story.projectionId!);
      expect(
        proj,
        `Projection '${story.projectionId}' for story '${story.id}' must exist`
      ).toBeDefined();

      // 3. Provenance and lineage consistency
      expect(proj!.baselineId).toBe(story.baselineId);
      expect(proj!.artifactType).toBe('stories');
      expect(proj!.content).toBe(story.gherkinText);

      // 4. Content hashes match exact Gherkin content
      const computedHash = createHash('sha256').update(story.gherkinText).digest('hex');
      expect(story.metadata.measuredVerification?.contentHash).toBe(computedHash);
      expect(proj!.metadata.measuredVerification?.contentHash).toBe(computedHash);
    }
  });

  it('verifies that every seeded projection has a measured verification hash matching its exact content', async () => {
    const projections = await repo.listProjectionRecords();
    expect(projections.length).toBeGreaterThan(0);

    for (const proj of projections) {
      const computedHash = createHash('sha256').update(proj.content).digest('hex');
      expect(
        proj.metadata.measuredVerification?.contentHash,
        `Projection '${proj.id}' (${proj.artifactType}) content hash must match computed SHA-256`
      ).toBe(computedHash);
    }
  });
});
