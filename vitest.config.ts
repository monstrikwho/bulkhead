import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
          // The extension's own tests need a real VS Code: `pnpm --filter bulkhead test:e2e`.
          exclude: [
            ...configDefaults.exclude,
            '**/*.integration.test.ts',
            'packages/extension/src/test/**',
          ],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/*/test/**/*.integration.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
})
