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
    // Pin the render state: the Polished entrance animation is gated on
    // prefers-reduced-motion, and axe folds animated opacity into contrast.
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'w375', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } } },
    { name: 'w1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    // Bind explicitly to loopback. Besides keeping the synthetic test server
    // private, this avoids Next.js enumerating host network interfaces in
    // restricted CI/container runtimes where that syscall is unavailable.
    command: `npm run build && npm run start -- --port ${PORT} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      CS_DATA_MODE: 'fake',
      CS_TEST_MODE: 'e2e',
      CS_FAKE_TODAY: '2026-09-30',
      AI_PROVIDER: 'fake',
      AUTH_SECRET: 'e2e-only-auth-secret-not-a-real-value-000000',
      APP_BASE_URL: `http://127.0.0.1:${PORT}`,
    },
  },
});
