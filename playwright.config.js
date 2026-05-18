// =============================================================================
// playwright.config.js
// ---------------------------------------------------------------------------
// Minimal Playwright config for the smoke test (tests/smoke.spec.js).
//
// Spins up a tiny Python HTTP server so the page is served from
// http://localhost which triggers BN_IS_LOCALHOST = true and skips the
// Supabase auth gate (the test environment has no Google OAuth).
// =============================================================================

const PORT = 4321;

module.exports = {
  testDir: 'tests',
  timeout: 30 * 1000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['line'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:' + PORT,
    headless: true,
    actionTimeout: 5 * 1000,
    navigationTimeout: 15 * 1000,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `python3 -m http.server ${PORT}`,
    url: 'http://localhost:' + PORT,
    timeout: 10 * 1000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
  ],
};
