import { test, expect } from '@playwright/test';
import type { ProjectionRecordDto } from '@solutions-studio/contracts';
import { createInstant } from '@solutions-studio/domain';

test.describe('Phase 2.5 — Baseline Interactive Prototype Projection & Review', () => {
  test('1. Generates, mounts, and executes interactive prototype in sandbox with provenance metadata', async ({
    page
  }) => {
    // Intercept projection generation
    await page.route('**/api/baselines/*/projections', async (route) => {
      if (route.request().method() === 'POST') {
        const postData = route.request().postDataJSON();
        const artifactType = postData?.artifactType ?? 'prototype';
        const mockProjection: ProjectionRecordDto = {
          id: 'PROJ-MOCK-PROTO-001',
          baselineId: 'BASE-001',
          requirementRevisionIds: ['REQ-002-R1'],
          artifactType,
          content: [
            '/**',
            ' * @baseline BASE-001',
            ' * @requirements REQ-002-R1',
            ' */',
            "import React, { useState } from 'react';",
            '',
            'export default function CounterPrototype() {',
            '  const [count, setCount] = useState(0);',
            '  return (',
            '    <div className="p-6 bg-white rounded-lg border border-gray-200">',
            '      <h2 className="text-sm font-bold text-gray-900 mb-2">Interactive Counter Prototype</h2>',
            '      <p data-testid="counter-value" className="text-xs text-gray-700 font-mono mb-4">',
            '        Count: {count}',
            '      </p>',
            '      <button',
            '        type="button"',
            '        data-testid="increment-btn"',
            '        onClick={() => setCount((c) => c + 1)}',
            '        className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold"',
            '      >',
            '        Increment Counter',
            '      </button>',
            '    </div>',
            '  );',
            '}'
          ].join('\n'),
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
              contentHash: 'mock-proto-content-hash-abcdef123456',
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

    // Switch to Projections view
    const projBtn = page.getByTestId('view-projections-btn');
    await expect(projBtn).toBeVisible();
    await projBtn.click();

    // Select Interactive Prototype (TSX)
    const typeSelect = page.getByTestId('projection-type-select');
    await expect(typeSelect).toBeVisible();
    await typeSelect.selectOption('prototype');

    // Click Generate Projection
    await page.getByTestId('submit-generate-projection-btn').click();

    // Verify projection option appears and select it
    const protoOption = page.getByTestId('projection-option-PROJ-MOCK-PROTO-001');
    await expect(protoOption).toBeVisible({ timeout: 10000 });
    await protoOption.click();

    // Verify PrototypeViewer provenance bar
    const provenanceBar = page.getByTestId('projection-provenance-bar');
    await expect(provenanceBar).toBeVisible();
    await expect(page.getByTestId('projection-baseline-id')).toHaveText('BASE-001');
    await expect(page.getByTestId('projection-revisions-list')).toContainText('REQ-002-R1');
    await expect(page.getByTestId('projection-repairs-needed')).toHaveText('0');
    await expect(page.getByTestId('projection-attempt-count')).toHaveText('1');
    await expect(page.getByTestId('projection-content-hash')).toBeVisible();

    // Verify SandboxFrame iframe loads and reaches RENDERED status
    const statusBadge = page.getByTestId('sandbox-status-badge');
    await expect(statusBadge).toHaveText('RENDERED', { timeout: 15000 });

    // Test live user interaction inside isolated sandboxed iframe
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

    // Test Toggle Raw TSX Code
    const rawCodeBtn = page.getByTestId('toggle-raw-code-btn');
    await expect(page.getByTestId('raw-prototype-code')).toHaveCount(0);
    await rawCodeBtn.click();
    const rawCode = page.getByTestId('raw-prototype-code');
    await expect(rawCode).toBeVisible();
    await expect(rawCode).toContainText('export default function CounterPrototype()');
    await rawCodeBtn.click();
    await expect(page.getByTestId('raw-prototype-code')).toHaveCount(0);

    // Test Export TSX download trigger
    const exportBtn = page.getByTestId('export-prototype-btn');
    await expect(exportBtn).toBeEnabled();
    const downloadPromise = page.waitForEvent('download');
    await exportBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('PROJ-MOCK-PROTO-001.tsx');
  });

  test('2. Records requirement discovery from prototype review and hydrates workspace', async ({
    page
  }) => {
    await page.goto('/review?baselineId=BASE-001');
    await page.getByTestId('view-projections-btn').click();

    // Select pre-seeded prototype projection PROJ-002
    const protoOption = page.getByTestId('projection-option-PROJ-002');
    await expect(protoOption).toBeVisible({ timeout: 10000 });
    await protoOption.click();

    // Verify PrototypeDiscoveryPanel is displayed
    const discoveryPanel = page.getByTestId('prototype-discovery-panel');
    await expect(discoveryPanel).toBeVisible();

    // Submit Requirement Proposal from prototype inspection
    await page.getByTestId('discovery-tab-requirement').click();
    await page
      .getByTestId('discovery-statement-input')
      .fill('Prototype reveals user needs confirmation before submitting final order');
    await page.getByTestId('discovery-category-select').selectOption('business-rule');
    await page
      .getByTestId('discovery-rationale-input')
      .fill('Observed accidental submission during clickable walkthrough');

    await page.getByTestId('submit-requirement-discovery-btn').click();
    await expect(page.getByTestId('discovery-success-message')).toBeVisible();

    // Switch to Requirements tab to assert proposal was recorded
    await page.getByTestId('view-by-requirement-btn').click();
    await expect(page.getByTestId('requirement-list')).toContainText(
      'Prototype reveals user needs confirmation before submitting final order'
    );
  });

  test('3. Records candidate finding from prototype review and verifies open disposition', async ({
    page
  }) => {
    await page.goto('/review?baselineId=BASE-001');
    await page.getByTestId('view-projections-btn').click();

    // Select pre-seeded prototype projection PROJ-002
    const protoOption = page.getByTestId('projection-option-PROJ-002');
    await expect(protoOption).toBeVisible({ timeout: 10000 });
    await protoOption.click();

    // Switch to Finding tab
    await page.getByTestId('discovery-tab-finding').click();
    await page
      .getByTestId('discovery-finding-type-select')
      .selectOption('incomplete-state-machine');

    const revCheck = page.getByTestId('discovery-affected-rev-REQ-002-R1');
    if (await revCheck.isVisible()) {
      if (!(await revCheck.isChecked())) {
        await revCheck.check();
      }
    }

    await page
      .getByTestId('discovery-finding-rationale-input')
      .fill('Prototype demonstrates that error state transitions freeze the form without recovery');

    await page.getByTestId('submit-finding-discovery-btn').click();
    await expect(page.getByTestId('discovery-success-message')).toBeVisible();

    // Switch to All Findings tab
    await page.getByTestId('view-all-findings-btn').click();
    await expect(page.getByTestId('all-findings-panel')).toContainText(
      'Prototype demonstrates that error state transitions freeze the form without recovery'
    );
  });
});
