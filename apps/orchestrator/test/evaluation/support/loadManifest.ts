import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EvaluationManifestDtoSchema,
  type EvaluationManifestDto
} from '@solutions-studio/contracts';
import { loadFixture, type LoadedFixture } from './loadFixture.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface LoadedCorpus {
  readonly manifest: EvaluationManifestDto;
  readonly manifestPath: string;
  readonly fixtures: Map<string, LoadedFixture>;
}

export function loadManifest(manifestPathOrFilename?: string): LoadedCorpus {
  let resolvedManifestPath =
    manifestPathOrFilename ?? path.resolve(__dirname, '../manifests/corpus.v1.json');

  if (!path.isAbsolute(resolvedManifestPath)) {
    const relativeToCwd = path.resolve(process.cwd(), resolvedManifestPath);
    const relativeToManifests = path.resolve(__dirname, '../manifests', resolvedManifestPath);
    if (fs.existsSync(relativeToCwd)) {
      resolvedManifestPath = relativeToCwd;
    } else if (fs.existsSync(relativeToManifests)) {
      resolvedManifestPath = relativeToManifests;
    } else {
      resolvedManifestPath = relativeToManifests;
    }
  }

  if (!fs.existsSync(resolvedManifestPath)) {
    throw new Error(`Corpus manifest not found at '${resolvedManifestPath}'`);
  }

  const rawJson = JSON.parse(fs.readFileSync(resolvedManifestPath, 'utf-8'));
  const manifest = EvaluationManifestDtoSchema.parse(rawJson);

  const fixtures = new Map<string, LoadedFixture>();
  const manifestDir = path.dirname(resolvedManifestPath);
  const evaluationDir = path.resolve(__dirname, '..');

  for (const entry of manifest.fixtures) {
    if (path.isAbsolute(entry.path) || entry.path.split(/[/\\]/).includes('..')) {
      throw new Error(
        `Manifest entry '${entry.fixtureId}' declares forbidden traversal or absolute path: '${entry.path}'`
      );
    }

    const fromEvaluationDir = path.resolve(evaluationDir, entry.path);
    const fromManifestDir = path.resolve(manifestDir, entry.path);
    let fixturePath = fromEvaluationDir;
    if (fs.existsSync(fromEvaluationDir)) {
      fixturePath = fromEvaluationDir;
    } else if (fs.existsSync(fromManifestDir)) {
      fixturePath = fromManifestDir;
    }

    if (!fs.existsSync(fixturePath)) {
      throw new Error(
        `Manifest entry '${entry.fixtureId}' path '${entry.path}' does not exist at '${fixturePath}'`
      );
    }

    const realEvaluationDir = fs.realpathSync(evaluationDir);
    const realFixturePath = fs.realpathSync(fixturePath);
    const relativeToEvaluation = path.relative(realEvaluationDir, realFixturePath);
    if (relativeToEvaluation.startsWith('..') || path.isAbsolute(relativeToEvaluation)) {
      throw new Error(
        `Manifest entry '${entry.fixtureId}' path '${entry.path}' resolves outside evaluation root: '${realFixturePath}' escapes '${realEvaluationDir}'`
      );
    }

    const loaded = loadFixture(realFixturePath);

    if (loaded.fixture.fixtureId !== entry.fixtureId) {
      throw new Error(
        `Manifest entry fixtureId mismatch: manifest declared '${entry.fixtureId}', but fixture defines '${loaded.fixture.fixtureId}'`
      );
    }

    if (loaded.fixture.canonicalMessyPackage !== entry.canonicalMessyPackage) {
      throw new Error(
        `Manifest entry canonicalMessyPackage mismatch for '${entry.fixtureId}': manifest declared ${entry.canonicalMessyPackage}, but fixture defines ${loaded.fixture.canonicalMessyPackage}`
      );
    }

    const manifestCategories = [...entry.categories].sort();
    const fixtureCategories = [...loaded.fixture.categories].sort();
    if (
      manifestCategories.length !== fixtureCategories.length ||
      manifestCategories.some((cat, i) => cat !== fixtureCategories[i])
    ) {
      throw new Error(
        `Manifest entry categories mismatch for '${entry.fixtureId}': manifest has [${manifestCategories.join(', ')}], fixture has [${fixtureCategories.join(', ')}]`
      );
    }

    if (fixtures.has(entry.fixtureId)) {
      throw new Error(`Manifest has duplicate fixture entry for '${entry.fixtureId}'`);
    }

    fixtures.set(entry.fixtureId, loaded);
  }

  return {
    manifest,
    manifestPath: resolvedManifestPath,
    fixtures
  };
}
