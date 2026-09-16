import { describe, it, expect } from 'vitest';
import { createEvidenceLocator, EmptyIdentifierError } from '../../src/index.js';

describe('EvidenceLocator', () => {
  it('creates an opaque locator successfully', () => {
    const locator = createEvidenceLocator('business-logic-and-operational-rules#1');
    expect(locator).toBe('business-logic-and-operational-rules#1');
  });

  it('preserves locator format opaquely without parsing markdown or headers', () => {
    const custom = createEvidenceLocator('section-7.3/subclause-a#4');
    expect(custom).toBe('section-7.3/subclause-a#4');
  });

  it('rejects empty or whitespace-only locators', () => {
    expect(() => createEvidenceLocator('')).toThrow(EmptyIdentifierError);
    expect(() => createEvidenceLocator('   ')).toThrow(EmptyIdentifierError);
  });
});
