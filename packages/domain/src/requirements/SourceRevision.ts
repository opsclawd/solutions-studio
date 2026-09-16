import type { SourceId, SourceRevisionId, Instant } from './ids.js';
import { now } from './ids.js';
import { DomainError, InvalidRevisionNumberError } from './errors.js';

export interface SourceRevision {
  readonly id: SourceRevisionId;
  readonly sourceId: SourceId;
  readonly revision: number;
  readonly contentHash: string;
  readonly capturedAt: Instant;
  readonly verifiedAt?: Instant;
  readonly supersedes?: SourceRevisionId;
}

export function createSourceRevision(params: {
  id: SourceRevisionId;
  sourceId: SourceId;
  revision: number;
  contentHash: string;
  capturedAt?: Instant;
  verifiedAt?: Instant;
  supersedes?: SourceRevisionId;
}): SourceRevision {
  if (!Number.isInteger(params.revision) || params.revision < 1) {
    throw new InvalidRevisionNumberError(params.revision);
  }

  if (typeof params.contentHash !== 'string' || params.contentHash.trim().length === 0) {
    throw new DomainError('SourceRevision contentHash must be a non-empty string');
  }

  const capturedAt = params.capturedAt ?? now();

  return Object.freeze({
    id: params.id,
    sourceId: params.sourceId,
    revision: params.revision,
    contentHash: params.contentHash.trim(),
    capturedAt,
    ...(params.verifiedAt !== undefined ? { verifiedAt: params.verifiedAt } : {}),
    ...(params.supersedes !== undefined ? { supersedes: params.supersedes } : {})
  });
}

export function reviseSource(
  previous: SourceRevision,
  changes: {
    id: SourceRevisionId;
    contentHash: string;
    capturedAt?: Instant;
    verifiedAt?: Instant;
  }
): SourceRevision {
  if (changes.id === previous.id) {
    throw new DomainError(
      `Successor revision ID cannot be identical to previous revision ID: '${changes.id}'`
    );
  }

  return createSourceRevision({
    id: changes.id,
    sourceId: previous.sourceId,
    revision: previous.revision + 1,
    contentHash: changes.contentHash,
    capturedAt: changes.capturedAt,
    verifiedAt: changes.verifiedAt,
    supersedes: previous.id
  });
}
