import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';

const localChromePath = '/home/gary/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const useLocalExecutable = fs.existsSync(localChromePath);

export default defineConfig({
  testDir: './test/browser',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    ...(useLocalExecutable ? { launchOptions: { executablePath: localChromePath } } : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(useLocalExecutable ? { launchOptions: { executablePath: localChromePath } } : {}),
      },
    },
  ],
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:3000/dev/sandbox',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
