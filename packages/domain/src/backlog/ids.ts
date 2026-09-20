import { EmptyIdentifierError } from '../requirements/errors.js';

export type BacklogExportMappingId = string & { readonly __brand: 'BacklogExportMappingId' };

function assertNonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EmptyIdentifierError(name);
  }
  return value.trim();
}

export function createBacklogExportMappingId(value: string): BacklogExportMappingId {
  return assertNonEmpty(value, 'BacklogExportMappingId') as BacklogExportMappingId;
}
