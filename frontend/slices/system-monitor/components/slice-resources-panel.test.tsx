import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SliceRow } from "./slice-resources-panel";
import type { SliceResourceRow } from "../lib/host";

const row = (over: Partial<SliceResourceRow> = {}): SliceResourceRow => ({
  slice: "system-monitor",
  accounted: true,
  rationale: "polls telemetry",
  windowMs: 60_000,
  calls: 12,
  fields: [
    {
      field: "externalCallsPerMinute",
      budget: 30,
      actual: 12,
      evidence: "estimated",
      status: "within",
      provenance: { kind: "cited", file: "lib/host/sys-services-service.ts", line: 14, note: "30 per 60 s" },
    },
    {
      field: "memoryMiB",
      budget: 64,
      actual: null,
      evidence: "not-instrumented",
      status: "unknown",
      provenance: { kind: "policy", file: "lib/resources/policy.ts", line: 64, note: "policy" },
    },
  ],
  ...over,
});

describe("slice resources row", () => {
  it("renders the evidence class as visible text, not only a tooltip", () => {
    const html = renderToStaticMarkup(createElement(SliceRow, { row: row() }));
    // An estimate must be readable as an estimate at a glance; a tooltip alone would
    // let it look like a measurement.
    expect(html).toContain("estimated");
    expect(html).toContain("not-instrumented");
    expect(html).toContain("12 / 30 calls/min");
  });

  it("carries the citation in the title so the number is traceable", () => {
    const html = renderToStaticMarkup(createElement(SliceRow, { row: row() }));
    expect(html).toContain("lib/host/sys-services-service.ts:14");
  });

  it("marks an over-budget row and says which field is over", () => {
    const over = row({
      fields: [{
        field: "externalCallsPerMinute",
        budget: 5,
        actual: 40,
        evidence: "estimated",
        status: "over",
        provenance: { kind: "cited", file: "lib/host/sys-services-service.ts", line: 14, note: "5 per 60 s" },
      }],
    });
    const html = renderToStaticMarkup(createElement(SliceRow, { row: over }));
    expect(html).toContain("text-destructive-text");
    expect(html).toContain("40 / 5 calls/min");
  });

  it("falls back to a bare call count when a row has no call field", () => {
    const html = renderToStaticMarkup(createElement(SliceRow, { row: row({ fields: [], calls: 3 }) }));
    expect(html).toContain("3 calls");
  });
});
