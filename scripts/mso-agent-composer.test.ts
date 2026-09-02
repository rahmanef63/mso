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

  it("submits an exact slash command instead of a longer highlighted prefix", async () => {
    class FakeInput extends EventEmitter {
      isRaw = false; resume() {} pause() {} setRawMode(value: boolean) { this.isRaw = value; }
    }
    class FakeOutput { columns = 88; chunks: string[] = []; write(value: string) { this.chunks.push(String(value)); return true; } }
    const input = new FakeInput(); const output = new FakeOutput();
    const composer = new AgentComposer({ input: input as never, output: output as never, colors: { blue: "", bold: "", reset: "", dim: "" } });
    const answer = composer.question("› ", { complete: (value: string) => value.startsWith("/model") ? [
      { text: "/models", meta: "provider auth" }, { text: "/model", meta: "select model" },
    ] : [] } as never);
    for (const ch of "/model") input.emit("keypress", ch, { name: ch, sequence: ch });
    input.emit("keypress", "\r", { name: "return", sequence: "\r" });
    await expect(answer).resolves.toBe("/model");
    composer.close();
  });


  it("renders skill lifecycle markers distinctly from commands", async () => {
    class FakeInput extends EventEmitter {
      isRaw = false; resume() {} pause() {} setRawMode(value: boolean) { this.isRaw = value; }
    }
    class FakeOutput { columns = 96; chunks: string[] = []; write(value: string) { this.chunks.push(String(value)); return true; } }
    const input = new FakeInput(); const output = new FakeOutput();
    const colors = { blue: "<b>", warn: "<w>", c: "<g>", bold: "<B>", reset: "</>", dim: "<d>" };
    const composer = new AgentComposer({ input: input as never, output: output as never, colors });
    const answer = composer.question("› ", { complete: (value: string) => value.startsWith("/") ? [
      { text: "/ready", meta: "ready", kind: "skill", state: "ready" },
      { text: "/queued", meta: "queued", kind: "skill", state: "queued" },
      { text: "/invoked", meta: "invoked", kind: "skill", state: "invoked" },
    ] : [] } as never);
    input.emit("keypress", "/", { name: "/", sequence: "/" });
    const rendered = output.chunks.join("");
    expect(rendered).toContain("◇");
    expect(rendered).toContain("◆");
    expect(rendered).toContain("✓");
    expect(rendered).toContain("<w>");
    expect(rendered).toContain("<g>");
    input.emit("keypress", undefined, { ctrl: true, name: "c" });
    input.emit("keypress", undefined, { ctrl: true, name: "c" });
    await answer; composer.close();
  });


  it("exits on Ctrl+C at an empty prompt but only clears when text exists", async () => {
    class FakeInput extends EventEmitter { isRaw = false; resume() {} pause() {} setRawMode(value: boolean) { this.isRaw = value; } }
    class FakeOutput { columns = 88; chunks: string[] = []; write(value: string) { this.chunks.push(String(value)); return true; } }
    const colors = { blue: "", bold: "", reset: "", dim: "" };

    const input1 = new FakeInput(); const output1 = new FakeOutput();
    const composer1 = new AgentComposer({ input: input1 as never, output: output1 as never, colors });
    const empty = composer1.question("› ");
    input1.emit("keypress", undefined, { ctrl: true, name: "c", sequence: "\u0003" });
    await expect(empty).resolves.toBeNull();
    expect(input1.isRaw).toBe(false);
    composer1.close();

    const input2 = new FakeInput(); const output2 = new FakeOutput();
    const composer2 = new AgentComposer({ input: input2 as never, output: output2 as never, colors });
    const edited = composer2.question("› ");
    for (const ch of "draft") input2.emit("keypress", ch, { name: ch, sequence: ch });
    input2.emit("keypress", undefined, { ctrl: true, name: "c", sequence: "\u0003" });
    for (const ch of "kept") input2.emit("keypress", ch, { name: ch, sequence: ch });
    input2.emit("keypress", "\r", { name: "return", sequence: "\r" });
    await expect(edited).resolves.toBe("kept");
    composer2.close();
  });

  it("matches readline Ctrl+D, Ctrl+W, Ctrl+L and Ctrl+B/F editing behavior", async () => {
    class FakeInput extends EventEmitter { isRaw = false; resume() {} pause() {} setRawMode(value: boolean) { this.isRaw = value; } }
    class FakeOutput { columns = 88; chunks: string[] = []; write(value: string) { this.chunks.push(String(value)); return true; } }
    const input = new FakeInput(); const output = new FakeOutput();
    const composer = new AgentComposer({ input: input as never, output: output as never, colors: { blue: "", bold: "", reset: "", dim: "" } });
    const answer = composer.question("› ");
    for (const ch of "hello world") input.emit("keypress", ch, { name: ch, sequence: ch });
    input.emit("keypress", undefined, { ctrl: true, name: "w", sequence: "\u0017" });
    input.emit("keypress", undefined, { ctrl: true, name: "b", sequence: "\u0002" });
    input.emit("keypress", undefined, { ctrl: true, name: "d", sequence: "\u0004" });
    input.emit("keypress", undefined, { ctrl: true, name: "f", sequence: "\u0006" });
    const beforeClear = output.chunks.length;
    input.emit("keypress", undefined, { ctrl: true, name: "l", sequence: "\u000c" });
    expect(output.chunks.slice(beforeClear).join("")).toContain("\x1b[2J\x1b[H");
    input.emit("keypress", "\r", { name: "return", sequence: "\r" });
    await expect(answer).resolves.toBe("hello");
    composer.close();
  });

  it("uses Ctrl+P/N as history aliases and Ctrl+D exits an empty prompt", async () => {
    class FakeInput extends EventEmitter { isRaw = false; resume() {} pause() {} setRawMode(value: boolean) { this.isRaw = value; } }
    class FakeOutput { columns = 88; chunks: string[] = []; write(value: string) { this.chunks.push(String(value)); return true; } }
    const input = new FakeInput(); const output = new FakeOutput();
    const composer = new AgentComposer({ input: input as never, output: output as never, colors: { blue: "", bold: "", reset: "", dim: "" } });
    const first = composer.question("› ");
    for (const ch of "first") input.emit("keypress", ch, { name: ch, sequence: ch });
    input.emit("keypress", "\r", { name: "return", sequence: "\r" });
    await expect(first).resolves.toBe("first");

    const second = composer.question("› ");
    input.emit("keypress", undefined, { ctrl: true, name: "p", sequence: "\u0010" });
    input.emit("keypress", undefined, { ctrl: true, name: "n", sequence: "\u000e" });
    input.emit("keypress", undefined, { ctrl: true, name: "p", sequence: "\u0010" });
    input.emit("keypress", "\r", { name: "return", sequence: "\r" });
    await expect(second).resolves.toBe("first");

    const eof = composer.question("› ");
    input.emit("keypress", undefined, { ctrl: true, name: "d", sequence: "\u0004" });
    await expect(eof).resolves.toBeNull();
    composer.close();
  });


  it("can cancel a waiting prompt when Ctrl+C arrives as an OS SIGINT after an external TTY child", async () => {
    class FakeInput extends EventEmitter { isRaw = false; resume() {} pause() {} setRawMode(value: boolean) { this.isRaw = value; } }
    class FakeOutput { columns = 88; chunks: string[] = []; write(value: string) { this.chunks.push(String(value)); return true; } }
    const input = new FakeInput(); const output = new FakeOutput();
    const composer = new AgentComposer({ input: input as never, output: output as never, colors: { blue: "", bold: "", reset: "", dim: "" } });
    const waiting = composer.question("› ");
    expect(composer.cancelCurrent()).toBe(true);
    await expect(waiting).resolves.toBeNull();
    expect(output.chunks.join("")).toContain("^C\r\n");
    expect(composer.cancelCurrent()).toBe(false);
    composer.close();
  });

  it("prints an incoming agent event above the active prompt without losing draft input", async () => {
    class FakeInput extends EventEmitter { isRaw = false; resume() {} pause() {} setRawMode(value: boolean) { this.isRaw = value; } }
    class FakeOutput { columns = 88; chunks: string[] = []; write(value: string) { this.chunks.push(String(value)); return true; } }
    const input = new FakeInput(); const output = new FakeOutput();
    const composer = new AgentComposer({ input: input as never, output: output as never, colors: { blue: "", bold: "", reset: "", dim: "" } });
    const answer = composer.question("› ");
    for (const ch of "draft") input.emit("keypress", ch, { name: ch, sequence: ch });
    expect(composer.notify("[agent-zahra] hello")).toBe(true);
    for (const ch of " kept") input.emit("keypress", ch, { name: ch, sequence: ch });
    input.emit("keypress", "\r", { name: "return", sequence: "\r" });
    await expect(answer).resolves.toBe("draft kept");
    const rendered = output.chunks.join("");
    expect(rendered).toContain("[agent-zahra] hello\r\n");
    expect(rendered).toContain("draft kept");
    composer.close();
  });


});
