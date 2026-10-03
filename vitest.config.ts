import { fileURLToPath } from "node:url";

import {
  defineConfig,
} from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(
        new URL("./src", import.meta.url)
      ),
    },
  },

  test: {
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src/**/*.spec.ts",
      "src/**/*.spec.tsx",
    ],

    /*
     * DeployGuard stores repositories being assessed
     * beneath .deployguard/.
     *
     * Those repositories are untrusted assessment
     * targets, not part of DeployGuard's own test suite.
     */
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.next/**",
      "**/.deployguard/**",
    ],
  },
});
