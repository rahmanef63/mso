import fs from "node:fs";
import { createRequire } from "node:module";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { checkTestToolchain, validateTestToolchain } from "./check-test-toolchain.mjs";

const require = createRequire(import.meta.url);
describe("test toolchain release boundary", () => {
  it("accepts only matching installed runner and coverage versions", () => {
    expect(validateTestToolchain({ version: "5.0.0" }, { version: "5.0.0" })).toBe("5.0.0");
    expect(checkTestToolchain()).toBe(require("vitest/package.json").version);
  });
  it.each(["4.1.11", "5.0.1"])("rejects a mismatched coverage version %s", version => {
    expect(() => validateTestToolchain({ version: "5.0.0" }, { version })).toThrow("Update both together");
  });
  it("fails closed on absent package metadata", () => {
    expect(() => validateTestToolchain({}, null)).toThrow("install the committed lockfile");
  });
  it("runs the version guard before both canonical test commands", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    for (const name of ["test", "coverage"]) expect(pkg.scripts[name]).toMatch(/^node scripts\/check-test-toolchain\.mjs && vitest run/);
  });
  it("keeps Node typings on the supported baseline and groups the test runner with its providers", () => {
    const baseline = fs.readFileSync(".nvmrc", "utf8").trim().replace(/^v/, "").split(".")[0];
    expect(require("@types/node/package.json").version.split(".")[0]).toBe(baseline);
    const config = parse(fs.readFileSync(".github/dependabot.yml", "utf8"));
    const bun = config.updates.find((row: { "package-ecosystem": string }) => row["package-ecosystem"] === "bun");
    expect(bun.groups["test-toolchain"].patterns).toEqual(["vitest", "@vitest/*"]);
    expect(bun.groups["development-minor-patch"]["exclude-patterns"]).toEqual(expect.arrayContaining(["vitest", "@vitest/*"]));
    expect(bun.ignore).toContainEqual({ "dependency-name": "@types/node", "update-types": ["version-update:semver-major"] });
  });
});
