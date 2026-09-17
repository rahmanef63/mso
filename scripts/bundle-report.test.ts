import { describe, expect, it } from "vitest";
import { parseClientManifest, bundleViolations } from "./lib/bundle-report.mjs";

describe("fail-closed production bundle budget", () => {
  it("reads the generated assignment as JSON, without executing scripts", () => {
    expect(parseClientManifest('globalThis.__RSC_MANIFEST = {}; globalThis.__RSC_MANIFEST["/[[...slug]]/page"] = {"entryJSFiles":{}};')).toEqual({ entryJSFiles: {} });
    expect(() => parseClientManifest('process.exit(0)')).toThrow("Unsupported");
    expect(() => parseClientManifest('globalThis.__RSC_MANIFEST["/route"] = {"x":(()=>42)()};')).toThrow();
  });
  it("rejects missing measurements, over-budget bytes and eager heavy engines", () => {
    const report = { initial: { gzip: 100 }, fonts: { bytes: 10 }, initialHeavyModules: [] };
    const budget = { gzipBytes: { initial: 100 }, preloadedFontBytes: 10 };
    expect(bundleViolations(report, budget)).toEqual([]);
    expect(bundleViolations({ ...report, initial: { gzip: 101 } }, budget)).toHaveLength(1);
    expect(bundleViolations({ ...report, initial: null }, budget)).toHaveLength(1);
    expect(bundleViolations({ ...report, fonts: { bytes: 11 }, initialHeavyModules: ["ReactFlow"] }, budget)).toHaveLength(2);
  });
  it("fails closed on missing fonts, missing engine scan and invalid thresholds", () => {
    const report = { initial: { gzip: 10 }, fonts: { bytes: 1 }, initialHeavyModules: [] };
    const budget = { gzipBytes: { initial: 100 }, preloadedFontBytes: 10 };
    expect(bundleViolations({ ...report, fonts: null }, budget)).toContain("preloaded fonts: missing measurement");
    expect(bundleViolations({ ...report, initialHeavyModules: undefined }, budget)).toContain("Missing eager engine scan");
    expect(bundleViolations(report, { ...budget, gzipBytes: { initial: Number.NaN } })).toContain("initial: invalid budget");
    expect(bundleViolations(report, {})).toContain("Missing gzip bundle budgets");
  });

});
