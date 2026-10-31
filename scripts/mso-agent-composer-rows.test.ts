import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { AgentComposer } from "./mso-agent-composer.mjs";
import { clampPromptRows, PROMPT_ROWS } from "./mso-agent-composer-ui.mjs";
import { mountScreenLoop } from "./mso-agent-screen-loop.mjs";

class FakeInput extends EventEmitter {
  isRaw = false;
  resume() {}
  pause() {}
  setRawMode(value: boolean) { this.isRaw = value; }
}

class FakeOutput extends EventEmitter {
  isTTY = true;
  columns = 40;
  rows = 24;
  chunks: string[] = [];
  write(value: string) {
    this.chunks.push(String(value));
    return true;
  }
}

describe("MSO Agent composer row reporting and dynamic screen loop reservation", () => {
  it("reports 1 row for a single-line draft and 3 rows when wrapped to 3 lines", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    output.columns = 20; // prompt is "› " (2 chars), lineWidth = max(8, 20 - 2 - 2) = 16
    const reported: number[] = [];
    const composer = new AgentComposer({
      input: input as never,
      output: output as never,
      colors: { blue: "", bold: "", reset: "", dim: "", warn: "", c: "", cyan: "", err: "" },
      onRows: (rows: number) => { reported.push(rows); },
    });

    const answerPromise = composer.question("› ");
    expect(composer.rowCount()).toBe(1);
    expect(reported).toEqual([1]);

    // Type 35 chars to wrap across 3 lines: line 1 (16 chars), line 2 (16 chars), line 3 (3 chars)
    const text = "a".repeat(35);
    for (const ch of text) input.emit("keypress", ch, { name: ch, sequence: ch });

    expect(composer.rowCount()).toBe(3);
    expect(reported[reported.length - 1]).toBe(3);

    input.emit("keypress", "\r", { name: "return", sequence: "\r" });
    await answerPromise;
    composer.close();
  });

  it("reports 2 rows for a 2-row draft and 7 rows for a 7-row draft", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    output.columns = 20; // lineWidth is 16
    output.rows = 40; // generous height so maxRows allows 7 visual rows
    const composer = new AgentComposer({
      input: input as never,
      output: output as never,
      colors: { blue: "", bold: "", reset: "", dim: "", warn: "", c: "", cyan: "", err: "" },
    });

    const answerPromise = composer.question("› ");

    // 20 chars wraps into 2 rows (16 in row 1, 4 in row 2)
    for (const ch of "b".repeat(20)) input.emit("keypress", ch, { name: ch, sequence: ch });
    expect(composer.rowCount()).toBe(2);

    // 16 * 6 + 2 = 98 chars wraps into 7 rows
    for (const ch of "c".repeat(78)) input.emit("keypress", ch, { name: ch, sequence: ch });
    expect(composer.rowCount()).toBe(7);

    input.emit("keypress", "\r", { name: "return", sequence: "\r" });
    await answerPromise;
    composer.close();
  });

  it("fires callback again when draft is edited from 3 lines back to 1 line", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    output.columns = 20; // lineWidth = 16
    const reported: number[] = [];
    const composer = new AgentComposer({
      input: input as never,
      output: output as never,
      colors: { blue: "", bold: "", reset: "", dim: "", warn: "", c: "", cyan: "", err: "" },
      onRows: (rows: number) => { reported.push(rows); },
    });

    const answerPromise = composer.question("› ");
    expect(reported).toEqual([1]);

    // Type 35 chars to reach 3 rows
    for (const ch of "x".repeat(35)) input.emit("keypress", ch, { name: ch, sequence: ch });
    expect(composer.rowCount()).toBe(3);
    expect(reported).toContain(3);

    // Delete 30 chars back to 5 chars (single row)
    for (let i = 0; i < 30; i++) input.emit("keypress", undefined, { name: "backspace", sequence: "\x7f" });
    expect(composer.rowCount()).toBe(1);
    expect(reported[reported.length - 1]).toBe(1);

    input.emit("keypress", "\r", { name: "return", sequence: "\r" });
    await answerPromise;
    composer.close();
  });

  it("clamps a reported 0 to the initial reservation and a runaway report to what is left of the screen", () => {
    expect(clampPromptRows(0, 20)).toBe(PROMPT_ROWS); // an erase must not bounce the panel
    // 20 rows minus 4 keeps the chrome block plus one transcript row on screen. A quarter of the
    // terminal would be 5, which is below the 6 row draft this fix exists for.
    expect(clampPromptRows(40, 20)).toBe(16);
    expect(clampPromptRows(6, 12)).toBe(6);

    const session = { paneKind: "off", streamSink: null };
    const output = new FakeOutput();
    output.rows = 20;
    output.columns = 80;

    const loop = mountScreenLoop({
      session,
      enabled: true,
      output: output as never,
      input: new FakeInput() as never,
    });

    loop.setPromptRows(0);
    expect(loop.geometry().promptRows).toBe(3);

    loop.setPromptRows(40);
    expect(loop.geometry().promptRows).toBe(16);

    loop.dispose();
  });

  it("subtracts reported reservation in geometry so taller composer leaves fewer viewport rows", () => {
    const session = { paneKind: "off" };
    const output = new FakeOutput();
    output.rows = 24;
    output.columns = 80;

    const loop = mountScreenLoop({
      session,
      enabled: true,
      output: output as never,
      input: new FakeInput() as never,
    });

    // Default initial reservation is PROMPT_ROWS (3)
    const initialViewRows = loop.geometry().viewRows;
    expect(loop.geometry().promptRows).toBe(3);

    // Set reported rows to 5, which is within the 20 allowed on a 24 row terminal
    loop.setPromptRows(5);
    const updatedViewRows = loop.geometry().viewRows;

    expect(loop.geometry().promptRows).toBe(5);
    expect(updatedViewRows).toBe(initialViewRows - 2);

    loop.dispose();
  });

  it("emits no newline characters while reporting row changes during repaints", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    output.columns = 20; // lineWidth = 16
    const composer = new AgentComposer({
      input: input as never,
      output: output as never,
      colors: { blue: "", bold: "", reset: "", dim: "", warn: "", c: "", cyan: "", err: "" },
    });

    const answerPromise = composer.question("› ");
    // Expand draft to 3 rows
    for (const ch of "a".repeat(35)) input.emit("keypress", ch, { name: ch, sequence: ch });
    expect(composer.rowCount()).toBe(3);

    // Edit from 3 rows back to 1 row while reporting row count changes
    const beforeEdit = output.chunks.length;
    for (let i = 0; i < 30; i++) {
      input.emit("keypress", undefined, { name: "backspace", sequence: "\x7f" });
    }
    expect(composer.rowCount()).toBe(1);

    const repaintWrites = output.chunks.slice(beforeEdit).join("");
    // Repainting in place must only use cursor moves, never \n
    expect(repaintWrites).not.toContain("\n");

    composer.cancelCurrent({ echo: false });
    await answerPromise;
    composer.close();
  });

  it("prevents panel overwrite on a 12-row TTY with a 6-line draft compared to fixed 3-row assumption", () => {
    const session = {
      paneKind: "off",
      agentSession: { id: "s1" },
    };
    const output = new FakeOutput();
    output.rows = 12;
    output.columns = 60;

    const loop = mountScreenLoop({
      session,
      enabled: true,
      output: output as never,
      input: new FakeInput() as never,
    });

    // Old fixed 3-row assumption: geometry(3)
    const oldGeom = loop.geometry(3);
    // Dynamic reservation for 6-line draft: geometry(6)
    const newGeom = loop.geometry(6);

    // In old assumption, panel is placed lower down because loop reserves only 3 rows
    // viewRows = 12 - panel.length (2) - 3 = 7 rows. Panel is at rows 8..9.
    // Cursor left at row 10. A 6-line composer at row 10 extends to row 15 (exceeding 12 rows!).
    expect(oldGeom.viewRows).toBe(7);

    // With dynamic 6-row reservation:
    // viewRows = 12 - panel.length (2) - 6 = 4 rows. Panel is at rows 5..6.
    // Cursor left at row 7. A 6-line composer occupies rows 7..12 (exact fit on 12-row screen).
    expect(newGeom.viewRows).toBe(4);

    loop.dispose();
  });
});
