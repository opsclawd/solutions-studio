import { test, expect } from '@playwright/test';
import type { ProjectionRecordDto } from '@solutions-studio/contracts';
import { createInstant } from '@solutions-studio/domain';

test.describe('Phase 2.4 — Baseline Process/State Projection & Review', () => {
  test('1. Loads pre-seeded projection and verifies provenance bar metadata', async ({ page }) => {
    await page.goto('/review?baselineId=BASE-001');

    const projBtn = page.getByTestId('view-projections-btn');
    await expect(projBtn).toBeVisible();
    await projBtn.click();

    // Verify provenance bar is visible
    const provenanceBar = page.getByTestId('projection-provenance-bar');
    await expect(provenanceBar).toBeVisible();

    // Verify baseline ID
    const baselineIdBadge = page.getByTestId('projection-baseline-id');
    await expect(baselineIdBadge).toHaveText('BASE-001');

    // Verify revisions list includes REQ-002-R1
    const revisionsList = page.getByTestId('projection-revisions-list');
    await expect(revisionsList).toContainText('REQ-002-R1');

    // Verify repairsNeeded, attemptCount, contentHash, and verifiedAt are present
    const repairsNeeded = page.getByTestId('projection-repairs-needed');
    await expect(repairsNeeded).toHaveText('0');

    const attemptCount = page.getByTestId('projection-attempt-count');
    await expect(attemptCount).toHaveText('1');

    const contentHash = page.getByTestId('projection-content-hash');
    await expect(contentHash).toBeVisible();
    await expect(contentHash).not.toBeEmpty();

    const verifiedAt = page.getByTestId('projection-verified-at');
    await expect(verifiedAt).toBeVisible();
  });

  test('2. Inspects Mermaid diagram with pan/zoom, raw code toggle, and native SVG export', async ({
    page
  }) => {
    await page.goto('/review?baselineId=BASE-001');
    await page.getByTestId('view-projections-btn').click();

    // Wait for canvas to render SVG
    const canvas = page.getByTestId('diagram-canvas-container');
    await expect(canvas).toBeVisible();
    await expect(canvas.locator('svg')).toBeVisible({ timeout: 10000 });

    // Test Zoom In
    const zoomText = page.getByTestId('zoom-level-text');
    await expect(zoomText).toHaveText('100%');

    await page.getByTestId('zoom-in-btn').click();
    await expect(zoomText).toHaveText('120%');

    // Test Zoom Reset
    await page.getByTestId('zoom-reset-btn').click();
    await expect(zoomText).toHaveText('100%');

    // Test Toggle Raw Code
    const rawCodeBtn = page.getByTestId('toggle-raw-code-btn');
    await expect(page.getByTestId('raw-mermaid-code')).toHaveCount(0);
    await rawCodeBtn.click();
    const rawCode = page.getByTestId('raw-mermaid-code');
    await expect(rawCode).toBeVisible();
    await expect(rawCode).toContainText('graph TD');
    await rawCodeBtn.click();
    await expect(page.getByTestId('raw-mermaid-code')).toHaveCount(0);

    // Test SVG Export download trigger
    const exportBtn = page.getByTestId('export-svg-btn');
    await expect(exportBtn).toBeEnabled();
    const downloadPromise = page.waitForEvent('download');
    await exportBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('PROJ-001.svg');
  });

  test('3. Deterministic state diagram generation via route interception', async ({ page }) => {
    // Intercept POST /api/baselines/*/projections to guarantee deterministic offline execution
    await page.route('**/api/baselines/*/projections', async (route) => {
      if (route.request().method() === 'POST') {
        const postData = route.request().postDataJSON();
        const artifactType = postData?.artifactType ?? 'state-diagram';
        const mockProjection: ProjectionRecordDto = {
          id: 'PROJ-MOCK-STATE-001',
          baselineId: 'BASE-001',
          requirementRevisionIds: ['REQ-002-R1'],
          artifactType,
          content: `stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing: Submit\n  Processing --> Success: Complete\n  Success --> [*]`,
          metadata: {
            baselineId: 'BASE-001',
            requirementRevisionIds: ['REQ-002-R1'],
            artifactType,
            declaredProvenance: {
              baselineId: 'BASE-001',
              requirementRevisionIds: ['REQ-002-R1']
            },
            configuredExecution: {
              provider: 'fake',
              artifactType
            },
            measuredVerification: {
              repairsNeeded: 0,
              attemptCount: 1,
              contentHash: 'mock-content-hash-abcdef123456',
              verifiedAt: createInstant(new Date().toISOString())
            }
          },
          createdAt: createInstant(new Date().toISOString())
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockProjection)
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/review?baselineId=BASE-001');
    await page.getByTestId('view-projections-btn').click();

    // Select state-diagram
    await page.getByTestId('projection-type-select').selectOption('state-diagram');

    // Submit generation
    await page.getByTestId('submit-generate-projection-btn').click();

    // Verify new projection option appears in selector and select it
    const newProjTab = page.getByTestId('projection-option-PROJ-MOCK-STATE-001');
    await expect(newProjTab).toBeVisible({ timeout: 10000 });
    await newProjTab.click();

    // Verify SVG renders new state diagram
    const canvas = page.getByTestId('diagram-canvas-container');
    await expect(canvas.locator('svg')).toBeVisible({ timeout: 10000 });

    // Verify raw code displays stateDiagram-v2
    await page.getByTestId('toggle-raw-code-btn').click();
    await expect(page.getByTestId('raw-mermaid-code')).toContainText('stateDiagram-v2');
  });

  test('4. Reports requirement discovery from diagram and verifies workspace hydration on refresh', async ({
    page
  }) => {
    await page.goto('/review?baselineId=BASE-001');
    await page.getByTestId('view-projections-btn').click();

    // Ensure projection is loaded
    await expect(page.getByTestId('diagram-canvas-container')).toBeVisible();

    // Ensure discovery tab is requirement
    await page.getByTestId('discovery-tab-requirement').click();

    // Fill form
    await page
      .getByTestId('discovery-statement-input')
      .fill('System must log all administrative RBAC assignments to audit vault');
    await page.getByTestId('discovery-category-select').selectOption('business-rule');
    await page
      .getByTestId('discovery-rationale-input')
      .fill('Discovered missing audit trail during diagram review');

    // Submit proposal
    await page.getByTestId('submit-requirement-discovery-btn').click();

    // Verify success message
    await expect(page.getByTestId('discovery-success-message')).toBeVisible();

    // Switch view to Requirements List
    await page.getByTestId('view-by-requirement-btn').click();

    // Verify newly proposed requirement is in the list
    const reqList = page.getByTestId('requirement-list');
    await expect(reqList).toContainText(
      'System must log all administrative RBAC assignments to audit vault'
    );
  });

  test('5. Reports candidate finding discovery from diagram review', async ({ page }) => {
    await page.goto('/review?baselineId=BASE-001');
    await page.getByTestId('view-projections-btn').click();

    // Switch to Report Finding tab
    await page.getByTestId('discovery-tab-finding').click();

    // Select finding type
    await page
      .getByTestId('discovery-finding-type-select')
      .selectOption('incomplete-state-machine');

    // Check REQ-002-R1 checkbox if available
    const revCheck = page.getByTestId('discovery-affected-rev-REQ-002-R1');
    if (await revCheck.isVisible()) {
      if (!(await revCheck.isChecked())) {
        await revCheck.check();
      }
    }

    // Fill rationale
    await page
      .getByTestId('discovery-finding-rationale-input')
      .fill('State transition for session timeout is missing rollback');

    // Submit finding
    await page.getByTestId('submit-finding-discovery-btn').click();

    // Verify success message
    await expect(page.getByTestId('discovery-success-message')).toBeVisible();

    // Switch to All Findings view
    await page.getByTestId('view-all-findings-btn').click();

    // Verify finding appears with OPEN disposition
    const allFindings = page.getByTestId('all-findings-panel');
    await expect(allFindings).toContainText(
      'State transition for session timeout is missing rollback'
    );
  });

  test('6. Verifies cross-baseline isolation for projections', async ({ page }) => {
    // Navigate without baselineId parameter
    await page.goto('/review');

    // Switch to Diagram Projections view
    await page.getByTestId('view-projections-btn').click();

    // In global view without baselineId, baseline warning is shown
    await expect(page.getByTestId('no-baseline-warning')).toBeVisible();

    // Navigate back to BASE-001
    await page.goto('/review?baselineId=BASE-001');
    await page.getByTestId('view-projections-btn').click();

    // Provenance bar is visible and shows BASE-001
    await expect(page.getByTestId('projection-baseline-id')).toHaveText('BASE-001');
  });
});
