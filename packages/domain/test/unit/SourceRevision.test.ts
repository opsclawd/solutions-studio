import { describe, it, expect } from 'vitest';
import {
  createSource,
  createSourceId,
  createSourceRevision,
  createSourceRevisionId,
  createRequirementId,
  createInstant,
  reviseSource,
  InvalidRevisionNumberError,
  DomainError
} from '../../src/index.js';

describe('Source and SourceRevision', () => {
  it('creates an immutable source entity', () => {
    const source = createSource({
      id: createSourceId('INT-004'),
      sourceType: 'interview'
    });

    expect(source.id).toBe('INT-004');
    expect(source.sourceType).toBe('interview');
    expect(Object.isFrozen(source)).toBe(true);
  });

  it('rejects invalid source types', () => {
    expect(() =>
      createSource({
        id: createSourceId('INT-004'),
        sourceType: 'invalid-type' as any
      })
    ).toThrow(DomainError);
  });

  it('creates an immutable SourceRevision with frozen structure', () => {
    const revision = createSourceRevision({
      id: createSourceRevisionId('INT-004@r1'),
      sourceId: createSourceId('INT-004'),
      revision: 1,
      contentHash: 'hash-abc-123',
      capturedAt: createInstant('2026-09-15T10:00:00.000Z')
    });

    expect(revision.id).toBe('INT-004@r1');
    expect(revision.sourceId).toBe('INT-004');
    expect(revision.revision).toBe(1);
    expect(revision.contentHash).toBe('hash-abc-123');
    expect(revision.capturedAt).toBe('2026-09-15T10:00:00.000Z');
    expect(revision.supersedes).toBeUndefined();
    expect(Object.isFrozen(revision)).toBe(true);
  });

  it('rejects revision numbers < 1 or non-integers', () => {
    expect(() =>
      createSourceRevision({
        id: createSourceRevisionId('INT-004@r0'),
        sourceId: createSourceId('INT-004'),
        revision: 0,
        contentHash: 'hash'
      })
    ).toThrow(InvalidRevisionNumberError);

    expect(() =>
      createSourceRevision({
        id: createSourceRevisionId('INT-004@r1.5'),
        sourceId: createSourceId('INT-004'),
        revision: 1.5,
        contentHash: 'hash'
      })
    ).toThrow(InvalidRevisionNumberError);
  });

  it('rejects successor revision with the same ID as previous revision', () => {
    const r1 = createSourceRevision({
      id: createSourceRevisionId('INT-004@r1'),
      sourceId: createSourceId('INT-004'),
      revision: 1,
      contentHash: 'hash-v1'
    });

    expect(() =>
      reviseSource(r1, {
        id: createSourceRevisionId('INT-004@r1'),
        contentHash: 'hash-v2'
      })
    ).toThrow(DomainError);
  });

  it('proves revision immutability: reviseSource creates a new revision without mutating previous', () => {
    const r1 = createSourceRevision({
      id: createSourceRevisionId('INT-004@r1'),
      sourceId: createSourceId('INT-004'),
      revision: 1,
      contentHash: 'hash-v1',
      capturedAt: createInstant('2026-09-15T10:00:00.000Z')
    });

    const originalR1Json = JSON.stringify(r1);

    const r2 = reviseSource(r1, {
      id: createSourceRevisionId('INT-004@r2'),
      contentHash: 'hash-v2',
      capturedAt: createInstant('2026-09-16T11:00:00.000Z')
    });

    // Verify r2 properties
    expect(r2.id).toBe('INT-004@r2');
    expect(r2.sourceId).toBe('INT-004');
    expect(r2.revision).toBe(2);
    expect(r2.contentHash).toBe('hash-v2');
    expect(r2.supersedes).toBe(r1.id);
    expect(Object.isFrozen(r2)).toBe(true);

    // Verify r1 was not mutated in place
    expect(JSON.stringify(r1)).toBe(originalR1Json);
    expect(r1.revision).toBe(1);
    expect(r1.supersedes).toBeUndefined();
  });

  it('enforces exact branded types at compile time', () => {
    function _typeChecks() {
      const sourceId = createSourceId('SRC-1');
      const revId = createSourceRevisionId('SRC-1@r1');
      const reqId = createRequirementId('R-1');

      // @ts-expect-error - rejects unbranded string in createSource
      createSource({ id: 'SRC-1', sourceType: 'interview' });
      // @ts-expect-error - rejects RequirementId in createSource
      createSource({ id: reqId, sourceType: 'interview' });
      // @ts-expect-error - rejects unbranded strings in createSourceRevision
      createSourceRevision({ id: 'SRC-1@r1', sourceId: 'SRC-1', revision: 1, contentHash: 'h' });
      // @ts-expect-error - rejects cross-brand IDs in createSourceRevision
      createSourceRevision({ id: reqId, sourceId: sourceId, revision: 1, contentHash: 'h' });
      // @ts-expect-error - rejects unbranded string ID in reviseSource
      reviseSource({} as any, { id: 'SRC-1@r2', contentHash: 'h' });
      // @ts-expect-error - rejects SourceRevisionId in sourceId position
      createSourceRevision({ id: revId, sourceId: revId, revision: 1, contentHash: 'h' });
    }
    expect(_typeChecks).toBeDefined();
  });
});
