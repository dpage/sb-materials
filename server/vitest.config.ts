import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/types.d.ts', 'src/index.ts', 'src/db/import-samples.ts', 'src/__tests__/**'],
    },
    setupFiles: [],
  },
});
