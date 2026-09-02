import { describe, expect, it } from "vitest";
import { applyNewSessionState, restartSessionArg } from "./mso-agent-session-ui.mjs";

describe("MSO Agent /new session transition", () => {
  it("switches to a new durable id and clears conversation-local state", () => {
    const session = {
      agentSession: { id: "old", source: "cli", title: "old session" },
      history: [{ role: "user", text: "old prompt" }],
      pendingSkill: { id: "old-skill" },
      activeSkill: { id: "running" },
      lastInvokedSkill: { id: "done" },
      titleOverride: "old title",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      lastElapsedMs: 500,
    };
    applyNewSessionState(
      session,
      { id: "new", source: "cli", title: "MSO Agent session", history: [] },
      "",
    );
    expect(session.agentSession.id).toBe("new");
    expect(session.history).toEqual([]);
    expect(session.pendingSkill).toBeNull();
    expect(session.activeSkill).toBeNull();
    expect(session.lastInvokedSkill).toBeNull();
    expect(session.titleOverride).toBeNull();
    expect(session.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    expect(session.lastElapsedMs).toBe(0);
  });

  it("keeps an explicit /new title authoritative", () => {
    const session: any = {};
    applyNewSessionState(
      session,
      { id: "new", source: "cli", title: "baco-2", history: [] },
      "baco-2",
    );
    expect(session.titleOverride).toBe("baco-2");
  });
  it("parses only the restart-only exact session argument", () => {
    expect(restartSessionArg(["--restart-session", "sess_exact_1"])).toBe("sess_exact_1");
    expect(restartSessionArg(["--resume", "sess_other"])).toBeNull();
    expect(() => restartSessionArg(["--restart-session"])).toThrow(/exact durable session id/);
  });

});
