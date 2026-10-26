import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // The real `server-only` throws outside a bundler. tests/unit/security/boundaries.test.ts
      // enforces the property it exists for (no client module reaches server code).
      'server-only': fileURLToPath(new URL('./tests/support/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    // Run the real Auth.js wrapper through Vite so its Next extensionless
    // imports resolve and next/headers can use a synthetic request context.
    server: { deps: { inline: ['next-auth'] } },
    environment: 'node',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/replies/unit/**/*.test.ts',
      'tests/replies/unit/**/*.test.tsx',
      'tests/integration/**/*.test.ts',
    ],
    setupFiles: ['tests/setup/vitest.setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    maxWorkers: 4,
  },
});
