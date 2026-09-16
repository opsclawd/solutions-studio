import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadFixture } from '../evaluation/support/loadFixture.js';
import { loadManifest } from '../evaluation/support/loadManifest.js';

describe('Evaluation Support Loaders', () => {
  it('loadFixture throws descriptive error when expected.json is missing', () => {
    expect(() => loadFixture('/non/existent/directory')).toThrow(
      /Fixture ground truth not found: 'expected.json'/
    );
  });

  it('loadFixture loads a valid fixture by fixtureId', () => {
    const loaded = loadFixture('approval-threshold-contradiction-basic');
    expect(loaded.fixture.fixtureId).toBe('approval-threshold-contradiction-basic');
    expect(loaded.sourceRevisions.has('SOP-PROC-001-R1')).toBe(true);
    const rev = loaded.sourceRevisions.get('SOP-PROC-001-R1')!;
    expect(rev.sourceType).toBe('sop');
    expect(rev.revision).toBe(1);
    expect(rev.contentHash).toBeDefined();
    expect(rev.text).toContain('Corporate Procurement');
  });

  it('loadFixture maintains distinct content and hashes for multi-revision fixtures', () => {
    const loaded = loadFixture('superseded-source-revision');
    expect(loaded.sourceRevisions.size).toBe(2);

    const rev1 = loaded.sourceRevisions.get('SOP-DISCOUNT-001-R1')!;
    const rev2 = loaded.sourceRevisions.get('SOP-DISCOUNT-001-R2')!;

    expect(rev1.sourceId).toBe('SOP-DISCOUNT-001');
    expect(rev2.sourceId).toBe('SOP-DISCOUNT-001');
    expect(rev1.revision).toBe(1);
    expect(rev2.revision).toBe(2);

    // Hashes must be distinct because file contents differ
    expect(rev1.contentHash).not.toBe(rev2.contentHash);
    expect(rev1.text).toContain('up to 25%');
    expect(rev2.text).toContain('up to 15%');
  });

  it('loadManifest loads all fixtures declared in manifest', () => {
    const corpus = loadManifest();
    expect(corpus.manifest.fixtures.length).toBe(14);
    expect(corpus.fixtures.size).toBe(14);
  });

  it('loadManifest throws when manifest file does not exist', () => {
    expect(() => loadManifest('/missing/manifest.json')).toThrow(/Corpus manifest not found/);
  });

  describe('Path traversal and root confinement security', () => {
    const tmpBase = path.resolve(process.cwd(), '.ai-tmp', `loader-test-${Date.now()}`);

    beforeAll(() => {
      fs.mkdirSync(tmpBase, { recursive: true });
    });

    afterAll(() => {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    });

    it('loadFixture rejects source with traversal path (..)', () => {
      const fixtureDir = path.join(tmpBase, 'traversal-fixture');
      fs.mkdirSync(fixtureDir, { recursive: true });
      fs.writeFileSync(
        path.join(fixtureDir, 'expected.json'),
        JSON.stringify({
          fixtureId: 'test-traversal',
          version: '1.0.0',
          title: 'Test',
          description: 'Test',
          categories: ['contradictory-approval-thresholds'],
          canonicalMessyPackage: false,
          sources: [
            {
              sourceRevisionId: 'TEST-R1',
              sourceId: 'TEST',
              sourceType: 'sop',
              revision: 1,
              path: '../outside.md'
            }
          ],
          expectedRequirements: [],
          expectedFindings: [],
          expectedNonFindings: []
        })
      );

      expect(() => loadFixture(fixtureDir)).toThrow(
        /traversal|Path must be a relative path without traversal segments/i
      );
    });

    it('loadFixture rejects source with absolute path', () => {
      const fixtureDir = path.join(tmpBase, 'absolute-fixture');
      fs.mkdirSync(fixtureDir, { recursive: true });
      fs.writeFileSync(
        path.join(fixtureDir, 'expected.json'),
        JSON.stringify({
          fixtureId: 'test-absolute',
          version: '1.0.0',
          title: 'Test',
          description: 'Test',
          categories: ['contradictory-approval-thresholds'],
          canonicalMessyPackage: false,
          sources: [
            {
              sourceRevisionId: 'TEST-R1',
              sourceId: 'TEST',
              sourceType: 'sop',
              revision: 1,
              path: '/etc/passwd'
            }
          ],
          expectedRequirements: [],
          expectedFindings: [],
          expectedNonFindings: []
        })
      );

      expect(() => loadFixture(fixtureDir)).toThrow(
        /absolute|Path must be a relative path without traversal segments/i
      );
    });

    it('loadFixture rejects source when symlink escapes fixture root', () => {
      const fixtureDir = path.join(tmpBase, 'symlink-fixture');
      const outsideFile = path.join(tmpBase, 'outside-secret.md');
      fs.mkdirSync(fixtureDir, { recursive: true });
      fs.writeFileSync(outsideFile, 'confidential content');

      const symlinkPath = path.join(fixtureDir, 'source.md');
      fs.symlinkSync(outsideFile, symlinkPath);

      fs.writeFileSync(
        path.join(fixtureDir, 'expected.json'),
        JSON.stringify({
          fixtureId: 'test-symlink',
          version: '1.0.0',
          title: 'Test',
          description: 'Test',
          categories: ['contradictory-approval-thresholds'],
          canonicalMessyPackage: false,
          sources: [
            {
              sourceRevisionId: 'TEST-R1',
              sourceId: 'TEST',
              sourceType: 'sop',
              revision: 1,
              path: 'source.md'
            }
          ],
          expectedRequirements: [],
          expectedFindings: [],
          expectedNonFindings: []
        })
      );

      expect(() => loadFixture(fixtureDir)).toThrow(/escapes/i);
    });

    it('loadManifest rejects manifest entry with traversal path (..)', () => {
      const manifestPath = path.join(tmpBase, 'manifest-traversal.json');
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          corpusVersion: 'v1.0',
          generatedAt: '2026-09-16T12:00:00.000Z',
          fixtures: [
            {
              fixtureId: 'traversal-manifest',
              path: '../../outside',
              categories: ['contradictory-approval-thresholds'],
              canonicalMessyPackage: false
            }
          ]
        })
      );

      expect(() => loadManifest(manifestPath)).toThrow(
        /traversal|Path must be a relative path without traversal segments/i
      );
    });

    it('loadManifest rejects manifest entry with absolute path', () => {
      const manifestPath = path.join(tmpBase, 'manifest-absolute.json');
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          corpusVersion: 'v1.0',
          generatedAt: '2026-09-16T12:00:00.000Z',
          fixtures: [
            {
              fixtureId: 'absolute-manifest',
              path: '/etc/fixtures',
              categories: ['contradictory-approval-thresholds'],
              canonicalMessyPackage: false
            }
          ]
        })
      );

      expect(() => loadManifest(manifestPath)).toThrow(
        /absolute|Path must be a relative path without traversal segments/i
      );
    });

    it('loadManifest rejects manifest entry that resolves outside evaluation root', () => {
      const outsideFixtureDir = path.join(tmpBase, 'outside-fixture');
      fs.mkdirSync(outsideFixtureDir, { recursive: true });
      fs.writeFileSync(
        path.join(outsideFixtureDir, 'expected.json'),
        JSON.stringify({
          fixtureId: 'outside-fixture',
          version: '1.0.0',
          title: 'Test',
          description: 'Test',
          categories: ['contradictory-approval-thresholds'],
          canonicalMessyPackage: false,
          sources: [
            {
              sourceRevisionId: 'OUT-R1',
              sourceId: 'OUT',
              sourceType: 'sop',
              revision: 1,
              path: 'source.md'
            }
          ],
          expectedRequirements: [],
          expectedFindings: [],
          expectedNonFindings: []
        })
      );
      fs.writeFileSync(path.join(outsideFixtureDir, 'source.md'), 'test content');

      const manifestPath = path.join(tmpBase, 'manifest-outside.json');
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          corpusVersion: 'v1.0',
          generatedAt: '2026-09-16T12:00:00.000Z',
          fixtures: [
            {
              fixtureId: 'outside-fixture',
              path: 'outside-fixture',
              categories: ['contradictory-approval-thresholds'],
              canonicalMessyPackage: false
            }
          ]
        })
      );

      expect(() => loadManifest(manifestPath)).toThrow(/escapes/i);
    });
  });
});
