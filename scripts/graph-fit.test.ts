import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compactGraphViewport } from "../components/shared/graph-fit";

describe("readable measured graph viewport", () => {
  it("handles portrait, narrow desktop panes and short landscape independently", () => {
    expect(compactGraphViewport(390, 600)).toBe(true);
    expect(compactGraphViewport(550, 800)).toBe(true);
    expect(compactGraphViewport(826, 122)).toBe(true);
    expect(compactGraphViewport(1200, 239)).toBe(true);
    expect(compactGraphViewport(600, 240)).toBe(false);
    expect(compactGraphViewport(1000, 700)).toBe(false);
  });
  it("does not classify an unmeasured canvas", () => {
    expect(compactGraphViewport(0, 0)).toBe(false);
    expect(compactGraphViewport(826, 0)).toBe(false);
  });
  it("focuses selected nodes explicitly without changing full-fit semantics", () => {
    const source = readFileSync("components/shared/graph-canvas.tsx", "utf8");
    expect(source).toContain('aria-label="Focus selection"');
    expect(source).toContain('event.shiftKey && selectedNodes.length');
    expect(source).toContain('title="Fit complete graph (F)"');
  });
  it("waits for node measurements and avoids competing initial fit controllers", () => {
    const source = readFileSync("components/shared/graph-canvas.tsx", "utf8");
    expect(source).toContain("useNodesInitialized()");
    expect(source).toContain("state.height");
    expect(source).toContain("cancelAnimationFrame(frame)");
    expect(source).not.toContain("fitView fitViewOptions=");
  });
});
