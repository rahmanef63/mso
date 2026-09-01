import { describe, expect, it } from "vitest";
import { completionWindow, inputViewport } from "./mso-agent-composer.mjs";

describe("MSO Agent interactive composer primitives", () => {
  it("keeps a fixed completion viewport centered near the selected row", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ text: `/${i}` }));
    expect(completionWindow(rows, 0, 8)).toMatchObject({ start: 0 });
    expect(completionWindow(rows, 10, 8)).toMatchObject({ start: 6 });
    expect(completionWindow(rows, 19, 8)).toMatchObject({ start: 12 });
    expect(completionWindow(rows, 10, 8).items).toHaveLength(8);
  });

  it("keeps long input on one physical composer line with cursor visibility", () => {
    const source = "abcdefghijklmnopqrstuvwxyz";
    const atEnd = inputViewport(source, source.length, 10);
    expect(Array.from(atEnd.display).length).toBeLessThanOrEqual(10);
    expect(atEnd.display).toContain("…");
    expect(atEnd.cursor).toBeGreaterThan(0);

    const atStart = inputViewport(source, 0, 10);
    expect(Array.from(atStart.display).length).toBeLessThanOrEqual(10);
    expect(atStart.cursor).toBe(0);
  });
});
