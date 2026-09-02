import { describe, expect, it, vi } from "vitest";
import { dispatchLocalAgentMention, mentionAck, parseLocalAgentMention, resolveLocalAgentMention } from "./mso-agent-mentions.mjs";

const rows = [
  { id: "session-b", alias: "agent-b", label: "[agent-b]", title: "Session B", titleSource: "auto", status: "idle" },
  { id: "session-z", alias: "agent-c", label: "[zahra]", title: "zahra", titleSource: "manual", status: "idle" },
];

describe("local agent @mention routing", () => {
  it("parses and resolves valid aliases/manual labels", () => {
    expect(parseLocalAgentMention("@agent-b tebak: apa yang punya banyak kunci?")).toEqual({ target: "agent-b", prompt: "tebak: apa yang punya banyak kunci?" });
    expect(resolveLocalAgentMention(rows, "agent-b").id).toBe("session-b");
    expect(resolveLocalAgentMention(rows, "zahra").id).toBe("session-z");
  });

  it("fails unknown mentions with available stable aliases", () => {
    expect(() => resolveLocalAgentMention(rows, "missing")).toThrow(/@missing not found.*@agent-b.*@agent-c/i);
  });

  it("dispatches a mention as a correlated request and persists the parent request", async () => {
    const history: unknown[] = [];
    const session = { agentSession: { id: "session-a" }, history };
    const api = vi.fn(async (path: string, init?: RequestInit) => {
      if (!init?.method) return { agents: rows };
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ target: "session-b", intent: "request", requiresUserRelay: true });
      return {
        status: "delivered", target: rows[0],
        message: { id: "localmsg_11111111-1111-1111-1111-111111111111", correlationId: "localcorr_22222222-2222-2222-2222-222222222222", createdAt: new Date().toISOString() },
      };
    });
    const persist = vi.fn(async () => {});
    const out = await dispatchLocalAgentMention(session, "@agent-b tebak ini", { api, persist });
    expect(out?.result.status).toBe("delivered");
    expect(history).toEqual(expect.arrayContaining([expect.objectContaining({ role: "local_request", targetSessionId: "session-b", requiresUserRelay: true })]));
    expect(persist).toHaveBeenCalledOnce();
  });

  it("reports offline/queued UX without pretending the target ran", () => {
    expect(mentionAck({ target: { label: "[agent-b]" }, status: "target_offline" })).toMatch(/queued · target offline/i);
    expect(mentionAck({ target: { label: "[agent-b]" }, status: "queued" })).toMatch(/target busy/i);
  });

  it("reports bounded lookup timeout without sending anything", async () => {
    const timeout = new Error("timeout"); timeout.name = "TimeoutError";
    await expect(dispatchLocalAgentMention({ agentSession: { id: "session-a" }, history: [] }, "@agent-b hi", {
      api: vi.fn(async () => { throw timeout; }), persist: vi.fn(),
    })).rejects.toThrow(/lookup timed out; no message was sent/i);
  });
});
