import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import {
  useHandoffState,
  type UseHandoffStateReturn
} from '../../src/features/handoff/state/useHandoffState';
import * as handoffApi from '../../src/features/handoff/api/handoffApi';
import type { EngineeringHandoffBundleDto, StoryDto } from '@solutions-studio/contracts';
import { createInstant } from '@solutions-studio/domain';

// Setup minimal DOM environment for React 18 in node
class FakeElement {
  nodeType = 1;
  nodeName: string;
  tagName: string;
  style = {};
  children: FakeElement[] = [];

  constructor(name = 'div') {
    this.nodeName = name.toUpperCase();
    this.tagName = name.toUpperCase();
  }

  setAttribute() {}
  getAttribute() {
    return null;
  }
  removeAttribute() {}
  appendChild(child: FakeElement) {
    this.children.push(child);
  }
  removeChild() {}
  addEventListener() {}
  removeEventListener() {}
}

const doc = {
  nodeType: 9,
  nodeName: '#document',
  documentElement: new FakeElement('html'),
  createComment: () => ({ nodeType: 8 }),
  createElement: (name: string) => new FakeElement(name),
  createTextNode: (text: string) => ({ nodeType: 3, textContent: text }),
  addEventListener: () => {},
  removeEventListener: () => {},
  activeElement: null
};

(doc.documentElement as any).ownerDocument = doc;
(global as any).window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  document: doc,
  HTMLIFrameElement: class extends FakeElement {}
};
(global as any).document = doc;
(global as any).HTMLIFrameElement = (global as any).window.HTMLIFrameElement;
(global as any).HTMLElement = FakeElement;
(global as any).Element = FakeElement;
(global as any).IS_REACT_ACT_ENVIRONMENT = true;

interface HookHarness {
  readonly result: { current: UseHandoffStateReturn };
  readonly unmount: () => void;
}

function renderHandoffHook(initialBaselineId?: string, initialCandidateSha?: string): HookHarness {
  const result = {} as { current: UseHandoffStateReturn };
  const container = new FakeElement('div');
  (container as any).ownerDocument = doc;
  const root = ReactDOM.createRoot(container as unknown as Element);

  function Wrapper({ id, sha }: { id?: string; sha?: string }) {
    result.current = useHandoffState(id, sha);
    return null;
  }

  act(() => {
    root.render(React.createElement(Wrapper, { id: initialBaselineId, sha: initialCandidateSha }));
  });

  return {
    result,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    }
  };
}

function makeBundle(baselineId: string): EngineeringHandoffBundleDto {
  const story: StoryDto = {
    id: `STORY-${baselineId}-1`,
    baselineId,
    title: `Story in ${baselineId}`,
    narrative: { role: 'user', feature: 'feature', benefit: 'benefit' },
    requirementRevisionIds: ['REQ-001-R1'],
    scenarios: [],
    acceptanceCriteria: ['AC1'],
    gherkinText: 'Feature: Test',
    dependencies: [],
    createdAt: createInstant('2026-09-19T00:00:00.000Z')
  };

  return {
    baseline: {
      id: baselineId,
      requirementRevisions: ['REQ-001-R1'],
      policyConstraintRevisions: [],
      createdAt: createInstant('2026-09-19T00:00:00.000Z'),
      createdBy: 'test'
    },
    authorityBundle: {
      baseline: {
        id: baselineId,
        requirementRevisions: ['REQ-001-R1'],
        policyConstraintRevisions: [],
        createdAt: createInstant('2026-09-19T00:00:00.000Z'),
        createdBy: 'test'
      },
      requirements: [],
      policyConstraints: []
    },
    engineeringDecisions: [],
    stories: [story],
    readinessReports: [
      {
        storyId: story.id,
        baselineId,
        status: 'implementation-ready',
        isReady: true,
        failures: [],
        passedRules: ['RULE_01_PROJECTION_EXISTS'],
        evaluatedAt: createInstant('2026-09-19T00:00:00.000Z')
      }
    ],
    coverage: {
      baselineId,
      totalRequirements: 1,
      coveredCount: 1,
      uncoveredCount: 0,
      multiCoveredCount: 0,
      coveredRequirements: [],
      uncoveredRequirementRevisionIds: [],
      multiCoveredRequirements: [],
      isFullyCovered: true,
      computedAt: createInstant('2026-09-19T00:00:00.000Z')
    },
    dependencyGraph: {
      baselineId,
      nodes: [],
      edges: [],
      executionOrder: [],
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
    },
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
}

describe('useHandoffState', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(handoffApi, 'listAvailableBaselines').mockResolvedValue(['BASE-001', 'BASE-002']);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes and fetches bundle for initial baseline', async () => {
    const bundle1 = makeBundle('BASE-001');
    vi.spyOn(handoffApi, 'getEngineeringHandoffBundle').mockResolvedValue(bundle1);

    let harness!: HookHarness;
    await act(async () => {
      harness = renderHandoffHook('BASE-001');
    });

    expect(harness.result.current.status).toBe('success');
    expect(harness.result.current.activeBaselineId).toBe('BASE-001');
    expect(harness.result.current.bundle?.baseline.id).toBe('BASE-001');
    expect(harness.result.current.availableBaselines).toEqual(['BASE-001', 'BASE-002']);
    harness.unmount();
  });

  it('prevents stale out-of-order baseline response from overwriting newer selection (deferred-response test)', async () => {
    let resolveBase1!: (b: EngineeringHandoffBundleDto) => void;
    const base1Promise = new Promise<EngineeringHandoffBundleDto>((resolve) => {
      resolveBase1 = resolve;
    });

    let resolveBase2!: (b: EngineeringHandoffBundleDto) => void;
    const base2Promise = new Promise<EngineeringHandoffBundleDto>((resolve) => {
      resolveBase2 = resolve;
    });

    vi.spyOn(handoffApi, 'getEngineeringHandoffBundle').mockImplementation(async (id: string) => {
      if (id === 'BASE-001') return base1Promise;
      if (id === 'BASE-002') return base2Promise;
      return makeBundle(id);
    });

    let harness!: HookHarness;
    await act(async () => {
      harness = renderHandoffHook('BASE-001');
    });

    // Currently BASE-001 is loading
    expect(harness.result.current.status).toBe('loading');
    expect(harness.result.current.activeBaselineId).toBe('BASE-001');

    // User switches to BASE-002 before BASE-001 resolves
    act(() => {
      harness.result.current.selectBaseline('BASE-002');
    });

    expect(harness.result.current.activeBaselineId).toBe('BASE-002');
    expect(harness.result.current.status).toBe('loading');

    // Newer request BASE-002 resolves first
    const bundle2 = makeBundle('BASE-002');
    await act(async () => {
      resolveBase2(bundle2);
    });

    expect(harness.result.current.status).toBe('success');
    expect(harness.result.current.activeBaselineId).toBe('BASE-002');
    expect(harness.result.current.bundle?.baseline.id).toBe('BASE-002');

    // Older request BASE-001 resolves LAST (deferred response)
    const bundle1 = makeBundle('BASE-001');
    await act(async () => {
      resolveBase1(bundle1);
    });

    // Crucial check: state must NOT regress to BASE-001!
    expect(harness.result.current.activeBaselineId).toBe('BASE-002');
    expect(harness.result.current.bundle?.baseline.id).toBe('BASE-002');
    expect(harness.result.current.status).toBe('success');

    harness.unmount();
  });

  it('ignores deferred error from superseded baseline request', async () => {
    let rejectBase1!: (err: Error) => void;
    const base1Promise = new Promise<EngineeringHandoffBundleDto>((_, reject) => {
      rejectBase1 = reject;
    });

    const bundle2 = makeBundle('BASE-002');
    vi.spyOn(handoffApi, 'getEngineeringHandoffBundle').mockImplementation(async (id: string) => {
      if (id === 'BASE-001') return base1Promise;
      if (id === 'BASE-002') return bundle2;
      return makeBundle(id);
    });

    let harness!: HookHarness;
    await act(async () => {
      harness = renderHandoffHook('BASE-001');
    });

    // User switches to BASE-002
    await act(async () => {
      harness.result.current.selectBaseline('BASE-002');
    });

    expect(harness.result.current.status).toBe('success');
    expect(harness.result.current.bundle?.baseline.id).toBe('BASE-002');
    expect(harness.result.current.error).toBeNull();

    // Now older BASE-001 request fails
    await act(async () => {
      rejectBase1(new Error('Network error on BASE-001'));
    });

    // State remains healthy on BASE-002
    expect(harness.result.current.status).toBe('success');
    expect(harness.result.current.bundle?.baseline.id).toBe('BASE-002');
    expect(harness.result.current.error).toBeNull();

    harness.unmount();
  });

  it('guards mutateStoryDependencies against superseded baseline refresh', async () => {
    const bundle1 = makeBundle('BASE-001');
    const bundle2 = makeBundle('BASE-002');

    let resolveMutation!: (s: StoryDto) => void;
    const mutationPromise = new Promise<StoryDto>((resolve) => {
      resolveMutation = resolve;
    });

    vi.spyOn(handoffApi, 'getEngineeringHandoffBundle').mockImplementation(async (id) => {
      if (id === 'BASE-001') return bundle1;
      if (id === 'BASE-002') return bundle2;
      return makeBundle(id);
    });

    vi.spyOn(handoffApi, 'updateStoryDependencies').mockImplementation(async () => {
      return mutationPromise;
    });

    let harness!: HookHarness;
    await act(async () => {
      harness = renderHandoffHook('BASE-001');
    });

    expect(harness.result.current.bundle?.baseline.id).toBe('BASE-001');

    // Start mutation for a story in BASE-001
    let mutatePromise: Promise<StoryDto | undefined>;
    act(() => {
      mutatePromise = harness.result.current.mutateStoryDependencies('STORY-BASE-001-1', []);
    });

    // While mutation is pending, user switches to BASE-002
    await act(async () => {
      harness.result.current.selectBaseline('BASE-002');
    });

    expect(harness.result.current.activeBaselineId).toBe('BASE-002');
    expect(harness.result.current.bundle?.baseline.id).toBe('BASE-002');

    // Resolve the mutation
    const updatedStory: StoryDto = {
      ...bundle1.stories[0],
      dependencies: ['STORY-OTHER']
    };
    await act(async () => {
      resolveMutation(updatedStory);
      await mutatePromise;
    });

    // Must still remain on BASE-002 and not refresh or regress to BASE-001
    expect(harness.result.current.activeBaselineId).toBe('BASE-002');
    expect(harness.result.current.bundle?.baseline.id).toBe('BASE-002');

    harness.unmount();
  });

  it('defaults candidateSha to empty string and fetches nothing when no SHA provided', async () => {
    const getStatusSpy = vi.spyOn(handoffApi, 'getCandidatePromotionStatus');
    let harness!: HookHarness;
    await act(async () => {
      harness = renderHandoffHook('BASE-001');
    });

    expect(harness.result.current.candidateSha).toBe('');
    expect(harness.result.current.promotionStatus).toBeNull();
    expect(harness.result.current.validationRuns).toEqual([]);
    expect(harness.result.current.governanceApprovals).toEqual([]);
    expect(getStatusSpy).not.toHaveBeenCalled();

    harness.unmount();
  });

  it('updates governance state and re-fetches status, runs, and approvals when candidate SHA changes', async () => {
    const shaA = '1111111111111111111111111111111111111111';
    const shaB = '2222222222222222222222222222222222222222';

    const getStatusSpy = vi
      .spyOn(handoffApi, 'getCandidatePromotionStatus')
      .mockImplementation(async (sha) => ({
        candidateSha: sha,
        isApproved: false,
        disposition: 'UNAPPROVED',
        diagnosticCode: 'AWAITING_APPROVAL',
        message: `Status for ${sha}`,
        evaluatedAt: createInstant('2026-09-20T08:00:00.000Z')
      }));

    const listRunsSpy = vi
      .spyOn(handoffApi, 'listValidationRuns')
      .mockImplementation(async (sha) => [
        {
          id: `RUN-${sha.slice(0, 4)}`,
          candidateSha: sha,
          phase: 'phase-3',
          executionMode: 'deterministic-ci',
          provider: 'fake',
          artifacts: [],
          evidenceDigest: 'd'.repeat(64),
          proposedDisposition: 'GO',
          executedBy: 'runner',
          executedAt: createInstant('2026-09-20T08:00:00.000Z'),
          summary: {}
        }
      ]);

    const listApprovalsSpy = vi
      .spyOn(handoffApi, 'listGovernanceApprovals')
      .mockImplementation(async (sha) => [
        {
          id: `APPR-${sha.slice(0, 4)}`,
          candidateSha: sha,
          validationRunId: `RUN-${sha.slice(0, 4)}`,
          evidenceDigest: 'd'.repeat(64),
          decision: 'GO',
          status: 'ACTIVE',
          rationale: `Approved ${sha}`,
          actor: { id: 'u1', name: 'User 1', actorType: 'human' },
          decidedAt: createInstant('2026-09-20T08:00:00.000Z')
        }
      ]);

    let harness!: HookHarness;
    await act(async () => {
      harness = renderHandoffHook('BASE-001', shaA);
    });

    expect(harness.result.current.candidateSha).toBe(shaA);
    expect(harness.result.current.promotionStatus?.candidateSha).toBe(shaA);
    expect(harness.result.current.validationRuns[0]?.candidateSha).toBe(shaA);
    expect(harness.result.current.governanceApprovals[0]?.candidateSha).toBe(shaA);
    expect(getStatusSpy).toHaveBeenCalledWith(shaA);
    expect(listRunsSpy).toHaveBeenCalledWith(shaA);
    expect(listApprovalsSpy).toHaveBeenCalledWith(shaA);

    // Now change candidate SHA to shaB
    await act(async () => {
      harness.result.current.setCandidateSha(shaB);
    });

    expect(harness.result.current.candidateSha).toBe(shaB);
    expect(harness.result.current.promotionStatus?.candidateSha).toBe(shaB);
    expect(harness.result.current.validationRuns[0]?.candidateSha).toBe(shaB);
    expect(harness.result.current.governanceApprovals[0]?.candidateSha).toBe(shaB);
    expect(getStatusSpy).toHaveBeenCalledWith(shaB);
    expect(listRunsSpy).toHaveBeenCalledWith(shaB);
    expect(listApprovalsSpy).toHaveBeenCalledWith(shaB);

    harness.unmount();
  });

  it('surfaces governance API error in governanceError without swallowing it', async () => {
    const sha = '3333333333333333333333333333333333333333';
    vi.spyOn(handoffApi, 'getCandidatePromotionStatus').mockRejectedValue(
      new Error('Governance backend service unavailable')
    );
    vi.spyOn(handoffApi, 'listValidationRuns').mockResolvedValue([]);
    vi.spyOn(handoffApi, 'listGovernanceApprovals').mockResolvedValue([]);

    let harness!: HookHarness;
    await act(async () => {
      harness = renderHandoffHook('BASE-001', sha);
    });

    expect(harness.result.current.governanceError).toBe('Governance backend service unavailable');

    harness.unmount();
  });

  it('fails closed when approveCandidate or exportAudit is invoked without a candidate SHA', async () => {
    let harness!: HookHarness;
    await act(async () => {
      harness = renderHandoffHook('BASE-001');
    });

    expect(harness.result.current.candidateSha).toBe('');
    await expect(harness.result.current.approveCandidate('GO', 'Rationale')).rejects.toThrow(
      /Candidate commit SHA is required/
    );

    await expect(harness.result.current.exportAudit()).rejects.toThrow(
      /Candidate commit SHA is required/
    );

    harness.unmount();
  });
});
