import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@curator/core": resolve(rootDir, "packages/core/src/index.ts"),
      "@curator/db": resolve(rootDir, "packages/db/src/index.ts"),
      "@curator/providers": resolve(rootDir, "packages/providers/src/index.ts"),
      "@curator/ai": resolve(rootDir, "packages/ai/src/index.ts"),
      "@curator/telegram": resolve(rootDir, "packages/telegram/src/index.ts"),
      "@curator/wordpress": resolve(rootDir, "packages/wordpress/src/index.ts"),
      "@curator/media": resolve(rootDir, "packages/media/src/index.ts"),
      "@curator/scheduler": resolve(rootDir, "packages/scheduler/src/index.ts"),
      "@curator/observability": resolve(rootDir, "packages/observability/src/index.ts")
    }
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    passWithNoTests: false,
    coverage: { reporter: ["text", "html"] }
  }
});
