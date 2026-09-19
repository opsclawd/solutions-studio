import { describe, it, expect } from 'vitest';
import type { RequirementsReviewStateDto } from '@solutions-studio/contracts';
import { createInstant } from '@solutions-studio/domain';
import { buildRevisionRequirementIndex } from '../../src/features/review/lineage/revisionRequirementIndex';

describe('buildRevisionRequirementIndex', () => {
  it('resolves historical revision findings to stable requirementId using revisionLineage alone', () => {
    // Synthetic fixture with a two-hop lineage chain R1 -> R2 -> R3.
    // Only R3 is in requirementRevisions[] (current latest revision).
    // reconciliationHistory only records successor R2 and successor R3, NEVER R1.
    const fixture: RequirementsReviewStateDto = {
      requirementRevisions: [
        {
          id: 'REQ-AUTH-R3',
          requirementId: 'REQ-AUTH',
          revision: 3,
          statement: 'Third revision statement',
          category: 'business-rule',
          origin: 'EXPLICIT',
          reviewState: 'PENDING',
          resolutionState: 'UNRESOLVED',
          evidence: [],
          supersedes: 'REQ-AUTH-R2'
        }
      ],
      revisionLineage: [
        { revisionId: 'REQ-AUTH-R1', requirementId: 'REQ-AUTH' },
        { revisionId: 'REQ-AUTH-R2', requirementId: 'REQ-AUTH' },
        { revisionId: 'REQ-AUTH-R3', requirementId: 'REQ-AUTH' }
      ],
      findings: [
        {
          id: 'FIND-HISTORICAL-001',
          type: 'contradiction',
          // Attached to R1 (the initial compile-time revision, never a reconciliation output)
          affectedRequirementRevisions: ['REQ-AUTH-R1'],
          evidence: [],
          discoveredBy: 'model',
          disposition: 'OPEN',
          rationale: 'Conflict found on first revision'
        },
        {
          id: 'FIND-UNATTACHED-001',
          type: 'missing-authorization',
          // Genuinely empty affectedRequirementRevisions array
          affectedRequirementRevisions: [],
          evidence: [],
          discoveredBy: 'model',
          disposition: 'OPEN',
          rationale: 'Repository-wide discovery'
        }
      ],
      reconciliationHistory: [
        {
          id: 'rec-2',
          entityType: 'requirement',
          entityId: 'REQ-AUTH',
          requirementRevisionId: 'REQ-AUTH-R2',
          action: 'REVISE',
          newReviewState: 'PENDING',
          rationale: 'Revised to R2',
          recordedAt: createInstant('2026-09-18T12:00:00Z')
        },
        {
          id: 'rec-3',
          entityType: 'requirement',
          entityId: 'REQ-AUTH',
          requirementRevisionId: 'REQ-AUTH-R3',
          action: 'REVISE',
          newReviewState: 'PENDING',
          rationale: 'Revised to R3',
          recordedAt: createInstant('2026-09-18T13:00:00Z')
        }
      ],
      evidenceExcerpts: [],
      projections: []
    };

    const index = buildRevisionRequirementIndex(fixture);

    // 1. Revision mapping includes R1, R2, R3 mapped to REQ-AUTH
    expect(index.revisionToRequirementId.get('REQ-AUTH-R1')).toBe('REQ-AUTH');
    expect(index.revisionToRequirementId.get('REQ-AUTH-R2')).toBe('REQ-AUTH');
    expect(index.revisionToRequirementId.get('REQ-AUTH-R3')).toBe('REQ-AUTH');

    // 2. Finding attached only to R1 resolves under stable requirementId 'REQ-AUTH'
    const reqAuthFindings = index.findingsByRequirementId.get('REQ-AUTH');
    expect(reqAuthFindings).toBeDefined();
    expect(reqAuthFindings?.map((f) => f.id)).toContain('FIND-HISTORICAL-001');

    // 3. Finding with empty affectedRequirementRevisions lands directly in unresolvedFindings
    expect(index.unresolvedFindings.map((f) => f.id)).toContain('FIND-UNATTACHED-001');
    expect(index.unresolvedFindings.map((f) => f.id)).not.toContain('FIND-HISTORICAL-001');
  });

  it('puts findings with unknown/unresolved revisions into unresolvedFindings', () => {
    const fixture: RequirementsReviewStateDto = {
      requirementRevisions: [],
      revisionLineage: [],
      findings: [
        {
          id: 'FIND-ORPHAN-001',
          type: 'missing-failure-recovery',
          affectedRequirementRevisions: ['NON-EXISTENT-R1'],
          evidence: [],
          discoveredBy: 'model',
          disposition: 'OPEN'
        }
      ],
      reconciliationHistory: [],
      evidenceExcerpts: [],
      projections: []
    };

    const index = buildRevisionRequirementIndex(fixture);
    expect(index.unresolvedFindings.map((f) => f.id)).toContain('FIND-ORPHAN-001');
  });
});
