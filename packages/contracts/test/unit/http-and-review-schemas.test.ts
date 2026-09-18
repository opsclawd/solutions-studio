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
  RevisionLineageEntryDtoSchema,
  RecordRequirementDiscoveryRequestDtoSchema,
  RecordFindingDiscoveryRequestDtoSchema,
  RequirementRevisionDtoSchema,
  CandidateFindingDtoSchema
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

  describe('RecordRequirementDiscoveryRequestDtoSchema', () => {
    it('accepts valid proposal discovery request with all fields', () => {
      const parsed = RecordRequirementDiscoveryRequestDtoSchema.parse({
        statement: 'Tenant purge must retain audit records for 90 days',
        category: 'business-rule',
        rationale: 'SME noted SOC2 requirement during prototype review',
        actorId: 'reviewer-42',
        baselineId: 'BASELINE-001',
        originatingProjectionId: 'PROJ-001',
        affectedActors: ['SecurityAuditor'],
        dependencies: ['REQ-001'],
        evidence: [{ sourceRevisionId: 'SRC-001-R1', locator: 'overview#1' }],
        requirementId: 'REQ-NEW',
        revisionId: 'REQ-NEW-R1'
      });
      expect(parsed.statement).toBe('Tenant purge must retain audit records for 90 days');
      expect(parsed.category).toBe('business-rule');
      expect(parsed.rationale).toBe('SME noted SOC2 requirement during prototype review');
      expect(parsed.actorId).toBe('reviewer-42');
      expect(parsed.baselineId).toBe('BASELINE-001');
      expect(parsed.originatingProjectionId).toBe('PROJ-001');
      expect(parsed.affectedActors).toEqual(['SecurityAuditor']);
      expect(parsed.dependencies).toEqual(['REQ-001']);
      expect(parsed.evidence).toHaveLength(1);
    });

    it('accepts minimal proposal discovery request', () => {
      const parsed = RecordRequirementDiscoveryRequestDtoSchema.parse({
        statement: 'Simple statement',
        category: 'business-rule',
        rationale: 'Discovered during SME review'
      });
      expect(parsed.statement).toBe('Simple statement');
      expect(parsed.category).toBe('business-rule');
      expect(parsed.rationale).toBe('Discovered during SME review');
      expect(parsed.actorId).toBeUndefined();
      expect(parsed.baselineId).toBeUndefined();
      expect(parsed.originatingProjectionId).toBeUndefined();
    });

    it('rejects empty or whitespace-only statement', () => {
      expect(() =>
        RecordRequirementDiscoveryRequestDtoSchema.parse({
          statement: '',
          category: 'business-rule',
          rationale: 'Valid rationale'
        })
      ).toThrow();

      expect(() =>
        RecordRequirementDiscoveryRequestDtoSchema.parse({
          statement: '   ',
          category: 'business-rule',
          rationale: 'Valid rationale'
        })
      ).toThrow();
    });

    it('rejects empty or whitespace-only rationale', () => {
      expect(() =>
        RecordRequirementDiscoveryRequestDtoSchema.parse({
          statement: 'Valid statement',
          category: 'business-rule',
          rationale: ''
        })
      ).toThrow();

      expect(() =>
        RecordRequirementDiscoveryRequestDtoSchema.parse({
          statement: 'Valid statement',
          category: 'business-rule',
          rationale: '   '
        })
      ).toThrow();
    });

    it('rejects invalid category', () => {
      expect(() =>
        RecordRequirementDiscoveryRequestDtoSchema.parse({
          statement: 'Valid statement',
          category: 'invalid-cat',
          rationale: 'Valid rationale'
        })
      ).toThrow();
    });
  });

  describe('RecordFindingDiscoveryRequestDtoSchema', () => {
    it('accepts valid human finding discovery request', () => {
      const parsed = RecordFindingDiscoveryRequestDtoSchema.parse({
        type: 'missing-authorization',
        discoveredBy: 'human',
        rationale: 'Admin role is missing required permissions check',
        actorId: 'reviewer-1',
        baselineId: 'BASELINE-001',
        originatingProjectionId: 'PROJ-001',
        affectedRequirementRevisions: ['REQ-001-R1'],
        evidence: [{ sourceRevisionId: 'SRC-001-R1', locator: 'auth#1' }],
        findingId: 'FINDING-CUSTOM'
      });
      expect(parsed.type).toBe('missing-authorization');
      expect(parsed.discoveredBy).toBe('human');
      expect(parsed.rationale).toBe('Admin role is missing required permissions check');
      expect(parsed.actorId).toBe('reviewer-1');
      expect(parsed.baselineId).toBe('BASELINE-001');
      expect(parsed.originatingProjectionId).toBe('PROJ-001');
    });

    it('accepts valid artifact-validation finding discovery request', () => {
      const parsed = RecordFindingDiscoveryRequestDtoSchema.parse({
        type: 'incomplete-state-machine',
        discoveredBy: 'artifact-validation',
        rationale: 'Mermaid diagram review revealed terminal state with no exit transition',
        originatingProjectionId: 'PROJ-002'
      });
      expect(parsed.type).toBe('incomplete-state-machine');
      expect(parsed.discoveredBy).toBe('artifact-validation');
      expect(parsed.originatingProjectionId).toBe('PROJ-002');
    });

    it('rejects disallowed discoveredBy values (model, heuristic, arbitrary)', () => {
      expect(() =>
        RecordFindingDiscoveryRequestDtoSchema.parse({
          type: 'contradiction',
          discoveredBy: 'model',
          rationale: 'Generated by model'
        })
      ).toThrow();

      expect(() =>
        RecordFindingDiscoveryRequestDtoSchema.parse({
          type: 'contradiction',
          discoveredBy: 'heuristic',
          rationale: 'Detected by heuristic'
        })
      ).toThrow();

      expect(() =>
        RecordFindingDiscoveryRequestDtoSchema.parse({
          type: 'contradiction',
          discoveredBy: 'bot',
          rationale: 'Random bot'
        })
      ).toThrow();
    });

    it('rejects empty or whitespace-only rationale', () => {
      expect(() =>
        RecordFindingDiscoveryRequestDtoSchema.parse({
          type: 'contradiction',
          discoveredBy: 'human',
          rationale: ''
        })
      ).toThrow();

      expect(() =>
        RecordFindingDiscoveryRequestDtoSchema.parse({
          type: 'contradiction',
          discoveredBy: 'human',
          rationale: '   '
        })
      ).toThrow();
    });

    it('rejects invalid finding type', () => {
      expect(() =>
        RecordFindingDiscoveryRequestDtoSchema.parse({
          type: 'invalid-finding-type',
          discoveredBy: 'human',
          rationale: 'Valid rationale'
        })
      ).toThrow();
    });
  });

  describe('DTO context fields preservation in schemas', () => {
    it('parses RequirementRevisionDtoSchema with context fields', () => {
      const parsed = RequirementRevisionDtoSchema.parse({
        id: 'REQ-001-R1',
        requirementId: 'REQ-001',
        revision: 1,
        statement: 'Statement',
        category: 'business-rule',
        origin: 'REVIEWER_PROPOSAL',
        reviewState: 'PENDING',
        resolutionState: 'UNRESOLVED',
        evidence: [],
        rationale: 'Discovery rationale',
        actorId: 'actor-1',
        baselineId: 'BASELINE-1',
        originatingProjectionId: 'PROJ-1'
      });
      expect(parsed.actorId).toBe('actor-1');
      expect(parsed.baselineId).toBe('BASELINE-1');
      expect(parsed.originatingProjectionId).toBe('PROJ-1');
    });

    it('parses CandidateFindingDtoSchema with context fields', () => {
      const parsed = CandidateFindingDtoSchema.parse({
        id: 'FINDING-001',
        type: 'contradiction',
        affectedRequirementRevisions: [],
        evidence: [],
        discoveredBy: 'artifact-validation',
        disposition: 'OPEN',
        rationale: 'Discovery rationale',
        actorId: 'actor-1',
        baselineId: 'BASELINE-1',
        originatingProjectionId: 'PROJ-1'
      });
      expect(parsed.actorId).toBe('actor-1');
      expect(parsed.baselineId).toBe('BASELINE-1');
      expect(parsed.originatingProjectionId).toBe('PROJ-1');
    });
  });
});
