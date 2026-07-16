import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // http-app.ts is thin Express wiring; behavior is covered via mcp-http-handlers + oauth-bridge
      // unit tests and http-app.test.ts smoke coverage outside the threshold include set.
      exclude: ['src/**/*.test.ts', 'src/types.ts', 'src/http-app.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
