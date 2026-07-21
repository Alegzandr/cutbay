import { defineConfig, devices } from '@playwright/test';

/**
 * Production-build checks, run against `vite preview` rather than the dev server.
 *
 * Separate from the main config because what is under test here only exists in a
 * built app: the COOP/COEP service worker is skipped in dev (Vite serves those
 * headers itself), so the dev suite cannot exercise it at all. A worker that sits
 * in front of every response under /app/ is not something to ship unrun.
 *
 * Run with: npx playwright test -c playwright.prod.config.ts
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: /prod-.*\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // The service worker is per-origin state that a second worker would race on.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/app/',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
