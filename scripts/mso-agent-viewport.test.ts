import { describe, expect, it } from "vitest";
import { cellWidth } from "./tui/cells.mjs";
import {
  appendLines, appendStream, commitStream, createViewport, handleViewportKey,
  resetFollow, setLines, viewportWindow,
} from "./mso-agent-viewport.mjs";
import { renderViewport, scrollbarColumn } from "./mso-agent-viewport-render.mjs";

describe("mso-agent-viewport", () => {
  it("1. appending lines keeps follow mode pinned to the bottom", () => {
    const vp = createViewport({ rows: 5 });
    appendLines(vp, ["line 1", "line 2", "line 3"]);
    expect(vp.offset).toBe(0);
    const win1 = viewportWindow(vp, 5);
    expect(win1.follow).toBe(true);
    expect(win1.lines).toEqual(["line 1", "line 2", "line 3"]);

    appendLines(vp, ["line 4", "line 5", "line 6", "line 7"]);
    expect(vp.offset).toBe(0);
    const win2 = viewportWindow(vp, 5);
    expect(win2.follow).toBe(true);
    expect(win2.lines).toEqual(["line 3", "line 4", "line 5", "line 6", "line 7"]);
  });

  it("2. scrolling up leaves follow mode and the window does not move when new lines arrive", () => {
    const vp = createViewport({ rows: 5 });
    appendLines(vp, Array.from({ length: 20 }, (_, i) => `item ${i + 1}`));
    expect(vp.offset).toBe(0);

    const consumed = handleViewportKey(vp, { name: "pageup" }, { rows: 5 });
    expect(consumed).toBe(true);
    expect(vp.offset).toBe(5);

    const winBefore = viewportWindow(vp, 5);
    expect(winBefore.follow).toBe(false);
    expect(winBefore.lines).toEqual(["item 11", "item 12", "item 13", "item 14", "item 15"]);

    appendLines(vp, ["new 1", "new 2", "new 3", "new 4"]);
    expect(vp.offset).toBe(9);
    const winAfter = viewportWindow(vp, 5);
    expect(winAfter.follow).toBe(false);
    expect(winAfter.lines).toEqual(["item 11", "item 12", "item 13", "item 14", "item 15"]);
  });

  it("3. scrolling back to the bottom restores follow mode", () => {
    const vp = createViewport({ rows: 5 });
    appendLines(vp, Array.from({ length: 20 }, (_, i) => `row ${i}`));
    handleViewportKey(vp, { name: "pageup" }, { rows: 5 });
    expect(viewportWindow(vp, 5).follow).toBe(false);

    const consumed = handleViewportKey(vp, { name: "end" }, { rows: 5 });
    expect(consumed).toBe(true);
    expect(vp.offset).toBe(0);
    const win = viewportWindow(vp, 5);
    expect(win.follow).toBe(true);
    expect(win.lines).toEqual(["row 15", "row 16", "row 17", "row 18", "row 19"]);

    vp.offset = 10;
    resetFollow(vp);
    expect(vp.offset).toBe(0);
    expect(viewportWindow(vp, 5).follow).toBe(true);
  });

  it("4. viewportWindow returns at most rows lines and reports the right offset and total", () => {
    const vp = createViewport({ rows: 4 });
    appendLines(vp, ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]);
    expect(viewportWindow(vp, 0).lines).toEqual([]);

    const win = viewportWindow(vp, 4);
    expect(win.lines).toHaveLength(4);
    expect(win.lines).toEqual(["gamma", "delta", "epsilon", "zeta"]);
    expect(win.total).toBe(6);
    expect(win.offset).toBe(0);

    vp.offset = 1;
    const scrolled = viewportWindow(vp, 4);
    expect(scrolled.lines).toEqual(["beta", "gamma", "delta", "epsilon"]);
    expect(scrolled.offset).toBe(1);
    expect(scrolled.total).toBe(6);
  });

  it("5. the scrollbar is exactly rows lines, is empty when everything fits, and its thumb position tracks the offset", () => {
    const vp = createViewport({ rows: 10 });
    appendLines(vp, ["line 1", "line 2"]);

    expect(scrollbarColumn(vp, 10)).toEqual([]);

    appendLines(vp, Array.from({ length: 40 }, (_, i) => `item ${i}`));
    const barBottom = scrollbarColumn(vp, 10);
    expect(barBottom).toHaveLength(10);
    expect(barBottom[9]).toBe("█");

    handleViewportKey(vp, { ctrl: true, name: "g" }, { rows: 10 });
    const barTop = scrollbarColumn(vp, 10);
    expect(barTop).toHaveLength(10);
    expect(barTop[0]).toBe("█");

    vp.offset = Math.floor((42 - 10) / 2);
    const barMid = scrollbarColumn(vp, 10);
    expect(barMid).toHaveLength(10);
    expect(barMid.slice(1, 9).some((ch) => ch === "█")).toBe(true);
  });

  it("6. renderViewport clips long lines to width and never returns a line wider than width, including when a wide CJK character sits at the boundary", () => {
    const vp = createViewport({ rows: 3 });
    appendLines(vp, ["short", "東京特許許可局局長", "abcdefghijklmnopqrstuvwxyz"]);

    const rendered = renderViewport(vp, { width: 10, rows: 3 });
    expect(rendered).toHaveLength(3);
    for (const line of rendered) {
      expect(cellWidth(line)).toBeLessThanOrEqual(10);
      expect(line).not.toContain("\n");
      expect(line).not.toContain("\r");
    }

    const vpBoundary = createViewport({ rows: 1 });
    appendLines(vpBoundary, ["🌸🌸🌸🌸🌸"]);
    const renderedBoundary = renderViewport(vpBoundary, { width: 7, rows: 1 });
    expect(renderedBoundary).toHaveLength(1);
    expect(cellWidth(renderedBoundary[0])).toBeLessThanOrEqual(7);
  });

  it("7. PgUp, PgDn, Ctrl+G and End move as specified and consume the key; an unrelated key is not consumed", () => {
    const vp = createViewport({ rows: 10 });
    appendLines(vp, Array.from({ length: 50 }, (_, i) => `row ${i}`));

    expect(handleViewportKey(vp, { name: "a" }, { rows: 10 })).toBe(false);
    expect(handleViewportKey(vp, { name: "return" }, { rows: 10 })).toBe(false);
    expect(vp.offset).toBe(0);

    expect(handleViewportKey(vp, { name: "pageup" }, { rows: 10 })).toBe(true);
    expect(vp.offset).toBe(10);

    expect(handleViewportKey(vp, { name: "pagedown" }, { rows: 10 })).toBe(true);
    expect(vp.offset).toBe(0);

    expect(handleViewportKey(vp, { ctrl: true, name: "g" }, { rows: 10 })).toBe(true);
    expect(vp.offset).toBe(40);

    expect(handleViewportKey(vp, { ctrl: true, shift: true, name: "g" }, { rows: 10 })).toBe(true);
    expect(vp.offset).toBe(0);

    expect(handleViewportKey(vp, { ctrl: true, name: "u" }, { rows: 10 })).toBe(true);
    expect(vp.offset).toBe(5);

    expect(handleViewportKey(vp, { ctrl: true, name: "d" }, { rows: 10 })).toBe(true);
    expect(vp.offset).toBe(0);
  });

  it("8. a resize from 30 rows to 8 rows keeps the buffer intact and the offset clamped", () => {
    const vp = createViewport({ rows: 30 });
    appendLines(vp, Array.from({ length: 40 }, (_, i) => `msg ${i}`));
    expect(vp.lines).toHaveLength(40);

    const win30 = viewportWindow(vp, 30);
    expect(win30.lines).toHaveLength(30);

    const win8 = viewportWindow(vp, 8);
    expect(win8.lines).toHaveLength(8);
    expect(vp.lines).toHaveLength(40);
  });

  it("9. the buffer drops the oldest lines past its cap and marks the drop", () => {
    const vp = createViewport({ rows: 5, maxLines: 15 });
    appendLines(vp, Array.from({ length: 25 }, (_, i) => `entry ${i}`));

    expect(vp.lines.length).toBeLessThanOrEqual(15);
    expect(vp.droppedCount).toBeGreaterThan(0);
    expect(vp.lines[0]).toMatch(/\[\.\.\. \d+ earlier lines dropped \.\.\.\]/);
  });

  it("10. a streaming chunk that has not been committed appears as a partial line without breaking the window arithmetic", () => {
    const vp = createViewport({ rows: 5 });
    appendLines(vp, ["line 1", "line 2"]);

    appendStream(vp, "partial stream text");
    const win = viewportWindow(vp, 5);
    expect(win.total).toBe(3);
    expect(win.lines).toEqual(["line 1", "line 2", "partial stream text"]);

    commitStream(vp);
    expect(vp.lines).toEqual(["line 1", "line 2", "partial stream text"]);
    expect(vp.stream).toBe("");
    expect(viewportWindow(vp, 5).total).toBe(3);
  });

  it("11. setLines replaces the transcript instead of appending a duplicate copy", () => {
    const vp = createViewport({ rows: 5 });
    setLines(vp, ["[user] one", "[assistant] two"]);
    expect(vp.lines).toEqual(["[user] one", "[assistant] two"]);
    setLines(vp, ["[user] one", "[assistant] two", "[tool] three"]);
    expect(vp.lines).toEqual(["[user] one", "[assistant] two", "[tool] three"]);
    expect(vp.offset).toBe(0);
  });

  it("12. setLines keeps a scrolled-up reader where they were and still applies the cap", () => {
    const vp = createViewport({ rows: 4, maxLines: 10 });
    setLines(vp, Array.from({ length: 30 }, (_, i) => `row ${i}`));
    expect(vp.lines.length).toBeLessThanOrEqual(10);
    expect(vp.lines[0]).toContain("earlier lines dropped");
    handleViewportKey(vp, { name: "pageup" }, { rows: 4 });
    const offset = vp.offset;
    setLines(vp, Array.from({ length: 30 }, (_, i) => `next ${i}`));
    expect(vp.offset).toBeLessThanOrEqual(offset);
    expect(vp.lines.at(-1)).toBe("next 29");
  });
});
