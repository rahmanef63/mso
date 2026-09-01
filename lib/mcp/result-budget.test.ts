import { describe, expect, it } from "vitest";
import { boundedResultText, DEFAULT_MCP_RESULT_BYTES } from "./result-budget";

describe("MCP result budget", () => {
  it("leaves small exact outputs unchanged", () => {
    const result = { ok: true, rows: [1, 2, 3] };
    expect(boundedResultText(result)).toBe(JSON.stringify(result));
  });

  it("returns a parseable compact envelope instead of flooding model context", () => {
    const raw = { stdout: "x".repeat(80_000), stderr: "", code: 0 };
    const text = boundedResultText(raw);
    const parsed = JSON.parse(text) as { msoTruncated: boolean; originalBytes: number; preview: string; hint: string };
    expect(parsed.msoTruncated).toBe(true);
    expect(parsed.originalBytes).toBeGreaterThan(DEFAULT_MCP_RESULT_BYTES);
    expect(parsed.preview).toContain("stdout");
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(DEFAULT_MCP_RESULT_BYTES + 512);
    expect(parsed.hint).toContain("narrower");
  });

  it("supports a larger per-tool budget without allowing unbounded output", () => {
    const text = boundedResultText("z".repeat(200_000), { maxTextBytes: 64 * 1024, overflowHint: "Use pagination." });
    const parsed = JSON.parse(text) as { msoTruncated: boolean; hint: string };
    expect(parsed.msoTruncated).toBe(true);
    expect(parsed.hint).toBe("Use pagination.");
    expect(Buffer.byteLength(text, "utf8")).toBeLessThan(66 * 1024);
  });
});
