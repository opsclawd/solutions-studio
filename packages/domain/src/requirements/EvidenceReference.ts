import type { SourceRevisionId } from './ids.js';
import type { EvidenceLocator } from './EvidenceLocator.js';

export interface EvidenceReference {
  readonly sourceRevisionId: SourceRevisionId;
  readonly locator: EvidenceLocator;
}

export function createEvidenceReference(
  sourceRevisionId: SourceRevisionId,
  locator: EvidenceLocator
): EvidenceReference {
  return Object.freeze({
    sourceRevisionId,
    locator
  });
}
