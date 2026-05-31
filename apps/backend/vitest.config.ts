import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the workspace package to its TS source (tsx/tsc use tsconfig
      // paths; Vitest/Vite needs the alias declared explicitly).
      '@solstice/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    // Background fetchers / timers in singletons can keep handles open;
    // tests clean up after themselves but this keeps CI from hanging.
    teardownTimeout: 2000,
  },
});
