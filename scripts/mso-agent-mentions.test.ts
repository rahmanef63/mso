import { describe, expect, it, vi } from "vitest";
import { dispatchLocalAgentMention, mentionAck, parseLocalAgentMention, resolveLocalAgentMention } from "./mso-agent-mentions.mjs";

const rows = [
  { id: "session-b", name: "milo", alias: "agent-b", label: "[milo]", title: "Session B", titleSource: "auto", status: "idle" },
  { id: "session-z", name: "zahra", alias: "agent-c", label: "[zahra]", title: "Design review", titleSource: "manual", status: "idle" },
  { id: "session-o", name: "luna", alias: "agent-d", label: "[luna]", title: "Offline", titleSource: "auto", status: "offline" },
];

describe("local agent @mention routing", () => {
  it("parses and resolves active public names only", () => {
    expect(parseLocalAgentMention("@milo tebak: apa yang punya banyak kunci?")).toEqual({ target: "milo", prompt: "tebak: apa yang punya banyak kunci?" });
    expect(resolveLocalAgentMention(rows, "milo").id).toBe("session-b");
    expect(resolveLocalAgentMention(rows, "zahra").id).toBe("session-z");
    expect(() => resolveLocalAgentMention(rows, "agent-b")).toThrow(/not found/i);
    expect(() => resolveLocalAgentMention(rows, "luna")).toThrow(/not found/i);
  });

  it("fails unknown mentions with active public names only", () => {
    expect(() => resolveLocalAgentMention(rows, "missing")).toThrow(/@missing not found.*@milo.*@zahra/i);
  });

  it("dispatches a mention as a correlated request and persists the parent request", async () => {
    const history: unknown[] = [];
    const session = { agentSession: { id: "session-a" }, history };
    const api = vi.fn(async (path: string, init?: RequestInit) => {
      if (!init?.method) return { agents: rows };
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ target: "session-b", intent: "request", requiresUserRelay: true, activeOnly: true });
      return {
        status: "delivered", target: rows[0],
        message: { id: "localmsg_11111111-1111-1111-1111-111111111111", correlationId: "localcorr_22222222-2222-2222-2222-222222222222", createdAt: new Date().toISOString() },
      };
    });
    const persist = vi.fn(async () => {});
    const out = await dispatchLocalAgentMention(session, "@milo tebak ini", { api, persist });
    expect(out?.result.status).toBe("delivered");
    expect(history).toEqual(expect.arrayContaining([expect.objectContaining({ role: "local_request", targetSessionId: "session-b", requiresUserRelay: true })]));
    expect(persist).toHaveBeenCalledOnce();
  });

  it("reports offline/queued UX without pretending the target ran", () => {
    expect(mentionAck({ target: { label: "[milo]" }, status: "target_offline" })).toMatch(/queued · target offline/i);
    expect(mentionAck({ target: { label: "[milo]" }, status: "queued" })).toMatch(/target busy/i);
  });

  it("explains an active lease with no subscribed receiver instead of pretending it ran", () => {
    expect(mentionAck({ target: { label: "[milo]", consumerConnected: false }, status: "accepted" })).toMatch(/no receiver is subscribed/i);
  });

  it("reports bounded lookup timeout without sending anything", async () => {
    const timeout = new Error("timeout"); timeout.name = "TimeoutError";
    await expect(dispatchLocalAgentMention({ agentSession: { id: "session-a" }, history: [] }, "@milo hi", {
      api: vi.fn(async () => { throw timeout; }), persist: vi.fn(),
    })).rejects.toThrow(/lookup timed out; no message was sent/i);
  });
});
