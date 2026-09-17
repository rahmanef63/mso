// Test and coverage packages are one versioned contract, including patch releases.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function validateTestToolchain(runner, coverage) {
  for (const [name, metadata] of [["vitest", runner], ["@vitest/coverage-v8", coverage]]) {
    if (!metadata || typeof metadata.version !== "string" || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(metadata.version)) {
      throw new Error(`Cannot verify ${name} version; install the committed lockfile first.`);
    }
  }
  if (runner.version !== coverage.version) {
    throw new Error(`Unsupported test toolchain: vitest@${runner.version} and @vitest/coverage-v8@${coverage.version}. Update both together and regenerate bun.lock.`);
  }
  return runner.version;
}

export function checkTestToolchain(root = process.cwd()) {
  const require = createRequire(path.join(root, "package.json"));
  return validateTestToolchain(require("vitest/package.json"), require("@vitest/coverage-v8/package.json"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(`test toolchain: matching Vitest/coverage ${checkTestToolchain()}`); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
