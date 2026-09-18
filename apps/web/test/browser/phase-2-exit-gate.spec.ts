import { test, expect } from '@playwright/test';

test.describe('Phase 2.7 — End-to-End Phase 2 Exit Gate Reviewer Journey', () => {
  test('Complete human-visible reviewer journey across review state, evidence inspection, diagram, prototype sandbox, discovery, reconciliation, successor baseline, and staleness verification', async ({
    page
  }) => {
    // ------------------------------------------------------------------------
    // Step 1: Load Requirements Review State for starting baseline BASE-001
    // ------------------------------------------------------------------------
    await page.goto('/review?baselineId=BASE-001');

    const baselineSelector = page.getByTestId('baseline-selector');
    await expect(baselineSelector).toBeVisible();
    await expect(baselineSelector).toHaveValue('BASE-001');

    // ------------------------------------------------------------------------
    // Step 2: Inspect Requirement Evidence & Provenance
    // ------------------------------------------------------------------------
    // Select REQ-002 in requirements list
    const req2Row = page.locator('[data-requirement-id="REQ-002"]');
    await expect(req2Row).toBeVisible();
    await req2Row.click();

    // Verify EvidencePanel displays source revision, locator badge, and excerpt quote
    const evidencePanel = page.getByTestId('evidence-panel');
    await expect(evidencePanel).toBeVisible();
    await expect(evidencePanel).toContainText('SRC-001');
    await expect(evidencePanel).toContainText('sec-2');
    await expect(page.getByTestId('evidence-excerpt-text')).toContainText(
      'Administrative roles must require multi-factor authentication'
    );

    // ------------------------------------------------------------------------
    // Step 3: Inspect Process Diagram Projection from BASELINE-A
    // ------------------------------------------------------------------------
    const projTabBtn = page.getByTestId('view-projections-btn');
    await projTabBtn.click();

    // Select pre-seeded process diagram PROJ-001
    const proj1Option = page.getByTestId('projection-option-PROJ-001');
    await expect(proj1Option).toBeVisible();
    await proj1Option.click();

    // Verify Mermaid viewer and SVG render
    const mermaidViewer = page.getByTestId('mermaid-viewer');
    await expect(mermaidViewer).toBeVisible();
    const mermaidSvg = mermaidViewer.locator('svg');
    await expect(mermaidSvg).toBeVisible();

    // Verify provenance bar
    const provenanceBar = page.getByTestId('projection-provenance-bar');
    await expect(provenanceBar).toBeVisible();
    await expect(page.getByTestId('projection-baseline-id')).toHaveText('BASE-001');
    await expect(page.getByTestId('projection-revisions-list')).toContainText('REQ-002-R1');

    // ------------------------------------------------------------------------
    // Step 4: Inspect & Interact with Interactive Prototype Projection in Sandbox
    // ------------------------------------------------------------------------
    // Select pre-seeded prototype PROJ-002
    const proj2Option = page.getByTestId('projection-option-PROJ-002');
    await expect(proj2Option).toBeVisible();
    await proj2Option.click();

    // Verify PrototypeViewer provenance bar
    await expect(page.getByTestId('projection-baseline-id')).toHaveText('BASE-001');
    await expect(page.getByTestId('projection-revisions-list')).toContainText('REQ-002-R1');

    // Verify SandboxFrame iframe mounts, compiles TSX, and reaches RENDERED status
    const statusBadge = page.getByTestId('sandbox-status-badge');
    await expect(statusBadge).toHaveText('RENDERED', { timeout: 15000 });

    // Test live user interaction inside isolated sandbox iframe
    const sandboxIframe = page.locator('iframe[data-testid="sandbox-iframe"]');
    await expect(sandboxIframe).toBeVisible();
    const frame = sandboxIframe.contentFrame();
    expect(frame).not.toBeNull();
    if (frame) {
      const counterText = frame.getByTestId('counter-value');
      await expect(counterText).toHaveText('Count: 0');
      const incrementBtn = frame.getByTestId('increment-btn');
      await incrementBtn.click();
      await expect(counterText).toHaveText('Count: 1');
    }

    // ------------------------------------------------------------------------
    // Step 5 & 6: Simulate SME Review & Record Non-Authoritative Candidate Discoveries
    // ------------------------------------------------------------------------
    const discoveryPanel = page.getByTestId('prototype-discovery-panel');
    await expect(discoveryPanel).toBeVisible();

    // 6a: Record candidate requirement proposal
    await page.getByTestId('discovery-tab-requirement').click();
    await page
      .getByTestId('discovery-statement-input')
      .fill('All privileged sessions must terminate automatically after 15 minutes of inactivity.');
    await page.getByTestId('discovery-category-select').selectOption('business-rule');
    await page
      .getByTestId('discovery-rationale-input')
      .fill('Discovered unhandled session inactivity timeout during prototype review walkthrough.');
    await page.getByTestId('submit-requirement-discovery-btn').click();
    await expect(page.getByTestId('discovery-success-message')).toBeVisible();

    // 6b: Record candidate defect finding
    await page.getByTestId('discovery-tab-finding').click();
    await page.getByTestId('discovery-finding-type-select').selectOption('missing-authorization');
    const revCheck = page.getByTestId('discovery-affected-rev-REQ-002-R1');
    if (await revCheck.isVisible()) {
      if (!(await revCheck.isChecked())) {
        await revCheck.check();
      }
    }
    await page
      .getByTestId('discovery-finding-rationale-input')
      .fill(
        'Missing authorization boundary for administrative sessions during inactivity timeout.'
      );
    await page.getByTestId('submit-finding-discovery-btn').click();
    await expect(page.getByTestId('discovery-finding-success-message')).toBeVisible();

    // ------------------------------------------------------------------------
    // Step 6c: Verify Non-Authoritative Candidate State in Requirements View
    // ------------------------------------------------------------------------
    const reqTabBtn = page.getByTestId('view-by-requirement-btn');
    await reqTabBtn.click();

    // Locate the newly recorded requirement proposal
    const discoveredReqRow = page.locator(
      '[data-requirement-id]:has-text("All privileged sessions must terminate automatically")'
    );
    await expect(discoveredReqRow).toBeVisible();
    await discoveredReqRow.click();

    // Verify non-authoritative badges: PENDING REVIEW and UNRESOLVED
    await expect(page.getByTestId('detail-review-badge')).toHaveText('PENDING REVIEW');
    await expect(page.getByTestId('detail-resolution-badge')).toHaveText('UNRESOLVED');

    // ------------------------------------------------------------------------
    // Step 7: Human Reconciliation
    // ------------------------------------------------------------------------
    // 7a: Accept candidate requirement proposal
    const openAcceptBtn = page.getByTestId('open-accept-form-btn');
    await expect(openAcceptBtn).toBeVisible();
    await openAcceptBtn.click();
    await page
      .getByTestId('action-rationale-input')
      .fill('Accepted into scope following SME prototype evaluation.');
    await page.getByTestId('submit-action-btn').click();
    await expect(page.getByTestId('detail-review-badge')).toHaveText('ACCEPTED');

    // 7b: Resolve candidate requirement proposal
    const openResolveBtn = page.getByTestId('open-resolve-form-btn');
    await expect(openResolveBtn).toBeVisible();
    await openResolveBtn.click();
    await page
      .getByTestId('action-rationale-input')
      .fill('Verified 15-minute inactivity boundary is unambiguous.');
    await page.getByTestId('submit-action-btn').click();
    await expect(page.getByTestId('detail-resolution-badge')).toHaveText('CLEAR');

    // 7c: Reconcile candidate defect finding
    const allFindingsBtn = page.getByTestId('view-all-findings-btn');
    await allFindingsBtn.click();

    // Locate the newly created missing-authorization finding
    const findingItem = page
      .locator('[data-testid="finding-item"]')
      .filter({ hasText: 'Missing authorization boundary for administrative sessions' });
    await expect(findingItem).toBeVisible();

    // Open finding disposition form
    const toggleActionBtn = findingItem.getByTestId('toggle-finding-action-btn');
    await toggleActionBtn.click();
    await findingItem.getByTestId('finding-disposition-select').selectOption('RESOLVED');
    await findingItem
      .getByTestId('finding-rationale-input')
      .fill('Resolved by defining explicit 15-minute inactivity timeout requirement.');
    await findingItem.getByTestId('apply-disposition-btn').click();

    // Verify finding disposition badge updates to RESOLVED
    await expect(findingItem.getByTestId('finding-disposition-badge')).toHaveText('RESOLVED');

    // ------------------------------------------------------------------------
    // Step 8: Create Immutable Successor Baseline BASE-002
    // ------------------------------------------------------------------------
    const openCreateBaselineBtn = page.getByTestId('open-create-baseline-modal-btn');
    await expect(openCreateBaselineBtn).toBeVisible();
    await openCreateBaselineBtn.click();

    const baselineModal = page.getByTestId('create-baseline-modal');
    await expect(baselineModal).toBeVisible();
    await expect(page.getByTestId('predecessor-baseline-id')).toHaveText('BASE-001');

    const baselineIdInput = page.getByTestId('create-baseline-id-input');
    await expect(baselineIdInput).toHaveValue('BASE-002');

    // Preview lists eligible reconciled revisions
    const previewList = page.getByTestId('create-baseline-revisions-preview');
    await expect(previewList).toContainText('REQ-002-R1');

    const submitBaselineBtn = page.getByTestId('submit-create-baseline-btn');
    await expect(submitBaselineBtn).toBeEnabled();
    await submitBaselineBtn.click();

    // Modal closes and active baseline updates to BASE-002
    await expect(baselineModal).toHaveCount(0);
    await expect(baselineSelector).toHaveValue('BASE-002');

    // ------------------------------------------------------------------------
    // Step 9: Verify Projections & Staleness Detection in Successor Baseline
    // ------------------------------------------------------------------------
    await projTabBtn.click();

    // Prior baseline tags appear on earlier projections PROJ-001 & PROJ-002
    const priorTag1 = page.getByTestId('projection-prior-tag-PROJ-001');
    await expect(priorTag1).toBeVisible();
    await expect(priorTag1).toContainText('BASE-001');

    // Select PROJ-001 in BASE-002 workspace
    await page.getByTestId('projection-option-PROJ-001').click();

    // Verify staleness alert and badge
    const stalenessAlert = page.getByTestId('projection-prior-baseline-alert');
    await expect(stalenessAlert).toBeVisible();
    await expect(stalenessAlert).toContainText('BASE-001');

    const stalenessBadge = page.getByTestId('projection-staleness-badge');
    await expect(stalenessBadge).toBeVisible();
    await expect(stalenessBadge).toContainText('Prior Baseline (BASE-001)');

    // ------------------------------------------------------------------------
    // Step 10: Prove Historical Immutability & Workspace Switching
    // ------------------------------------------------------------------------
    // Switch back to BASE-001 via baseline selector
    await baselineSelector.selectOption('BASE-001');
    await expect(baselineSelector).toHaveValue('BASE-001');

    // In BASE-001 workspace, PROJ-001 is active projection, so staleness alerts disappear
    await projTabBtn.click();
    await page.getByTestId('projection-option-PROJ-001').click();
    await expect(page.getByTestId('projection-staleness-badge')).toHaveCount(0);
    await expect(page.getByTestId('projection-prior-baseline-alert')).toHaveCount(0);

    // Switch to Requirements tab: verify BASE-001 requirements list remains intact
    await reqTabBtn.click();
    await expect(page.getByTestId('detail-requirement-id')).toBeVisible();
  });
});
