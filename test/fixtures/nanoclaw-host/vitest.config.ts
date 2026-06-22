import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/channels/web.ts',
        'src/webchat-store.ts',
        'src/webchat-sync.ts',
        'src/webchat-routing.ts',
        'src/webchat-mentions.ts',
      ],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        // Adapter tests run in the host fixture; webchat-boot and thread-cleanup
        // are covered by integration/wiring tests rather than unit coverage here.
        lines: 76,
        functions: 88,
        branches: 62,
        statements: 78,
      },
    },
  },
});
