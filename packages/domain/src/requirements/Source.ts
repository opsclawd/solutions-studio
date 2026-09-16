import type { SourceId } from './ids.js';
import { DomainError } from './errors.js';

export const SOURCE_TYPES = ['interview', 'sop', 'policy', 'schema', 'spreadsheet'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface Source {
  readonly id: SourceId;
  readonly sourceType: SourceType;
}

export function createSource(params: { id: SourceId; sourceType: SourceType }): Source {
  if (!SOURCE_TYPES.includes(params.sourceType)) {
    throw new DomainError(`Invalid SourceType: '${String(params.sourceType)}'`);
  }
  return Object.freeze({
    id: params.id,
    sourceType: params.sourceType
  });
}
