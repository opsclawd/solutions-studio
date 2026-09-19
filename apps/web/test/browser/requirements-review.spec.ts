import { test, expect } from '@playwright/test';

test.describe('Interactive Requirements Review & Reconciliation Workspace', () => {
  test('1. Loads persisted review state through HTTP and renders requirements, evidence, and authority badges', async ({
    page
  }) => {
    // Navigating to root / should redirect to /review
    await page.goto('/');
    await expect(page).toHaveURL(/\/review/);

    await expect(page.getByTestId('workspace-title')).toBeVisible();

    // Verify all 3 seeded requirements appear in the list
    const reqList = page.getByTestId('requirement-list');
    await expect(reqList).toBeVisible();

    const req1Row = page.locator('[data-testid="requirement-row"][data-requirement-id="REQ-001"]');
    const req2Row = page.locator('[data-testid="requirement-row"][data-requirement-id="REQ-002"]');
    const req3Row = page.locator('[data-testid="requirement-row"][data-requirement-id="REQ-003"]');

    await expect(req1Row).toBeVisible();
    await expect(req2Row).toBeVisible();
    await expect(req3Row).toBeVisible();

    // Verify REQ-001 details are displayed by default
    await expect(page.getByTestId('detail-requirement-id')).toHaveText('REQ-001');
    await expect(page.getByTestId('detail-revision-id')).toContainText('REQ-001-R1');
    await expect(page.getByTestId('detail-origin-badge')).toHaveText('EXPLICIT');
    await expect(page.getByTestId('detail-review-badge')).toHaveText('PENDING REVIEW');

    // Verify Evidence Panel contains the excerpt for REQ-001
    const evidenceText = page.getByTestId('evidence-excerpt-text').first();
    await expect(evidenceText).toBeVisible();
    await expect(evidenceText).toContainText('AES-256 encryption at rest');
  });

  test('2. Accepts a pending requirement with rationale and updates to successor revision', async ({
    page
  }) => {
    await page.goto('/review');

    // Select REQ-001 (PENDING)
    await page.locator('[data-testid="requirement-row"][data-requirement-id="REQ-001"]').click();
    await expect(page.getByTestId('detail-requirement-id')).toHaveText('REQ-001');
    await expect(page.getByTestId('detail-revision-id')).toContainText('REQ-001-R1');

    // Open Accept form
    await page.getByTestId('open-accept-form-btn').click();
    const submitBtn = page.getByTestId('submit-action-btn');

    // Submit is disabled without rationale
    await expect(submitBtn).toBeDisabled();

    // Fill non-empty rationale
    await page.getByTestId('action-rationale-input').fill('Accepted per compliance audit');
    await expect(submitBtn).toBeEnabled();

    // Submit accept action
    await submitBtn.click();

    // Verify detail updates to successor revision REQ-001-R2
    await expect(page.getByTestId('detail-revision-id')).toContainText('REQ-001-R2');
    await expect(page.getByTestId('detail-review-badge')).toHaveText('ACCEPTED');

    // Verify row in requirement list also reflects successor revision and ACCEPTED badge
    const req1Row = page.locator('[data-testid="requirement-row"][data-requirement-id="REQ-001"]');
    await expect(req1Row.locator('[data-testid="req-row-revision-badge"]')).toHaveText(
      'REQ-001-R2'
    );
    await expect(req1Row.locator('[data-testid="req-row-review-badge"]')).toHaveText('ACCEPTED');

    // Verify reconciliation history records the action
    const history = page.getByTestId('reconciliation-history');
    await expect(history).toContainText('produced revision REQ-001-R2');
    await expect(history).toContainText('Accepted per compliance audit');
  });

  test('3. Revises requirement, resetting reviewState to PENDING, and preserves attached findings from prior revisions', async ({
    page
  }) => {
    await page.goto('/review');

    // Select REQ-003 (which has finding FIND-001 attached to its initial revision REQ-003-R1)
    await page.locator('[data-testid="requirement-row"][data-requirement-id="REQ-003"]').click();
    await expect(page.getByTestId('detail-requirement-id')).toHaveText('REQ-003');
    await expect(page.getByTestId('detail-revision-id')).toContainText('REQ-003-R1');

    // Verify FIND-001 is visible in FindingsPanel
    const findingItem = page.locator('[data-testid="finding-item"][data-finding-id="FIND-001"]');
    await expect(findingItem).toBeVisible();
    await expect(findingItem.getByTestId('finding-rationale')).toContainText(
      'Maintenance portal requires 60-minute session duration'
    );

    // Open Revise form
    await page.getByTestId('open-revise-form-btn').click();
    const reviseForm = page.getByTestId('action-form-revise');
    await expect(reviseForm).toBeVisible();

    // Modify statement
    await page
      .getByTestId('revise-statement-input')
      .fill(
        'User sessions must expire after 30 minutes of inactivity across all internal web portals.'
      );

    // Submit button is disabled until rationale is provided
    const submitBtn = page.getByTestId('submit-action-btn');
    await expect(submitBtn).toBeDisabled();

    await page
      .getByTestId('action-rationale-input')
      .fill('Extended inactivity threshold to 30 minutes to reduce maintenance friction');
    await expect(submitBtn).toBeEnabled();

    // Submit revise
    await submitBtn.click();

    // Verify revision advances to REQ-003-R2
    await expect(page.getByTestId('detail-revision-id')).toContainText('REQ-003-R2');
    await expect(page.getByTestId('detail-review-badge')).toHaveText('PENDING REVIEW');
    await expect(page.getByTestId('detail-statement')).toContainText('30 minutes of inactivity');

    // CRITICAL REGRESSION ASSERTION (Architecture Review Finding 1):
    // FIND-001 (which was attached to REQ-003-R1) MUST STILL BE VISIBLE under REQ-003-R2!
    await expect(
      page.locator('[data-testid="finding-item"][data-finding-id="FIND-001"]')
    ).toBeVisible();
  });

  test('4. Resolves conflicted requirement through application layer', async ({ page }) => {
    await page.goto('/review');

    // Select REQ-003
    await page.locator('[data-testid="requirement-row"][data-requirement-id="REQ-003"]').click();

    // Open Resolve form
    await page.getByTestId('open-resolve-form-btn').click();
    await page
      .getByTestId('action-rationale-input')
      .fill('Resolved conflict after security architect sign-off on 30 min window.');
    await page.getByTestId('submit-action-btn').click();

    // Verify resolutionState is now CLEAR
    await expect(page.getByTestId('detail-resolution-badge')).toHaveText('CLEAR');
  });

  test('5. Dispositions and reopens a candidate finding through the application layer', async ({
    page
  }) => {
    await page.goto('/review');

    // Select REQ-003
    await page.locator('[data-testid="requirement-row"][data-requirement-id="REQ-003"]').click();

    const findingItem = page.locator('[data-testid="finding-item"][data-finding-id="FIND-001"]');
    await expect(findingItem).toBeVisible();

    // Open disposition action
    await findingItem.getByTestId('toggle-finding-action-btn').click();

    // Select ACCEPTED_RISK
    await findingItem.getByTestId('finding-disposition-select').selectOption('ACCEPTED_RISK');

    // Apply button disabled without rationale
    const applyBtn = findingItem.getByTestId('apply-disposition-btn');
    await expect(applyBtn).toBeDisabled();

    await findingItem
      .getByTestId('finding-rationale-input')
      .fill('Risk accepted by InfoSec director for maintenance portal.');
    await expect(applyBtn).toBeEnabled();

    await applyBtn.click();

    // Verify finding disposition badge updates
    await expect(findingItem.getByTestId('finding-disposition-badge')).toHaveText('ACCEPTED RISK');

    // Now Reopen the finding
    await findingItem.getByTestId('toggle-finding-action-btn').click();
    await findingItem
      .getByTestId('reopen-rationale-input')
      .fill('Reopening finding following annual compliance reassessment.');
    await findingItem.getByTestId('reopen-finding-btn').click();

    // Verify finding is back to OPEN
    await expect(findingItem.getByTestId('finding-disposition-badge')).toHaveText('OPEN');
  });

  test('6. Rejects a pending requirement through application layer', async ({ page }) => {
    await page.goto('/review');

    // REQ-003 is currently PENDING (after revise in earlier test, or select REQ-001/REQ-003)
    await page.locator('[data-testid="requirement-row"][data-requirement-id="REQ-003"]').click();

    await page.getByTestId('open-reject-form-btn').click();
    await page
      .getByTestId('action-rationale-input')
      .fill('Rejected proposal in favor of enterprise SSO timeout standard.');
    await page.getByTestId('submit-action-btn').click();

    await expect(page.getByTestId('detail-review-badge')).toHaveText('REJECTED');
  });

  test('7. Detects stale revision conflict and displays actionable error banner without silent corruption', async ({
    page,
    request
  }) => {
    await page.goto('/review');

    // Select REQ-002 (currently at REQ-002-R1)
    await page.locator('[data-testid="requirement-row"][data-requirement-id="REQ-002"]').click();
    await expect(page.getByTestId('detail-revision-id')).toContainText('REQ-002-R1');

    // Behind the browser's back, mutate REQ-002 on the server using direct HTTP POST
    const reviseRes = await request.post(
      'http://localhost:4000/api/requirements/REQ-002-R1/revise',
      {
        data: {
          statement: 'Mutated statement from concurrent reviewer',
          rationale: 'Concurrent edit from automated background agent'
        }
      }
    );
    expect(reviseRes.status()).toBe(200);
    const revisedData = await reviseRes.json();
    const successorId = revisedData.id; // e.g. REQ-002-R2

    // Now, in the browser (which still has REQ-002-R1 loaded), attempt an action
    await page.getByTestId('open-revise-form-btn').click();
    await page
      .getByTestId('action-rationale-input')
      .fill('Reviewer attempting edit against superseded R1');
    await page.getByTestId('submit-action-btn').click();

    // Verify ErrorBanner appears with STALE_REVISION_TARGET
    const errorBanner = page.getByTestId('review-error-banner');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner.getByTestId('error-code-badge')).toHaveText('STALE_REVISION_TARGET');
    await expect(errorBanner.getByTestId('error-message-text')).toContainText(successorId);

    // Verify reload recovery affordance works
    await page.getByTestId('reload-latest-btn').click();
    await expect(page.getByTestId('detail-revision-id')).toContainText(successorId);
    await expect(errorBanner).not.toBeVisible();
  });

  test('8. Displays unattached repository-wide findings in AllFindingsPanel (Architecture Review Finding 2)', async ({
    page
  }) => {
    await page.goto('/review');

    // Switch view to "All Findings"
    await page.getByTestId('view-all-findings-btn').click();

    const allFindingsPanel = page.getByTestId('all-findings-panel');
    await expect(allFindingsPanel).toBeVisible();

    // Verify the unattached findings group is displayed
    const unattachedGroup = page.getByTestId('unattached-findings-group');
    await expect(unattachedGroup).toBeVisible();

    // Verify FIND-UNATTACHED-001 is present with its rationale
    const unattachedItem = unattachedGroup.locator(
      '[data-testid="finding-item"][data-finding-id="FIND-UNATTACHED-001"]'
    );
    await expect(unattachedItem).toBeVisible();
    await expect(unattachedItem.getByTestId('finding-rationale')).toContainText(
      'Emergency break-glass access procedure is unspecified'
    );
  });
});
