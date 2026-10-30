import { describe, expect, it } from "vitest";
import { cursorHome, eraseFrame, frameHeight, withCursorHidden, writeFrame } from "./mso-agent-screen.mjs";

// A terminal by default, because that is the path being tested. The non-TTY cases below
// construct the same class and set isTTY = false explicitly.
class FakeOutput {
  columns = 80;
  chunks: string[] = [];
  isTTY?: boolean = true;
  write(value: string) {
    this.chunks.push(String(value));
    return true;
  }
}

describe("MSO Agent retained screen and frame writer", () => {
  it("treats an undefined isTTY as a pipe, because node leaves it undefined outside a terminal", () => {
    const output = new FakeOutput();
    output.isTTY = undefined;
    writeFrame(output, [], ["alpha"]);
    const combined = output.chunks.join("");
    expect(combined).toContain("alpha");
    expect(combined).not.toContain("\x1b[");
  });

  it("first paint of two rows emits them once, in order", () => {
    const output = new FakeOutput();
    const painted = writeFrame(output, [], ["alpha", "beta"]);
    expect(painted).toEqual(["alpha", "beta"]);
    const combined = output.chunks.join("");
    expect(combined).toContain("alpha");
    expect(combined).toContain("beta");
    expect(combined.indexOf("alpha")).toBeLessThan(combined.indexOf("beta"));
    // Ensure rows are written once, not duplicated during initial paint.
    expect(combined.split("alpha").length).toBe(2);
    expect(combined.split("beta").length).toBe(2);
  });

  it("repainting the same two rows emits nothing", () => {
    const output = new FakeOutput();
    const initial = writeFrame(output, [], ["alpha", "beta"]);
    const writeCountBefore = output.chunks.length;
    const next = writeFrame(output, initial, ["alpha", "beta"]);
    expect(next).toEqual(["alpha", "beta"]);
    expect(output.chunks.length).toBe(writeCountBefore);
  });

  it("changing one row rewrites only that row", () => {
    const output = new FakeOutput();
    const initial = writeFrame(output, [], ["header", "row1", "footer"]);
    const writeCountBefore = output.chunks.length;
    const next = writeFrame(output, initial, ["header", "row1 updated", "footer"]);
    expect(next).toEqual(["header", "row1 updated", "footer"]);
    const diff = output.chunks.slice(writeCountBefore).join("");
    expect(diff).toContain("row1 updated");
    expect(diff).not.toContain("header");
    expect(diff).not.toContain("footer");
  });

  it("shrinking from three rows to two clears the third", () => {
    const output = new FakeOutput();
    const initial = writeFrame(output, [], ["row1", "row2", "row3"]);
    const writeCountBefore = output.chunks.length;
    const next = writeFrame(output, initial, ["row1", "row2"]);
    expect(next).toEqual(["row1", "row2"]);
    const diff = output.chunks.slice(writeCountBefore).join("");
    // Erase sequence must be emitted for the third row, without touching row1 or row2.
    expect(diff).toContain("\x1b[2K");
    expect(diff).not.toContain("row1");
    expect(diff).not.toContain("row2");
    expect(diff).not.toContain("row3");
  });

  it("no \\n appears in any write produced while painting a frame", () => {
    const output = new FakeOutput();
    const frame1 = writeFrame(output, [], ["line 1", "line 2", "line 3"]);
    const frame2 = writeFrame(output, frame1, ["line 1 updated", "line 2", "line 3"]);
    const frame3 = writeFrame(output, frame2, ["line 1 updated", "line 2"]);
    expect(frame3).toEqual(["line 1 updated", "line 2"]);
    for (const chunk of output.chunks) {
      expect(chunk).not.toContain("\n");
    }
  });

  it("a non-TTY output receives plain lines and no escape sequences", () => {
    const output = new FakeOutput();
    output.isTTY = false;
    const painted = writeFrame(output, [], ["plain first", "plain second"]);
    expect(painted).toEqual(["plain first", "plain second"]);
    const combined = output.chunks.join("");
    expect(combined).toBe("plain first\nplain second\n");
    expect(combined).not.toContain("\x1b");
  });

  it("withCursorHidden restores the cursor when the callback throws", () => {
    const output = new FakeOutput();
    expect(() => {
      withCursorHidden(output, () => {
        throw new Error("simulated failure during repaint");
      });
    }).toThrow("simulated failure during repaint");
    // Ensure hide sequence was sent first and show sequence was sent in finally block.
    expect(output.chunks[0]).toBe("\x1b[?25l");
    expect(output.chunks[output.chunks.length - 1]).toBe("\x1b[?25h");

    // Guard check: non-TTY stream receives no cursor escape sequences.
    const nonTty = new FakeOutput();
    nonTty.isTTY = false;
    const value = withCursorHidden(nonTty, () => "safe-result");
    expect(value).toBe("safe-result");
    expect(nonTty.chunks.length).toBe(0);
  });

  it("frameHeight matches the number of painted rows, including a row that had to wrap", () => {
    expect(frameHeight([])).toBe(0);
    expect(frameHeight(["single line"], 80)).toBe(1);
    expect(frameHeight(["first", "second"], 80)).toBe(2);
    // A 100-cell row on an 80-column terminal wraps into 2 physical rows.
    const longLine = "x".repeat(100);
    expect(frameHeight(["short", longLine], 80)).toBe(3);
    // ANSI codes should be stripped and not inflate cell width calculations.
    const ansiLine = `\x1b[31m${"y".repeat(100)}\x1b[0m`;
    expect(frameHeight(["short", ansiLine], 80)).toBe(3);
  });

  it("cursorHome and eraseFrame operate without emitting newlines", () => {
    const output = new FakeOutput();
    cursorHome(output, 2);
    expect(output.chunks.join("")).toBe("\x1b[2A\r");

    const nonTty = new FakeOutput();
    nonTty.isTTY = false;
    cursorHome(nonTty, 2);
    expect(nonTty.chunks.length).toBe(0);

    const eraseOutput = new FakeOutput();
    eraseFrame(eraseOutput, ["line 1", "line 2", "line 3"]);
    const erased = eraseOutput.chunks.join("");
    expect(erased).not.toContain("\n");
    expect(erased).toContain("\x1b[2K");
  });
});
