import { describe, expect, it } from "vitest";
import { parsePerfReport, summarize } from "./perf-report.mjs";
import { validReport, validRunDesktop, validRunMobile } from "./perf-report.fixtures";

describe("parsePerfReport", () => {
  it("accepts a valid report and returns it unchanged", () => {
    const parsed = parsePerfReport(validReport);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.runs).toHaveLength(2);
    expect(parsed.runs[0].label).toBe("desktop");
  });

  it("accepts a JSON string as well as an object", () => {
    expect(parsePerfReport(JSON.stringify(validReport)).runs).toHaveLength(2);
  });

  it("rejects invalid JSON with a parse message", () => {
    expect(() => parsePerfReport("{ nope")).toThrow(/Invalid JSON/);
  });

  it("rejects missing or invalid schemaVersion naming the field", () => {
    expect(() => parsePerfReport({ ...validReport, schemaVersion: 2 })).toThrow(/schemaVersion/);
    const { schemaVersion: _drop, ...withoutVersion } = validReport;
    expect(() => parsePerfReport(withoutVersion)).toThrow(/schemaVersion/);
  });

  it("rejects non-array and empty runs naming the field", () => {
    expect(() => parsePerfReport({ ...validReport, runs: {} })).toThrow(/runs/);
    expect(() => parsePerfReport({ ...validReport, runs: [] })).toThrow(/runs/);
  });

  it("rejects a run without a label naming the offending index", () => {
    expect(() => parsePerfReport({ ...validReport, runs: [{ ...validRunDesktop, label: "  " }] })).toThrow(/index 0.*label/);
  });

  it("rejects a missing timing field without coercing it to zero", () => {
    // The whole point: a dropped metric must fail loudly, not be scored as a fast page.
    const { tbtMs: _drop, ...withoutTbt } = validRunDesktop;
    expect(() => parsePerfReport({ ...validReport, runs: [withoutTbt] })).toThrow(/desktop.*tbtMs/);
  });

  it("rejects a non-finite timing value", () => {
    expect(() => parsePerfReport({ ...validReport, runs: [{ ...validRunDesktop, lcpMs: Number.NaN }] })).toThrow(/lcpMs/);
    expect(() => parsePerfReport({ ...validReport, runs: [{ ...validRunMobile, fcpMs: "1168" }] })).toThrow(/fcpMs/);
  });

  it("permits an explicit null timing value (unobserved, not zero)", () => {
    const parsed = parsePerfReport({ ...validReport, runs: [{ ...validRunMobile, lcpMs: null }] });
    expect(parsed.runs[0].lcpMs).toBeNull();
  });
});

describe("summarize", () => {
  it("projects only the fields the table and the gate read", () => {
    const rows = summarize(validReport);
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0]).sort()).toEqual(["cls", "fcpMs", "firstLoadJsBytes", "label", "lcpMs", "maxLongTaskMs", "tbtMs"]);
    expect(rows[1].label).toBe("mobile");
  });

  it("returns an empty list for a report with no runs", () => {
    expect(summarize({ runs: [] })).toEqual([]);
  });
});
