import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'drizzle/**',
        '**/*.d.ts',
        '**/*.config.{js,ts}',
        '**/index.ts',
      ],
      thresholds: {
        // Critical paths: auth module
        'src/lib/auth.ts': {
          statements: 60,
          branches: 50,
          functions: 50,
          lines: 60,
        },
        // WebSocket - partial coverage for now, improve over time
        'src/websocket/**': {
          statements: 50,
          branches: 15,
          functions: 50,
          lines: 50,
        },
        // Routes - good coverage on security-critical endpoints
        'src/routes/**': {
          statements: 60,
          branches: 60,
          functions: 60,
          lines: 60,
        },
      },
    },
    setupFiles: ['./src/__tests__/setup.ts'],
    testTimeout: 10000,
  },
});
