import { EmptyIdentifierError } from '../requirements/errors.js';
import { InvalidCandidateShaError } from './errors.js';
import type { CandidateSha, ValidationRunId, GovernanceApprovalId } from './GovernanceTypes.js';

const CANDIDATE_SHA_REGEX = /^[a-f0-9]{7,64}$/i;

function assertNonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EmptyIdentifierError(name);
  }
  return value.trim();
}

export function isValidCandidateSha(value: unknown): value is CandidateSha {
  return typeof value === 'string' && CANDIDATE_SHA_REGEX.test(value.trim());
}

export function createCandidateSha(value: string): CandidateSha {
  const trimmed = assertNonEmpty(value, 'CandidateSha');
  if (!CANDIDATE_SHA_REGEX.test(trimmed)) {
    throw new InvalidCandidateShaError(trimmed);
  }
  return trimmed.toLowerCase() as CandidateSha;
}

export function createValidationRunId(value: string): ValidationRunId {
  return assertNonEmpty(value, 'ValidationRunId') as ValidationRunId;
}

export function createGovernanceApprovalId(value: string): GovernanceApprovalId {
  return assertNonEmpty(value, 'GovernanceApprovalId') as GovernanceApprovalId;
}
