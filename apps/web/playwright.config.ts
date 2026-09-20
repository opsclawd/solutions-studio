import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  timeout: 30000,
  expect: {
    timeout: 5000
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome']
      }
    }
  ],
  webServer: [
    {
      command:
        'pnpm --filter @solutions-studio/orchestrator exec tsx scripts/seed-review-fixture.ts --out .review-fixture-store && pnpm --filter @solutions-studio/orchestrator exec tsx scripts/run-http-server.ts --store .review-fixture-store --port 4000',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        AUTH_PROVIDER: 'test'
      }
    },
    {
      command: 'pnpm start',
      url: 'http://localhost:3000/dev/sandbox',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        NEXT_PUBLIC_ORCHESTRATOR_URL: 'http://localhost:4000'
      }
    }
  ]
});
