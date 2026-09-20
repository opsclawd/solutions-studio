import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getEngineeringHandoffBundle,
  getStoryDependencyGraph,
  updateStoryDependencies,
  listAvailableBaselines,
  getCandidatePromotionStatus,
  listValidationRuns,
  createGovernanceApproval,
  revokeGovernanceApproval,
  exportGovernanceAudit
} from '../../src/features/handoff/api/handoffApi';
import { createInstant } from '@solutions-studio/domain';
import type {
  EngineeringHandoffBundleDto,
  StoryDependencyGraphDto,
  StoryDto,
  CandidatePromotionStatusDto,
  ValidationRunRecordDto,
  CandidateApprovalRecordDto,
  GovernanceAuditExportDto
} from '@solutions-studio/contracts';

describe('handoffApi', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const sampleGraph: StoryDependencyGraphDto = {
    baselineId: 'BASE-001',
    nodes: [
      {
        storyId: 'STORY-001',
        title: 'Story 1',
        requirementRevisionIds: ['REQ-001-R1'],
        dependencies: [],
        dependents: ['STORY-002'],
        readinessStatus: 'implementation-ready',
        isReady: true
      },
      {
        storyId: 'STORY-002',
        title: 'Story 2',
        requirementRevisionIds: ['REQ-001-R1'],
        dependencies: ['STORY-001'],
        dependents: [],
        readinessStatus: 'implementation-ready',
        isReady: true
      }
    ],
    edges: [
      {
        from: 'STORY-001',
        to: 'STORY-002'
      }
    ],
    executionOrder: ['STORY-001', 'STORY-002'],
    isAcyclic: true,
    hasCycles: false,
    cycles: [],
    validation: {
      isValid: true,
      missingNodeIds: [],
      selfDependencies: [],
      cycles: [],
      errors: []
    },
    createdAt: createInstant('2026-09-19T00:00:00.000Z')
  };

  const sampleStory: StoryDto = {
    id: 'STORY-001',
    baselineId: 'BASE-001',
    title: 'Story 1',
    narrative: {
      role: 'user',
      feature: 'feature',
      benefit: 'benefit'
    },
    requirementRevisionIds: ['REQ-001-R1'],
    scenarios: [
      {
        title: 'S1',
        requirementRevisionIds: ['REQ-001-R1'],
        steps: [{ keyword: 'Given', text: 'x' }]
      }
    ],
    acceptanceCriteria: ['AC1'],
    gherkinText: 'Feature: 1\nScenario: S1\nGiven x',
    dependencies: [],
    createdAt: createInstant('2026-09-19T00:00:00.000Z')
  };

  const sampleBundle: EngineeringHandoffBundleDto = {
    baseline: {
      id: 'BASE-001',
      requirementRevisions: ['REQ-001-R1'],
      policyConstraintRevisions: [],
      createdAt: createInstant('2026-09-19T00:00:00.000Z'),
      createdBy: 'reviewer-1'
    },
    authorityBundle: {
      baseline: {
        id: 'BASE-001',
        requirementRevisions: ['REQ-001-R1'],
        policyConstraintRevisions: [],
        createdAt: createInstant('2026-09-19T00:00:00.000Z'),
        createdBy: 'reviewer-1'
      },
      requirements: [
        {
          id: 'REQ-001-R1',
          requirementId: 'REQ-001',
          revision: 1,
          statement: 'Requirement 1',
          category: 'business-rule',
          origin: 'EXPLICIT',
          reviewState: 'ACCEPTED',
          resolutionState: 'CLEAR',
          evidence: []
        }
      ],
      policyConstraints: []
    },
    engineeringDecisions: [],
    stories: [sampleStory],
    readinessReports: [
      {
        storyId: 'STORY-001',
        baselineId: 'BASE-001',
        status: 'implementation-ready',
        isReady: true,
        failures: [],
        passedRules: ['RULE_01_PROJECTION_EXISTS'],
        evaluatedAt: createInstant('2026-09-19T00:00:00.000Z')
      }
    ],
    coverage: {
      baselineId: 'BASE-001',
      totalRequirements: 1,
      coveredCount: 1,
      uncoveredCount: 0,
      multiCoveredCount: 0,
      coveredRequirements: [
        {
          requirementRevisionId: 'REQ-001-R1',
          coveringStoryIds: ['STORY-001'],
          coverageCount: 1
        }
      ],
      uncoveredRequirementRevisionIds: [],
      multiCoveredRequirements: [],
      isFullyCovered: true,
      computedAt: createInstant('2026-09-19T00:00:00.000Z')
    },
    dependencyGraph: sampleGraph,
    blockingFindings: [],
    unresolvedRequirements: [],
    summary: {
      totalStories: 1,
      readyStories: 1,
      nonReadyStories: 0,
      totalRequirements: 1,
      coveredRequirements: 1,
      openBlockingFindings: 0,
      isHandoffReady: true
    }
  };

  it('getEngineeringHandoffBundle fetches and parses bundle successfully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleBundle
    } as Response);

    const bundle = await getEngineeringHandoffBundle('BASE-001');
    expect(bundle.baseline.id).toBe('BASE-001');
    expect(bundle.summary.isHandoffReady).toBe(true);
    expect(bundle.dependencyGraph.executionOrder).toEqual(['STORY-001', 'STORY-002']);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/baselines/BASE-001/handoff'),
      expect.any(Object)
    );
  });

  it('getStoryDependencyGraph fetches and parses graph with query options', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleGraph
    } as Response);

    const graph = await getStoryDependencyGraph('BASE-001', {
      includeReadiness: true,
      strict: true
    });

    expect(graph.baselineId).toBe('BASE-001');
    expect(graph.nodes).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/baselines/BASE-001/dependency-graph?includeReadiness=true&strict=true'
      ),
      expect.any(Object)
    );
  });

  it('updateStoryDependencies sends PUT request and parses updated story', async () => {
    const updatedStory: StoryDto = {
      ...sampleStory,
      dependencies: ['STORY-002']
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => updatedStory
    } as Response);

    const result = await updateStoryDependencies('STORY-001', ['STORY-002']);
    expect(result.dependencies).toEqual(['STORY-002']);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/stories/STORY-001/dependencies'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ dependencies: ['STORY-002'] })
      })
    );
  });

  it('listAvailableBaselines returns list of baseline IDs', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 'BASE-001',
          requirementRevisions: ['REQ-001-R1'],
          policyConstraintRevisions: [],
          createdAt: '2026-09-19T00:00:00.000Z',
          createdBy: 'reviewer-1'
        },
        {
          id: 'BASE-002',
          requirementRevisions: ['REQ-001-R1'],
          policyConstraintRevisions: [],
          createdAt: '2026-09-19T00:00:00.000Z',
          createdBy: 'reviewer-1'
        }
      ]
    } as Response);

    const ids = await listAvailableBaselines();
    expect(ids).toEqual(['BASE-001', 'BASE-002']);
  });

  it('getCandidatePromotionStatus fetches and parses promotion status', async () => {
    const candidateSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';
    const sampleStatus: CandidatePromotionStatusDto = {
      candidateSha,
      isApproved: true,
      disposition: 'APPROVED',
      diagnosticCode: 'PROMOTION_READY',
      message: 'Ready for release',
      evaluatedAt: createInstant('2026-09-20T00:00:00.000Z')
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleStatus
    } as Response);

    const res = await getCandidatePromotionStatus(candidateSha);
    expect(res.isApproved).toBe(true);
    expect(res.disposition).toBe('APPROVED');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/api/governance/candidates/${candidateSha}/status`),
      expect.any(Object)
    );
  });

  it('listValidationRuns fetches and parses array of validation runs', async () => {
    const candidateSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';
    const sampleRuns: ValidationRunRecordDto[] = [
      {
        id: 'RUN-001',
        candidateSha,
        phase: 'phase-3',
        executionMode: 'deterministic-ci',
        provider: 'fake',
        artifacts: [
          {
            name: 'schema.sql',
            artifactType: 'sql-ddl',
            contentHash: 'a'.repeat(64)
          }
        ],
        evidenceDigest: 'b'.repeat(64),
        proposedDisposition: 'GO',
        executedBy: 'runner-ci',
        executedAt: createInstant('2026-09-20T00:00:00.000Z'),
        summary: { checks: 15 }
      }
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleRuns
    } as Response);

    const res = await listValidationRuns(candidateSha);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('RUN-001');
  });

  it('createGovernanceApproval sends POST and parses approval record', async () => {
    const candidateSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';
    const sampleApproval: CandidateApprovalRecordDto = {
      id: 'APPR-001',
      candidateSha,
      validationRunId: 'RUN-001',
      evidenceDigest: 'b'.repeat(64),
      decision: 'GO',
      status: 'ACTIVE',
      rationale: 'Human sign-off',
      actor: {
        id: 'rev-1',
        name: 'Alice Reviewer',
        actorType: 'human'
      },
      decidedAt: createInstant('2026-09-20T00:00:00.000Z')
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => sampleApproval
    } as Response);

    const res = await createGovernanceApproval({
      candidateSha,
      validationRunId: 'RUN-001',
      evidenceDigest: 'b'.repeat(64),
      decision: 'GO',
      rationale: 'Human sign-off'
    });
    expect(res.id).toBe('APPR-001');
    expect(res.status).toBe('ACTIVE');
    expect(res.actor.name).toBe('Alice Reviewer');
  });

  it('revokeGovernanceApproval sends POST to revoke endpoint and parses updated approval', async () => {
    const sampleRevoked: CandidateApprovalRecordDto = {
      id: 'APPR-001',
      candidateSha: 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4',
      validationRunId: 'RUN-001',
      evidenceDigest: 'b'.repeat(64),
      decision: 'GO',
      status: 'REVOKED',
      rationale: 'Human sign-off',
      actor: {
        id: 'rev-1',
        name: 'Alice Reviewer',
        actorType: 'human'
      },
      decidedAt: createInstant('2026-09-20T00:00:00.000Z'),
      revocation: {
        revokedAt: createInstant('2026-09-20T01:00:00.000Z'),
        revokedBy: {
          id: 'rev-1',
          name: 'Alice Reviewer',
          actorType: 'human'
        },
        rationale: 'Defect discovered'
      }
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleRevoked
    } as Response);

    const res = await revokeGovernanceApproval('APPR-001', 'Defect discovered');
    expect(res.status).toBe('REVOKED');
    expect(res.revocation?.rationale).toBe('Defect discovered');
  });

  it('exportGovernanceAudit fetches and parses governance export package', async () => {
    const candidateSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';
    const sampleExport: GovernanceAuditExportDto = {
      candidateSha,
      exportedAt: createInstant('2026-09-20T00:00:00.000Z'),
      promotionStatus: {
        candidateSha,
        isApproved: true,
        disposition: 'APPROVED',
        diagnosticCode: 'PROMOTION_READY',
        message: 'Ready',
        evaluatedAt: createInstant('2026-09-20T00:00:00.000Z')
      },
      validationRuns: [],
      approvalHistory: [],
      manifestChecksum: 'c'.repeat(64)
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleExport
    } as Response);

    const res = await exportGovernanceAudit(candidateSha);
    expect(res.candidateSha).toBe(candidateSha);
    expect(res.manifestChecksum).toBe('c'.repeat(64));
  });
});
