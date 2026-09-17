import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { LoadedCorpus } from './ports.js';

export const CORPUS_CANONICALIZATION_VERSION = 'v1' as const;

export interface CorpusIdentityResult {
  readonly canonicalizationVersion: string;
  readonly manifestHash: string;
  readonly corpusIdentity: string;
}

export function computeCorpusIdentity(corpus: LoadedCorpus): CorpusIdentityResult {
  const manifestBytes = fs.readFileSync(corpus.manifestPath);
  const manifestHash = crypto.createHash('sha256').update(manifestBytes).digest('hex');

  const corpusHasher = crypto.createHash('sha256');
  corpusHasher.update(`CANONICAL_CORPUS_${CORPUS_CANONICALIZATION_VERSION}\n`);
  corpusHasher.update(`manifestVersion:${corpus.manifest.corpusVersion}\n`);
  corpusHasher.update(`manifestHash:${manifestHash}\n`);

  for (const manifestEntry of corpus.manifest.fixtures) {
    const loaded = corpus.fixtures.get(manifestEntry.fixtureId);
    if (!loaded) {
      throw new Error(`Corpus fixture '${manifestEntry.fixtureId}' not found in loaded corpus`);
    }

    corpusHasher.update(`fixture:${loaded.fixture.fixtureId}\n`);

    const expectedHash =
      loaded.expectedJsonHash ??
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(loaded.fixtureDir, 'expected.json')))
        .digest('hex');
    corpusHasher.update(`expectedJsonHash:${expectedHash}\n`);

    for (const src of loaded.fixture.sources) {
      const srcRev = loaded.sourceRevisions.get(src.sourceRevisionId);
      const srcHash = srcRev?.contentHash ?? '';
      corpusHasher.update(
        `source:${src.sourceRevisionId}:${src.sourceId}:${src.revision}:${src.sourceType}:${src.supersedes ?? ''}:${srcHash}\n`
      );
    }
  }

  const corpusIdentity = corpusHasher.digest('hex');

  return Object.freeze({
    canonicalizationVersion: CORPUS_CANONICALIZATION_VERSION,
    manifestHash,
    corpusIdentity
  });
}
