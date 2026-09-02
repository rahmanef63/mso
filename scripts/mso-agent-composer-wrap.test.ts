import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { AgentComposer, inputLayout, verticalCursor } from "./mso-agent-composer.mjs";

describe("MSO Agent responsive wrapped composer", () => {
  it("wraps the active draft to terminal width and scales visible rows with terminal height", () => {
    const source = "abcdefghijklmnopqrstuvwxyz".repeat(4);
    const short = inputLayout(source, source.length, { columns: 30, rows: 12, promptWidth: 2 });
    const tall = inputLayout(source, source.length, { columns: 30, rows: 40, promptWidth: 2 });
    expect(short.totalLines).toBeGreaterThan(1);
    expect(short.lines.length).toBeGreaterThanOrEqual(2);
    expect(short.lines.length).toBeLessThanOrEqual(tall.lines.length);
    expect(short.lines.every((line) => Array.from(line).length <= short.lineWidth)).toBe(true);
  });

  it("moves the cursor vertically across wrapped visual rows while preserving its column", () => {
    const source = "0123456789abcdefghijKLMNOPQRST";
    const down = verticalCursor(source, 3, 10, 1);
    expect(down).toMatchObject({ moved: true, cursor: 13, column: 3 });
    const downAgain = verticalCursor(source, down.cursor, 10, 1, down.column);
    expect(downAgain.cursor).toBe(23);
    const up = verticalCursor(source, downAgain.cursor, 10, -1, downAgain.column);
    expect(up.cursor).toBe(13);
  });

  it("repaints a wrapped draft on terminal resize without losing the submitted value", async () => {
    class FakeInput extends EventEmitter { isRaw = false; resume() {} pause() {} setRawMode(value: boolean) { this.isRaw = value; } }
    class FakeOutput extends EventEmitter {
      columns = 24; rows = 16; chunks: string[] = [];
      write(value: string) { this.chunks.push(String(value)); return true; }
    }
    const input = new FakeInput(), output = new FakeOutput();
    const composer = new AgentComposer({ input: input as never, output: output as never, colors: { blue: "", warn: "", c: "", cyan: "", err: "", bold: "", reset: "", dim: "" } });
    const answer = composer.question("› ");
    const value = "resize keeps this long draft intact";
    for (const ch of value) input.emit("keypress", ch, { name: ch, sequence: ch });
    const before = output.chunks.length;
    output.columns = 18; output.rows = 24; output.emit("resize");
    expect(output.chunks.length).toBeGreaterThan(before);
    input.emit("keypress", "\r", { name: "return", sequence: "\r" });
    await expect(answer).resolves.toBe(value);
    composer.close();
  });
});
