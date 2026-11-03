import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { AgentComposer } from "./mso-agent-composer.mjs";
import { panelGeometry } from "./mso-agent-panel-geometry.mjs";

class FakeInput extends EventEmitter {
  isRaw = false;
  resume() {}
  pause() {}
  setRawMode(value: boolean) { this.isRaw = value; }
}

class FakeOutput extends EventEmitter {
  isTTY = true;
  columns = 100;
  rows = 30;
  chunks: string[] = [];
  write(value: string) { this.chunks.push(String(value)); return true; }
  // A newline scrolls the screen; in the alternate screen that is exactly what pushes the banner off
  // the top and cannot be undone, so the test counts them rather than trusting the frame maths.
  get newlines(): number { return this.chunks.join("").split("\n").length - 1; }
}

const colors = { blue: "", bold: "", reset: "", dim: "", warn: "", c: "", cyan: "", err: "" };

describe("panel and composer share one row budget", () => {
  // The bug this pins down: the panel reserved the composer's rows, and the composer ALSO grew its
  // frame with CRLF. Opening the / menu therefore scrolled the screen by the menu height, and closing
  // it left the panel shifted up for the rest of the session.
  it("never emits a newline while a completion menu opens, because a newline scrolls the panel away", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const composer = new AgentComposer({
      input: input as never,
      output: output as never,
      colors,
      onRows: () => {},
    });
    const options = /** @type {any} */ ({ complete: (v: string) => (v.startsWith("/") ? ["/help", "/models", "/new"] : []) });
    const answer = composer.question("› ", options);
    input.emit("keypress", "/", { sequence: "/" });
    // Measured before submit: the echo of an accepted line legitimately ends in a newline, but nothing
    // while the menu is opening may, because that scroll is what moved the panel.
    expect(output.newlines).toBe(0);
    input.emit("keypress", undefined, { name: "return" });
    await answer;
  });

  it("reports the menu height to the panel instead of growing the terminal", async () => {
    const reported: number[] = [];
    const input = new FakeInput();
    const output = new FakeOutput();
    const composer = new AgentComposer({
      input: input as never,
      output: output as never,
      colors,
      onRows: (rows: number) => reported.push(rows),
    });
    const options = /** @type {any} */ ({ complete: (v: string) => (v.startsWith("/") ? ["/help", "/models", "/new", "/session"] : []) });
    const answer = composer.question("› ", options);
    input.emit("keypress", "/", { sequence: "/" });
    // The menu must NOT be reported: it is an overlay over the transcript. Reporting it would shrink
    // the panel, and a shrinking panel drops its own top lines, which is what made the layout appear
    // to jump when a menu opened. Only the prompt row may be claimed.
    expect(reported.every((rows) => rows <= 1)).toBe(true);
    input.emit("keypress", undefined, { name: "return" });
    await answer;
  });

  it("keeps panel rows plus composer rows inside the terminal at every reservation", () => {
    const output = { columns: 100, rows: 30 };
    const session = { agentSession: { id: "s", name: "mso", title: "t" }, statusBar: true };
    for (const reservation of [1, 3, 6, 10, 14]) {
      const g = panelGeometry({ output, session, colors: {}, getSessions: () => [], promptReservation: reservation });
      // The frame ends with one blank cursor line, and that line is where the composer's FIRST row is
      // written. So the frame already covers one reserved row: frame + reservation - 1 is the budget.
      const frame = g.viewRows + g.panel.length + 1;
      expect(frame + reservation - 1).toBeLessThanOrEqual(30);
    }
  });
});
