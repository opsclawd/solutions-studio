import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EvaluationFixtureDtoSchema, type EvaluationFixtureDto } from '@solutions-studio/contracts';
import type { SourceType } from '@solutions-studio/domain';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface LoadedSourceRevision {
  readonly text: string;
  readonly contentHash: string;
  readonly sourceId: string;
  readonly sourceType: SourceType;
  readonly revision: number;
}

export interface LoadedFixture {
  readonly fixture: EvaluationFixtureDto;
  readonly fixtureDir: string;
  readonly sourceRevisions: Map<string, LoadedSourceRevision>;
}

export function loadFixture(fixtureDirOrId: string): LoadedFixture {
  let resolvedFixtureDir = fixtureDirOrId;

  if (!path.isAbsolute(resolvedFixtureDir)) {
    // Check if it exists relative to cwd or fixtures dir
    const relativeToCwd = path.resolve(process.cwd(), resolvedFixtureDir);
    const relativeToFixtures = path.resolve(__dirname, '../fixtures', resolvedFixtureDir);

    if (fs.existsSync(relativeToCwd)) {
      resolvedFixtureDir = relativeToCwd;
    } else if (fs.existsSync(relativeToFixtures)) {
      resolvedFixtureDir = relativeToFixtures;
    } else {
      resolvedFixtureDir = relativeToFixtures;
    }
  }

  const expectedJsonPath = path.join(resolvedFixtureDir, 'expected.json');
  if (!fs.existsSync(expectedJsonPath)) {
    throw new Error(
      `Fixture ground truth not found: 'expected.json' does not exist in directory '${resolvedFixtureDir}'`
    );
  }

  const rawJson = JSON.parse(fs.readFileSync(expectedJsonPath, 'utf-8'));
  const fixture = EvaluationFixtureDtoSchema.parse(rawJson);

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
    sourceRevisions
  };
}
