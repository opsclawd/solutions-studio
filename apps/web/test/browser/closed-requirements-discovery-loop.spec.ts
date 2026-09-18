import { test, expect } from '@playwright/test';

test.describe('Phase 2.6 — Closed Requirements Discovery Loop', () => {
  test('Executes end-to-end loop: projection review -> discovery -> reconciliation -> successor baseline -> projection staleness & switching', async ({
    page
  }) => {
    // ------------------------------------------------------------------------
    // Step 1: Navigate to review workspace anchored to BASE-001
    // ------------------------------------------------------------------------
    await page.goto('/review?baselineId=BASE-001');

    // Verify header baseline selector is visible and selects BASE-001
    const baselineSelector = page.getByTestId('baseline-selector');
    await expect(baselineSelector).toBeVisible();
    await expect(baselineSelector).toHaveValue('BASE-001');

    // ------------------------------------------------------------------------
    // Step 2: Open Projections tab and verify PROJ-001
    // ------------------------------------------------------------------------
    const projTabBtn = page.getByTestId('view-projections-btn');
    await expect(projTabBtn).toBeVisible();
    await projTabBtn.click();

    // Verify PROJ-001 tab is active and does NOT show a prior baseline warning or staleness badge
    const proj1Tab = page.getByTestId('projection-option-PROJ-001');
    await expect(proj1Tab).toBeVisible();
    await expect(page.getByTestId('projection-staleness-badge')).toHaveCount(0);
    await expect(page.getByTestId('projection-prior-baseline-alert')).toHaveCount(0);

    // ------------------------------------------------------------------------
    // Step 3: Discover new requirement from PROJ-001 diagram panel
    // ------------------------------------------------------------------------
    await page
      .getByTestId('discovery-statement-input')
      .fill('All privileged sessions must terminate automatically after 15 minutes of inactivity.');
    await page.getByTestId('discovery-category-select').selectOption('business-rule');
    await page
      .getByTestId('discovery-rationale-input')
      .fill('Observed missing timeout handling during PROJ-001 diagram review.');

    const submitDiscoveryBtn = page.getByTestId('submit-requirement-discovery-btn');
    await expect(submitDiscoveryBtn).toBeEnabled();
    await submitDiscoveryBtn.click();

    // Verify discovery success alert and deep-link navigation
    const viewDiscoveredBtn = page.getByTestId('view-discovered-requirement-btn');
    await expect(viewDiscoveredBtn).toBeVisible({ timeout: 10000 });
    await viewDiscoveredBtn.click();

    // ------------------------------------------------------------------------
    // Step 4: Verify navigation to Requirements tab with originating projection context
    // ------------------------------------------------------------------------
    await expect(page.getByTestId('view-by-requirement-btn')).toHaveClass(/bg-white/);
    const originatingContext = page.getByTestId('originating-projection-context');
    await expect(originatingContext).toBeVisible();
    await expect(originatingContext).toContainText('PROJ-001');

    const backToProjBtn = page.getByTestId('back-to-projection-btn');
    await expect(backToProjBtn).toBeVisible();

    // ------------------------------------------------------------------------
    // Step 5: Human Reconciliation of discovered candidate requirement
    // ------------------------------------------------------------------------
    // Initially PENDING REVIEW / UNRESOLVED
    await expect(page.getByTestId('detail-review-badge')).toHaveText('PENDING REVIEW');

    // Accept requirement
    const openAcceptBtn = page.getByTestId('open-accept-form-btn');
    await expect(openAcceptBtn).toBeVisible();
    await openAcceptBtn.click();
    await page.getByTestId('action-rationale-input').fill('Accepted into scope after SME review.');
    await page.getByTestId('submit-action-btn').click();

    // Verify ACCEPTED
    await expect(page.getByTestId('detail-review-badge')).toHaveText('ACCEPTED');

    // Resolve requirement
    const openResolveBtn = page.getByTestId('open-resolve-form-btn');
    await expect(openResolveBtn).toBeVisible();
    await openResolveBtn.click();
    await page
      .getByTestId('action-rationale-input')
      .fill('Verified dependencies and scope resolution.');
    await page.getByTestId('submit-action-btn').click();

    // Verify CLEAR resolution state
    await expect(page.getByTestId('detail-resolution-badge')).toHaveText('CLEAR');

    // ------------------------------------------------------------------------
    // Step 6: Create successor baseline BASE-002
    // ------------------------------------------------------------------------
    const openCreateBaselineBtn = page.getByTestId('open-create-baseline-modal-btn');
    await expect(openCreateBaselineBtn).toBeVisible();
    await openCreateBaselineBtn.click();

    // Verify Create Baseline Modal contents
    const baselineModal = page.getByTestId('create-baseline-modal');
    await expect(baselineModal).toBeVisible();
    await expect(page.getByTestId('predecessor-baseline-id')).toHaveText('BASE-001');

    const baselineIdInput = page.getByTestId('create-baseline-id-input');
    await expect(baselineIdInput).toHaveValue('BASE-002');

    // Preview shows eligible revisions
    const previewList = page.getByTestId('create-baseline-revisions-preview');
    await expect(previewList).toContainText('REQ-002-R1');

    const submitBaselineBtn = page.getByTestId('submit-create-baseline-btn');
    await expect(submitBaselineBtn).toBeEnabled();
    await submitBaselineBtn.click();

    // Verify modal closes and active baseline updates to BASE-002
    await expect(baselineModal).toHaveCount(0);
    await expect(baselineSelector).toHaveValue('BASE-002');

    // ------------------------------------------------------------------------
    // Step 7: Inspect projections in BASE-002 workspace
    //         PROJ-001 (from BASE-001) must display staleness identity badge
    // ------------------------------------------------------------------------
    await projTabBtn.click();

    // Prior baseline tag in tab and alert banner
    const priorTag = page.getByTestId('projection-prior-tag-PROJ-001');
    await expect(priorTag).toBeVisible();
    await expect(priorTag).toContainText('BASE-001');

    // Select PROJ-001
    await page.getByTestId('projection-option-PROJ-001').click();

    // Verify staleness banner and badge
    const stalenessAlert = page.getByTestId('projection-prior-baseline-alert');
    await expect(stalenessAlert).toBeVisible();
    await expect(stalenessAlert).toContainText('BASE-001');

    const stalenessBadge = page.getByTestId('projection-staleness-badge');
    await expect(stalenessBadge).toBeVisible();
    await expect(stalenessBadge).toContainText('Prior Baseline (BASE-001)');

    // ------------------------------------------------------------------------
    // Step 8: Switch back to BASE-001 via baseline selector
    // ------------------------------------------------------------------------
    await baselineSelector.selectOption('BASE-001');
    await expect(baselineSelector).toHaveValue('BASE-001');

    // In BASE-001 workspace, PROJ-001 is the active baseline projection, so staleness badge disappears
    await projTabBtn.click();
    await expect(page.getByTestId('projection-staleness-badge')).toHaveCount(0);
    await expect(page.getByTestId('projection-prior-baseline-alert')).toHaveCount(0);
  });
});
