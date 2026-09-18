import { describe, it, expect } from 'vitest';
import {
  validateSourceLineage,
  LineageValidationError
} from '../../src/application/evaluation/validateSourceLineage.js';
import type { EvaluationSourceDto } from '@solutions-studio/contracts';
import type { SourceRevisionRecord } from '../../src/application/ports/persistence/IRequirementsRepository.js';
import {
  createSourceId,
  createSourceRevisionId,
  createEvidenceLocator,
  createInstant,
  createSourceRevision
} from '@solutions-studio/domain';

function makeCapturedRecord(
  sourceId: string,
  revision: number,
  contentHash: string,
  supersedes?: string
): SourceRevisionRecord {
  const id = `${sourceId}-R${revision}`;
  return {
    sourceType: 'sop',
    revision: createSourceRevision({
      id: createSourceRevisionId(id),
      sourceId: createSourceId(sourceId),
      revision,
      contentHash,
      capturedAt: createInstant('2026-09-17T00:00:00.000Z'),
      supersedes: supersedes ? createSourceRevisionId(supersedes) : undefined
    }),
    rawText: 'source content',
    locatorIndex: [
      {
        locator: createEvidenceLocator('section-1'),
        headingPath: 'Section 1',
        blockLabel: 'label',
        blockLabelSource: 'explicit-section',
        text: 'some text',
        startLine: 1,
        endLine: 2
      }
    ]
  };
}

describe('validateSourceLineage', () => {
  it('validates canonical multi-revision alias lineage (MESSY-SOP-001-R2 -> CORE-SOP-001-R2)', () => {
    const declaredSources: EvaluationSourceDto[] = [
      {
        sourceRevisionId: 'MESSY-SOP-001-R1',
        sourceId: 'CORE-SOP-001',
        sourceType: 'sop',
        revision: 1,
        path: 'source.1.md'
      },
      {
        sourceRevisionId: 'MESSY-SOP-001-R2',
        sourceId: 'CORE-SOP-001',
        sourceType: 'sop',
        revision: 2,
        path: 'source.2.md',
        supersedes: 'MESSY-SOP-001-R1'
      }
    ];

    const capturedRecords: SourceRevisionRecord[] = [
      makeCapturedRecord('CORE-SOP-001', 1, 'hash-1'),
      makeCapturedRecord('CORE-SOP-001', 2, 'hash-2', 'CORE-SOP-001-R1')
    ];

    const map = validateSourceLineage(declaredSources, capturedRecords);

    expect(map.entries).toHaveLength(2);
    expect(map.resolveDeclared('MESSY-SOP-001-R1')).toBe('CORE-SOP-001-R1');
    expect(map.resolveDeclared('MESSY-SOP-001-R2')).toBe('CORE-SOP-001-R2');
    expect(map.resolveCaptured('CORE-SOP-001-R2')).toBe('MESSY-SOP-001-R2');

    const r2Entry = map.entries[1];
    expect(r2Entry.declaredPredecessorAlias).toBe('MESSY-SOP-001-R1');
    expect(r2Entry.capturedPredecessorId).toBe('CORE-SOP-001-R1');
    expect(r2Entry.declaredOrdinal).toBe(2);
    expect(r2Entry.capturedOrdinal).toBe(2);
  });

  it('rejects count mismatch', () => {
    const declared: EvaluationSourceDto[] = [
      {
        sourceRevisionId: 'S-1',
        sourceId: 'SRC-1',
        sourceType: 'sop',
        revision: 1,
        path: 's.md'
      }
    ];
    expect(() => validateSourceLineage(declared, [])).toThrow(LineageValidationError);
  });

  it('rejects duplicate declared source alias', () => {
    const declared: EvaluationSourceDto[] = [
      {
        sourceRevisionId: 'DUP-R1',
        sourceId: 'SRC-1',
        sourceType: 'sop',
        revision: 1,
        path: 's1.md'
      },
      {
        sourceRevisionId: 'DUP-R1',
        sourceId: 'SRC-1',
        sourceType: 'sop',
        revision: 2,
        path: 's2.md'
      }
    ];
    const captured = [makeCapturedRecord('SRC-1', 1, 'h1'), makeCapturedRecord('SRC-1', 2, 'h2')];
    expect(() => validateSourceLineage(declared, captured)).toThrow(/Duplicate declared source/);
  });

  it('rejects non-bijective duplicate captured ID mapping', () => {
    const declared: EvaluationSourceDto[] = [
      {
        sourceRevisionId: 'D-R1',
        sourceId: 'SRC-1',
        sourceType: 'sop',
        revision: 1,
        path: 's1.md'
      },
      {
        sourceRevisionId: 'D-R2',
        sourceId: 'SRC-1',
        sourceType: 'sop',
        revision: 1,
        path: 's2.md'
      }
    ];
    const captured = [makeCapturedRecord('SRC-1', 1, 'h1'), makeCapturedRecord('SRC-1', 1, 'h1')];
    expect(() => validateSourceLineage(declared, captured)).toThrow(/Non-bijective source mapping/);
  });

  it('rejects source ID mismatch', () => {
    const declared: EvaluationSourceDto[] = [
      {
        sourceRevisionId: 'D-R1',
        sourceId: 'WRONG-ID',
        sourceType: 'sop',
        revision: 1,
        path: 's1.md'
      }
    ];
    const captured = [makeCapturedRecord('ACTUAL-ID', 1, 'h1')];
    expect(() => validateSourceLineage(declared, captured)).toThrow(/Source ID mismatch/);
  });

  it('rejects ordinal mismatch', () => {
    const declared: EvaluationSourceDto[] = [
      {
        sourceRevisionId: 'D-R1',
        sourceId: 'SRC-1',
        sourceType: 'sop',
        revision: 2,
        path: 's1.md'
      }
    ];
    const captured = [makeCapturedRecord('SRC-1', 1, 'h1')];
    expect(() => validateSourceLineage(declared, captured)).toThrow(/Ordinal mismatch/);
  });

  it('rejects broken translated supersession link', () => {
    const declared: EvaluationSourceDto[] = [
      {
        sourceRevisionId: 'D-R1',
        sourceId: 'SRC-1',
        sourceType: 'sop',
        revision: 1,
        path: 's1.md'
      },
      {
        sourceRevisionId: 'D-R2',
        sourceId: 'SRC-1',
        sourceType: 'sop',
        revision: 2,
        path: 's2.md',
        supersedes: 'D-R1'
      }
    ];
    const captured = [
      makeCapturedRecord('SRC-1', 1, 'h1'),
      // captured supersedes wrong predecessor
      makeCapturedRecord('SRC-1', 2, 'h2', 'FOREIGN-R1')
    ];
    expect(() => validateSourceLineage(declared, captured)).toThrow(
      /Translated predecessor mismatch/
    );
  });
});
