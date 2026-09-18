import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvaluationManifestDtoSchema } from '@solutions-studio/contracts';
import { loadFixture } from './loadFixture.js';
import type { LoadedCorpus, LoadedFixture } from '../../application/evaluation/ports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function findDefaultManifestPath(): string {
  const candidates = [
    path.resolve(__dirname, '../../../../test/evaluation/manifests/corpus.v2.json'),
    path.resolve(__dirname, '../../../test/evaluation/manifests/corpus.v2.json'),
    path.resolve(__dirname, '../../test/evaluation/manifests/corpus.v2.json'),
    path.resolve(__dirname, '../manifests/corpus.v2.json'),
    path.resolve(process.cwd(), 'apps/orchestrator/test/evaluation/manifests/corpus.v2.json'),
    path.resolve(process.cwd(), 'test/evaluation/manifests/corpus.v2.json')
  ];

  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      return cand;
    }
  }
  return path.resolve(process.cwd(), 'apps/orchestrator/test/evaluation/manifests/corpus.v2.json');
}

export function loadManifest(manifestPathOrFilename?: string): LoadedCorpus {
  let resolvedManifestPath = manifestPathOrFilename;

  if (!resolvedManifestPath) {
    resolvedManifestPath = findDefaultManifestPath();
  } else if (!path.isAbsolute(resolvedManifestPath)) {
    const relativeToCwd = path.resolve(process.cwd(), resolvedManifestPath);
    if (fs.existsSync(relativeToCwd)) {
      resolvedManifestPath = relativeToCwd;
    } else {
      const candidates = [
        path.resolve(__dirname, '../../../../test/evaluation/manifests', resolvedManifestPath),
        path.resolve(__dirname, '../../../test/evaluation/manifests', resolvedManifestPath),
        path.resolve(__dirname, '../../test/evaluation/manifests', resolvedManifestPath),
        path.resolve(__dirname, '../manifests', resolvedManifestPath),
        path.resolve(
          process.cwd(),
          'apps/orchestrator/test/evaluation/manifests',
          resolvedManifestPath
        ),
        path.resolve(process.cwd(), 'test/evaluation/manifests', resolvedManifestPath)
      ];
      let found = false;
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          resolvedManifestPath = cand;
          found = true;
          break;
        }
      }
      if (!found) {
        resolvedManifestPath = relativeToCwd;
      }
    }
  }

  if (!fs.existsSync(resolvedManifestPath)) {
    throw new Error(`Corpus manifest not found at '${resolvedManifestPath}'`);
  }

  const rawJson = JSON.parse(fs.readFileSync(resolvedManifestPath, 'utf-8'));
  const manifest = EvaluationManifestDtoSchema.parse(rawJson);

  const fixtures = new Map<string, LoadedFixture>();
  const manifestDir = path.dirname(resolvedManifestPath);
  const evaluationDir = path.dirname(manifestDir);

  for (const entry of manifest.fixtures) {
    if (path.isAbsolute(entry.path) || entry.path.split(/[/\\]/).includes('..')) {
      throw new Error(
        `Manifest entry '${entry.fixtureId}' declares forbidden traversal or absolute path: '${entry.path}'`
      );
    }

    if (!entry.path.startsWith('fixtures/') && !entry.path.startsWith('fixtures\\')) {
      throw new Error(
        `Manifest entry '${entry.fixtureId}' path '${entry.path}' resolves outside evaluation root: '${entry.path}' escapes 'fixtures/' root`
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

    fixtures.set(entry.fixtureId, loaded);
  }

  return {
    manifest,
    manifestPath: resolvedManifestPath,
    fixtures
  };
}
