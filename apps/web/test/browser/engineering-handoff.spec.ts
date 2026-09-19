import { test, expect } from '@playwright/test';
import type {
  EngineeringHandoffBundleDto,
  StoryDependencyGraphDto,
  StoryDto
} from '@solutions-studio/contracts';
import { createInstant } from '@solutions-studio/domain';

test.describe('Phase 3.6 — Story Dependency Graph & Engineering Handoff Workspace', () => {
  const nowInstant = createInstant(new Date().toISOString());

  const mockGraph: StoryDependencyGraphDto = {
    baselineId: 'BASE-001',
    nodes: [
      {
        storyId: 'STORY-001',
        title: 'User Authentication',
        requirementRevisionIds: ['REQ-001-R1'],
        dependencies: [],
        dependents: ['STORY-002'],
        isReady: true,
        readinessStatus: 'implementation-ready'
      },
      {
        storyId: 'STORY-002',
        title: 'User Profile Display',
        requirementRevisionIds: ['REQ-001-R1'],
        dependencies: ['STORY-001'],
        dependents: [],
        isReady: true,
        readinessStatus: 'implementation-ready'
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
      errors: [],
      missingNodeIds: [],
      selfDependencies: [],
      cycles: []
    },
    createdAt: nowInstant
  };

  const mockBundle: EngineeringHandoffBundleDto = {
    baseline: {
      id: 'BASE-001',
      requirementRevisions: ['REQ-001-R1'],
      policyConstraintRevisions: ['POL-001-R1'],
      createdBy: 'reviewer-1',
      createdAt: nowInstant
    },
    summary: {
      isHandoffReady: true,
      readyStories: 2,
      nonReadyStories: 0,
      totalStories: 2,
      openBlockingFindings: 0,
      coveredRequirements: 1,
      totalRequirements: 1
    },
    authorityBundle: {
      baseline: {
        id: 'BASE-001',
        requirementRevisions: ['REQ-001-R1'],
        policyConstraintRevisions: ['POL-001-R1'],
        createdBy: 'reviewer-1',
        createdAt: nowInstant
      },
      requirements: [
        {
          id: 'REQ-001-R1',
          requirementId: 'REQ-001',
          revision: 1,
          statement: 'Users shall be authenticated using passwordless email OTP.',
          category: 'business-rule',
          origin: 'ASSUMED',
          reviewState: 'ACCEPTED',
          resolutionState: 'CLEAR',
          evidence: []
        }
      ],
      policyConstraints: [
        {
          id: 'POL-001-R1',
          policyConstraintId: 'POL-001',
          revision: 1,
          statement: 'All authentication must be MFA enabled',
          authorityReference: 'SEC-01',
          state: 'ACCEPTED',
          createdBy: 'reviewer-1',
          createdAt: nowInstant
        }
      ]
    },
    engineeringDecisions: [
      {
        id: 'DEC-001',
        baselineId: 'BASE-001',
        statement: 'Use WebCrypto for token hashing',
        rationale: 'Standard browser and node support',
        requirementRevisionIds: ['REQ-001-R1'],
        policyConstraintRevisionIds: [],
        state: 'ACCEPTED',
        createdBy: 'reviewer-1',
        createdAt: nowInstant
      }
    ],
    blockingFindings: [],
    unresolvedRequirements: [],
    dependencyGraph: mockGraph,
    stories: [
      {
        id: 'STORY-001',
        baselineId: 'BASE-001',
        title: 'User Authentication',
        narrative: {
          role: 'Registered User',
          feature: 'Login via OTP',
          benefit: 'Access account securely'
        },
        requirementRevisionIds: ['REQ-001-R1'],
        policyConstraintRevisionIds: ['POL-001-R1'],
        scenarios: [
          {
            id: 'SCEN-001',
            title: 'Successful OTP Login',
            requirementRevisionIds: ['REQ-001-R1'],
            steps: [{ keyword: 'Given', text: 'a valid user' }]
          }
        ],
        acceptanceCriteria: ['Valid email receives OTP'],
        gherkinText:
          'Feature: User Authentication\n\nScenario: Successful OTP Login\nGiven a valid user',
        dependencies: [],
        createdAt: nowInstant
      },
      {
        id: 'STORY-002',
        baselineId: 'BASE-001',
        title: 'User Profile Display',
        narrative: {
          role: 'Authenticated User',
          feature: 'View profile page',
          benefit: 'See user info'
        },
        requirementRevisionIds: ['REQ-001-R1'],
        policyConstraintRevisionIds: [],
        scenarios: [
          {
            id: 'SCEN-002',
            title: 'View profile info',
            requirementRevisionIds: ['REQ-001-R1'],
            steps: [{ keyword: 'Given', text: 'an authenticated session' }]
          }
        ],
        acceptanceCriteria: ['Profile shows email and avatar'],
        gherkinText:
          'Feature: User Profile Display\n# @depends-on: STORY-001\n\nScenario: View profile info\nGiven an authenticated session',
        dependencies: ['STORY-001'],
        createdAt: nowInstant
      }
    ],
    readinessReports: [
      {
        storyId: 'STORY-001',
        baselineId: 'BASE-001',
        isReady: true,
        status: 'implementation-ready',
        failures: [],
        passedRules: ['RULE-001', 'RULE-010'],
        evaluatedAt: nowInstant
      },
      {
        storyId: 'STORY-002',
        baselineId: 'BASE-001',
        isReady: true,
        status: 'implementation-ready',
        failures: [],
        passedRules: ['RULE-001', 'RULE-010'],
        evaluatedAt: nowInstant
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
          coveringStoryIds: ['STORY-001', 'STORY-002'],
          coverageCount: 2
        }
      ],
      uncoveredRequirementRevisionIds: [],
      multiCoveredRequirements: [],
      isFullyCovered: true,
      computedAt: nowInstant
    },
    sqlProjection: {
      id: 'PROJ-SQL-001',
      baselineId: 'BASE-001',
      requirementRevisionIds: ['REQ-001-R1'],
      artifactType: 'sql-schema',
      content: 'CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL);',
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
          artifactType: 'sql-schema'
        },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'hash-sql',
          verifiedAt: nowInstant
        }
      },
      createdAt: nowInstant
    },
    openApiProjection: {
      id: 'PROJ-OAS-001',
      baselineId: 'BASE-001',
      requirementRevisionIds: ['REQ-001-R1'],
      artifactType: 'openapi',
      content: 'openapi: 3.0.0\ninfo:\n  title: Test API\n  version: 1.0.0\npaths: {}',
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
          artifactType: 'openapi'
        },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'hash-oas',
          verifiedAt: nowInstant
        }
      },
      createdAt: nowInstant
    }
  };

  let currentBundle: EngineeringHandoffBundleDto;

  test.beforeEach(async ({ page }) => {
    currentBundle = JSON.parse(JSON.stringify(mockBundle));

    // Intercept handoff and dependency-graph APIs
    await page.route('**/api/baselines/BASE-001/handoff', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(currentBundle)
      });
    });

    await page.route('**/api/baselines/BASE-001/dependency-graph', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(currentBundle.dependencyGraph)
      });
    });

    await page.route('**/api/baselines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'BASE-001',
            requirementRevisions: ['REQ-001-R1'],
            policyConstraintRevisions: [],
            createdBy: 'reviewer-1',
            createdAt: nowInstant
          }
        ])
      });
    });
  });

  test('1. Loads /handoff workspace and displays readiness header and metrics', async ({
    page
  }) => {
    await page.goto('/handoff?baselineId=BASE-001');

    // Header and baseline select
    await expect(page.getByTestId('handoff-header')).toBeVisible();
    await expect(page.getByTestId('handoff-baseline-select')).toHaveValue('BASE-001');

    // Readiness status badge
    const badge = page.getByTestId('handoff-status-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('HANDOFF READY');

    // Metric pills
    const pills = page.getByTestId('handoff-metric-pills');
    await expect(pills).toBeVisible();
    await expect(pills).toContainText('2 / 2 Ready');
    await expect(pills).toContainText('0 Open Blockers');
    await expect(pills).toContainText('100% Coverage');
  });

  test('2. Displays Authority Contracts with Requirements, Policies, and Decisions tabs', async ({
    page
  }) => {
    await page.goto('/handoff?baselineId=BASE-001');

    const authSection = page.getByTestId('authority-contracts-section');
    await expect(authSection).toBeVisible();

    // Verify Requirements tab
    await expect(page.getByTestId('authority-item-REQ-001-R1')).toBeVisible();
    await expect(authSection).toContainText('Users shall be authenticated');

    // Switch to Policies tab
    await page.getByTestId('authority-tab-policies').click();
    await expect(authSection).toContainText('All authentication must be MFA enabled');

    // Switch to Decisions tab
    await page.getByTestId('authority-tab-decisions').click();
    await expect(authSection).toContainText('Use WebCrypto for token hashing');
  });

  test('3. Displays Projections with SQL, OpenAPI, and Gherkin tabs', async ({ page }) => {
    await page.goto('/handoff?baselineId=BASE-001');

    const projSection = page.getByTestId('projections-section');
    await expect(projSection).toBeVisible();

    // SQL Tab is default
    await expect(page.getByTestId('projection-content-sql')).toContainText('CREATE TABLE users');

    // Switch to OpenAPI tab
    await page.getByTestId('projections-tab-openapi').click();
    await expect(page.getByTestId('projection-content-openapi')).toContainText('openapi: 3.0.0');

    // Switch to Gherkin tab
    await page.getByTestId('projections-tab-gherkin').click();
    await expect(page.getByTestId('projection-content-gherkin')).toContainText(
      'User Authentication'
    );
  });

  test('4. Displays Story Readiness Backlog with mutation capability, cycle rejection, and sync', async ({
    page
  }) => {
    await page.goto('/handoff?baselineId=BASE-001');

    const backlog = page.getByTestId('story-readiness-backlog-section');
    await expect(backlog).toBeVisible();

    // Both stories shown
    await expect(page.getByTestId('story-card-STORY-001')).toBeVisible();
    await expect(page.getByTestId('story-card-STORY-002')).toBeVisible();

    // Part A: Cycle Rejection Feedback
    const editBtn1 = page.getByTestId('edit-dependencies-btn-STORY-001');
    await expect(editBtn1).toBeVisible();
    await editBtn1.click();

    await page.route('**/api/stories/STORY-001/dependencies', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Circular dependency detected: STORY-001 -> STORY-002 -> STORY-001'
        })
      });
    });

    await page.getByTestId('dep-checkbox-STORY-002').click();
    await page.getByTestId('save-dependencies-btn-STORY-001').click();
    await expect(backlog).toContainText('Circular dependency detected');
    await editBtn1.click(); // Cancel editing

    // Part B: Valid Mutation on STORY-002
    await page.route('**/api/stories/STORY-002/dependencies', async (route) => {
      const reqBody = JSON.parse(route.request().postData() || '{}');
      const updatedStory: StoryDto = {
        ...currentBundle.stories[1],
        dependencies: reqBody.dependencies,
        gherkinText:
          'Feature: User Profile Display\n\nScenario: View profile info\nGiven an authenticated session'
      };
      currentBundle.stories[1] = updatedStory;
      currentBundle.dependencyGraph = {
        ...mockGraph,
        nodes: [
          {
            ...mockGraph.nodes[0],
            dependents: []
          },
          {
            ...mockGraph.nodes[1],
            dependencies: []
          }
        ],
        edges: [],
        executionOrder: ['STORY-001', 'STORY-002']
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(updatedStory)
      });
    });

    // Edit dependencies on STORY-002
    const editBtn2 = page.getByTestId('edit-dependencies-btn-STORY-002');
    await expect(editBtn2).toBeVisible();
    await editBtn2.click();

    const editor = page.getByTestId('story-dependency-editor-STORY-002');
    await expect(editor).toBeVisible();
    await expect(page.getByTestId('dep-checkbox-STORY-001')).toBeChecked();

    // Uncheck and save
    await page.getByTestId('dep-checkbox-STORY-001').click();
    await page.getByTestId('save-dependencies-btn-STORY-002').click();

    // Assert refreshed dependencies on story card
    const storyCard2 = page.getByTestId('story-card-STORY-002');
    await expect(storyCard2).toContainText('None (Root)');

    // Assert synchronized Gherkin text
    await page.getByTestId('toggle-details-btn-STORY-002').click();
    await expect(storyCard2).not.toContainText('# @depends-on: STORY-001');

    // Assert graph stage changes: both stories now in parallel Stage 1
    await expect(page.getByTestId('graph-stage-lane-1')).toContainText('STORY-001');
    await expect(page.getByTestId('graph-stage-lane-1')).toContainText('STORY-002');
    await expect(page.getByTestId('graph-stage-lane-2')).not.toBeVisible();
  });

  test('5. Displays Dependency Graph lanes and raw JSON drawer', async ({ page }) => {
    await page.goto('/handoff?baselineId=BASE-001');

    const graphSection = page.getByTestId('dependency-graph-section');
    await expect(graphSection).toBeVisible();

    // Stage lanes: Stage 1 has STORY-001, Stage 2 has STORY-002
    await expect(page.getByTestId('graph-stage-lane-1')).toBeVisible();
    await expect(page.getByTestId('graph-stage-lane-2')).toBeVisible();
    await expect(page.getByTestId('graph-node-STORY-001')).toBeVisible();
    await expect(page.getByTestId('graph-node-STORY-002')).toBeVisible();

    // Open raw JSON drawer
    await page.getByTestId('raw-json-drawer-btn').click();
    const drawer = page.getByTestId('raw-json-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('"STORY-001"');
    await expect(drawer).toContainText('"STORY-002"');
  });

  test('6. Shows Blockers banner with deep link to review when unresolved findings exist', async ({
    page
  }) => {
    const bundleWithBlockers: EngineeringHandoffBundleDto = {
      ...mockBundle,
      summary: {
        ...mockBundle.summary,
        isHandoffReady: false,
        openBlockingFindings: 1
      },
      blockingFindings: [
        {
          id: 'FIND-001',
          type: 'contradiction',
          affectedRequirementRevisions: ['REQ-001-R1'],
          discoveredBy: 'human',
          disposition: 'OPEN',
          rationale: 'Contradiction between auth and token validity',
          evidence: [],
          baselineId: 'BASE-001'
        }
      ]
    };

    await page.route('**/api/baselines/BASE-001/handoff', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(bundleWithBlockers)
      });
    });

    await page.goto('/handoff?baselineId=BASE-001');

    // Status badge is NOT READY
    const badge = page.getByTestId('handoff-status-badge');
    await expect(badge).toHaveText('NOT READY FOR HANDOFF');

    // Alert banner
    const alert = page.getByTestId('unresolved-findings-alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Contradiction between auth and token validity');

    // Deep link to review
    const deepLink = page.getByTestId('unresolved-finding-link');
    await expect(deepLink).toBeVisible();
    await expect(deepLink).toHaveAttribute(
      'href',
      '/review?baselineId=BASE-001&requirementId=REQ-001-R1'
    );
  });

  test('7. Shows Blockers banner and authority badge when PROPOSED engineering decisions exist', async ({
    page
  }) => {
    const bundleWithProposedDecision: EngineeringHandoffBundleDto = {
      ...mockBundle,
      summary: {
        ...mockBundle.summary,
        isHandoffReady: false
      },
      engineeringDecisions: [
        ...mockBundle.engineeringDecisions,
        {
          id: 'DEC-002',
          baselineId: 'BASE-001',
          statement: 'Use Argon2 for password hashing',
          rationale: 'Stronger memory-hard defense',
          requirementRevisionIds: ['REQ-001-R1'],
          policyConstraintRevisionIds: [],
          state: 'PROPOSED',
          createdBy: 'architect-1',
          createdAt: nowInstant
        }
      ]
    };

    await page.route('**/api/baselines/BASE-001/handoff', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(bundleWithProposedDecision)
      });
    });

    await page.goto('/handoff?baselineId=BASE-001');

    // Blocker banner displays the proposed decision
    const alert = page.getByTestId('unresolved-findings-alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Proposed Engineering Decisions');
    await expect(alert).toContainText('Use Argon2 for password hashing');

    // Check review deep link for decision
    const decisionItem = page.getByTestId('proposed-decision-item-DEC-002');
    await expect(decisionItem).toBeVisible();
    await expect(decisionItem.getByTestId('unresolved-finding-link')).toHaveAttribute(
      'href',
      '/review?baselineId=BASE-001&requirementId=REQ-001-R1'
    );

    // Authority Contracts section displays both decisions with state labels
    await page.getByTestId('authority-tab-decisions').click();
    const dec1 = page.getByTestId('authority-item-DEC-001');
    await expect(dec1).toContainText('ACCEPTED');
    const dec2 = page.getByTestId('authority-item-DEC-002');
    await expect(dec2).toContainText('PROPOSED');
  });
});
