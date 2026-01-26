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
        // Critical paths: auth, websocket handlers
        'src/lib/auth.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/websocket/**': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/routes/**': {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
      },
    },
    setupFiles: ['./src/__tests__/setup.ts'],
    testTimeout: 10000,
  },
});
