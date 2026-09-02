import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { AgentComposer } from "./mso-agent-composer.mjs";
import { composerFooter, composerPrompt } from "./mso-agent-layout.mjs";

class FakeInput extends EventEmitter {
  isRaw = false;
  resume() {}
  pause() {}
  setRawMode(value: boolean) { this.isRaw = value; }
}
class FakeOutput {
  columns = 96;
  chunks: string[] = [];
  write(value: string) { this.chunks.push(String(value)); return true; }
}
const colors = { blue: "", bold: "", reset: "", dim: "" };

function composerFixture() {
  const input = new FakeInput(), output = new FakeOutput();
  const composer = new AgentComposer({ input: input as never, output: output as never, colors });
  return { input, output, composer };
}

describe("MSO Agent session/history composer UX", () => {
  it("renders a titled session dropdown immediately and submits its hidden id without printing it", async () => {
    const { input, output, composer } = composerFixture();
    const hiddenId = "20260901_192428_255bb637";
    const answer = composer.question("session › ", {
      history: false, panelLabel: "recent sessions", selectOnEnter: true, escapeCancels: true,
      complete: () => [{ text: "Renamed session", value: hiddenId, meta: "modified 2m ago" }],
    } as never);
    const initial = output.chunks.join("");
    expect(initial).toContain("recent sessions");
    expect(initial).toContain("Renamed session");
    expect(initial).toContain("modified 2m ago");
    expect(initial).not.toContain(hiddenId);
    input.emit("keypress", "\r", { name: "return", sequence: "\r" });
    await expect(answer).resolves.toBe(hiddenId);
    expect(output.chunks.join("")).not.toContain(hiddenId);
    composer.close();
  });

  it("recalls durable prompt history with Arrow Up and walks forward again with Arrow Down", async () => {
    const { input, composer } = composerFixture();
    composer.replaceHistory(["latest durable prompt", "older durable prompt"]);
    const answer = composer.question("› ");
    input.emit("keypress", undefined, { name: "up", sequence: "ESC-UP" });
    input.emit("keypress", undefined, { name: "up", sequence: "ESC-UP" });
    input.emit("keypress", undefined, { name: "down", sequence: "ESC-DOWN" });
    input.emit("keypress", "\r", { name: "return", sequence: "\r" });
    await expect(answer).resolves.toBe("latest durable prompt");
    composer.close();
  });

  it("keeps @name in the prompt while Tab repaints permission only in the bottom footer", async () => {
    const { input, output, composer } = composerFixture();
    const session: any = {
      permission: "ask", statusBar: false, history: [], agentSession: { name: "milo" },
      state: { config: {}, modelMeta: null }, usage: { totalTokens: 0 },
    };
    let cycles = 0;
    const answer = composer.question(() => composerPrompt(session, colors), {
      footer: () => composerFooter(session, colors, output.columns),
      onTab: () => { cycles++; session.permission = "yolo"; },
    } as never);
    const before = output.chunks.join("");
    expect(before).toContain("@milo › ");
    expect(before).toContain("mode ask");
    input.emit("keypress", "\t", { name: "tab", sequence: "\t" });
    const after = output.chunks.join("");
    expect(cycles).toBe(1);
    expect(after).toContain("@milo › ");
    expect(after).toContain("mode yolo");
    expect(after.slice(before.length)).not.toMatch(/[\r]?\n/);
    for (const ch of "go") input.emit("keypress", ch, { name: ch, sequence: ch });
    input.emit("keypress", "\r", { name: "return", sequence: "\r" });
    await expect(answer).resolves.toBe("go");
    expect(composer.history[0]).toBe("go");
    composer.close();
  });
});
