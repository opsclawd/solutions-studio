import { test, expect } from '@playwright/test';

test.describe('Prototype Sandbox Tracer (Phase 0 Spike B)', () => {
  test.beforeEach(async ({ page }) => {
    // Set synthetic host-level cookie, localStorage item, and sessionStorage item to verify storage isolation
    await page.goto('/dev/sandbox');
    await page.evaluate(() => {
      document.cookie = 'host-session-token=secret-host-credential-xyz; path=/';
      localStorage.setItem('host-auth-token', 'bearer-token-12345');
      sessionStorage.setItem('host-session-secret', 'top-secret-session-token');
    });
  });

  test('1. Compiles TSX client-side and renders component in sandboxed iframe', async ({
    page
  }) => {
    await expect(page.getByTestId('page-title')).toBeVisible();

    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('RENDERED', { timeout: 10000 });

    const iframeElement = page.locator('iframe[data-testid="sandbox-iframe"]');
    await expect(iframeElement).toHaveAttribute('sandbox', 'allow-scripts');

    const iframe = page.frameLocator('iframe[data-testid="sandbox-iframe"]');
    await expect(iframe.getByTestId('counter-title')).toHaveText('Interactive Counter');
    await expect(iframe.getByTestId('counter-value')).toHaveText('0');
  });

  test('2. Updates local React state on user interaction inside sandbox', async ({ page }) => {
    const iframe = page.frameLocator('iframe[data-testid="sandbox-iframe"]');

    await expect(iframe.getByTestId('counter-value')).toHaveText('0', { timeout: 10000 });

    await iframe.getByTestId('increment-btn').click();
    await expect(iframe.getByTestId('counter-value')).toHaveText('1');

    await iframe.getByTestId('increment-btn').click();
    await expect(iframe.getByTestId('counter-value')).toHaveText('2');

    await iframe.getByTestId('reset-btn').click();
    await expect(iframe.getByTestId('counter-value')).toHaveText('0');
  });

  test('3. Renders validation behavior derived from PRD synthetic business rule', async ({
    page
  }) => {
    await page.selectOption('[data-testid="fixture-selector"]', 'valve-inspection');
    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('RENDERED', { timeout: 10000 });

    const iframe = page.frameLocator('iframe[data-testid="sandbox-iframe"]');

    await expect(iframe.getByTestId('form-title')).toHaveText('Valve Inspection & Pressure Check');
    await expect(iframe.getByTestId('validation-success')).toBeVisible();

    // Input out-of-range value (350 PSI < 450 PSI)
    const pressureInput = iframe.getByTestId('pressure-input');
    await pressureInput.fill('350');

    const warning = iframe.getByTestId('validation-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('outside safe operating range');
    await expect(iframe.getByTestId('submit-btn')).toBeDisabled();

    // Input in-range value (600 PSI)
    await pressureInput.fill('600');
    await expect(warning).not.toBeVisible();
    await expect(iframe.getByTestId('validation-success')).toBeVisible();
    await expect(iframe.getByTestId('submit-btn')).toBeEnabled();

    // Submit form and verify status update
    await iframe.getByTestId('submit-btn').click();
    await expect(iframe.getByTestId('submit-confirmation')).toBeVisible();
    await expect(iframe.getByTestId('status-badge')).toHaveText('SUBMITTED');
  });

  test('4. Captures compile errors and surfaces them in structured form without crashing host', async ({
    page
  }) => {
    await page.selectOption('[data-testid="fixture-selector"]', 'compile-error');

    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('COMPILE_ERROR', { timeout: 10000 });

    const errorBanner = page.locator('[data-testid="sandbox-compile-error-banner"]');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('Compile Error');

    await expect(page.getByTestId('page-title')).toBeVisible();
  });

  test('5. Captures runtime errors via ErrorBoundary without corrupting host application', async ({
    page
  }) => {
    await page.selectOption('[data-testid="fixture-selector"]', 'runtime-error');

    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('RUNTIME_ERROR', { timeout: 10000 });

    const errorBanner = page.locator('[data-testid="sandbox-runtime-error-banner"]');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('Synthetic render failure');

    await expect(page.getByTestId('page-title')).toBeVisible();
  });

  test('6. Enforces parent DOM isolation (sandboxed code cannot access parent document)', async ({
    page
  }) => {
    await page.selectOption('[data-testid="fixture-selector"]', 'security-dom');
    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('RENDERED', { timeout: 10000 });

    const iframe = page.frameLocator('iframe[data-testid="sandbox-iframe"]');
    await expect(iframe.getByTestId('dom-isolation-status')).toHaveText('BLOCKED', {
      timeout: 10000
    });
    await expect(iframe.getByTestId('dom-probe-result')).toContainText('ISOLATION ENFORCED');
  });

  test('7. Enforces storage isolation (sandboxed code cannot read host cookies, localStorage, or sessionStorage)', async ({
    page
  }) => {
    await page.selectOption('[data-testid="fixture-selector"]', 'security-storage');
    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('RENDERED', { timeout: 10000 });

    const iframe = page.frameLocator('iframe[data-testid="sandbox-iframe"]');
    await expect(iframe.getByTestId('storage-isolation-status')).toHaveText('ISOLATED', {
      timeout: 10000
    });
    await expect(iframe.getByTestId('cookie-probe-result')).toContainText('ISOLATION ENFORCED');
    await expect(iframe.getByTestId('storage-probe-result')).toContainText('ISOLATION ENFORCED');
    await expect(iframe.getByTestId('session-storage-probe-result')).toContainText(
      'ISOLATION ENFORCED'
    );
  });

  test('8. Enforces multi-vector network and navigation isolation across all probe vectors', async ({
    page
  }) => {
    await page.selectOption('[data-testid="fixture-selector"]', 'security-network');
    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('RENDERED', { timeout: 10000 });

    const iframe = page.frameLocator('iframe[data-testid="sandbox-iframe"]');

    // Verify each probe vector is individually blocked
    await expect(iframe.getByTestId('probe-fetch-status')).toHaveText('BLOCKED', {
      timeout: 10000
    });
    await expect(iframe.getByTestId('probe-xhr-status')).toHaveText('BLOCKED', { timeout: 10000 });
    await expect(iframe.getByTestId('probe-beacon-status')).toHaveText('BLOCKED', {
      timeout: 10000
    });
    await expect(iframe.getByTestId('probe-image-status')).toHaveText('BLOCKED', {
      timeout: 10000
    });
    await expect(iframe.getByTestId('probe-script-status')).toHaveText('BLOCKED', {
      timeout: 10000
    });
    await expect(iframe.getByTestId('probe-topnav-status')).toHaveText('BLOCKED', {
      timeout: 10000
    });

    // Verify overall composite exfiltration boundary
    await expect(iframe.getByTestId('network-isolation-status')).toHaveText(
      'ALL_EXFILTRATION_BLOCKED'
    );
  });

  test('9. Terminates synchronous infinite loops via AST compiler guard without freezing host', async ({
    page
  }) => {
    await page.selectOption('[data-testid="fixture-selector"]', 'infinite-loop');

    // Synchronous loop guard terminates execution and ErrorBoundary reports RUNTIME_ERROR
    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('RUNTIME_ERROR', { timeout: 10000 });

    const errorBanner = page.locator('[data-testid="sandbox-runtime-error-banner"]');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('Infinite loop detected');

    // Verify host application shell remains responsive
    await expect(page.getByTestId('page-title')).toBeVisible();
  });

  test('10. Recovers from asynchronous component hangs via host execution timeout and iframe teardown', async ({
    page
  }) => {
    await page.selectOption('[data-testid="fixture-selector"]', 'async-hang');

    // Host arms timeout timer (4000ms), transitions to TIMEOUT, and tears down the iframe
    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('TIMEOUT', { timeout: 10000 });

    // Verify host application shell remains responsive
    await expect(page.getByTestId('page-title')).toBeVisible();

    // Verify recovery: switch back to Counter fixture, host recreates iframe, and component renders normally
    await page.selectOption('[data-testid="fixture-selector"]', 'counter');
    await expect(statusBadge).toHaveText('RENDERED', { timeout: 10000 });

    const iframe = page.frameLocator('iframe[data-testid="sandbox-iframe"]');
    await expect(iframe.getByTestId('counter-title')).toHaveText('Interactive Counter');
    await expect(iframe.getByTestId('counter-value')).toHaveText('0');
  });

  test('11. Enforces private MessagePort exclusivity: generated code cannot discover script secrets and host drops spoofed window.parent messages', async ({
    page
  }) => {
    await page.selectOption('[data-testid="fixture-selector"]', 'security-spoofing');

    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('RENDERED', { timeout: 10000 });

    const iframe = page.frameLocator('iframe[data-testid="sandbox-iframe"]');
    await expect(iframe.getByTestId('spoof-probe-container')).toBeVisible();

    // 1. Verify zero tokens or secrets exist in DOM script tags
    await expect(iframe.getByTestId('spoof-tokens-found')).toHaveText('0');

    // 2. Verify spoofed window.parent.postMessages were dispatched by generated code
    await expect(iframe.getByTestId('spoof-attempted')).toHaveText('true');
    await expect(iframe.getByTestId('spoof-probe-status')).toContainText(
      'MessagePort security probe active'
    );

    // 3. Verify host ignored spoofed SANDBOX_RUNTIME_ERROR ("FORGED_MALICIOUS_ERROR") and remained in RENDERED state
    await expect(statusBadge).toHaveText('RENDERED');
    await expect(page.locator('[data-testid="sandbox-runtime-error-boundary"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="error-message"]')).toHaveCount(0);

    // 4. Verify host ignored spoofed SANDBOX_RENDERED (renderTimeMs: 999999) and accepted only authoritative port render time (< 5000ms)
    const renderTimeBadge = page.locator('[data-testid="render-time-badge"]');
    await expect(renderTimeBadge).toBeVisible();
    const renderTimeText = await renderTimeBadge.textContent();
    expect(renderTimeText).not.toContain('999999ms');

    // 5. Direct host-level spoof attempt verification:
    // Even if external/untrusted scripts post spoofed lifecycle messages directly to the host window,
    // the host rejects them because authoritative lifecycle events must arrive strictly on the private MessagePort.
    await page.evaluate(() => {
      window.postMessage(
        {
          source: 'solutions-studio-sandbox',
          version: 'solutions-studio-sandbox-v1',
          type: 'SANDBOX_RUNTIME_ERROR',
          executionId: 1,
          error: { message: 'EXTERNAL_WINDOW_SPOOF_ATTEMPT' }
        },
        '*'
      );
    });

    // Host status remains RENDERED, completely ignoring the window-level spoof attempt
    await page.waitForTimeout(200);
    await expect(statusBadge).toHaveText('RENDERED');
  });

  test('12. Enforces prototype poisoning immunity: overriding MessagePort.prototype.postMessage cannot intercept privatePort or alter lifecycle traffic', async ({
    page
  }) => {
    await page.selectOption('[data-testid="fixture-selector"]', 'security-prototype-poisoning');

    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('RENDERED', { timeout: 10000 });

    const iframe = page.frameLocator('iframe[data-testid="sandbox-iframe"]');
    await expect(iframe.getByTestId('prototype-poisoning-probe')).toBeVisible();

    // 1. Verify poisoning was attempted by the component
    await expect(iframe.getByTestId('poisoning-attempted')).toHaveText('true');

    // 2. Verify intercepted lifecycle calls via poisoned prototype is 0 (the harness uses bound native intrinsic)
    await expect(iframe.getByTestId('intercepted-calls-count')).toHaveText('0');
    await expect(iframe.getByTestId('captured-port-detected')).toHaveText('false');
    await expect(iframe.getByTestId('poisoning-probe-status')).toContainText(
      'Prototype poisoning defeated'
    );

    // 3. Verify that the private MessagePort instance was NEVER exposed to attacker
    const capturedPort = await iframe
      .locator('[data-testid="prototype-poisoning-probe"]')
      .evaluate(() => {
        return !!(window as any).__capturedPortInstance;
      });
    expect(capturedPort).toBe(false);

    // 4. Verify host successfully received authentic SANDBOX_RENDERED event despite prototype mutation
    await expect(statusBadge).toHaveText('RENDERED');
    const renderTimeBadge = page.locator('[data-testid="render-time-badge"]');
    await expect(renderTimeBadge).toBeVisible();
  });
});
