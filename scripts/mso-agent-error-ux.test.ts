import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { AgentApiError, AgentMutationUncertainError, recoverableErrorLines, recoverableTurnState } from "./mso-agent-errors.mjs";
import { sectionBlock } from "./mso-agent-layout.mjs";
import { AgentComposer } from "./mso-agent-composer.mjs";
import { agentRound, executeTool } from "./mso-agent-turn.mjs";

const colors = { blue: "", bold: "", reset: "", dim: "", c: "", cyan: "", warn: "", err: "" };

describe("MSO Agent recoverable API/tool error UX", () => {
  it("reports HTTP 400 after a successful mutation as completed, never as a reason to repeat it", () => {
    const error = new AgentApiError("assistant rejected follow-up", { status: 400, path: "/api/assistant", method: "POST", requestDispatched: true });
    const state = recoverableTurnState(error, { calls: [{ name: "fs_write", scope: "write", ok: true }] });
    expect(state).toMatchObject({ mutationState: "completed", mutationTool: "fs_write", status: 400 });
    expect(state.action).toMatch(/do not repeat/i);
  });

  it("reports HTTP 400 before any mutation as not started", () => {
    const error = new AgentApiError("bad assistant request", { status: 400, path: "/api/assistant", method: "POST", requestDispatched: true });
    expect(recoverableTurnState(error, { calls: [] })).toMatchObject({ mutationState: "not_started", status: 400 });
  });

  it("stops an uncertain write API failure after exactly one dispatch instead of returning it to the model for retry", async () => {
    const request = vi.fn(async () => { throw new AgentApiError("HTTP 400", { status: 400, path: "/api/v1/agent-tools", method: "POST", requestDispatched: true }); });
    const tool = { name: "fs_write", scope: "write" };
    await expect(executeTool(null, tool, { name: "fs_write", input: { path: "/tmp/x", text: "x" } }, { id: "session-a" }, "yolo", undefined, null, {
      quiet: true, apiRequest: request,
    })).rejects.toBeInstanceOf(AgentMutationUncertainError);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a completed mutation when the following assistant request fails with HTTP 400", async () => {
    const session: any = {
      history: [{ role: "user", text: "write once" }], permission: "yolo",
      state: { tools: [{ name: "fs_write", scope: "write" }], modelMeta: null },
      agentSession: { id: "session-a", name: "milo" },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, lastElapsedMs: 0,
    };
    const stream = vi.fn()
      .mockResolvedValueOnce({ text: "", toolUses: [{ id: "call-1", name: "fs_write", input: { path: "/tmp/a", text: "a" } }], usage: null })
      .mockRejectedValueOnce(new AgentApiError("follow-up bad request", { status: 400, path: "/api/assistant", method: "POST", requestDispatched: true }));
    const toolExecutor = vi.fn(async () => ({ ok: true, result: "written" }));
    let caught: any;
    try { await agentRound(null, session, null, undefined, null, { quiet: true, streamTurn: stream, executeTool: toolExecutor }); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AgentApiError);
    expect(toolExecutor).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(2);
    expect(recoverableTurnState(caught, caught.turnJournal)).toMatchObject({ mutationState: "completed", mutationTool: "fs_write" });
  });

  it("does not dispatch any tool when the assistant request fails before tool planning", async () => {
    const session: any = {
      history: [{ role: "user", text: "read" }], permission: "ask",
      state: { tools: [{ name: "fs_read", scope: "read" }], modelMeta: null },
      agentSession: { id: "session-a", name: "milo" }, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
    const stream = vi.fn(async () => { throw new AgentApiError("bad request", { status: 400, path: "/api/assistant", method: "POST", requestDispatched: true }); });
    const toolExecutor = vi.fn();
    await expect(agentRound(null, session, null, undefined, null, { quiet: true, streamTurn: stream, executeTool: toolExecutor })).rejects.toBeInstanceOf(AgentApiError);
    expect(toolExecutor).not.toHaveBeenCalled();
  });

  it("preserves a pending exact approval if the approval interaction itself fails recoverably", async () => {
    const approvalState: any = { pendingApproval: null };
    const rl = { question: vi.fn(async () => { throw new AgentApiError("approval UI transport failed", { status: 400, path: "/approval", method: "POST", requestDispatched: false }); }) };
    await expect(executeTool(rl, { name: "fs_write", scope: "write" }, { name: "fs_write", input: { path: "/tmp/a", text: "a" } }, { id: "session-a" }, "ask", undefined, null, {
      quiet: true, approvalState,
    })).rejects.toBeInstanceOf(AgentApiError);
    expect(approvalState.pendingApproval).toMatchObject({ tool: "fs_write", scope: "write" });
  });

  it("treats a POST transport failure as uncertain even without a response", () => {
    const error = new AgentApiError("socket closed", { path: "/api/v1/agent-sessions", method: "POST", requestDispatched: false });
    expect(recoverableTurnState(error, { calls: [] })).toMatchObject({ mutationState: "uncertain", requestDispatched: false });
  });

  it("redacts secret-shaped error text from the user-facing error section", () => {
    const state = recoverableTurnState(new AgentApiError("password=supersecret failed", { status: 400, path: "/api/x", method: "GET", requestDispatched: true }));
    const rendered = recoverableErrorLines(state).join("\n");
    expect(rendered).toContain("password=[redacted]");
    expect(rendered).not.toContain("supersecret");
  });

  it("preserves an in-progress draft when a recoverable error section is rendered above the composer", async () => {
    class FakeInput extends EventEmitter { isRaw = false; resume() {} pause() {} setRawMode(v: boolean) { this.isRaw = v; } }
    class FakeOutput extends EventEmitter { columns = 64; rows = 18; chunks: string[] = []; write(v: string) { this.chunks.push(String(v)); return true; } }
    const input = new FakeInput(), output = new FakeOutput();
    const composer = new AgentComposer({ input: input as never, output: output as never, colors });
    const answer = composer.question("@milo › ", { footer: "mode ask · Tab cycle", separator: "── Input ──" } as never);
    for (const ch of "draft") input.emit("keypress", ch, { name: ch, sequence: ch });
    composer.notify(sectionBlock("error", "HTTP 400 · no mutation repeated", { columns: output.columns, colors }));
    for (const ch of " kept") input.emit("keypress", ch, { name: ch, sequence: ch });
    input.emit("keypress", "\r", { name: "return", sequence: "\r" });
    await expect(answer).resolves.toBe("draft kept");
    const rendered = output.chunks.join("");
    expect(rendered).toContain("Error");
    expect(rendered).toContain("HTTP 400 · no mutation repeated");
    expect(rendered).toContain("mode ask");
    expect(rendered).toContain("draft kept");
    composer.close();
  });
});
