import { defineConfig, devices } from '@playwright/test';

/**
 * Deterministic browser journeys (T1) and synthetic layout checks (T2) against the
 * app in fake-provider mode. Emulated widths are not physical-device evidence.
 */
const PORT = Number(process.env.CS_E2E_PORT ?? 3200);
const SWEEP_ISOLATED = process.env.CS_SWEEP_ISOLATED === '1';
if (SWEEP_ISOLATED && process.env.CS_E2E_PREBUILT !== '1') {
  throw new Error('Build once before starting the isolated sweep servers (CS_E2E_PREBUILT=1).');
}

function server(port: number) {
  return {
    // Each width/group has its own process and mutable fake adapters. Workers
    // share a runner, never a test-control reset or provider fault.
    command: `${process.env.CS_E2E_PREBUILT === '1' ? '' : 'npm run build && '}npm run start -- --port ${port} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: SWEEP_ISOLATED ? false : !process.env.CI,
    timeout: 300_000,
    env: {
      CS_DATA_MODE: 'fake',
      CS_CONTENT_STORE: 'sheet',
      CS_E2E_PORT: String(port),
      CS_TEST_MODE: 'e2e',
      CS_FAKE_TODAY: '2026-09-30',
      AI_PROVIDER: 'fake',
      AUTH_SECRET: 'e2e-only-auth-secret-not-a-real-value-000000',
      APP_BASE_URL: `http://127.0.0.1:${port}`,
    },
  };
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: SWEEP_ISOLATED ? (process.env.CI ? 4 : 2) : 1,
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
    { name: 'w375', testIgnore: ['**/sweep.spec.ts', '**/sweep-faults.spec.ts', '**/content-parity.spec.ts'], use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } } },
    { name: 'w1280', testIgnore: ['**/sweep.spec.ts', '**/sweep-faults.spec.ts', '**/content-parity.spec.ts'], use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    ...[375, 1280].flatMap((width, index) => ['routes', 'faults'].map((group, offset) => ({
      name: group === 'routes' ? `sweep-${width}` : `sweep-fault-${width}`,
      testMatch: group === 'routes' ? '**/sweep.spec.ts' : '**/sweep-faults.spec.ts',
      // Thousands of keyboard/axe DOM snapshots are expensive; per-check JSON
      // and failure screenshots provide sweep evidence without recording them.
      use: { ...devices['Desktop Chrome'], viewport: { width, height: 900 }, trace: 'off' as const,
        ...(SWEEP_ISOLATED ? { baseURL: `http://127.0.0.1:${PORT + index * 2 + offset}` } : {}) },
    }))),
    ...[375, 1280].map(width => ({ name: `shadow-w${width}`, testMatch: '**/content-parity.spec.ts', use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT + 1}`, viewport: { width, height: width === 375 ? 812 : 900 } } })),
  ],
  webServer: SWEEP_ISOLATED ? [0, 1, 2, 3].map((offset) => server(PORT + offset)) : { ...server(PORT), command: 'node scripts/e2e-servers.mjs', url: `http://127.0.0.1:${PORT + 1}/api/health`, reuseExistingServer: false },
});
