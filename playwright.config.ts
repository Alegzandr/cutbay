import { defineConfig, devices } from '@playwright/test';

/**
 * E2E suite for the SelfCut editor. Chromium only, and specifically the full
 * Chromium build (`channel: 'chromium'`, new headless mode): the app is built
 * on WebCodecs, and the default Playwright headless shell ships a VideoEncoder
 * that stalls forever - imports would decode but the export test would hang.
 */
export default defineConfig({
  testDir: 'e2e',
  // Video decode/encode dominates test time; keep the budget generous.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // Nearly every test drives WebCodecs, and one of them now loads a 32 MB wasm
  // build of ffmpeg: they contend for the same hardware encoder rather than for
  // CPU, so the default worker count oversubscribes it and the export test times
  // out waiting on a stalled encode. Two workers run the suite in seconds; the
  // unbounded default took over a minute and failed.
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    // The editor localizes via the browser language; pin it so text-based
    // selectors always match the English strings.
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
  webServer: {
    command: 'npm run dev',
    // The editor SPA lives at /app/ (the root serves the static landing page).
    url: 'http://localhost:5173/app/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
