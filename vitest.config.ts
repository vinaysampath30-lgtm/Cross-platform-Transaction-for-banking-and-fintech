import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./backend/tests/setup.ts"],
    include: ["backend/tests/**/*.test.ts"],
    deps: {
      // Force vitest to use the workspace node_modules — fixes pnpm hoisting issues
      interopDefault: true,
    },
    resolve: {
      // Tell vitest to look for modules in the workspace root
      conditions: ["node", "import", "module"],
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/**",
        "backend/tests/**",
        "client/**",
        "dist/**",
      ],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
