import { describe, it, expect } from 'vitest';
import {
  createSourceId,
  createSourceRevisionId,
  createRequirementId,
  createRequirementRevisionId,
  createFindingId,
  createRequirementsBaselineId,
  createActorId,
  createReviewerId,
  createInstant,
  isValidInstant,
  now,
  EmptyIdentifierError,
  InvalidInstantError,
  type SourceId,
  type SourceRevisionId,
  type RequirementId,
  type RequirementRevisionId
} from '../../src/index.js';

describe('Domain Identifiers', () => {
  it('creates valid branded IDs', () => {
    expect(createSourceId('INT-004')).toBe('INT-004');
    expect(createSourceRevisionId('INT-004@r3')).toBe('INT-004@r3');
    expect(createRequirementId('R-142')).toBe('R-142');
    expect(createRequirementRevisionId('R-142@r4')).toBe('R-142@r4');
    expect(createFindingId('FINDING-01')).toBe('FINDING-01');
    expect(createRequirementsBaselineId('BASELINE-17')).toBe('BASELINE-17');
    expect(createActorId('FieldLead')).toBe('FieldLead');
    expect(createReviewerId('REV-01')).toBe('REV-01');
  });

  it('trims leading and trailing whitespace', () => {
    expect(createSourceId('  INT-004  ')).toBe('INT-004');
    expect(createRequirementId('  R-142  ')).toBe('R-142');
  });

  it('rejects empty or whitespace-only strings with EmptyIdentifierError', () => {
    expect(() => createSourceId('')).toThrow(EmptyIdentifierError);
    expect(() => createSourceId('   ')).toThrow(EmptyIdentifierError);
    expect(() => createSourceRevisionId('')).toThrow(EmptyIdentifierError);
    expect(() => createRequirementId('')).toThrow(EmptyIdentifierError);
    expect(() => createRequirementRevisionId('')).toThrow(EmptyIdentifierError);
    expect(() => createFindingId('')).toThrow(EmptyIdentifierError);
    expect(() => createRequirementsBaselineId('')).toThrow(EmptyIdentifierError);
    expect(() => createActorId('')).toThrow(EmptyIdentifierError);
    expect(() => createReviewerId('')).toThrow(EmptyIdentifierError);
  });

  describe('Instant validation', () => {
    it('creates and validates RFC 3339 / ISO-8601 Instant values with UTC or timezone offset', () => {
      const validUtc = '2026-09-15T10:30:00.000Z';
      expect(createInstant(validUtc)).toBe(validUtc);
      expect(isValidInstant(validUtc)).toBe(true);

      const validLeapYear = '2024-02-29T12:00:00Z';
      expect(createInstant(validLeapYear)).toBe(validLeapYear);
      expect(isValidInstant(validLeapYear)).toBe(true);

      const validPositiveOffset = '2026-09-15T10:30:00+02:00';
      expect(createInstant(validPositiveOffset)).toBe(validPositiveOffset);
      expect(isValidInstant(validPositiveOffset)).toBe(true);

      const validNegativeOffset = '2026-09-15T10:30:00-05:00';
      expect(createInstant(validNegativeOffset)).toBe(validNegativeOffset);
      expect(isValidInstant(validNegativeOffset)).toBe(true);

      const generated = now();
      expect(typeof generated).toBe('string');
      expect(isValidInstant(generated)).toBe(true);
    });

    it('rejects timezone-less strings', () => {
      expect(() => createInstant('2026-09-15T10:30:00')).toThrow(InvalidInstantError);
      expect(isValidInstant('2026-09-15T10:30:00')).toBe(false);
    });

    it('rejects date-only strings', () => {
      expect(() => createInstant('2026-09-15')).toThrow(InvalidInstantError);
      expect(isValidInstant('2026-09-15')).toBe(false);
    });

    it('rejects locale-formatted strings', () => {
      expect(() => createInstant('09/15/2026')).toThrow(InvalidInstantError);
      expect(isValidInstant('09/15/2026')).toBe(false);
      expect(() => createInstant('15/09/2026 10:30:00')).toThrow(InvalidInstantError);
      expect(isValidInstant('15/09/2026 10:30:00')).toBe(false);
    });

    it('rejects RFC 2822 dates', () => {
      expect(() => createInstant('Tue, 15 Sep 2026 10:30:00 GMT')).toThrow(InvalidInstantError);
      expect(isValidInstant('Tue, 15 Sep 2026 10:30:00 GMT')).toBe(false);
    });

    it('rejects calendar-invalid dates', () => {
      // Feb 30th does not exist
      expect(() => createInstant('2026-02-30T12:00:00Z')).toThrow(InvalidInstantError);
      expect(isValidInstant('2026-02-30T12:00:00Z')).toBe(false);

      // 2026 is not a leap year, so Feb 29 does not exist
      expect(() => createInstant('2026-02-29T12:00:00Z')).toThrow(InvalidInstantError);
      expect(isValidInstant('2026-02-29T12:00:00Z')).toBe(false);

      // April has 30 days
      expect(() => createInstant('2026-04-31T12:00:00Z')).toThrow(InvalidInstantError);
      expect(isValidInstant('2026-04-31T12:00:00Z')).toBe(false);

      // Invalid month
      expect(() => createInstant('2026-13-01T12:00:00Z')).toThrow(InvalidInstantError);
      expect(isValidInstant('2026-13-01T12:00:00Z')).toBe(false);
      expect(() => createInstant('2026-00-10T12:00:00Z')).toThrow(InvalidInstantError);
      expect(isValidInstant('2026-00-10T12:00:00Z')).toBe(false);
    });

    it('rejects arbitrary text and empty strings', () => {
      expect(() => createInstant('invalid-date')).toThrow(InvalidInstantError);
      expect(isValidInstant('invalid-date')).toBe(false);
      expect(() => createInstant('')).toThrow(EmptyIdentifierError);
      expect(isValidInstant('')).toBe(false);
    });
  });

  describe('Branded ID compile-time safety', () => {
    it('prevents accidental cross-brand ID assignments at compile time', () => {
      const sourceId = createSourceId('SRC-1');
      const reqRevId = createRequirementRevisionId('R-1@r1');

      const typedSourceId: SourceId = sourceId;
      const typedReqRevId: RequirementRevisionId = reqRevId;

      // @ts-expect-error - SourceId is not assignable to RequirementId
      const reqId: RequirementId = sourceId;
      // @ts-expect-error - RequirementRevisionId is not assignable to SourceRevisionId
      const srcRevId: SourceRevisionId = reqRevId;
      // @ts-expect-error - raw unbranded string is not assignable to RequirementId
      const rawReqId: RequirementId = 'R-1';

      expect(typedSourceId).toBeDefined();
      expect(typedReqRevId).toBeDefined();
      expect(reqId).toBeDefined();
      expect(srcRevId).toBeDefined();
      expect(rawReqId).toBeDefined();
    });
  });
});
