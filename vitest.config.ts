import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // The ops modules import "server-only", which throws outside a React
      // Server Component build. Alias it to an empty stub so unit tests can
      // import the orchestrator and config directly.
      "server-only": `${root}test/stubs/server-only.ts`,
      "@": `${root}src`,
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
