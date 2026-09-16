import { describe, it, expect } from 'vitest';
import {
  createEvidenceReference,
  createSourceRevisionId,
  createEvidenceLocator,
  createRequirementId,
  createRequirementRevisionId,
  createSourceId,
  EmptyIdentifierError
} from '../../src/index.js';

describe('EvidenceReference', () => {
  it('creates a frozen evidence reference binding exact SourceRevisionId and EvidenceLocator', () => {
    const revId = createSourceRevisionId('INT-004@r3');
    const locator = createEvidenceLocator('business-logic-and-operational-rules#1');
    const ref = createEvidenceReference(revId, locator);

    expect(ref.sourceRevisionId).toBe('INT-004@r3');
    expect(ref.locator).toBe('business-logic-and-operational-rules#1');
    expect(Object.isFrozen(ref)).toBe(true);
  });

  it('rejects empty components when building boundary types', () => {
    expect(() => createSourceRevisionId('')).toThrow(EmptyIdentifierError);
    expect(() => createEvidenceLocator('')).toThrow(EmptyIdentifierError);
  });

  it('enforces exact branded types at compile time', () => {
    const revId = createSourceRevisionId('INT-004@r1');
    const locator = createEvidenceLocator('section-1#1');
    const reqId = createRequirementId('R-1');
    const reqRevId = createRequirementRevisionId('R-1@r1');
    const sourceId = createSourceId('SRC-1');

    // Valid
    const ref = createEvidenceReference(revId, locator);
    expect(ref).toBeDefined();

    // @ts-expect-error - rejects unbranded string for sourceRevisionId
    createEvidenceReference('INT-004@r1', locator);
    // @ts-expect-error - rejects unbranded string for locator
    createEvidenceReference(revId, 'section-1#1');
    // @ts-expect-error - rejects RequirementId in SourceRevisionId position
    createEvidenceReference(reqId, locator);
    // @ts-expect-error - rejects RequirementRevisionId in SourceRevisionId position
    createEvidenceReference(reqRevId, locator);
    // @ts-expect-error - rejects SourceId in SourceRevisionId position
    createEvidenceReference(sourceId, locator);
    // @ts-expect-error - rejects SourceRevisionId in EvidenceLocator position
    createEvidenceReference(revId, revId);
  });
});
