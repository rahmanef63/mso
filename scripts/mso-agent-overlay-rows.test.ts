import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { AgentComposer } from "./mso-agent-composer.mjs";
import { reserveComposerRows } from "./mso-agent-composer-ui.mjs";

class FakeInput extends EventEmitter {
  isRaw = false;
  resume() {}
  pause() {}
  setRawMode(value: boolean) { this.isRaw = value; }
}

class FakeOutput extends EventEmitter {
  isTTY = true;
  columns = 80;
  rows = 24;
  chunks: string[] = [];
  write(value: string) {
    this.chunks.push(String(value));
    return true;
  }
}

// Parses ANSI cursor movement sequences to determine net vertical row delta.
function parseVerticalDelta(outputStream: string): number {
  let delta = 0;
  const regex = /\x1b\[(\d+)([AB])|\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(outputStream)) !== null) {
    if (match[2] === "A") delta -= Number(match[1]);
    else if (match[2] === "B") delta += Number(match[1]);
    else delta += 1;
  }
  return delta;
}

describe("MSO Agent overlay menu and wrapped draft row reservation shrinking", () => {
  it("open the menu (12 items), render, close it, render: the reserved row count returns to the original value", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const colors = { blue: "", bold: "", reset: "", dim: "", warn: "", c: "", cyan: "", err: "" };
    const items = Array.from({ length: 12 }, (_, i) => ({ text: `/cmd${i}`, meta: `help ${i}` }));
    const composer = new AgentComposer({ input: input as never, output: output as never, colors });

    const answer = composer.question("› ", {
      complete: (value: string) => value.startsWith("/") ? items : [],
    } as never);

    // Initial state before opening completion menu
    expect(composer.reservedRows()).toBe(0);

    // Typing slash triggers complete() with 12 items. completionWindow caps visible items to 8,
    // plus top and bottom borders, producing 10 menu lines below the 1-line draft (total 11 lines).
    input.emit("keypress", "/", { name: "/", sequence: "/" });
    expect(composer.reservedRows()).toBe(10);

    // Esc dismisses the completion overlay. Reserved rows must shrink back to 0 instead of ratcheting.
    input.emit("keypress", undefined, { name: "escape", sequence: "\x1b" });
    expect(composer.reservedRows()).toBe(0);

    // Direct reserveComposerRows check confirms symmetric return value contract.
    const directOutput = new FakeOutput();
    expect(reserveComposerRows(directOutput, 0, 10)).toBe(10);
    expect(reserveComposerRows(directOutput, 10, 0)).toBe(0);

    composer.cancelCurrent({ echo: false });
    await answer;
    composer.close();
  });

  it("after closing, the total emitted cursor movement leaves the cursor on the same row it started on", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const colors = { blue: "", bold: "", reset: "", dim: "", warn: "", c: "", cyan: "", err: "" };
    const items = Array.from({ length: 12 }, (_, i) => ({ text: `/cmd${i}`, meta: `help ${i}` }));
    const composer = new AgentComposer({ input: input as never, output: output as never, colors });

    const answer = composer.question("› ", {
      complete: (value: string) => value.startsWith("/") ? items : [],
    } as never);

    // Open menu
    input.emit("keypress", "/", { name: "/", sequence: "/" });
    expect(composer.reservedRows()).toBe(10);

    // Capture output specifically during the close action
    const beforeClose = output.chunks.length;
    input.emit("keypress", undefined, { name: "escape", sequence: "\x1b" });
    const closeOutput = output.chunks.slice(beforeClose).join("");

    // Net vertical cursor movement during close repaint must sum to 0.
    const verticalDelta = parseVerticalDelta(closeOutput);
    expect(verticalDelta).toBe(0);

    // Cumulative vertical position across the whole session must also sit on row 0.
    const totalOutput = output.chunks.join("");
    const cumulativeDelta = parseVerticalDelta(totalOutput);
    expect(cumulativeDelta).toBe(0);

    composer.cancelCurrent({ echo: false });
    await answer;
    composer.close();
  });

  it("typing a wrapped draft that grows the frame, then backspacing to one line, also shrinks the reservation back", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    output.columns = 20; // lineWidth is 16 with prompt "› "
    const colors = { blue: "", bold: "", reset: "", dim: "", warn: "", c: "", cyan: "", err: "" };
    const composer = new AgentComposer({ input: input as never, output: output as never, colors });

    const answer = composer.question("› ");
    expect(composer.reservedRows()).toBe(0);

    // Type 35 chars to wrap across 3 lines: row 0 (16 chars), row 1 (16 chars), row 2 (3 chars).
    for (const ch of "a".repeat(35)) input.emit("keypress", ch, { name: ch, sequence: ch });
    expect(composer.reservedRows()).toBe(2);

    // Backspace 30 characters to return to 5 characters on a single visual row.
    for (let i = 0; i < 30; i++) {
      input.emit("keypress", undefined, { name: "backspace", sequence: "\x7f" });
    }
    expect(composer.reservedRows()).toBe(0);

    composer.cancelCurrent({ echo: false });
    await answer;
    composer.close();
  });

  it("no newline is emitted during any of the above repaints", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    output.columns = 20;
    const colors = { blue: "", bold: "", reset: "", dim: "", warn: "", c: "", cyan: "", err: "" };
    const items = Array.from({ length: 12 }, (_, i) => ({ text: `/cmd${i}`, meta: `help ${i}` }));
    const composer = new AgentComposer({ input: input as never, output: output as never, colors });

    const answer = composer.question("› ", {
      complete: (value: string) => value.startsWith("/") ? items : [],
    } as never);

    // Initial render is done. Now open menu.
    input.emit("keypress", "/", { name: "/", sequence: "/" });

    // Close menu: repaint must NOT emit any newline characters.
    const beforeClose = output.chunks.length;
    input.emit("keypress", undefined, { name: "escape", sequence: "\x1b" });
    const closeWrites = output.chunks.slice(beforeClose).join("");
    expect(closeWrites).not.toContain("\n");

    // Grow draft by typing wrapped text.
    for (const ch of "z".repeat(35)) input.emit("keypress", ch, { name: ch, sequence: ch });

    // Shrink draft by backspacing: in-place repaint must NOT emit any newline characters.
    const beforeBackspace = output.chunks.length;
    for (let i = 0; i < 30; i++) {
      input.emit("keypress", undefined, { name: "backspace", sequence: "\x7f" });
    }
    const backspaceWrites = output.chunks.slice(beforeBackspace).join("");
    expect(backspaceWrites).not.toContain("\n");

    // Direct shrink reservation call must also never emit newlines.
    const directOutput = new FakeOutput();
    reserveComposerRows(directOutput, 12, 0);
    expect(directOutput.chunks.join("")).not.toContain("\n");

    composer.cancelCurrent({ echo: false });
    await answer;
    composer.close();
  });
});
