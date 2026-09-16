import { test, expect } from '@playwright/test';

test.describe('Prototype Sandbox Tracer (Phase 0 Spike B)', () => {
  test.beforeEach(async ({ page }) => {
    // Set a synthetic host-level cookie and localStorage item to verify isolation
    await page.goto('/dev/sandbox');
    await page.evaluate(() => {
      document.cookie = 'host-session-token=secret-host-credential-xyz; path=/';
      localStorage.setItem('host-auth-token', 'bearer-token-12345');
    });
  });

  test('1. Compiles TSX client-side and renders component in sandboxed iframe', async ({ page }) => {
    // Verify host application header
    await expect(page.getByTestId('page-title')).toBeVisible();

    // Verify sandbox transitions to RENDERED
    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('RENDERED', { timeout: 10000 });

    // Verify iframe attributes strictly enforce isolation
    const iframeElement = page.locator('iframe[data-testid="sandbox-iframe"]');
    await expect(iframeElement).toHaveAttribute('sandbox', 'allow-scripts');

    // Verify component rendered inside iframe
    const iframe = page.frameLocator('iframe[data-testid="sandbox-iframe"]');
    await expect(iframe.getByTestId('counter-title')).toHaveText('Interactive Counter');
    await expect(iframe.getByTestId('counter-value')).toHaveText('0');
  });

  test('2. Updates local React state on user interaction inside sandbox', async ({ page }) => {
    const iframe = page.frameLocator('iframe[data-testid="sandbox-iframe"]');

    // Wait for initial render
    await expect(iframe.getByTestId('counter-value')).toHaveText('0', { timeout: 10000 });

    // Click increment twice
    await iframe.getByTestId('increment-btn').click();
    await expect(iframe.getByTestId('counter-value')).toHaveText('1');

    await iframe.getByTestId('increment-btn').click();
    await expect(iframe.getByTestId('counter-value')).toHaveText('2');

    // Click reset
    await iframe.getByTestId('reset-btn').click();
    await expect(iframe.getByTestId('counter-value')).toHaveText('0');
  });

  test('3. Renders validation behavior derived from PRD synthetic business rule', async ({ page }) => {
    // Switch to Valve Inspection fixture
    await page.selectOption('[data-testid="fixture-selector"]', 'valve-inspection');
    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('RENDERED', { timeout: 10000 });

    const iframe = page.frameLocator('iframe[data-testid="sandbox-iframe"]');

    // Wait for form to render
    await expect(iframe.getByTestId('form-title')).toHaveText('Valve Inspection & Pressure Check');
    await expect(iframe.getByTestId('validation-success')).toBeVisible();

    // Input out-of-range value (350 PSI < 450 PSI)
    const pressureInput = iframe.getByTestId('pressure-input');
    await pressureInput.fill('350');

    // Validation warning must trigger immediately
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

  test('4. Captures compile errors and surfaces them in structured form without crashing host', async ({ page }) => {
    // Switch to broken syntax fixture
    await page.selectOption('[data-testid="fixture-selector"]', 'compile-error');

    // Host status should reflect COMPILE_ERROR
    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('COMPILE_ERROR', { timeout: 10000 });

    // Host must display structured compile error banner
    const errorBanner = page.locator('[data-testid="sandbox-compile-error-banner"]');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('Compile Error');

    // Verify host application shell remains responsive
    await expect(page.getByTestId('page-title')).toBeVisible();
  });

  test('5. Captures runtime errors via ErrorBoundary without corrupting host application', async ({ page }) => {
    // Switch to runtime error fixture
    await page.selectOption('[data-testid="fixture-selector"]', 'runtime-error');

    // Host status should reflect RUNTIME_ERROR
    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('RUNTIME_ERROR', { timeout: 10000 });

    // Host must display structured runtime error banner
    const errorBanner = page.locator('[data-testid="sandbox-runtime-error-banner"]');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('Synthetic render failure');

    // Host application must not be crashed
    await expect(page.getByTestId('page-title')).toBeVisible();
  });

  test('6. Enforces parent DOM isolation (sandboxed code cannot access parent document)', async ({ page }) => {
    // Switch to parent DOM escape security probe
    await page.selectOption('[data-testid="fixture-selector"]', 'security-dom');
    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('RENDERED', { timeout: 10000 });

    const iframe = page.frameLocator('iframe[data-testid="sandbox-iframe"]');

    // Verify isolation status
    await expect(iframe.getByTestId('dom-isolation-status')).toHaveText('BLOCKED', { timeout: 10000 });
    await expect(iframe.getByTestId('dom-probe-result')).toContainText('ISOLATION ENFORCED');
  });

  test('7. Enforces storage isolation (sandboxed code cannot read host cookies or localStorage)', async ({ page }) => {
    // Switch to storage theft security probe
    await page.selectOption('[data-testid="fixture-selector"]', 'security-storage');
    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('RENDERED', { timeout: 10000 });

    const iframe = page.frameLocator('iframe[data-testid="sandbox-iframe"]');

    // Verify storage & cookie isolation status
    await expect(iframe.getByTestId('storage-isolation-status')).toHaveText('ISOLATED', { timeout: 10000 });
    await expect(iframe.getByTestId('cookie-probe-result')).toContainText('ISOLATION ENFORCED');
    await expect(iframe.getByTestId('storage-probe-result')).toContainText('ISOLATION ENFORCED');
  });

  test('8. Enforces network isolation (CSP connect-src none blocks outbound network requests)', async ({ page }) => {
    // Switch to network exfiltration security probe
    await page.selectOption('[data-testid="fixture-selector"]', 'security-network');
    const statusBadge = page.locator('[data-testid="sandbox-status-badge"]');
    await expect(statusBadge).toHaveText('RENDERED', { timeout: 10000 });

    const iframe = page.frameLocator('iframe[data-testid="sandbox-iframe"]');

    // Verify network isolation status
    await expect(iframe.getByTestId('network-isolation-status')).toHaveText('BLOCKED', { timeout: 10000 });
    await expect(iframe.getByTestId('network-probe-result')).toContainText('CSP ENFORCED');
  });
});
