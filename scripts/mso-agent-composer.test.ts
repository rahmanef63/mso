import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { AgentComposer, completionWindow, inputViewport } from "./mso-agent-composer.mjs";

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
  it("redraws arrow-key selection in place without emitting new lines", async () => {
    class FakeInput extends EventEmitter {
      isRaw = false;
      resume() {}
      pause() {}
      setRawMode(value: boolean) { this.isRaw = value; }
    }
    class FakeOutput {
      columns = 88;
      chunks: string[] = [];
      write(value: string) { this.chunks.push(String(value)); return true; }
    }
    const input = new FakeInput();
    const output = new FakeOutput();
    const colors = { blue: "", bold: "", reset: "", dim: "" };
    const composer = new AgentComposer({ input: input as never, output: output as never, colors });
    const answer = composer.question("› ", {
      complete: (value: string) => value.startsWith("/") ? [
        { text: "/help", meta: "help" },
        { text: "/model", meta: "model" },
        { text: "/skills", meta: "skills" },
      ] : [],
    } as never);

    input.emit("keypress", "/", { name: "/", sequence: "/" });
    const beforeDown = output.chunks.length;
    input.emit("keypress", undefined, { name: "down", sequence: "ESC-DOWN" });
    const downRedraw = output.chunks.slice(beforeDown).join("");
    expect(downRedraw).not.toContain("\n");
    expect(downRedraw).toContain("/model");

    const beforeUp = output.chunks.length;
    input.emit("keypress", undefined, { name: "up", sequence: "ESC-UP" });
    const upRedraw = output.chunks.slice(beforeUp).join("");
    expect(upRedraw).not.toContain("\n");
    expect(upRedraw).toContain("/help");

    input.emit("keypress", undefined, { ctrl: true, name: "c" });
    input.emit("keypress", undefined, { ctrl: true, name: "c" });
    await answer;
    composer.close();
  });

});
