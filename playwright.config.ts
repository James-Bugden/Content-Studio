import { defineConfig, devices } from '@playwright/test';

/**
 * Deterministic browser journeys (T1) and synthetic layout checks (T2) against the
 * app in fake-provider mode. Emulated widths are not physical-device evidence.
 */
const PORT = 3200;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'w375', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } } },
    { name: 'w1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      CS_DATA_MODE: 'fake',
      CS_TEST_MODE: 'e2e',
      AI_PROVIDER: 'fake',
      AUTH_SECRET: 'e2e-only-auth-secret-not-a-real-value-000000',
      APP_BASE_URL: `http://127.0.0.1:${PORT}`,
    },
  },
});
