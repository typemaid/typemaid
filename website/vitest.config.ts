import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'site',
          include: ['tests/site/**/*.test.ts'],
          environment: 'node',
          // Builds the site once before reading dist/ (skipped when SKIP_BUILD=1).
          globalSetup: ['tests/site/global-setup.ts'],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.e2e.test.ts'],
          environment: 'node',
          globalSetup: ['tests/site/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // One browser, one server: run the files one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
