import { describe, it, expect } from 'vitest';
import {
  getOriginBadge,
  getReviewStateBadge,
  getResolutionStateBadge,
  getDispositionBadge
} from '../../src/features/review/components/badges';

describe('Review Badge Helpers', () => {
  it('maps origin badges correctly', () => {
    expect(getOriginBadge('EXPLICIT').label).toBe('EXPLICIT');
    expect(getOriginBadge('GENERATED_PROPOSAL').label).toBe('CANDIDATE: GENERATED');
    expect(getOriginBadge('INFERRED').label).toBe('CANDIDATE: INFERRED');
    expect(getOriginBadge('ASSUMED').label).toBe('CANDIDATE: ASSUMED');
  });

  it('maps review state badges correctly', () => {
    expect(getReviewStateBadge('PENDING').label).toBe('PENDING REVIEW');
    expect(getReviewStateBadge('ACCEPTED').label).toBe('ACCEPTED');
    expect(getReviewStateBadge('REJECTED').label).toBe('REJECTED');
  });

  it('maps resolution state badges correctly', () => {
    expect(getResolutionStateBadge('CLEAR').label).toBe('CLEAR');
    expect(getResolutionStateBadge('CONFLICTED').label).toBe('CONFLICTED');
    expect(getResolutionStateBadge('UNRESOLVED').label).toBe('UNRESOLVED');
    expect(getResolutionStateBadge('SUPERSEDED').label).toBe('SUPERSEDED');
  });

  it('maps disposition badges correctly', () => {
    expect(getDispositionBadge('OPEN').label).toBe('OPEN');
    expect(getDispositionBadge('RESOLVED').label).toBe('RESOLVED');
    expect(getDispositionBadge('DISMISSED_FALSE_POSITIVE').label).toContain('DISMISSED');
    expect(getDispositionBadge('ACCEPTED_RISK').label).toBe('ACCEPTED RISK');
  });
});
