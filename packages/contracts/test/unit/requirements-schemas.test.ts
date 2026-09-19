import { describe, it, expect } from 'vitest';
import {
  InstantDtoSchema,
  EvidenceLocatorDtoSchema,
  EvidenceReferenceDtoSchema,
  SourceDtoSchema,
  RequirementDtoSchema,
  SourceRevisionDtoSchema,
  RequirementRevisionDtoSchema,
  RequirementsBaselineDtoSchema,
  CandidateFindingDtoSchema,
  CandidateEvidenceRefDtoSchema,
  CandidateRequirementDtoSchema,
  CandidateRequirementOriginSchema,
  CandidateFindingResponseDtoSchema,
  CompiledRequirementsResponseDtoSchema,
  RequirementReconciliationActionSchema,
  RequirementReconciliationRecordDtoSchema,
  FindingReconciliationRecordDtoSchema,
  ReconciliationRecordDtoSchema,
  CreateRequirementsBaselineRequestDtoSchema,
  PolicyConstraintStateSchema,
  PolicyConstraintRevisionDtoSchema,
  CreatePolicyConstraintRevisionRequestDtoSchema,
  EngineeringDecisionStateSchema,
  EngineeringDecisionDtoSchema,
  CreateEngineeringDecisionRequestDtoSchema,
  TransitionEngineeringDecisionRequestDtoSchema,
  AuthorityBundleDtoSchema,
  GenerateProjectionRequestDtoSchema,
  StoryDtoSchema,
  GenerateStoryRequestDtoSchema,
  ListStoriesResponseDtoSchema,
  StoryReadinessRuleIdSchema,
  StoryReadinessFailureDtoSchema,
  StoryReadinessPolicyDtoSchema,
  StoryReadinessReportDtoSchema,
  ListStoryReadinessReportsResponseDtoSchema,
  RequirementCoverageEntryDtoSchema,
  BaselineRequirementCoverageDtoSchema,
  StoryDependencyGraphDtoSchema,
  UpdateStoryDependenciesRequestDtoSchema,
  EngineeringHandoffSummaryDtoSchema,
  EngineeringHandoffBundleDtoSchema
} from '../../src/requirements/index.js';

describe('Requirements Contract Schemas', () => {
  describe('InstantDtoSchema', () => {
    it('accepts RFC 3339 / ISO-8601 instant strings with timezone', () => {
      expect(InstantDtoSchema.parse('2026-09-15T10:00:00.000Z')).toBe('2026-09-15T10:00:00.000Z');
      expect(InstantDtoSchema.parse('2026-09-15T10:00:00+02:00')).toBe('2026-09-15T10:00:00+02:00');
      expect(InstantDtoSchema.parse('2024-02-29T12:00:00Z')).toBe('2024-02-29T12:00:00Z');
    });

    it('rejects locale-formatted, timezone-less, invalid-calendar, and arbitrary-text inputs', () => {
      expect(() => InstantDtoSchema.parse('09/15/2026')).toThrow();
      expect(() => InstantDtoSchema.parse('2026-09-15T10:00:00')).toThrow();
      expect(() => InstantDtoSchema.parse('2026-09-15')).toThrow();
      expect(() => InstantDtoSchema.parse('2026-02-30T12:00:00Z')).toThrow();
      expect(() => InstantDtoSchema.parse('2026-02-29T12:00:00Z')).toThrow();
      expect(() => InstantDtoSchema.parse('2026-04-31T12:00:00Z')).toThrow();
      expect(() => InstantDtoSchema.parse('not-a-date')).toThrow();
      expect(() => InstantDtoSchema.parse('')).toThrow();
    });
  });

  describe('EvidenceLocatorDtoSchema', () => {
    it('accepts non-empty strings', () => {
      const parsed = EvidenceLocatorDtoSchema.parse('heading-path#1');
      expect(parsed).toBe('heading-path#1');
    });

    it('rejects empty strings', () => {
      expect(() => EvidenceLocatorDtoSchema.parse('')).toThrow();
    });
  });

  describe('EvidenceReferenceDtoSchema', () => {
    it('accepts valid evidence reference DTO', () => {
      const raw = {
        sourceRevisionId: 'INT-004@r3',
        locator: 'business-logic-and-operational-rules#1'
      };
      const parsed = EvidenceReferenceDtoSchema.parse(raw);
      expect(parsed).toEqual(raw);
    });

    it('rejects missing or empty fields', () => {
      expect(() =>
        EvidenceReferenceDtoSchema.parse({ sourceRevisionId: '', locator: 'h#1' })
      ).toThrow();
      expect(() => EvidenceReferenceDtoSchema.parse({ sourceRevisionId: 'INT-004@r1' })).toThrow();
    });
  });

  describe('SourceDtoSchema & RequirementDtoSchema', () => {
    it('validates SourceDto', () => {
      const parsed = SourceDtoSchema.parse({ id: 'INT-004', sourceType: 'interview' });
      expect(parsed.id).toBe('INT-004');
      expect(parsed.sourceType).toBe('interview');

      expect(() => SourceDtoSchema.parse({ id: 'INT-004', sourceType: 'unknown' })).toThrow();
    });

    it('validates RequirementDto', () => {
      const parsed = RequirementDtoSchema.parse({ id: 'R-142' });
      expect(parsed.id).toBe('R-142');

      expect(() => RequirementDtoSchema.parse({ id: '' })).toThrow();
    });
  });

  describe('SourceRevisionDtoSchema', () => {
    it('validates a complete source revision DTO', () => {
      const raw = {
        id: 'INT-004@r1',
        sourceId: 'INT-004',
        revision: 1,
        contentHash: 'hash-1234',
        capturedAt: '2026-09-15T10:00:00.000Z',
        verifiedAt: '2026-09-15T11:00:00.000Z',
        supersedes: 'INT-004@r0'
      };
      const parsed = SourceRevisionDtoSchema.parse(raw);
      expect(parsed).toEqual(raw);
    });

    it('rejects non-positive or float revision numbers', () => {
      expect(() =>
        SourceRevisionDtoSchema.parse({
          id: 'INT-004@r0',
          sourceId: 'INT-004',
          revision: 0,
          contentHash: 'hash',
          capturedAt: '2026-09-15T10:00:00.000Z'
        })
      ).toThrow();

      expect(() =>
        SourceRevisionDtoSchema.parse({
          id: 'INT-004@r1',
          sourceId: 'INT-004',
          revision: 1.5,
          contentHash: 'hash',
          capturedAt: '2026-09-15T10:00:00.000Z'
        })
      ).toThrow();
    });

    it('rejects invalid or arbitrary text in capturedAt and verifiedAt', () => {
      expect(() =>
        SourceRevisionDtoSchema.parse({
          id: 'INT-004@r1',
          sourceId: 'INT-004',
          revision: 1,
          contentHash: 'hash',
          capturedAt: 'not-a-date'
        })
      ).toThrow();

      expect(() =>
        SourceRevisionDtoSchema.parse({
          id: 'INT-004@r1',
          sourceId: 'INT-004',
          revision: 1,
          contentHash: 'hash',
          capturedAt: '2026-09-15T10:00:00.000Z',
          verifiedAt: '2026-02-30T10:00:00.000Z'
        })
      ).toThrow();
    });
  });

  describe('RequirementRevisionDtoSchema', () => {
    it('validates a complete requirement revision DTO', () => {
      const raw = {
        id: 'R-142@r1',
        requirementId: 'R-142',
        revision: 1,
        statement: 'Secondary inspection required above 800 PSI',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: [
          {
            sourceRevisionId: 'INT-004@r3',
            locator: 'business-logic-and-operational-rules#1'
          }
        ],
        rationale: 'Mandated by safety standards',
        affectedActors: ['FieldLead'],
        dependencies: ['R-100'],
        supersedes: 'R-142@r0'
      };
      const parsed = RequirementRevisionDtoSchema.parse(raw);
      expect(parsed).toEqual(raw);
    });

    it('proves boundary validation does NOT enforce domain business rules', () => {
      // In domain, EXPLICIT requirement without evidence cannot enter a baseline,
      // and PENDING + CONFLICTED cannot enter a baseline.
      // But at the CONTRACT layer, structural shape is valid regardless of business lifecycle validity.
      const structurallyValidBusinessInvalid = {
        id: 'R-999@r1',
        requirementId: 'R-999',
        revision: 1,
        statement: 'Pending conflicted statement without evidence',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'PENDING',
        resolutionState: 'CONFLICTED',
        evidence: [] // Empty evidence allowed by contract schema
      };

      const parsed = RequirementRevisionDtoSchema.parse(structurallyValidBusinessInvalid);
      expect(parsed.reviewState).toBe('PENDING');
      expect(parsed.resolutionState).toBe('CONFLICTED');
      expect(parsed.evidence).toHaveLength(0);
    });

    it('rejects invalid enum values or empty required fields', () => {
      expect(() =>
        RequirementRevisionDtoSchema.parse({
          id: 'R-142@r1',
          requirementId: 'R-142',
          revision: 1,
          statement: '', // empty statement
          category: 'business-rule',
          origin: 'EXPLICIT',
          reviewState: 'ACCEPTED',
          resolutionState: 'CLEAR',
          evidence: []
        })
      ).toThrow();

      expect(() =>
        RequirementRevisionDtoSchema.parse({
          id: 'R-142@r1',
          requirementId: 'R-142',
          revision: 1,
          statement: 'Valid statement',
          category: 'non-existent-category',
          origin: 'EXPLICIT',
          reviewState: 'ACCEPTED',
          resolutionState: 'CLEAR',
          evidence: []
        })
      ).toThrow();
    });
  });

  describe('RequirementsBaselineDtoSchema', () => {
    it('validates a valid baseline DTO', () => {
      const raw = {
        id: 'BASELINE-01',
        requirementRevisions: ['R-142@r1', 'R-143@r2'],
        createdAt: '2026-09-15T12:00:00.000Z',
        createdBy: 'REV-01'
      };
      const parsed = RequirementsBaselineDtoSchema.parse(raw);
      expect(parsed).toEqual(raw);
    });

    it('allows empty requirementRevisions array structurally (business rule is domain-only)', () => {
      const emptyRevisions = {
        id: 'BASELINE-EMPTY',
        requirementRevisions: [],
        createdAt: '2026-09-15T12:00:00.000Z',
        createdBy: 'REV-01'
      };
      const parsed = RequirementsBaselineDtoSchema.parse(emptyRevisions);
      expect(parsed.requirementRevisions).toEqual([]);
    });

    it('rejects invalid or arbitrary text in createdAt', () => {
      expect(() =>
        RequirementsBaselineDtoSchema.parse({
          id: 'BASELINE-01',
          requirementRevisions: ['R-142@r1'],
          createdAt: 'not-a-date',
          createdBy: 'REV-01'
        })
      ).toThrow();
    });
  });

  describe('CandidateFindingDtoSchema', () => {
    it('validates a valid finding DTO', () => {
      const raw = {
        id: 'FINDING-01',
        type: 'contradiction',
        affectedRequirementRevisions: ['R-142@r1'],
        evidence: [
          {
            sourceRevisionId: 'INT-004@r1',
            locator: 'section#1'
          }
        ],
        discoveredBy: 'model',
        disposition: 'OPEN'
      };
      const parsed = CandidateFindingDtoSchema.parse(raw);
      expect(parsed).toEqual(raw);
    });

    it('rejects invalid disposition or type', () => {
      expect(() =>
        CandidateFindingDtoSchema.parse({
          id: 'FINDING-01',
          type: 'invalid-type',
          affectedRequirementRevisions: [],
          evidence: [],
          discoveredBy: 'model',
          disposition: 'OPEN'
        })
      ).toThrow();

      expect(() =>
        CandidateFindingDtoSchema.parse({
          id: 'FINDING-01',
          type: 'contradiction',
          affectedRequirementRevisions: [],
          evidence: [],
          discoveredBy: 'model',
          disposition: 'NOT_A_DISPOSITION'
        })
      ).toThrow();
    });
  });

  describe('Candidate Compilation Schemas', () => {
    it('guarantees CandidateEvidenceRefDtoSchema is reference-identical to EvidenceReferenceDtoSchema', () => {
      expect(CandidateEvidenceRefDtoSchema).toBe(EvidenceReferenceDtoSchema);
      expect(CandidateRequirementDtoSchema.shape.evidence.element).toBe(EvidenceReferenceDtoSchema);
      expect(CandidateFindingResponseDtoSchema.shape.evidence.element).toBe(
        EvidenceReferenceDtoSchema
      );
    });

    it('validates a valid CandidateRequirementDto', () => {
      const valid = {
        requirementKey: 'REQ-1',
        statement: 'Must do X',
        category: 'business-rule',
        origin: 'EXPLICIT',
        evidence: [{ sourceRevisionId: 'REV-1', locator: 'loc#1' }],
        rationale: 'some rationale'
      };
      const parsed = CandidateRequirementDtoSchema.parse(valid);
      expect(parsed).toEqual(valid);
    });

    it('allows empty evidence on CandidateRequirementDto structurally', () => {
      const valid = {
        requirementKey: 'REQ-2',
        statement: 'Assumption Y',
        category: 'business-rule',
        origin: 'ASSUMED',
        evidence: []
      };
      const parsed = CandidateRequirementDtoSchema.parse(valid);
      expect(parsed.evidence).toHaveLength(0);
    });

    it('rejects CandidateRequirementDto with missing requirementKey or statement', () => {
      expect(() =>
        CandidateRequirementDtoSchema.parse({
          requirementKey: '',
          statement: 'Statement',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: []
        })
      ).toThrow();

      expect(() =>
        CandidateRequirementDtoSchema.parse({
          requirementKey: 'REQ-1',
          statement: '',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: []
        })
      ).toThrow();
    });

    it('rejects CandidateRequirementDto with invalid category or origin enum', () => {
      expect(() =>
        CandidateRequirementDtoSchema.parse({
          requirementKey: 'REQ-1',
          statement: 'Statement',
          category: 'invalid-category',
          origin: 'EXPLICIT',
          evidence: []
        })
      ).toThrow();

      expect(() =>
        CandidateRequirementDtoSchema.parse({
          requirementKey: 'REQ-1',
          statement: 'Statement',
          category: 'business-rule',
          origin: 'INVALID_ORIGIN',
          evidence: []
        })
      ).toThrow();
    });

    it('accepts only model-permitted origins and rejects REVIEWER_PROPOSAL from candidate generation', () => {
      const allowedOrigins = ['EXPLICIT', 'INFERRED', 'ASSUMED', 'GENERATED_PROPOSAL'] as const;
      for (const origin of allowedOrigins) {
        const parsed = CandidateRequirementDtoSchema.parse({
          requirementKey: 'REQ-OK',
          statement: 'Valid statement',
          category: 'business-rule',
          origin,
          evidence: []
        });
        expect(parsed.origin).toBe(origin);
      }

      // CandidateRequirementOriginSchema accepts permitted origins and rejects REVIEWER_PROPOSAL
      expect(CandidateRequirementOriginSchema.parse('EXPLICIT')).toBe('EXPLICIT');
      expect(() => CandidateRequirementOriginSchema.parse('REVIEWER_PROPOSAL')).toThrow();

      // CandidateRequirementDtoSchema must reject human-only REVIEWER_PROPOSAL
      expect(() =>
        CandidateRequirementDtoSchema.parse({
          requirementKey: 'REQ-FORBIDDEN',
          statement: 'Model trying to claim reviewer authority',
          category: 'business-rule',
          origin: 'REVIEWER_PROPOSAL',
          evidence: []
        })
      ).toThrow();

      // CompiledRequirementsResponseDtoSchema must fail parsing when a requirement has REVIEWER_PROPOSAL
      expect(() =>
        CompiledRequirementsResponseDtoSchema.parse({
          requirements: [
            {
              requirementKey: 'REQ-FORBIDDEN',
              statement: 'Model claiming reviewer authority',
              category: 'business-rule',
              origin: 'REVIEWER_PROPOSAL',
              evidence: []
            }
          ],
          findings: []
        })
      ).toThrow();

      // But persisted RequirementRevisionDtoSchema STILL accepts REVIEWER_PROPOSAL for human reconciliation
      const persistedRev = RequirementRevisionDtoSchema.parse({
        id: 'REQ-HUMAN-R1',
        requirementId: 'REQ-HUMAN',
        revision: 1,
        statement: 'Human proposed requirement',
        category: 'business-rule',
        origin: 'REVIEWER_PROPOSAL',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: []
      });
      expect(persistedRev.origin).toBe('REVIEWER_PROPOSAL');
    });

    it('validates a valid CandidateFindingResponseDto', () => {
      const valid = {
        findingKey: 'FINDING-1',
        type: 'contradiction',
        relatedRequirementKeys: ['REQ-1'],
        evidence: [{ sourceRevisionId: 'REV-1', locator: 'loc#1' }],
        rationale: 'Conflict between statements'
      };
      const parsed = CandidateFindingResponseDtoSchema.parse(valid);
      expect(parsed).toEqual(valid);
    });

    it('rejects CandidateFindingResponseDto with empty rationale', () => {
      expect(() =>
        CandidateFindingResponseDtoSchema.parse({
          findingKey: 'FINDING-1',
          type: 'contradiction',
          relatedRequirementKeys: ['REQ-1'],
          evidence: [],
          rationale: ''
        })
      ).toThrow();
    });

    it('rejects CandidateFindingResponseDto with invalid type enum', () => {
      expect(() =>
        CandidateFindingResponseDtoSchema.parse({
          findingKey: 'FINDING-1',
          type: 'not-a-finding-type',
          relatedRequirementKeys: [],
          evidence: [],
          rationale: 'Some rationale'
        })
      ).toThrow();
    });

    it('validates a complete CompiledRequirementsResponseDto', () => {
      const validResponse = {
        requirements: [
          {
            requirementKey: 'REQ-1',
            statement: 'Primary inspection required',
            category: 'business-rule',
            origin: 'EXPLICIT',
            evidence: [{ sourceRevisionId: 'REV-1', locator: 'h#1' }]
          }
        ],
        findings: [
          {
            findingKey: 'FINDING-1',
            type: 'missing-authorization',
            relatedRequirementKeys: ['REQ-1'],
            evidence: [{ sourceRevisionId: 'REV-1', locator: 'h#1' }],
            rationale: 'No role specified for inspection'
          }
        ]
      };
      const parsed = CompiledRequirementsResponseDtoSchema.parse(validResponse);
      expect(parsed).toEqual(validResponse);
    });

    it('allows empty requirements and findings arrays in CompiledRequirementsResponseDto', () => {
      const emptyResponse = {
        requirements: [],
        findings: []
      };
      const parsed = CompiledRequirementsResponseDtoSchema.parse(emptyResponse);
      expect(parsed.requirements).toEqual([]);
      expect(parsed.findings).toEqual([]);
    });

    it('rejects CompiledRequirementsResponseDto with duplicate requirementKey values', () => {
      const duplicateReqResponse = {
        requirements: [
          {
            requirementKey: 'REQ-DUP',
            statement: 'First statement',
            category: 'business-rule',
            origin: 'EXPLICIT',
            evidence: [{ sourceRevisionId: 'REV-1', locator: 'h#1' }]
          },
          {
            requirementKey: 'REQ-DUP',
            statement: 'Second statement',
            category: 'business-rule',
            origin: 'EXPLICIT',
            evidence: [{ sourceRevisionId: 'REV-1', locator: 'h#2' }]
          }
        ],
        findings: []
      };
      expect(() => CompiledRequirementsResponseDtoSchema.parse(duplicateReqResponse)).toThrow(
        /Duplicate requirementKey/
      );
    });

    it('rejects CompiledRequirementsResponseDto with duplicate findingKey values', () => {
      const duplicateFindingResponse = {
        requirements: [],
        findings: [
          {
            findingKey: 'FINDING-DUP',
            type: 'contradiction',
            relatedRequirementKeys: [],
            evidence: [{ sourceRevisionId: 'REV-1', locator: 'h#1' }],
            rationale: 'First finding'
          },
          {
            findingKey: 'FINDING-DUP',
            type: 'missing-authorization',
            relatedRequirementKeys: [],
            evidence: [{ sourceRevisionId: 'REV-1', locator: 'h#2' }],
            rationale: 'Second finding'
          }
        ]
      };
      expect(() => CompiledRequirementsResponseDtoSchema.parse(duplicateFindingResponse)).toThrow(
        /Duplicate findingKey/
      );
    });
  });

  describe('RequirementReconciliationActionSchema', () => {
    it('accepts valid reconciliation actions', () => {
      expect(RequirementReconciliationActionSchema.parse('ACCEPT')).toBe('ACCEPT');
      expect(RequirementReconciliationActionSchema.parse('REJECT')).toBe('REJECT');
      expect(RequirementReconciliationActionSchema.parse('REVISE')).toBe('REVISE');
      expect(RequirementReconciliationActionSchema.parse('REOPEN')).toBe('REOPEN');
      expect(RequirementReconciliationActionSchema.parse('RESOLVE')).toBe('RESOLVE');
    });

    it('rejects invalid action', () => {
      expect(() => RequirementReconciliationActionSchema.parse('INVALID')).toThrow();
    });
  });

  describe('RequirementReconciliationRecordDtoSchema', () => {
    const baseValidRecord = {
      id: 'REC-REQ-001',
      entityType: 'requirement' as const,
      entityId: 'REQ-100',
      requirementRevisionId: 'REQ-100-R2',
      action: 'ACCEPT' as const,
      previousReviewState: 'PENDING' as const,
      newReviewState: 'ACCEPTED' as const,
      rationale: 'Human reviewer accepts candidate requirement',
      actorId: 'REV-01',
      recordedAt: '2026-09-16T12:00:00.000Z'
    };

    it('validates a valid record without resolution fields', () => {
      const parsed = RequirementReconciliationRecordDtoSchema.parse(baseValidRecord);
      expect(parsed).toEqual(baseValidRecord);
    });

    it('validates a valid first record where previousReviewState is undefined', () => {
      const firstRecord = {
        ...baseValidRecord,
        previousReviewState: undefined
      };
      const parsed = RequirementReconciliationRecordDtoSchema.parse(firstRecord);
      expect(parsed.previousReviewState).toBeUndefined();
    });

    it('validates paired resolution fields for RESOLVE', () => {
      const resolveRecord = {
        ...baseValidRecord,
        action: 'RESOLVE' as const,
        previousResolutionState: 'UNRESOLVED' as const,
        newResolutionState: 'CLEAR' as const,
        rationale: 'Addressed known ambiguity'
      };
      const parsed = RequirementReconciliationRecordDtoSchema.parse(resolveRecord);
      expect(parsed.previousResolutionState).toBe('UNRESOLVED');
      expect(parsed.newResolutionState).toBe('CLEAR');
    });

    it('rejects one-sided resolution fields (missing previousResolutionState)', () => {
      const invalid = {
        ...baseValidRecord,
        newResolutionState: 'CLEAR' as const
      };
      expect(() => RequirementReconciliationRecordDtoSchema.parse(invalid)).toThrow(
        /previousResolutionState is required/
      );
    });

    it('rejects one-sided resolution fields (missing newResolutionState)', () => {
      const invalid = {
        ...baseValidRecord,
        previousResolutionState: 'UNRESOLVED' as const
      };
      expect(() => RequirementReconciliationRecordDtoSchema.parse(invalid)).toThrow(
        /newResolutionState is required/
      );
    });

    it('rejects identical resolution states when action is not REVISE', () => {
      const invalid = {
        ...baseValidRecord,
        action: 'ACCEPT' as const,
        previousResolutionState: 'UNRESOLVED' as const,
        newResolutionState: 'UNRESOLVED' as const
      };
      expect(() => RequirementReconciliationRecordDtoSchema.parse(invalid)).toThrow(
        /Resolution states cannot be identical/
      );
    });

    it('allows identical resolution states when action is REVISE fork', () => {
      const reviseFork = {
        ...baseValidRecord,
        action: 'REVISE' as const,
        previousResolutionState: 'UNRESOLVED' as const,
        newResolutionState: 'UNRESOLVED' as const,
        rationale: 'Explicit revision fork preserving unresolved state'
      };
      const parsed = RequirementReconciliationRecordDtoSchema.parse(reviseFork);
      expect(parsed.action).toBe('REVISE');
    });

    it('rejects empty or whitespace-only rationale', () => {
      expect(() =>
        RequirementReconciliationRecordDtoSchema.parse({
          ...baseValidRecord,
          rationale: ''
        })
      ).toThrow();

      expect(() =>
        RequirementReconciliationRecordDtoSchema.parse({
          ...baseValidRecord,
          rationale: '   '
        })
      ).toThrow();
    });
  });

  describe('FindingReconciliationRecordDtoSchema', () => {
    const baseFindingRecord = {
      id: 'REC-FIND-001',
      entityType: 'finding' as const,
      entityId: 'FINDING-1',
      previousDisposition: 'OPEN' as const,
      newDisposition: 'RESOLVED' as const,
      rationale: 'Fixed in revision 2 by adding supervisor signoff',
      actorId: 'REV-01',
      recordedAt: '2026-09-16T12:00:00.000Z'
    };

    it('validates a valid finding reconciliation record', () => {
      const parsed = FindingReconciliationRecordDtoSchema.parse(baseFindingRecord);
      expect(parsed).toEqual(baseFindingRecord);
    });

    it('rejects transition where previousDisposition equals newDisposition', () => {
      const invalid = {
        ...baseFindingRecord,
        previousDisposition: 'OPEN' as const,
        newDisposition: 'OPEN' as const
      };
      expect(() => FindingReconciliationRecordDtoSchema.parse(invalid)).toThrow(
        /Transition must change disposition/
      );
    });

    it('rejects empty or whitespace-only rationale', () => {
      expect(() =>
        FindingReconciliationRecordDtoSchema.parse({
          ...baseFindingRecord,
          rationale: ''
        })
      ).toThrow();

      expect(() =>
        FindingReconciliationRecordDtoSchema.parse({
          ...baseFindingRecord,
          rationale: '   '
        })
      ).toThrow();
    });
  });

  describe('ReconciliationRecordDtoSchema (discriminated union)', () => {
    it('discriminates requirement records', () => {
      const rec = {
        id: 'REC-1',
        entityType: 'requirement' as const,
        entityId: 'REQ-1',
        requirementRevisionId: 'REQ-1-R1',
        action: 'ACCEPT' as const,
        newReviewState: 'ACCEPTED' as const,
        rationale: 'Accepted',
        recordedAt: '2026-09-16T12:00:00.000Z'
      };
      const parsed = ReconciliationRecordDtoSchema.parse(rec);
      expect(parsed.entityType).toBe('requirement');
    });

    it('discriminates finding records', () => {
      const rec = {
        id: 'REC-2',
        entityType: 'finding' as const,
        entityId: 'FIND-1',
        previousDisposition: 'OPEN' as const,
        newDisposition: 'ACCEPTED_RISK' as const,
        rationale: 'Accepted low risk',
        recordedAt: '2026-09-16T12:00:00.000Z'
      };
      const parsed = ReconciliationRecordDtoSchema.parse(rec);
      expect(parsed.entityType).toBe('finding');
    });

    it('rejects unknown entityType', () => {
      expect(() =>
        ReconciliationRecordDtoSchema.parse({
          id: 'REC-3',
          entityType: 'unknown',
          rationale: 'test'
        })
      ).toThrow();
    });
  });

  describe('CreateRequirementsBaselineRequestDtoSchema', () => {
    it('validates a complete baseline creation request', () => {
      const valid = {
        id: 'BASELINE-1',
        requirementRevisions: ['REQ-1-R2', 'REQ-2-R1'],
        createdBy: 'REV-01',
        createdAt: '2026-09-16T12:00:00.000Z'
      };
      const parsed = CreateRequirementsBaselineRequestDtoSchema.parse(valid);
      expect(parsed).toEqual(valid);
    });

    it('allows optional id and createdAt', () => {
      const minimal = {
        requirementRevisions: ['REQ-1-R2'],
        createdBy: 'REV-01'
      };
      const parsed = CreateRequirementsBaselineRequestDtoSchema.parse(minimal);
      expect(parsed.requirementRevisions).toEqual(['REQ-1-R2']);
      expect(parsed.id).toBeUndefined();
      expect(parsed.createdAt).toBeUndefined();
    });

    it('rejects empty requirementRevisions array', () => {
      expect(() =>
        CreateRequirementsBaselineRequestDtoSchema.parse({
          requirementRevisions: [],
          createdBy: 'REV-01'
        })
      ).toThrow();
    });

    it('allows optional policyConstraintRevisions array', () => {
      const parsed = CreateRequirementsBaselineRequestDtoSchema.parse({
        requirementRevisions: ['REQ-1-R1'],
        policyConstraintRevisions: ['PC-SEC-001@r1'],
        createdBy: 'REV-01'
      });
      expect(parsed.policyConstraintRevisions).toEqual(['PC-SEC-001@r1']);
    });
  });

  describe('PolicyConstraintRevisionDtoSchema', () => {
    it('validates valid policy constraint revision DTO', () => {
      const raw = {
        id: 'PC-SEC-001@r1',
        policyConstraintId: 'PC-SEC-001',
        revision: 1,
        statement: 'TLS 1.3 required',
        authorityReference: 'NIST-800-53',
        state: 'ACCEPTED',
        createdAt: '2026-09-15T12:00:00.000Z',
        createdBy: 'sec-lead'
      };
      const parsed = PolicyConstraintRevisionDtoSchema.parse(raw);
      expect(parsed).toEqual(raw);
    });

    it('rejects non-positive revision or empty fields', () => {
      expect(() =>
        PolicyConstraintRevisionDtoSchema.parse({
          id: 'PC-SEC-001@r1',
          policyConstraintId: 'PC-SEC-001',
          revision: 0,
          statement: 'TLS 1.3 required',
          authorityReference: 'NIST-800-53',
          state: 'ACCEPTED',
          createdAt: '2026-09-15T12:00:00.000Z',
          createdBy: 'sec-lead'
        })
      ).toThrow();
    });
  });

  describe('CreatePolicyConstraintRevisionRequestDtoSchema', () => {
    it('defaults state to ACCEPTED', () => {
      const parsed = CreatePolicyConstraintRevisionRequestDtoSchema.parse({
        policyConstraintId: 'PC-SEC-001',
        statement: 'TLS 1.3 required',
        authorityReference: 'NIST-800-53',
        createdBy: 'sec-lead'
      });
      expect(parsed.state).toBe('ACCEPTED');
    });
  });

  describe('EngineeringDecisionDtoSchema', () => {
    it('validates valid engineering decision DTO', () => {
      const raw = {
        id: 'ED-001',
        baselineId: 'BASE-001',
        statement: 'Use composite B-tree index',
        rationale: 'Performance optimization',
        requirementRevisionIds: ['R-100@r1'],
        policyConstraintRevisionIds: ['PC-SEC-001@r1'],
        state: 'PROPOSED',
        createdAt: '2026-09-15T12:00:00.000Z',
        createdBy: 'lead-dev'
      };
      const parsed = EngineeringDecisionDtoSchema.parse(raw);
      expect(parsed).toEqual(raw);
    });
  });

  describe('CreateEngineeringDecisionRequestDtoSchema', () => {
    it('defaults requirementRevisionIds and policyConstraintRevisionIds to empty arrays', () => {
      const parsed = CreateEngineeringDecisionRequestDtoSchema.parse({
        baselineId: 'BASE-001',
        statement: 'Use composite B-tree index',
        rationale: 'Performance optimization',
        createdBy: 'lead-dev'
      });
      expect(parsed.requirementRevisionIds).toEqual([]);
      expect(parsed.policyConstraintRevisionIds).toEqual([]);
    });
  });

  describe('TransitionEngineeringDecisionRequestDtoSchema', () => {
    it('validates valid transition request DTO', () => {
      const raw = {
        newState: 'ACCEPTED',
        rationale: 'Approved by architecture board',
        actorId: 'REV-01'
      };
      const parsed = TransitionEngineeringDecisionRequestDtoSchema.parse(raw);
      expect(parsed).toEqual(raw);
    });
  });

  describe('AuthorityBundleDtoSchema', () => {
    it('validates valid authority bundle DTO', () => {
      const raw = {
        baseline: {
          id: 'BASE-001',
          requirementRevisions: ['R-100@r1'],
          policyConstraintRevisions: ['PC-SEC-001@r1'],
          createdAt: '2026-09-15T12:00:00.000Z',
          createdBy: 'REV-01'
        },
        requirements: [
          {
            id: 'R-100@r1',
            requirementId: 'R-100',
            revision: 1,
            statement: 'Must do X',
            category: 'business-rule',
            origin: 'ASSUMED',
            reviewState: 'ACCEPTED',
            resolutionState: 'CLEAR',
            evidence: []
          }
        ],
        policyConstraints: [
          {
            id: 'PC-SEC-001@r1',
            policyConstraintId: 'PC-SEC-001',
            revision: 1,
            statement: 'TLS 1.3 required',
            authorityReference: 'NIST-800-53',
            state: 'ACCEPTED',
            createdAt: '2026-09-15T12:00:00.000Z',
            createdBy: 'sec-lead'
          }
        ]
      };
      const parsed = AuthorityBundleDtoSchema.parse(raw);
      expect(parsed).toEqual(raw);
    });
  });

  describe('PolicyConstraintStateSchema', () => {
    it('validates allowed states and rejects unknown states', () => {
      expect(PolicyConstraintStateSchema.parse('PENDING')).toBe('PENDING');
      expect(PolicyConstraintStateSchema.parse('ACCEPTED')).toBe('ACCEPTED');
      expect(PolicyConstraintStateSchema.parse('REJECTED')).toBe('REJECTED');
      expect(() => PolicyConstraintStateSchema.parse('UNKNOWN')).toThrow();
    });
  });

  describe('EngineeringDecisionStateSchema', () => {
    it('validates allowed states and rejects unknown states', () => {
      expect(EngineeringDecisionStateSchema.parse('PROPOSED')).toBe('PROPOSED');
      expect(EngineeringDecisionStateSchema.parse('ACCEPTED')).toBe('ACCEPTED');
      expect(EngineeringDecisionStateSchema.parse('REJECTED')).toBe('REJECTED');
      expect(() => EngineeringDecisionStateSchema.parse('UNKNOWN')).toThrow();
    });
  });

  describe('GenerateProjectionRequestDtoSchema', () => {
    it('accepts stories as valid artifactType', () => {
      const parsed = GenerateProjectionRequestDtoSchema.parse({
        artifactType: 'stories',
        prompt: 'Generate user stories'
      });
      expect(parsed.artifactType).toBe('stories');
      expect(parsed.prompt).toBe('Generate user stories');
    });
  });

  describe('StoryDtoSchema', () => {
    it('validates a complete StoryDto object', () => {
      const rawStory = {
        id: 'STORY-001',
        baselineId: 'BASE-001',
        projectionId: 'PROJ-001',
        title: 'User Story Title',
        narrative: {
          role: 'Admin',
          feature: 'Manage permissions',
          benefit: 'Ensure security'
        },
        requirementRevisionIds: ['REQ-001-R1'],
        policyConstraintRevisionIds: ['POL-001-R1'],
        scenarios: [
          {
            title: 'Scenario 1',
            requirementRevisionIds: ['REQ-001-R1'],
            steps: [{ keyword: 'Given' as const, text: 'step 1' }]
          }
        ],
        acceptanceCriteria: ['Scenario 1'],
        gherkinText: 'Feature: F\n  Scenario: S',
        createdAt: '2026-09-18T12:00:00.000Z'
      };
      const parsed = StoryDtoSchema.parse(rawStory);
      expect(parsed.id).toBe('STORY-001');
      expect(parsed.scenarios[0].steps[0].keyword).toBe('Given');
    });

    it('rejects story with empty scenarios array', () => {
      const invalid = {
        id: 'STORY-001',
        baselineId: 'BASE-001',
        title: 'Title',
        narrative: { role: 'A', feature: 'B', benefit: 'C' },
        requirementRevisionIds: ['REQ-001-R1'],
        scenarios: [],
        acceptanceCriteria: [],
        gherkinText: 'Feature: F',
        createdAt: '2026-09-18T12:00:00.000Z'
      };
      expect(() => StoryDtoSchema.parse(invalid)).toThrow();
    });
  });

  describe('GenerateStoryRequestDtoSchema and ListStoriesResponseDtoSchema', () => {
    it('validates request and list response', () => {
      const req = GenerateStoryRequestDtoSchema.parse({
        prompt: 'Focus on auth',
        autoRecordDiscoveries: true
      });
      expect(req.autoRecordDiscoveries).toBe(true);

      const list = ListStoriesResponseDtoSchema.parse([]);
      expect(list).toEqual([]);
    });
  });

  describe('StoryDto with dependencies', () => {
    it('validates a story with declared dependencies', () => {
      const rawStory = {
        id: 'STORY-002',
        baselineId: 'BASE-001',
        title: 'Story with dependencies',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: ['REQ-001-R1'],
        scenarios: [
          {
            title: 'S1',
            requirementRevisionIds: ['REQ-001-R1'],
            steps: [{ keyword: 'Given' as const, text: 'step 1' }]
          }
        ],
        acceptanceCriteria: ['S1'],
        gherkinText: 'Feature: F',
        dependencies: ['STORY-001'],
        createdAt: '2026-09-19T00:00:00.000Z'
      };

      const parsed = StoryDtoSchema.parse(rawStory);
      expect(parsed.dependencies).toEqual(['STORY-001']);
    });
  });

  describe('StoryReadinessReportDtoSchema', () => {
    it('validates an implementation-ready report', () => {
      const raw = {
        storyId: 'STORY-001',
        baselineId: 'BASE-001',
        status: 'implementation-ready' as const,
        isReady: true,
        evaluatedAt: '2026-09-19T00:00:00.000Z',
        failures: [],
        passedRules: ['baseline-exists', 'requirement-revisions-belong-to-baseline']
      };

      const parsed = StoryReadinessReportDtoSchema.parse(raw);
      expect(parsed.isReady).toBe(true);
      expect(parsed.status).toBe('implementation-ready');
      expect(parsed.failures).toHaveLength(0);
    });

    it('validates a not-ready report with structured failures', () => {
      const raw = {
        storyId: 'STORY-001',
        baselineId: 'BASE-001',
        status: 'not-ready' as const,
        isReady: false,
        evaluatedAt: '2026-09-19T00:00:00.000Z',
        failures: [
          {
            ruleId: 'no-blocking-open-findings',
            message: 'Blocking open candidate finding affects story lineage',
            affectedIds: ['FND-001'],
            details: { type: 'contradiction' }
          }
        ],
        passedRules: ['baseline-exists'],
        policy: {
          requireSqlProjection: true,
          allowDeferredEngineeringDecisions: false
        }
      };

      const parsed = StoryReadinessReportDtoSchema.parse(raw);
      expect(parsed.isReady).toBe(false);
      expect(parsed.status).toBe('not-ready');
      expect(parsed.failures).toHaveLength(1);
      expect(parsed.failures[0].ruleId).toBe('no-blocking-open-findings');
      expect(parsed.failures[0].affectedIds).toEqual(['FND-001']);
      expect(parsed.policy?.requireSqlProjection).toBe(true);
    });
  });

  describe('BaselineRequirementCoverageDtoSchema', () => {
    it('validates a baseline requirement coverage report', () => {
      const raw = {
        baselineId: 'BASE-001',
        totalRequirements: 3,
        coveredCount: 2,
        uncoveredCount: 1,
        multiCoveredCount: 1,
        coveredRequirements: [
          {
            requirementRevisionId: 'REQ-001-R1',
            coveringStoryIds: ['STORY-001', 'STORY-002'],
            coverageCount: 2
          },
          {
            requirementRevisionId: 'REQ-002-R1',
            coveringStoryIds: ['STORY-002'],
            coverageCount: 1
          }
        ],
        uncoveredRequirementRevisionIds: ['REQ-003-R1'],
        multiCoveredRequirements: [
          {
            requirementRevisionId: 'REQ-001-R1',
            coveringStoryIds: ['STORY-001', 'STORY-002'],
            coverageCount: 2
          }
        ],
        isFullyCovered: false,
        computedAt: '2026-09-19T00:00:00.000Z'
      };

      const parsed = BaselineRequirementCoverageDtoSchema.parse(raw);
      expect(parsed.totalRequirements).toBe(3);
      expect(parsed.isFullyCovered).toBe(false);
      expect(parsed.uncoveredRequirementRevisionIds).toEqual(['REQ-003-R1']);
      expect(parsed.multiCoveredRequirements).toHaveLength(1);
    });

    it('validates individual requirement coverage entries and rule schemas', () => {
      expect(StoryReadinessRuleIdSchema.parse('baseline-exists')).toBe('baseline-exists');
      expect(StoryReadinessRuleIdSchema.safeParse('invalid-rule').success).toBe(false);

      const failure = StoryReadinessFailureDtoSchema.parse({
        ruleId: 'baseline-exists',
        message: 'Baseline does not exist',
        affectedIds: ['BASE-1']
      });
      expect(failure.ruleId).toBe('baseline-exists');

      const policy = StoryReadinessPolicyDtoSchema.parse({
        requireSqlProjection: true,
        allowDeferredEngineeringDecisions: false
      });
      expect(policy.requireSqlProjection).toBe(true);

      const listResponse = ListStoryReadinessReportsResponseDtoSchema.parse([]);
      expect(listResponse).toEqual([]);

      const entry = RequirementCoverageEntryDtoSchema.parse({
        requirementRevisionId: 'REQ-001-R1',
        coveringStoryIds: ['STORY-001'],
        coverageCount: 1
      });
      expect(entry.coverageCount).toBe(1);
    });
  });

  describe('StoryDependencyGraphDtoSchema', () => {
    it('validates a valid StoryDependencyGraphDto', () => {
      const raw = {
        baselineId: 'BASE-001',
        nodes: [
          {
            storyId: 'STORY-001',
            title: 'Story 1',
            requirementRevisionIds: ['REQ-001-R1'],
            dependencies: [],
            dependents: ['STORY-002'],
            readinessStatus: 'implementation-ready' as const,
            isReady: true
          },
          {
            storyId: 'STORY-002',
            title: 'Story 2',
            requirementRevisionIds: ['REQ-001-R1'],
            dependencies: ['STORY-001'],
            dependents: [],
            readinessStatus: 'not-ready' as const,
            isReady: false
          }
        ],
        edges: [{ from: 'STORY-001', to: 'STORY-002' }],
        executionOrder: ['STORY-001', 'STORY-002'],
        isAcyclic: true,
        hasCycles: false,
        cycles: [],
        validation: {
          isValid: true,
          errors: [],
          missingNodeIds: [],
          selfDependencies: [],
          cycles: []
        },
        createdAt: '2026-09-19T00:00:00.000Z'
      };

      const parsed = StoryDependencyGraphDtoSchema.parse(raw);
      expect(parsed.baselineId).toBe('BASE-001');
      expect(parsed.executionOrder).toEqual(['STORY-001', 'STORY-002']);
    });

    it('validates UpdateStoryDependenciesRequestDtoSchema', () => {
      const parsed = UpdateStoryDependenciesRequestDtoSchema.parse({
        dependencies: ['STORY-001', 'STORY-002']
      });
      expect(parsed.dependencies).toEqual(['STORY-001', 'STORY-002']);
    });
  });

  describe('EngineeringHandoffBundleDtoSchema', () => {
    const minimalBundle = {
      baseline: {
        id: 'BASE-001',
        requirementRevisions: ['REQ-001-R1'],
        createdAt: '2026-09-19T00:00:00.000Z',
        createdBy: 'REV-01'
      },
      authorityBundle: {
        baseline: {
          id: 'BASE-001',
          requirementRevisions: ['REQ-001-R1'],
          createdAt: '2026-09-19T00:00:00.000Z',
          createdBy: 'REV-01'
        },
        requirements: [
          {
            id: 'REQ-001-R1',
            requirementId: 'REQ-001',
            revision: 1,
            statement: 'Test requirement',
            category: 'business-rule' as const,
            origin: 'EXPLICIT' as const,
            reviewState: 'ACCEPTED' as const,
            resolutionState: 'CLEAR' as const,
            evidence: []
          }
        ],
        policyConstraints: []
      },
      engineeringDecisions: [],
      // projections optional
      stories: [],
      readinessReports: [],
      coverage: {
        baselineId: 'BASE-001',
        totalRequirements: 1,
        coveredCount: 0,
        uncoveredCount: 1,
        multiCoveredCount: 0,
        coveredRequirements: [],
        uncoveredRequirementRevisionIds: ['REQ-001-R1'],
        multiCoveredRequirements: [],
        isFullyCovered: false,
        computedAt: '2026-09-19T00:00:00.000Z'
      },
      dependencyGraph: {
        baselineId: 'BASE-001',
        nodes: [],
        edges: [],
        executionOrder: [],
        isAcyclic: true,
        hasCycles: false,
        cycles: [],
        validation: {
          isValid: true,
          errors: [],
          missingNodeIds: [],
          selfDependencies: [],
          cycles: []
        },
        createdAt: '2026-09-19T00:00:00.000Z'
      },
      blockingFindings: [],
      unresolvedRequirements: [],
      summary: {
        totalStories: 0,
        readyStories: 0,
        nonReadyStories: 0,
        totalRequirements: 1,
        coveredRequirements: 0,
        openBlockingFindings: 0,
        isHandoffReady: false
      }
    };

    it('validates a bundle without optional SQL or OpenAPI projections', () => {
      const parsed = EngineeringHandoffBundleDtoSchema.parse(minimalBundle);
      expect(parsed.sqlProjection).toBeUndefined();
      expect(parsed.openApiProjection).toBeUndefined();
      expect(parsed.summary.isHandoffReady).toBe(false);
    });

    it('validates a bundle with SQL and OpenAPI projections', () => {
      const withProjections = {
        ...minimalBundle,
        sqlProjection: {
          id: 'PROJ-SQL-001',
          baselineId: 'BASE-001',
          requirementRevisionIds: ['REQ-001-R1'],
          artifactType: 'sql-schema',
          content: 'CREATE TABLE t ();',
          metadata: {
            baselineId: 'BASE-001',
            requirementRevisionIds: ['REQ-001-R1'],
            artifactType: 'sql-schema',
            declaredProvenance: {
              baselineId: 'BASE-001',
              requirementRevisionIds: ['REQ-001-R1']
            },
            configuredExecution: {
              provider: 'fake',
              model: 'model1',
              artifactType: 'sql-schema'
            },
            measuredVerification: {
              repairsNeeded: 0,
              attemptCount: 1,
              contentHash: 'hash2',
              verifiedAt: '2026-09-19T00:00:00.000Z'
            }
          },
          createdAt: '2026-09-19T00:00:00.000Z'
        },
        openApiProjection: {
          id: 'PROJ-OAS-001',
          baselineId: 'BASE-001',
          requirementRevisionIds: ['REQ-001-R1'],
          artifactType: 'openapi',
          content: 'openapi: 3.1.0',
          metadata: {
            baselineId: 'BASE-001',
            requirementRevisionIds: ['REQ-001-R1'],
            artifactType: 'openapi',
            declaredProvenance: {
              baselineId: 'BASE-001',
              requirementRevisionIds: ['REQ-001-R1']
            },
            configuredExecution: {
              provider: 'fake',
              model: 'model1',
              artifactType: 'openapi'
            },
            measuredVerification: {
              repairsNeeded: 0,
              attemptCount: 1,
              contentHash: 'hash3',
              verifiedAt: '2026-09-19T00:00:00.000Z'
            }
          },
          createdAt: '2026-09-19T00:00:00.000Z'
        }
      };

      const parsed = EngineeringHandoffBundleDtoSchema.parse(withProjections);
      expect(parsed.sqlProjection?.id).toBe('PROJ-SQL-001');
      expect(parsed.openApiProjection?.id).toBe('PROJ-OAS-001');
    });

    it('validates EngineeringHandoffSummaryDtoSchema', () => {
      const summary = {
        totalRequirements: 5,
        coveredRequirements: 5,
        totalStories: 3,
        readyStories: 3,
        nonReadyStories: 0,
        openBlockingFindings: 0,
        isHandoffReady: true
      };
      const parsed = EngineeringHandoffSummaryDtoSchema.parse(summary);
      expect(parsed.isHandoffReady).toBe(true);
    });
  });
});
