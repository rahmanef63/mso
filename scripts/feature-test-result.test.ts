import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("per-feature evidence classification", () => {
  const cases = [
    [0, { success: true, numTotalTests: 3, numPassedTests: 3 }, "PASS"],
    [0, { success: true, numTotalTests: 3, numPassedTests: 0, numPendingTests: 3 }, "SKIPPED"],
    [0, { success: true, numTotalTests: 3, numPassedTests: 2, numPendingTests: 1 }, "PARTIAL"],
    [0, { success: true, numTotalTests: 3, numPassedTests: 2, numTodoTests: 1 }, "PARTIAL"],
    [0, { success: true, numTotalTests: 0, numPassedTests: 0 }, "FAIL"],
    [1, { success: false, numTotalTests: 3, numPassedTests: 2, numFailedTests: 1 }, "FAIL"],
    [null, {}, "FAIL"],
    [0, { success: true, numTotalTests: 3, numPassedTests: 2, numFailedTests: 1 }, "FAIL"],
  ] as const;
  for (const [code, result, expected] of cases) {
    it(`classifies ${JSON.stringify(result)} as ${expected}`, () => {
      const script = `import { classifyFeatureResult } from "./scripts/lib/feature-test-result.mjs"; console.log(classifyFeatureResult(${JSON.stringify(code)}, ${JSON.stringify(result)}));`;
      const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: process.cwd(), encoding: "utf8" });
      expect(run.status).toBe(0); expect(run.stdout.trim()).toBe(expected);
    });
  }
});
