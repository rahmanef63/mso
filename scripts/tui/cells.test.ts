import { describe, expect, it } from "vitest";
import {
  border,
  cellWidth,
  clean,
  compose,
  fitCells,
  paneRow,
  paneWidths,
  stripAnsi,
  windowFor,
} from "./cells.mjs";

describe("TUI cell and pane primitives", () => {
  it("measures plain ASCII string widths", () => {
    expect(cellWidth("")).toBe(0);
    expect(cellWidth("hello")).toBe(5);
    expect(cellWidth("hello world")).toBe(11);
    expect(cellWidth("   ")).toBe(3);
  });

  it("ignores ANSI escape sequences when measuring width", () => {
    expect(cellWidth("\x1b[31mred\x1b[0m")).toBe(3);
    expect(cellWidth("\x1b[1;32mbold green\x1b[0m")).toBe(10);
    expect(cellWidth("\x1b[38;5;208morange 256\x1b[0m")).toBe(10);
    expect(cellWidth("\x1b[38;2;255;128;0mtruecolor\x1b[0m")).toBe(9);
    expect(cellWidth("\x1b[2K\x1b[?25hvisible")).toBe(7);
    expect(stripAnsi("\x1b[34mtest\x1b[0m")).toBe("test");
  });

  it("measures East Asian wide characters and zero-width codepoints accurately", () => {
    expect(cellWidth("你好世界")).toBe(8);
    expect(cellWidth("コンニチハ")).toBe(10);
    expect(cellWidth("안녕하세요")).toBe(10);
    expect(cellWidth("全角！")).toBe(6);
    expect(cellWidth("🌸")).toBe(2);
    expect(cellWidth("😀")).toBe(2);
    // Zero-width joiner, variation selectors, and combining diacritics
    expect(cellWidth("e\u0301")).toBe(1);
    expect(cellWidth("test\u200d")).toBe(4);
    expect(cellWidth("a\ufe0f")).toBe(1);
  });

  it("truncates with an ellipsis and pads to target width", () => {
    expect(fitCells("hello", 10)).toBe("hello     ");
    expect(fitCells("hello", 10, { pad: false })).toBe("hello");
    expect(fitCells("hello world", 8)).toBe("hello w…");
    expect(fitCells("hello world", 5)).toBe("hell…");
    expect(fitCells("hello", 1)).toBe("…");
    expect(fitCells("hello", 0)).toBe("");
    expect(fitCells("hello", -2)).toBe("");
  });

  it("preserves surrogate pairs without splitting high/low surrogates on truncation", () => {
    // Demonstration of surrogate preservation: slicing by UTF-16 code units would
    // leave an orphaned high surrogate \ud83c. Array.from avoids splitting pairs.
    const result = fitCells("🌸🌸🌸", 4);
    expect(result).toBe("🌸… ");
    expect(cellWidth(result)).toBe(4);
    const codeUnits = Array.from({ length: result.length }, (_, i) => result.charCodeAt(i));
    const loneSurrogate = codeUnits.some((cu, i) => {
      if (cu >= 0xd800 && cu <= 0xdbff) {
        const next = codeUnits[i + 1] ?? 0;
        return next < 0xdc00 || next > 0xdfff;
      }
      if (cu >= 0xdc00 && cu <= 0xdfff) {
        const prev = codeUnits[i - 1] ?? 0;
        return prev < 0xd800 || prev > 0xdbff;
      }
      return false;
    });
    expect(loneSurrogate).toBe(false);
  });

  it("computes pane widths summing to available width without overflow", () => {
    for (const total of [60, 80, 100, 120, 160]) {
      for (const count of [1, 2, 3, 4]) {
        const widths = paneWidths(total, count);
        expect(widths).toHaveLength(count);
        const inner = widths.reduce((sum, w) => sum + w, 0);
        const expectedInner = Math.max(count * 10, total - (count + 1));
        expect(inner).toBe(expectedInner);
        if (total >= count * 10 + count + 1) {
          const totalBorderWidth = inner + (count + 1);
          expect(totalBorderWidth).toBe(total);
        }
      }
    }
  });

  it("composes border and paneRow lines of exactly equal visible width", () => {
    const cases = [
      { total: 80, count: 3, cells: ["Short", "Medium cell text", "Third column"] },
      { total: 95, count: 2, cells: ["\x1b[32mActive status\x1b[0m", "CJK 你好世界 column"] },
      { total: 60, count: 1, cells: ["Single full-width pane"] },
      { total: 120, count: 4, cells: ["A", "B", "C", "D"] },
    ];
    for (const { total, count, cells } of cases) {
      const widths = paneWidths(total, count);
      const top = border(widths, "top");
      const mid = border(widths, "mid");
      const bottom = border(widths, "bottom");
      const row = paneRow(cells, widths);

      const topW = cellWidth(top);
      const midW = cellWidth(mid);
      const bottomW = cellWidth(bottom);
      const rowW = cellWidth(row);

      expect(topW).toBe(rowW);
      expect(midW).toBe(rowW);
      expect(bottomW).toBe(rowW);
    }
  });

  it("composes left and right text within a target width", () => {
    const res = compose("Left", "Right", 20);
    expect(cellWidth(res)).toBe(20);
    expect(res.startsWith("Left")).toBe(true);
    expect(res.endsWith("Right")).toBe(true);
  });

  it("computes window slices for scrolling lists", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(windowFor(items, 0, 5)).toEqual({ start: 0, end: 5 });
    expect(windowFor(items, 5, 5)).toEqual({ start: 3, end: 8 });
    expect(windowFor(items, 9, 5)).toEqual({ start: 5, end: 10 });
    expect(windowFor([1, 2], 0, 5)).toEqual({ start: 0, end: 2 });
  });

  it("cleans control characters and trims text", () => {
    expect(clean("  hello\tworld\r\n  ")).toBe("hello world");
    expect(clean("\x1b[31m colored \x1b[0m")).toBe("colored");
  });
});
