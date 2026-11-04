import { describe, expect, it } from "vitest";
import { caretEscape, composeComposerLines, overlayFrame, paintOverlayFrame } from "./mso-agent-overlay.mjs";
import { writeFrame, writeFrameAt } from "./mso-agent-screen.mjs";

// The caret used to land on the footer. writeFrameAt leaves the cursor on the frame's LAST row, and the
// caret was then placed with a RELATIVE "move down N" from wherever the cursor happened to be, so the
// cursor sat on or under the status rows instead of in the prompt. It looked like a stray cursor below the
// layout. These tests pin the caret to the prompt's own row.

const rows = 24;
const foot = ["ask · model · thinking on", "/repo · ^P commands"];

const frameFor = (draftText = "hello", cursorRow = 0) => {
  const draft = Array.from({ length: cursorRow + 1 }, (_, i) => (i === 0 ? draftText : "wrapped"));
  const { lines, owned } = composeComposerLines({ prompt: "@mso › ", draft, menu: [], foot, promptWidth: 7 });
  const { visible, top } = overlayFrame({ lines, menu: [], foot, owned, rows });
  return { visible, top, owned };
};

describe("caret row", () => {
  it("places the caret on the prompt row, not on the footer", () => {
    const { top } = frameFor();
    const escape = caretEscape({ top, cursorRow: 0, promptWidth: 7, cursorCol: 5 });
    // Absolute form: 1-based row and column, so the row must be the prompt's.
    const match = /^\x1b\[(\d+);(\d+)H$/.exec(escape);
    expect(match?.[1]).toBe(String(top));
    // Column is prompt width + caret offset + 1, 1-based.
    expect(match?.[2]).toBe(String(7 + 5 + 1));
  });

  it("never emits a row past the terminal, whichever draft line the caret is on", () => {
    for (const cursorRow of [0, 1, 2]) {
      const { top, visible } = frameFor("hello", cursorRow);
      const match = /:?(\d+);/.exec(caretEscape({ top, cursorRow, promptWidth: 7, cursorCol: 0 }));
      const row = Number(match?.[1]);
      expect(row).toBe(top + cursorRow);
      expect(row).toBeLessThanOrEqual(rows);
      // The caret must be on a row the frame actually painted.
      expect(row).toBeLessThan(top + visible.length);
    }
  });

  it("falls back to a relative move in inline mode, where there is no absolute anchor", () => {
    const escape = caretEscape({ cursorRow: 0, promptWidth: 7, cursorCol: 5 });
    expect(escape).toBe("\r\x1b[12C");
    expect(caretEscape({ cursorRow: 2, promptWidth: 7, cursorCol: 0 })).toBe("\x1b[2B\r\x1b[7C");
  });
});

describe("paintOverlayFrame reports the anchor", () => {
  const fakeOut = () => {
    const out: any = { isTTY: true, columns: 40, rows, text: "" };
    out.write = (chunk: string) => { out.text += chunk; return true; };
    return out;
  };

  it("returns the frame's first row in absolute mode, so the caret can use it", () => {
    const output = fakeOut();
    const { visible, top, owned } = frameFor();
    const result = paintOverlayFrame({
      output, lines: visible, menu: [], foot, owned, previous: [], absolute: true, writeFrame, writeFrameAt,
    });
    expect(result.top).toBe(top);
    expect(result.painted).toEqual(visible);
  });

  it("returns no anchor in inline mode, where the frame is not bottom-anchored", () => {
    const output = fakeOut();
    const { visible, owned } = frameFor();
    const result = paintOverlayFrame({
      output, lines: visible, menu: [], foot, owned, previous: [], absolute: false, writeFrame, writeFrameAt,
    });
    expect(result.top).toBe(0);
  });

  it("leaves the cursor on the frame's last row, which is why the anchor is needed", () => {
    // This is the property that caused the bug: the painter's final cursor position is the footer.
    const output = fakeOut();
    const { visible, owned } = frameFor();
    paintOverlayFrame({
      output, lines: visible, menu: [], foot, owned, previous: [], absolute: true, writeFrame, writeFrameAt,
    });
    const written = [...output.text.matchAll(/\x1b\[(\d+);1H/g)].map((m) => Number(m[1]));
    expect(Math.max(...written)).toBe(24);
  });
});
