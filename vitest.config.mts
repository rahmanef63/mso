import { defineConfig } from "vitest/config";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const boundedWorkers = Number.parseInt(process.env.VITEST_MAX_WORKERS ?? "", 10);
const maxWorkers =
  Number.isInteger(boundedWorkers) && boundedWorkers > 0
    ? boundedWorkers
    : Math.max(2, Math.min(8, os.availableParallelism?.() ?? os.cpus().length));

export default defineConfig({
  resolve: {
    alias: {
      "next/server": path.join(root, "lib", "http", "next-server-shim.ts"),
      "next/headers": path.join(root, "lib", "http", "next-headers-shim.ts"),
      "server-only": path.join(root, "lib", "http", "server-only-shim.ts"),
      "next/dist/shared/lib/router/utils/relativize-url": path.join(root, "lib", "http", "next-server-shim.ts"),
      "@": root,
    },
  },
  test: {
    testTimeout: 15_000,
    maxWorkers,
    setupFiles: [path.join(root, "vitest.setup.ts")],
    fsModuleCachePath: path.join(root, "node_modules", ".vitest-cache", path.basename(root)),
    exclude: ["**/node_modules/**", "**/.next/**", "**/zz-*", "frontend/svelte/**"],
    include: [
      "app/**/*.test.ts",
      "lib/**/*.test.ts",
      "bin/**/*.test.ts",
      "scripts/**/*.test.ts",
      "proxy.test.ts",
      "proxy-framing.test.ts",
      "proxy-websocket.test.ts",
      "proxy-machine-protocol.test.ts",
      "proxy-font-csp.test.ts",
    ],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["lib/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.d.ts",
        "**/node_modules/**",
      ],
      thresholds: {
        statements: 42,
        branches: 39,
        functions: 32,
        lines: 43,
      },
    },
  },
});
