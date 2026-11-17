import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertBunRuntime, BUN_RUNTIME_RANGE, checkPackageManagerPin, supportedBunVersion } from "./check-bun-version.mjs";

describe("one supported Bun runtime contract", () => {
  it.each([
    ["1.3.14", false], ["1.4.1", false], ["1.4.2", true], ["1.4.4", true],
    ["1.10.0", true], ["2.0.0", false], ["1.4.2-canary.1", true],
    ["1.4", false], ["abc", false], ["", false],
  ])("checks %s", (version, accepted) => {
    expect(supportedBunVersion(version)).toBe(accepted);
  });

  it("keeps the packageManager pin inside the advertised range", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.engines.bun).toBe(BUN_RUNTIME_RANGE);
    expect(pkg.packageManager.startsWith("bun@")).toBe(true);
    expect(() => checkPackageManagerPin(pkg)).not.toThrow();
  });

  it("fails closed when bun is absent or too old", () => {
    expect(() => assertBunRuntime(undefined)).toThrow(/requires bun/);
    expect(() => assertBunRuntime("1.3.14")).toThrow(/found 1\.3\.14/);
    expect(() => assertBunRuntime("1.4.2")).not.toThrow();
  });
});
