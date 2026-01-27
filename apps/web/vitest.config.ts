import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{js,ts,jsx,tsx}"],
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "**/*.d.ts",
        "**/*.config.{js,ts}",
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],
      thresholds: {
        // Crypto modules - partial coverage, improve over time
        "src/lib/crypto.ts": {
          statements: 65,
          branches: 65,
          functions: 65,
          lines: 65,
        },
        "src/lib/channelCrypto.ts": {
          statements: 50,
          branches: 50,
          functions: 50,
          lines: 50,
        },
        "src/lib/keyStore.ts": {
          statements: 50,
          branches: 50,
          functions: 50,
          lines: 50,
        },
        // Overall thresholds
        global: {
          statements: 50,
          branches: 50,
          functions: 50,
          lines: 50,
        },
      },
    },
    setupFiles: ["./src/__tests__/setup.ts"],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
