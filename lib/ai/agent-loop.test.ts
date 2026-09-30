import { expect, it, vi } from "vitest";
import { runToolAgent } from "./agent-loop";
import { streamAgentTurn } from "./stream";
vi.mock("./stream", () => ({ streamAgentTurn: vi.fn() }));
it("stops between tool calls and retains matching tool results", async () => {
  vi.mocked(streamAgentTurn).mockResolvedValue({ text: "", stopReason: null, toolUses: [
    { id: "one", name: "fs.read", input: {} }, { id: "two", name: "fs.write", input: {} },
  ] });
  const ctrl = new AbortController();
  const invoke = vi.fn(async () => { ctrl.abort(); return { ok: true, result: "read" }; });
  const result = await runToolAgent([], [], invoke, { onDelta: vi.fn(), onTool: vi.fn() }, 8, undefined, ctrl.signal);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(result.outcome).toBe("stopped");
  expect(result.history.at(-1)).toMatchObject({ role: "tool", results: [{ id: "one" }, { id: "two", isError: true }] });
});
it("reports the turn cap as a limit instead of successful completion", async () => {
  vi.mocked(streamAgentTurn).mockResolvedValue({ text: "", stopReason: null, toolUses: [{ id: "one", name: "fs.read", input: {} }] });
  const result = await runToolAgent([], [], async () => ({ ok: true, result: "read" }), { onDelta: vi.fn(), onTool: vi.fn() }, 1);
  expect(result.outcome).toBe("limit");
});
