import { describe, it, expect } from 'vitest';
import {
  AcceptRequirementRequestDtoSchema,
  RejectRequirementRequestDtoSchema,
  ResolveRequirementRequestDtoSchema,
  ReviseRequirementRequestDtoSchema,
  DispositionFindingRequestDtoSchema,
  ReopenFindingRequestDtoSchema,
  GenerateProjectionRequestDtoSchema,
  EvidenceExcerptDtoSchema,
  RequirementsReviewStateDtoSchema,
  RevisionLineageEntryDtoSchema
} from '../../src/requirements/index.js';
import { ApiErrorDtoSchema, API_ERROR_CODES } from '../../src/http/index.js';

describe('HTTP and Review Schemas', () => {
  describe('AcceptRequirementRequestDtoSchema', () => {
    it('accepts valid input with rationale', () => {
      const parsed = AcceptRequirementRequestDtoSchema.parse({
        rationale: 'Looks solid and vetted',
        actorId: 'reviewer-1'
      });
      expect(parsed.rationale).toBe('Looks solid and vetted');
      expect(parsed.actorId).toBe('reviewer-1');
    });

    it('rejects empty or whitespace rationale', () => {
      expect(() => AcceptRequirementRequestDtoSchema.parse({ rationale: '' })).toThrow();
      expect(() => AcceptRequirementRequestDtoSchema.parse({ rationale: '   ' })).toThrow();
      expect(() => AcceptRequirementRequestDtoSchema.parse({})).toThrow();
    });
  });

  describe('RejectRequirementRequestDtoSchema', () => {
    it('accepts valid input', () => {
      const parsed = RejectRequirementRequestDtoSchema.parse({
        rationale: 'Out of scope for this release'
      });
      expect(parsed.rationale).toBe('Out of scope for this release');
      expect(parsed.actorId).toBeUndefined();
    });

    it('rejects empty rationale', () => {
      expect(() => RejectRequirementRequestDtoSchema.parse({ rationale: '' })).toThrow();
    });
  });

  describe('ResolveRequirementRequestDtoSchema', () => {
    it('accepts valid input', () => {
      const parsed = ResolveRequirementRequestDtoSchema.parse({
        rationale: 'Ambiguity resolved with stakeholder'
      });
      expect(parsed.rationale).toBe('Ambiguity resolved with stakeholder');
    });

    it('rejects empty rationale', () => {
      expect(() => ResolveRequirementRequestDtoSchema.parse({ rationale: '' })).toThrow();
    });
  });

  describe('ReviseRequirementRequestDtoSchema', () => {
    it('accepts valid revision fields', () => {
      const parsed = ReviseRequirementRequestDtoSchema.parse({
        statement: 'Updated statement text',
        category: 'business-rule',
        origin: 'EXPLICIT',
        rationale: 'Refined wording for clarity',
        actorId: 'actor-42',
        dependencies: ['REQ-002']
      });
      expect(parsed.statement).toBe('Updated statement text');
      expect(parsed.category).toBe('business-rule');
      expect(parsed.dependencies).toEqual(['REQ-002']);
    });

    it('rejects invalid category or empty rationale', () => {
      expect(() =>
        ReviseRequirementRequestDtoSchema.parse({
          category: 'invalid-category',
          rationale: 'Some rationale'
        })
      ).toThrow();

      expect(() =>
        ReviseRequirementRequestDtoSchema.parse({
          statement: 'New statement',
          rationale: ''
        })
      ).toThrow();
    });
  });

  describe('DispositionFindingRequestDtoSchema', () => {
    it('accepts valid dispositions', () => {
      const parsed = DispositionFindingRequestDtoSchema.parse({
        disposition: 'RESOLVED',
        rationale: 'Addressed in requirement update',
        actorId: 'auditor-1'
      });
      expect(parsed.disposition).toBe('RESOLVED');
    });

    it('rejects invalid disposition or missing rationale', () => {
      expect(() =>
        DispositionFindingRequestDtoSchema.parse({
          disposition: 'NOT_A_DISPOSITION',
          rationale: 'Some rationale'
        })
      ).toThrow();

      expect(() =>
        DispositionFindingRequestDtoSchema.parse({
          disposition: 'RESOLVED',
          rationale: ''
        })
      ).toThrow();
    });
  });

  describe('ReopenFindingRequestDtoSchema', () => {
    it('accepts empty object or optional rationale', () => {
      expect(ReopenFindingRequestDtoSchema.parse({})).toEqual({});
      const parsed = ReopenFindingRequestDtoSchema.parse({
        rationale: 'Reopening due to regression',
        actorId: 'qa-1'
      });
      expect(parsed.rationale).toBe('Reopening due to regression');
    });
  });

  describe('GenerateProjectionRequestDtoSchema', () => {
    it('accepts process-diagram and state-diagram', () => {
      expect(
        GenerateProjectionRequestDtoSchema.parse({ artifactType: 'process-diagram' }).artifactType
      ).toBe('process-diagram');
      expect(
        GenerateProjectionRequestDtoSchema.parse({ artifactType: 'state-diagram' }).artifactType
      ).toBe('state-diagram');
    });

    it('rejects unsupported artifact types', () => {
      expect(() =>
        GenerateProjectionRequestDtoSchema.parse({ artifactType: 'sequence-diagram' })
      ).toThrow();
    });
  });

  describe('EvidenceExcerptDtoSchema', () => {
    it('validates excerpt metadata', () => {
      const parsed = EvidenceExcerptDtoSchema.parse({
        sourceRevisionId: 'SRC-001-R1',
        locator: 'overview#1',
        headingPath: 'Overview',
        blockLabel: 'Section 1',
        blockLabelSource: 'explicit-section',
        text: 'Tenant purge must happen within 5 minutes.',
        startLine: 10,
        endLine: 15
      });
      expect(parsed.locator).toBe('overview#1');
      expect(parsed.startLine).toBe(10);
    });

    it('rejects non-positive line numbers', () => {
      expect(() =>
        EvidenceExcerptDtoSchema.parse({
          sourceRevisionId: 'SRC-001-R1',
          locator: 'overview#1',
          headingPath: 'Overview',
          blockLabel: 'Section 1',
          text: 'Text',
          startLine: 0,
          endLine: 10
        })
      ).toThrow();
    });
  });

  describe('RequirementsReviewStateDtoSchema', () => {
    it('validates coherent review state object', () => {
      const parsed = RequirementsReviewStateDtoSchema.parse({
        requirementRevisions: [
          {
            id: 'REQ-001-R1',
            requirementId: 'REQ-001',
            revision: 1,
            statement: 'Must be secure',
            category: 'business-rule',
            origin: 'EXPLICIT',
            reviewState: 'PENDING',
            resolutionState: 'CLEAR',
            evidence: [{ sourceRevisionId: 'SRC-001-R1', locator: 'overview#1' }]
          }
        ],
        findings: [],
        reconciliationHistory: [],
        evidenceExcerpts: [
          {
            sourceRevisionId: 'SRC-001-R1',
            locator: 'overview#1',
            headingPath: 'Overview',
            blockLabel: 'Overview',
            text: 'System must be secure',
            startLine: 1,
            endLine: 3
          }
        ],
        projections: [],
        revisionLineage: [
          {
            revisionId: 'REQ-001-R1',
            requirementId: 'REQ-001'
          }
        ]
      });
      expect(parsed.requirementRevisions).toHaveLength(1);
      expect(parsed.revisionLineage).toHaveLength(1);
      expect(parsed.baseline).toBeUndefined();
    });
  });

  describe('RevisionLineageEntryDtoSchema', () => {
    it('accepts valid revision lineage entry', () => {
      const parsed = RevisionLineageEntryDtoSchema.parse({
        revisionId: 'REQ-001-R1',
        requirementId: 'REQ-001'
      });
      expect(parsed.revisionId).toBe('REQ-001-R1');
      expect(parsed.requirementId).toBe('REQ-001');
    });

    it('rejects empty strings', () => {
      expect(() =>
        RevisionLineageEntryDtoSchema.parse({
          revisionId: '',
          requirementId: 'REQ-001'
        })
      ).toThrow();
      expect(() =>
        RevisionLineageEntryDtoSchema.parse({
          revisionId: 'REQ-001-R1',
          requirementId: ''
        })
      ).toThrow();
    });
  });

  describe('ApiErrorDtoSchema', () => {
    it('accepts known error codes and valid structure', () => {
      for (const code of API_ERROR_CODES) {
        const parsed = ApiErrorDtoSchema.parse({
          code,
          message: `Error message for ${code}`,
          details: { field: 'test' }
        });
        expect(parsed.code).toBe(code);
      }
    });

    it('rejects unknown error codes', () => {
      expect(() =>
        ApiErrorDtoSchema.parse({
          code: 'SOME_RANDOM_CODE',
          message: 'Error'
        })
      ).toThrow();
    });
  });
});
