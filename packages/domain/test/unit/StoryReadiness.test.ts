import { describe, it, expect } from 'vitest';
import {
  createStoryId,
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createPolicyConstraintRevisionId,
  createEngineeringDecisionId,
  createFindingId,
  createStory,
  createRequirementsBaseline,
  createRequirementRevision,
  createPolicyConstraintRevision,
  createCandidateFinding,
  createEngineeringDecision,
  evaluateStoryReadiness,
  computeRequirementCoverage,
  type StoryReadinessEvaluationContext
} from '../../src/index.js';

describe('StoryReadiness and RequirementCoverage', () => {
  const baselineId = createRequirementsBaselineId('BASE-001');
  const req1 = createRequirementRevisionId('REQ-001-R1');
  const req2 = createRequirementRevisionId('REQ-002-R1');
  const req3 = createRequirementRevisionId('REQ-003-R1');
  const pol1 = createPolicyConstraintRevisionId('POL-SEC-001-R1');

  const createValidRequirement = (
    id: string,
    reviewState = 'ACCEPTED',
    resolutionState = 'CLEAR'
  ) =>
    createRequirementRevision({
      id: createRequirementRevisionId(id),
      requirementId: id.replace(/-R\d+$/, '') as any,
      revision: 1,
      statement: `Statement for ${id}`,
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: reviewState as any,
      resolutionState: resolutionState as any,
      evidence: [{ sourceRevisionId: 'SRC-001-R1' as any, locator: 'loc-1' as any }]
    });

  const createValidPolicy = (id: string, state = 'ACCEPTED') =>
    createPolicyConstraintRevision({
      id: createPolicyConstraintRevisionId(id),
      policyConstraintId: id.replace(/-R\d+$/, '') as any,
      revision: 1,
      statement: `Security policy ${id}`,
      authorityReference: 'NIST-800-53',
      state: state as any,
      createdBy: 'REV-001'
    });

  const createValidStory = (id = 'STORY-001', dependencies?: string[]) =>
    createStory({
      id: createStoryId(id),
      baselineId,
      title: 'Valid Story',
      narrative: {
        role: 'Verified User',
        feature: 'Authentication',
        benefit: 'Security'
      },
      requirementRevisionIds: [req1],
      policyConstraintRevisionIds: [pol1],
      scenarios: [
        {
          id: 'SCENARIO-1',
          title: 'Scenario 1',
          requirementRevisionIds: [req1],
          policyConstraintRevisionIds: [pol1],
          steps: [
            { keyword: 'Given', text: 'a logged in user' },
            { keyword: 'When', text: 'they perform an action' },
            { keyword: 'Then', text: 'it succeeds' }
          ]
        }
      ],
      gherkinText: 'Feature: Authentication\n  Scenario: Scenario 1',
      dependencies
    });

  const validReqRev1 = createValidRequirement('REQ-001-R1');
  const validReqRev2 = createValidRequirement('REQ-002-R1');
  const validReqRev3 = createValidRequirement('REQ-003-R1');
  const validPolRev1 = createValidPolicy('POL-SEC-001-R1');

  const validBaseline = createRequirementsBaseline({
    id: baselineId,
    requirements: [validReqRev1, validReqRev2, validReqRev3],
    policyConstraints: [validPolRev1],
    createdBy: 'REV-001' as any
  });

  const createCleanContext = (): StoryReadinessEvaluationContext => ({
    story: createValidStory(),
    baseline: validBaseline,
    requirementRevisions: [validReqRev1, validReqRev2, validReqRev3],
    policyConstraintRevisions: [validPolRev1],
    candidateFindings: [],
    engineeringDecisions: [],
    sqlProjectionValidation: { exists: true, isValid: true, id: 'PROJ-SQL-001' },
    openApiProjectionValidation: { exists: true, isValid: true, id: 'PROJ-OAS-001' },
    baselineStoryIds: [createStoryId('STORY-001')]
  });

  describe('evaluateStoryReadiness - Rule Suite', () => {
    it('passes all 10 rules when structured context is fully valid', () => {
      const context = createCleanContext();
      const report = evaluateStoryReadiness(context);

      expect(report.isReady).toBe(true);
      expect(report.status).toBe('implementation-ready');
      expect(report.failures).toHaveLength(0);
      expect(report.passedRules).toHaveLength(10);
      expect(report.passedRules).toContain('baseline-exists');
      expect(report.passedRules).toContain('requirement-revisions-belong-to-baseline');
      expect(report.passedRules).toContain('requirements-accepted-and-clear');
      expect(report.passedRules).toContain('policy-constraints-valid');
      expect(report.passedRules).toContain('no-blocking-open-findings');
      expect(report.passedRules).toContain('story-traceability-declared');
      expect(report.passedRules).toContain('engineering-decisions-accepted-or-deferred');
      expect(report.passedRules).toContain('sql-projection-valid');
      expect(report.passedRules).toContain('openapi-projection-valid');
      expect(report.passedRules).toContain('story-dependencies-exist');
    });

    it('Rule 1 (baseline-exists): fails when baseline does not exist', () => {
      const context: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        baseline: undefined
      };
      const report = evaluateStoryReadiness(context);

      expect(report.isReady).toBe(false);
      expect(report.status).toBe('not-ready');
      const fail = report.failures.find((f) => f.ruleId === 'baseline-exists');
      expect(fail).toBeDefined();
      expect(fail?.affectedIds).toEqual([context.story.baselineId]);
    });

    it('Rule 2 (requirement-revisions-belong-to-baseline): fails when story references requirement not in baseline', () => {
      const alienReq = createRequirementRevisionId('REQ-ALIEN-R1');
      const alienStory = createStory({
        id: 'STORY-ALIEN',
        baselineId,
        title: 'Alien Story',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [alienReq],
        scenarios: [
          {
            title: 'S1',
            requirementRevisionIds: [alienReq],
            steps: [{ keyword: 'Given', text: 'step' }]
          }
        ],
        gherkinText: 'Feature: Alien'
      });

      const context: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        story: alienStory,
        requirementRevisions: [createValidRequirement('REQ-ALIEN-R1')]
      };
      const report = evaluateStoryReadiness(context);

      expect(report.isReady).toBe(false);
      const fail = report.failures.find(
        (f) => f.ruleId === 'requirement-revisions-belong-to-baseline'
      );
      expect(fail).toBeDefined();
      expect(fail?.affectedIds).toEqual(['REQ-ALIEN-R1']);
    });

    it('Rule 3 (requirements-accepted-and-clear): fails when requirement is not ACCEPTED or not CLEAR', () => {
      const pendingReq = createValidRequirement('REQ-001-R1', 'PENDING', 'CLEAR');
      const context: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        requirementRevisions: [pendingReq]
      };
      const report = evaluateStoryReadiness(context);

      expect(report.isReady).toBe(false);
      const fail = report.failures.find((f) => f.ruleId === 'requirements-accepted-and-clear');
      expect(fail).toBeDefined();
      expect(fail?.affectedIds).toEqual(['REQ-001-R1']);
    });

    it('Rule 4 (policy-constraints-valid): fails when declared policy constraint is not accepted or not in baseline', () => {
      const unacceptedPolicy = createValidPolicy('POL-SEC-001-R1', 'REJECTED');
      const context: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        policyConstraintRevisions: [unacceptedPolicy]
      };
      const report = evaluateStoryReadiness(context);

      expect(report.isReady).toBe(false);
      const fail = report.failures.find((f) => f.ruleId === 'policy-constraints-valid');
      expect(fail).toBeDefined();
      expect(fail?.affectedIds).toEqual(['POL-SEC-001-R1']);
    });

    it('Rule 5 (no-blocking-open-findings): blocks readiness when requirement-specific finding is open', () => {
      const finding = createCandidateFinding({
        id: createFindingId('FND-001'),
        type: 'contradiction',
        affectedRequirementRevisions: [req1],
        discoveredBy: 'artifact-validation',
        disposition: 'OPEN',
        rationale: 'Requirements conflict'
      });

      const context: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        candidateFindings: [finding]
      };
      const report = evaluateStoryReadiness(context);

      expect(report.isReady).toBe(false);
      const fail = report.failures.find((f) => f.ruleId === 'no-blocking-open-findings');
      expect(fail).toBeDefined();
      expect(fail?.affectedIds).toEqual(['FND-001']);
    });

    it('Rule 5 (no-blocking-open-findings): blocks readiness when baseline-wide open finding has empty affectedRequirementRevisions (CONSUMER-69-AC-3)', () => {
      const baselineFinding = createCandidateFinding({
        id: createFindingId('FND-AMBIG-001'),
        type: 'data-boundary-ambiguity',
        affectedRequirementRevisions: [],
        discoveredBy: 'model',
        disposition: 'OPEN',
        rationale: 'Baseline-wide unstated approval threshold',
        baselineId
      });

      const context: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        candidateFindings: [baselineFinding]
      };
      const report = evaluateStoryReadiness(context);

      expect(report.isReady).toBe(false);
      const fail = report.failures.find((f) => f.ruleId === 'no-blocking-open-findings');
      expect(fail).toBeDefined();
      expect(fail?.affectedIds).toEqual(['FND-AMBIG-001']);
    });

    it('Rule 5 (no-blocking-open-findings): does NOT block when finding is resolved or belongs to unrelated requirement', () => {
      const resolvedFinding = createCandidateFinding({
        id: createFindingId('FND-001'),
        type: 'contradiction',
        affectedRequirementRevisions: [req1],
        discoveredBy: 'artifact-validation',
        disposition: 'RESOLVED',
        rationale: 'Resolved by PM'
      });
      const unrelatedFinding = createCandidateFinding({
        id: createFindingId('FND-002'),
        type: 'contradiction',
        affectedRequirementRevisions: [req2], // story only references req1
        discoveredBy: 'artifact-validation',
        disposition: 'OPEN',
        rationale: 'Unrelated requirement finding'
      });

      const context: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        candidateFindings: [resolvedFinding, unrelatedFinding]
      };
      const report = evaluateStoryReadiness(context);

      expect(report.isReady).toBe(true);
      expect(report.failures.some((f) => f.ruleId === 'no-blocking-open-findings')).toBe(false);
    });

    it('Rule 7 (engineering-decisions-accepted-or-deferred): rejects rejected engineering decisions affecting story', () => {
      const rejectedDecision = createEngineeringDecision({
        id: createEngineeringDecisionId('ED-001'),
        baselineId,
        statement: 'Use SQLite',
        rationale: 'Simplicity',
        requirementRevisionIds: [req1],
        state: 'REJECTED',
        createdBy: 'eng'
      });

      const context: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        engineeringDecisions: [rejectedDecision]
      };
      const report = evaluateStoryReadiness(context);

      expect(report.isReady).toBe(false);
      const fail = report.failures.find(
        (f) => f.ruleId === 'engineering-decisions-accepted-or-deferred'
      );
      expect(fail).toBeDefined();
      expect(fail?.affectedIds).toEqual(['ED-001']);
    });

    it('Rule 7 (engineering-decisions-accepted-or-deferred): decision on unrelated requirement in baseline does NOT block story', () => {
      const unrelatedRejectedDecision = createEngineeringDecision({
        id: createEngineeringDecisionId('ED-UNRELATED'),
        baselineId,
        statement: 'Use gRPC for telemetry',
        rationale: 'Performance',
        requirementRevisionIds: [req2], // story references only req1
        state: 'REJECTED',
        createdBy: 'eng'
      });

      const context: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        engineeringDecisions: [unrelatedRejectedDecision]
      };
      const report = evaluateStoryReadiness(context);

      expect(report.isReady).toBe(true);
      expect(
        report.failures.some((f) => f.ruleId === 'engineering-decisions-accepted-or-deferred')
      ).toBe(false);
    });

    it('Rule 7 (engineering-decisions-accepted-or-deferred): proposed decision blocks only when allowDeferredEngineeringDecisions is false', () => {
      const proposedDecision = createEngineeringDecision({
        id: createEngineeringDecisionId('ED-PROPOSED'),
        baselineId,
        statement: 'Use Redis',
        rationale: 'Cache',
        requirementRevisionIds: [req1],
        state: 'PROPOSED',
        createdBy: 'eng'
      });

      const context: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        engineeringDecisions: [proposedDecision]
      };

      // Default: allowDeferredEngineeringDecisions is true
      const reportDefault = evaluateStoryReadiness(context);
      expect(reportDefault.isReady).toBe(true);

      // Strict policy: allowDeferredEngineeringDecisions is false
      const reportStrict = evaluateStoryReadiness(context, {
        allowDeferredEngineeringDecisions: false
      });
      expect(reportStrict.isReady).toBe(false);
      const fail = reportStrict.failures.find(
        (f) => f.ruleId === 'engineering-decisions-accepted-or-deferred'
      );
      expect(fail?.affectedIds).toEqual(['ED-PROPOSED']);
    });

    it('Rule 8 (sql-projection-valid): fails when required and missing or when optional and invalid', () => {
      // 1. Required and missing
      const contextMissing: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        sqlProjectionValidation: { exists: false, isValid: false }
      };
      const reportReq = evaluateStoryReadiness(contextMissing, { requireSqlProjection: true });
      expect(reportReq.isReady).toBe(false);
      expect(
        reportReq.failures.find((f) => f.ruleId === 'sql-projection-valid')?.affectedIds
      ).toEqual([baselineId]);

      // 2. Optional and missing -> passes
      const reportOptMissing = evaluateStoryReadiness(contextMissing, {
        requireSqlProjection: false
      });
      expect(reportOptMissing.failures.some((f) => f.ruleId === 'sql-projection-valid')).toBe(
        false
      );

      // 3. Optional but invalid existing projection in repo -> blocks!
      const contextInvalid: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        sqlProjectionValidation: {
          exists: true,
          isValid: false,
          errorMessage: 'Syntax error near TABLE',
          id: 'PROJ-SQL-BAD'
        }
      };
      const reportOptInvalid = evaluateStoryReadiness(contextInvalid, {
        requireSqlProjection: false
      });
      expect(reportOptInvalid.isReady).toBe(false);
      expect(
        reportOptInvalid.failures.find((f) => f.ruleId === 'sql-projection-valid')?.affectedIds
      ).toEqual(['PROJ-SQL-BAD']);
    });

    it('Rule 9 (openapi-projection-valid): fails when required and missing or when optional and invalid', () => {
      // 1. Required and missing
      const contextMissing: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        openApiProjectionValidation: { exists: false, isValid: false }
      };
      const reportReq = evaluateStoryReadiness(contextMissing, { requireOpenApiProjection: true });
      expect(reportReq.isReady).toBe(false);
      expect(
        reportReq.failures.find((f) => f.ruleId === 'openapi-projection-valid')?.affectedIds
      ).toEqual([baselineId]);

      // 2. Optional and missing -> passes
      const reportOptMissing = evaluateStoryReadiness(contextMissing);
      expect(reportOptMissing.failures.some((f) => f.ruleId === 'openapi-projection-valid')).toBe(
        false
      );

      // 3. Optional but invalid existing projection -> blocks!
      const contextInvalid: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        openApiProjectionValidation: {
          exists: true,
          isValid: false,
          errorMessage: 'Schema missing components',
          id: 'PROJ-OAS-BAD'
        }
      };
      const reportOptInvalid = evaluateStoryReadiness(contextInvalid);
      expect(reportOptInvalid.isReady).toBe(false);
      expect(
        reportOptInvalid.failures.find((f) => f.ruleId === 'openapi-projection-valid')?.affectedIds
      ).toEqual(['PROJ-OAS-BAD']);
    });

    it('Rule 10 (story-dependencies-exist): blocks self-referencing and out-of-baseline dependencies', () => {
      // Self-reference
      const selfRefStory = createValidStory('STORY-SELF', ['STORY-SELF']);
      const contextSelf: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        story: selfRefStory,
        baselineStoryIds: [createStoryId('STORY-SELF')]
      };
      const reportSelf = evaluateStoryReadiness(contextSelf);
      expect(reportSelf.isReady).toBe(false);
      const failSelf = reportSelf.failures.find((f) => f.ruleId === 'story-dependencies-exist');
      expect(failSelf?.affectedIds).toEqual(['STORY-SELF']);

      // Out-of-baseline dependency (e.g. from predecessor baseline BASE-000)
      const crossBaseStory = createValidStory('STORY-002', ['STORY-OLD']);
      const contextCross: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        story: crossBaseStory,
        baselineStoryIds: [createStoryId('STORY-002'), createStoryId('STORY-003')] // STORY-OLD not in baseline
      };
      const reportCross = evaluateStoryReadiness(contextCross);
      expect(reportCross.isReady).toBe(false);
      const failCross = reportCross.failures.find((f) => f.ruleId === 'story-dependencies-exist');
      expect(failCross?.affectedIds).toEqual(['STORY-OLD']);

      // Valid in-baseline dependency
      const validDepStory = createValidStory('STORY-002', ['STORY-003']);
      const contextValidDep: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        story: validDepStory,
        baselineStoryIds: [createStoryId('STORY-002'), createStoryId('STORY-003')]
      };
      const reportValidDep = evaluateStoryReadiness(contextValidDep);
      expect(reportValidDep.failures.some((f) => f.ruleId === 'story-dependencies-exist')).toBe(
        false
      );
    });

    it('returns structured readiness failures with exact affected IDs and lexicographically sorted output', () => {
      const brokenStory = createValidStory('STORY-BROKEN', ['MISSING-STORY-1', 'MISSING-STORY-2']);
      const finding = createCandidateFinding({
        id: createFindingId('FND-999'),
        type: 'contradiction',
        affectedRequirementRevisions: [req1],
        discoveredBy: 'artifact-validation',
        disposition: 'OPEN',
        rationale: 'Contradiction'
      });

      const context: StoryReadinessEvaluationContext = {
        ...createCleanContext(),
        story: brokenStory,
        candidateFindings: [finding],
        baselineStoryIds: [createStoryId('STORY-BROKEN')]
      };

      const report = evaluateStoryReadiness(context);
      expect(report.isReady).toBe(false);
      expect(report.status).toBe('not-ready');
      expect(report.failures.length).toBeGreaterThan(1);

      // Verify affectedIds are sorted
      for (const f of report.failures) {
        const sorted = [...f.affectedIds].sort();
        expect(f.affectedIds).toEqual(sorted);
      }
      // Verify passedRules are sorted
      const sortedRules = [...report.passedRules].sort();
      expect(report.passedRules).toEqual(sortedRules);
    });

    it('guarantees deterministic idempotency: same structured input produces byte-for-byte identical output (AC-1)', () => {
      const context = createCleanContext();
      const fixedTimestamp = '2026-09-19T00:00:00.000Z' as any;
      const report1 = evaluateStoryReadiness(context, undefined, fixedTimestamp);
      const report2 = evaluateStoryReadiness(context, undefined, fixedTimestamp);

      expect(JSON.stringify(report1)).toBe(JSON.stringify(report2));
    });
  });

  describe('computeRequirementCoverage', () => {
    it('computes coverage accurately when all requirements are covered (AC-5)', () => {
      const story1 = createStory({
        id: 'STORY-1',
        baselineId,
        title: 'Story 1',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [req1, req2],
        scenarios: [
          {
            title: 'S1',
            requirementRevisionIds: [req1],
            steps: [{ keyword: 'Given', text: 'step' }]
          },
          {
            title: 'S2',
            requirementRevisionIds: [req2],
            steps: [{ keyword: 'Given', text: 'step' }]
          }
        ],
        gherkinText: 'Feature: F'
      });

      const story2 = createStory({
        id: 'STORY-2',
        baselineId,
        title: 'Story 2',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [req3],
        scenarios: [
          {
            title: 'S3',
            requirementRevisionIds: [req3],
            steps: [{ keyword: 'Given', text: 'step' }]
          }
        ],
        gherkinText: 'Feature: F'
      });

      const coverage = computeRequirementCoverage(validBaseline, [story1, story2]);
      expect(coverage.totalRequirements).toBe(3);
      expect(coverage.coveredCount).toBe(3);
      expect(coverage.uncoveredCount).toBe(0);
      expect(coverage.multiCoveredCount).toBe(0);
      expect(coverage.isFullyCovered).toBe(true);
      expect(coverage.uncoveredRequirementRevisionIds).toHaveLength(0);
    });

    it('surfaces uncovered requirements without inventing stories (AC-6)', () => {
      const story1 = createStory({
        id: 'STORY-1',
        baselineId,
        title: 'Story 1',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [req1],
        scenarios: [
          {
            title: 'S1',
            requirementRevisionIds: [req1],
            steps: [{ keyword: 'Given', text: 'step' }]
          }
        ],
        gherkinText: 'Feature: F'
      });

      const coverage = computeRequirementCoverage(validBaseline, [story1]);
      expect(coverage.totalRequirements).toBe(3);
      expect(coverage.coveredCount).toBe(1);
      expect(coverage.uncoveredCount).toBe(2);
      expect(coverage.uncoveredRequirementRevisionIds).toEqual(['REQ-002-R1', 'REQ-003-R1']);
      expect(coverage.isFullyCovered).toBe(false);
    });

    it('represents multiple-story coverage cleanly without treating it as an error (AC-7)', () => {
      const story1 = createStory({
        id: 'STORY-1',
        baselineId,
        title: 'Story 1',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [req1],
        scenarios: [
          {
            title: 'S1',
            requirementRevisionIds: [req1],
            steps: [{ keyword: 'Given', text: 'step' }]
          }
        ],
        gherkinText: 'Feature: F'
      });

      const story2 = createStory({
        id: 'STORY-2',
        baselineId,
        title: 'Story 2',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [req1, req2, req3],
        scenarios: [
          {
            title: 'S2',
            requirementRevisionIds: [req1],
            steps: [{ keyword: 'Given', text: 'step' }]
          },
          {
            title: 'S3',
            requirementRevisionIds: [req2],
            steps: [{ keyword: 'Given', text: 'step' }]
          },
          {
            title: 'S4',
            requirementRevisionIds: [req3],
            steps: [{ keyword: 'Given', text: 'step' }]
          }
        ],
        gherkinText: 'Feature: F'
      });

      const coverage = computeRequirementCoverage(validBaseline, [story1, story2]);
      expect(coverage.totalRequirements).toBe(3);
      expect(coverage.coveredCount).toBe(3);
      expect(coverage.multiCoveredCount).toBe(1);
      expect(coverage.multiCoveredRequirements).toHaveLength(1);
      expect(coverage.multiCoveredRequirements[0].requirementRevisionId).toBe('REQ-001-R1');
      expect(coverage.multiCoveredRequirements[0].coverageCount).toBe(2);
      expect(coverage.multiCoveredRequirements[0].coveringStoryIds).toEqual(['STORY-1', 'STORY-2']);
      expect(coverage.isFullyCovered).toBe(true);
    });
  });
});
