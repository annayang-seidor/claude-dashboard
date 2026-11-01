import { defineConfig, devices } from '@playwright/test';
import { E2E_ORIGIN } from './e2e/support/env';

// ADR 0021: header specs run against the Vite dev server (no API needed).
// ADR 0028: the smoke spec runs against the real server on a temp copy of the fixtures.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5173',
  },
  webServer: [
    {
      command: 'pnpm exec vite',
      url: 'http://127.0.0.1:5173/work',
      reuseExistingServer: true,
    },
    {
      // A fresh build and a fresh fixture copy every run, so the smoke never sees stale state.
      command: 'pnpm build && pnpm exec tsx e2e/support/server.ts',
      url: `${E2E_ORIGIN}/work`,
      reuseExistingServer: false,
      stdout: 'pipe',
      timeout: 60_000,
      // SIGTERM lets e2e/support/server.ts delete its temp copy; the default kill would not.
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    },
  ],
});
