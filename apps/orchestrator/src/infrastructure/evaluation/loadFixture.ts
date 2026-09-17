import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EvaluationFixtureDtoSchema } from '@solutions-studio/contracts';
import type { SourceType } from '@solutions-studio/domain';
import type { LoadedFixture, LoadedSourceRevision } from '../../application/evaluation/ports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadFixture(fixtureDirOrId: string): LoadedFixture {
  let resolvedFixtureDir = fixtureDirOrId;

  if (!path.isAbsolute(resolvedFixtureDir)) {
    // Search relative to cwd or known fixtures paths
    const candidates = [
      path.resolve(process.cwd(), resolvedFixtureDir),
      path.resolve(__dirname, '../../../../test/evaluation/fixtures', resolvedFixtureDir),
      path.resolve(__dirname, '../../../test/evaluation/fixtures', resolvedFixtureDir),
      path.resolve(__dirname, '../../test/evaluation/fixtures', resolvedFixtureDir),
      path.resolve(process.cwd(), 'apps/orchestrator/test/evaluation/fixtures', resolvedFixtureDir),
      path.resolve(process.cwd(), 'test/evaluation/fixtures', resolvedFixtureDir)
    ];

    let found = false;
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        resolvedFixtureDir = cand;
        found = true;
        break;
      }
    }

    if (!found) {
      resolvedFixtureDir = path.resolve(process.cwd(), resolvedFixtureDir);
    }
  }

  const expectedJsonPath = path.join(resolvedFixtureDir, 'expected.json');
  if (!fs.existsSync(expectedJsonPath)) {
    throw new Error(
      `Fixture ground truth not found: 'expected.json' does not exist in directory '${resolvedFixtureDir}'`
    );
  }

  const expectedJsonBytes = fs.readFileSync(expectedJsonPath);
  const rawJson = JSON.parse(expectedJsonBytes.toString('utf-8'));
  const fixture = EvaluationFixtureDtoSchema.parse(rawJson);
  const expectedJsonHash = crypto.createHash('sha256').update(expectedJsonBytes).digest('hex');

  const sourceRevisions = new Map<string, LoadedSourceRevision>();

  for (const source of fixture.sources) {
    if (path.isAbsolute(source.path) || source.path.split(/[/\\]/).includes('..')) {
      throw new Error(
        `Fixture '${fixture.fixtureId}' declares source revision '${source.sourceRevisionId}' with forbidden traversal or absolute path: '${source.path}'`
      );
    }

    const sourceFilePath = path.resolve(resolvedFixtureDir, source.path);
    if (!fs.existsSync(sourceFilePath)) {
      throw new Error(
        `Fixture '${fixture.fixtureId}' declares source revision '${source.sourceRevisionId}' with path '${source.path}', but file does not exist at '${sourceFilePath}'`
      );
    }

    const realFixtureDir = fs.realpathSync(resolvedFixtureDir);
    const realSourceFilePath = fs.realpathSync(sourceFilePath);
    const relativeToFixture = path.relative(realFixtureDir, realSourceFilePath);
    if (relativeToFixture.startsWith('..') || path.isAbsolute(relativeToFixture)) {
      throw new Error(
        `Fixture '${fixture.fixtureId}' source revision '${source.sourceRevisionId}' path '${source.path}' resolves outside fixture directory: '${realSourceFilePath}' escapes '${realFixtureDir}'`
      );
    }

    const fileBuffer = fs.readFileSync(realSourceFilePath);
    const text = fileBuffer.toString('utf-8');
    const contentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    if (sourceRevisions.has(source.sourceRevisionId)) {
      throw new Error(
        `Fixture '${fixture.fixtureId}' has duplicate sourceRevisionId: '${source.sourceRevisionId}'`
      );
    }

    sourceRevisions.set(source.sourceRevisionId, {
      text,
      contentHash,
      sourceId: source.sourceId,
      sourceType: source.sourceType as SourceType,
      revision: source.revision
    });
  }

  return {
    fixture,
    fixtureDir: resolvedFixtureDir,
    sourceRevisions,
    expectedJsonHash
  };
}
