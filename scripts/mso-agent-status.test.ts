import { describe, expect, it } from "vitest";
import { addUsage, contextStatus, estimateTokens, statusParts } from "./mso-agent-status.mjs";

describe("MSO Agent dynamic status", () => {
  it("labels provider-neutral context as an estimate and uses catalog context window", () => {
    expect(estimateTokens("abcd")).toBe(1);
    const ctx = contextStatus([{ role: "user", text: "hello world" }], { context: 128000 });
    expect(ctx.used).toBeGreaterThan(0);
    expect(ctx.limit).toBe(128000);
    expect(ctx.percent).toBeGreaterThanOrEqual(0);
  });

  it("accumulates provider-reported usage without losing fallback status", () => {
    const usage = addUsage(addUsage(null, { inputTokens: 10, outputTokens: 4 }), { input_tokens: 6, output_tokens: 2 });
    expect(usage).toEqual({ inputTokens: 16, outputTokens: 6, totalTokens: 22 });
    const parts = statusParts({
      state: { config: { provider: "openai-codex", model: "gpt-5.6-sol" }, modelMeta: { context: 128000 } },
      history: [{ role: "user", text: "hello" }], usage, agentSession: { id: "20260901_120000_deadbeef" },
    }, "/tmp");
    expect(parts.join(" ")).toContain("openai-codex/gpt-5.6-sol");
    expect(parts.join(" ")).toContain("tokens 22");
  });

  it("shows whether a skill is queued or really invoked", () => {
    const base = {
      state: { config: { provider: "openai-codex", model: "gpt-5.6-sol" }, modelMeta: null },
      history: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      agentSession: { id: "20260901_120000_deadbeef" },
    };
    const queued = statusParts({ ...base, pendingSkill: { id: "design", name: "design" } }, "/tmp").join(" ");
    expect(queued).toContain("skill ◆ /design queued");
    const invoked = statusParts({ ...base, lastInvokedSkill: { id: "design", name: "design" } }, "/tmp").join(" ");
    expect(invoked).toContain("skill ✓ /design");
  });


  it("uses the human session title in compact status while keeping the id for detailed diagnostics", () => {
    const session = {
      state: { config: { provider: "openai-codex", model: "gpt-5.6-sol" }, modelMeta: null },
      history: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      agentSession: { id: "20260901_120000_deadbeef", title: "test tui mso" },
    };
    const compact = statusParts(session, "/tmp").join(" · ");
    expect(compact).toContain("session test tui mso");
    expect(compact).toContain("permission ask");
    expect(compact).not.toContain("deadbeef");
  });

});
