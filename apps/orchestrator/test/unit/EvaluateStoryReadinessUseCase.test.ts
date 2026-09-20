import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createPolicyConstraintRevisionId,
  createStoryId,
  createFindingId,
  createEngineeringDecisionId,
  createStory,
  createRequirementsBaseline,
  createRequirementRevision,
  createPolicyConstraintRevision,
  createCandidateFinding,
  createEngineeringDecision,
  resolveFinding,
  now
} from '@solutions-studio/domain';
import { EvaluateStoryReadinessUseCase } from '../../src/application/use-cases/EvaluateStoryReadinessUseCase.js';
import type {
  IRequirementsRepository,
  StoryRecord
} from '../../src/application/ports/persistence/IRequirementsRepository.js';
import type { ISqlValidatorGateway } from '../../src/application/ports/validation/ISqlValidatorGateway.js';
import type { IOpenApiValidatorGateway } from '../../src/application/ports/validation/IOpenApiValidatorGateway.js';
import { UnknownStoryError } from '../../src/application/use-cases/StoryProjectionErrors.js';

describe('EvaluateStoryReadinessUseCase', () => {
  const baselineId = createRequirementsBaselineId('BASE-001');
  const req1 = createRequirementRevisionId('REQ-001-R1');
  const req2 = createRequirementRevisionId('REQ-002-R1');
  const pol1 = createPolicyConstraintRevisionId('POL-001-R1');

  let mockRepository: Partial<IRequirementsRepository>;
  let mockSqlValidator: ISqlValidatorGateway;
  let mockOpenApiValidator: IOpenApiValidatorGateway;
  let useCase: EvaluateStoryReadinessUseCase;

  const validReqRev1 = createRequirementRevision({
    id: req1,
    requirementId: 'REQ-001' as any,
    revision: 1,
    statement: 'User must log in',
    category: 'business-rule',
    origin: 'EXPLICIT',
    reviewState: 'ACCEPTED',
    resolutionState: 'CLEAR',
    evidence: [{ sourceRevisionId: 'SRC-001-R1' as any, locator: 'loc-1' as any }]
  });

  const validReqRev2 = createRequirementRevision({
    id: req2,
    requirementId: 'REQ-002' as any,
    revision: 1,
    statement: 'User must logout',
    category: 'business-rule',
    origin: 'EXPLICIT',
    reviewState: 'ACCEPTED',
    resolutionState: 'CLEAR',
    evidence: [{ sourceRevisionId: 'SRC-001-R1' as any, locator: 'loc-1' as any }]
  });

  const validPolRev1 = createPolicyConstraintRevision({
    id: pol1,
    policyConstraintId: 'POL-001' as any,
    revision: 1,
    statement: 'Password must be strong',
    authorityReference: 'NIST-800-63B',
    state: 'ACCEPTED',
    createdBy: 'sec-officer'
  });

  const validBaseline = createRequirementsBaseline({
    id: baselineId,
    requirements: [validReqRev1, validReqRev2],
    policyConstraints: [validPolRev1],
    createdBy: 'lead-pm' as any
  });

  const createStoryRecord = (id = 'STORY-001', dependencies?: string[]): StoryRecord => {
    const story = createStory({
      id: createStoryId(id),
      baselineId,
      title: 'Story 1',
      narrative: { role: 'User', feature: 'Auth', benefit: 'Security' },
      requirementRevisionIds: [req1],
      policyConstraintRevisionIds: [pol1],
      scenarios: [
        {
          id: 'SCENARIO-1',
          title: 'Successful login',
          requirementRevisionIds: [req1],
          policyConstraintRevisionIds: [pol1],
          steps: [
            { keyword: 'Given', text: 'valid credentials' },
            { keyword: 'When', text: 'submit form' },
            { keyword: 'Then', text: 'login success' }
          ]
        }
      ],
      gherkinText: 'Feature: Auth\n  Scenario: Successful login',
      dependencies
    });

    return {
      id: story.id,
      baselineId: story.baselineId,
      projectionId: `PROJ-${story.id}`,
      title: story.title,
      narrative: story.narrative,
      requirementRevisionIds: story.requirementRevisionIds,
      policyConstraintRevisionIds: story.policyConstraintRevisionIds,
      scenarios: story.scenarios,
      acceptanceCriteria: story.acceptanceCriteria,
      gherkinText: story.gherkinText,
      metadata: {
        baselineId: story.baselineId,
        requirementRevisionIds: [...story.requirementRevisionIds],
        artifactType: 'stories',
        declaredProvenance: {
          baselineId: story.baselineId,
          requirementRevisionIds: [...story.requirementRevisionIds]
        },
        configuredExecution: { provider: 'test', artifactType: 'stories' },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'hash',
          verifiedAt: now()
        }
      },
      dependencies: story.dependencies,
      createdAt: story.createdAt
    };
  };

  beforeEach(() => {
    mockSqlValidator = {
      validate: async () => ({ isValid: true })
    };
    mockOpenApiValidator = {
      validate: async () => ({ isValid: true })
    };

    const storiesMap = new Map<string, StoryRecord>();
    storiesMap.set('STORY-001', createStoryRecord('STORY-001'));

    mockRepository = {
      getStory: async (id) => storiesMap.get(id),
      listStories: async (baseId) =>
        Array.from(storiesMap.values()).filter((s) => !baseId || s.baselineId === baseId),
      getRequirementsBaseline: async (id) => (id === baselineId ? validBaseline : undefined),
      getRequirementRevision: async (id) => {
        if (id === req1) return validReqRev1;
        if (id === req2) return validReqRev2;
        return undefined;
      },
      getPolicyConstraintRevision: async (id) => (id === pol1 ? validPolRev1 : undefined),
      listCandidateFindings: async () => [],
      listEngineeringDecisions: async () => [],
      listProjectionRecords: async () => [
        {
          id: 'PROJ-SQL-1',
          baselineId,
          requirementRevisionIds: [req1],
          artifactType: 'sql-schema',
          content: 'CREATE TABLE users (id TEXT PRIMARY KEY);',
          metadata: {} as any,
          createdAt: '2026-09-19T00:00:00.000Z' as any
        },
        {
          id: 'PROJ-OAS-1',
          baselineId,
          requirementRevisionIds: [req1],
          artifactType: 'openapi',
          content: 'openapi: 3.1.0\ninfo:\n  title: API\n  version: 1.0.0',
          metadata: {} as any,
          createdAt: '2026-09-19T00:00:00.000Z' as any
        }
      ]
    };

    useCase = new EvaluateStoryReadinessUseCase(
      mockRepository as IRequirementsRepository,
      mockSqlValidator,
      mockOpenApiValidator
    );
  });

  it('evaluates readiness successfully when all rules pass', async () => {
    const report = await useCase.execute({ storyId: 'STORY-001' });

    expect(report.isReady).toBe(true);
    expect(report.status).toBe('implementation-ready');
    expect(report.failures).toHaveLength(0);
    expect(report.passedRules).toHaveLength(10);
  });

  it('throws UnknownStoryError when story does not exist in repository', async () => {
    await expect(useCase.execute({ storyId: 'NON-EXISTENT' })).rejects.toThrow(UnknownStoryError);
  });

  it('Rule 5 & CONSUMER-69-AC-3: Baseline-wide open finding blocks readiness and human reconciliation clears it', async () => {
    // 1. Ambiguity recorded during projection discovery
    const ambiguityFinding = createCandidateFinding({
      id: createFindingId('FND-AMBIG-001'),
      type: 'data-boundary-ambiguity',
      affectedRequirementRevisions: [],
      discoveredBy: 'model',
      disposition: 'OPEN',
      rationale: 'Unstated approval limit',
      baselineId
    });

    let currentFindings = [ambiguityFinding];
    mockRepository.listCandidateFindings = async () => currentFindings;

    const blockedReport = await useCase.execute({ storyId: 'STORY-001' });
    expect(blockedReport.isReady).toBe(false);
    expect(blockedReport.status).toBe('not-ready');
    const fail = blockedReport.failures.find((f) => f.ruleId === 'no-blocking-open-findings');
    expect(fail).toBeDefined();
    expect(fail?.affectedIds).toEqual(['FND-AMBIG-001']);

    // 2. Human reconciliation (CONSUMER-69-AC-4): resolve finding
    const resolved = resolveFinding(ambiguityFinding, 'Approval threshold set to 50,000 USD');
    currentFindings = [resolved];

    const clearedReport = await useCase.execute({ storyId: 'STORY-001' });
    expect(clearedReport.isReady).toBe(true);
    expect(clearedReport.status).toBe('implementation-ready');
    expect(clearedReport.failures.some((f) => f.ruleId === 'no-blocking-open-findings')).toBe(
      false
    );
  });

  it('Rule 10 & CONSUMER-69-AC-8: Cross-baseline story dependency is blocked', async () => {
    // Story declares dependency on STORY-PREDECESSOR from predecessor baseline
    const storyWithCrossDep = createStoryRecord('STORY-001', ['STORY-PREDECESSOR']);
    mockRepository.getStory = async () => storyWithCrossDep;
    // baselineStoryIds returns only STORY-001 (belonging to BASE-001)
    mockRepository.listStories = async () => [storyWithCrossDep];

    const report = await useCase.execute({ storyId: 'STORY-001' });
    expect(report.isReady).toBe(false);
    const fail = report.failures.find((f) => f.ruleId === 'story-dependencies-exist');
    expect(fail).toBeDefined();
    expect(fail?.affectedIds).toEqual(['STORY-PREDECESSOR']);
  });

  it('Rule 8 & Finding 3: Existing invalid SQL projection in repo blocks even when requireSqlProjection is omitted', async () => {
    // Mock validator returns invalid
    mockSqlValidator.validate = async () => ({
      isValid: false,
      errorMessage: 'Syntax error near CREATE'
    });

    const report = await useCase.execute({ storyId: 'STORY-001' });
    expect(report.isReady).toBe(false);
    const fail = report.failures.find((f) => f.ruleId === 'sql-projection-valid');
    expect(fail).toBeDefined();
    expect(fail?.affectedIds).toEqual(['PROJ-SQL-1']);
  });

  it('resolves the latest projection record deterministically when multiple projections exist', async () => {
    mockRepository.listProjectionRecords = async () => [
      {
        id: 'PROJ-SQL-OLD',
        baselineId,
        requirementRevisionIds: [req1],
        artifactType: 'sql-schema',
        content: 'OLD SQL',
        metadata: {} as any,
        createdAt: '2026-09-18T00:00:00.000Z' as any
      },
      {
        id: 'PROJ-SQL-NEWEST',
        baselineId,
        requirementRevisionIds: [req1],
        artifactType: 'sql-schema',
        content: 'NEW SQL',
        metadata: {} as any,
        createdAt: '2026-09-19T12:00:00.000Z' as any
      }
    ];

    let validatedContent = '';
    mockSqlValidator.validate = async (content) => {
      validatedContent = content;
      return { isValid: false, errorMessage: 'Fail for test' };
    };

    const report = await useCase.execute({ storyId: 'STORY-001' });
    expect(validatedContent).toBe('NEW SQL');
    expect(report.failures.find((f) => f.ruleId === 'sql-projection-valid')?.affectedIds).toEqual([
      'PROJ-SQL-NEWEST'
    ]);
  });

  it('Rule 7 & Finding 4: Engineering decision lineage filtering', async () => {
    // Unrelated decision in baseline (scoped to req2) in REJECTED state does NOT block STORY-001 (which only references req1)
    const unrelatedRejected = createEngineeringDecision({
      id: createEngineeringDecisionId('ED-UNRELATED'),
      baselineId,
      statement: 'Unrelated technical choice',
      rationale: 'Reason',
      requirementRevisionIds: [req2],
      state: 'REJECTED',
      createdBy: 'eng'
    });

    mockRepository.listEngineeringDecisions = async () => [unrelatedRejected];

    const report = await useCase.execute({ storyId: 'STORY-001' });
    expect(report.isReady).toBe(true);
    expect(
      report.failures.some((f) => f.ruleId === 'engineering-decisions-accepted-or-deferred')
    ).toBe(false);

    // Baseline-wide decision (empty requirementRevisionIds) in REJECTED state DOES block STORY-001
    const baselineWideRejected = createEngineeringDecision({
      id: createEngineeringDecisionId('ED-BASELINE-WIDE'),
      baselineId,
      statement: 'Use unvetted cryptographic primitive',
      rationale: 'Rejected by security',
      requirementRevisionIds: [],
      state: 'REJECTED',
      createdBy: 'eng'
    });

    mockRepository.listEngineeringDecisions = async () => [unrelatedRejected, baselineWideRejected];

    const blockedReport = await useCase.execute({ storyId: 'STORY-001' });
    expect(blockedReport.isReady).toBe(false);
    const fail = blockedReport.failures.find(
      (f) => f.ruleId === 'engineering-decisions-accepted-or-deferred'
    );
    expect(fail).toBeDefined();
    expect(fail?.affectedIds).toEqual(['ED-BASELINE-WIDE']);
  });

  it('executeForBaseline returns readiness reports for all stories in baseline', async () => {
    const story1 = createStoryRecord('STORY-001');
    const story2 = createStoryRecord('STORY-002');
    mockRepository.listStories = async () => [story1, story2];
    mockRepository.getStory = async (id) => (id === 'STORY-001' ? story1 : story2);

    const reports = await useCase.executeForBaseline('BASE-001');
    expect(reports).toHaveLength(2);
    expect(reports[0].storyId).toBe('STORY-001');
    expect(reports[1].storyId).toBe('STORY-002');
  });
});
