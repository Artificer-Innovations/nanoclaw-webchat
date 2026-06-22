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
        lines: 98,
        functions: 98,
        branches: 98,
        statements: 98,
      },
    },
  },
});
