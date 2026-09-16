import { EmptyIdentifierError } from './errors.js';

export type EvidenceLocator = string & { readonly __brand: 'EvidenceLocator' };

export function createEvidenceLocator(value: string): EvidenceLocator {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EmptyIdentifierError('EvidenceLocator');
  }
  return value.trim() as EvidenceLocator;
}
