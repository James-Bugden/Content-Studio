import { defineConfig } from '@playwright/test';
import base from './playwright.config';
// Development-only fallback for a shared node_modules junction. Inherit the
// repository Chromium projects, fixtures, widths, timeouts and motion settings.
// This does not replace acceptance against a production build.

const port = Number(process.env.CS_E2E_PORT ?? 3264);
export default defineConfig({
  ...base,
  testMatch: '**/image-transfer.spec.ts',
  projects: base.projects?.filter(project => ['w375', 'w1280'].includes(project.name ?? '')),
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `node node_modules/next/dist/bin/next dev --webpack --port ${port} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${port}/api/library/SYN-L012/render`,
    reuseExistingServer: false,
    timeout: 300000,
    env: { CS_DATA_MODE: 'fake', CS_CONTENT_STORE: 'sheet', CS_TEST_MODE: 'e2e', CS_FAKE_TODAY: '2026-09-30', AI_PROVIDER: 'fake', AUTH_SECRET: 'e2e-only-auth-secret-not-a-real-value-000000', APP_BASE_URL: `http://127.0.0.1:${port}` }
  }
});
