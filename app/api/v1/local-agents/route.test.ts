import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), touch: vi.fn(), end: vi.fn(), inbox: vi.fn(), update: vi.fn(), send: vi.fn(), reply: vi.fn(),
  subscribe: vi.fn(), flush: vi.fn(), audit: vi.fn(), rate: vi.fn(), getSession: vi.fn(),
}));
vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: vi.fn(async () => ({ role: "owner", session: { device_id: "cli-test" } })),
}));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rate }));
vi.mock("@/lib/agent/session-store", () => ({ getAgentSession: mocks.getSession }));
vi.mock("@/lib/agent/local-agent-directory", () => ({ listLocalAgents: mocks.list }));
vi.mock("@/lib/agent/local-agent-presence", () => ({ touchLocalAgentPresence: mocks.touch, endLocalAgentPresence: mocks.end }));
vi.mock("@/lib/agent/local-agent-mailbox", () => ({ listLocalAgentInbox: mocks.inbox, updateLocalAgentMessageState: mocks.update }));
vi.mock("@/lib/agent/local-agent-messaging", () => ({ sendLocalAgentMessage: mocks.send, replyLocalAgentMessage: mocks.reply, flushLocalAgentQueue: mocks.flush }));
vi.mock("@/lib/agent/local-agent-events", () => ({ subscribeLocalAgentMessages: mocks.subscribe }));

const { GET, POST } = await import("./route");
const post = (body: object) => new NextRequest("http://localhost/api/v1/local-agents", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rate.mockReturnValue(false);
  mocks.getSession.mockResolvedValue({ id: "session-a", source: "cli" });
  mocks.list.mockResolvedValue([{ id: "session-b", label: "[agent-b]", status: "idle" }]);
  mocks.touch.mockResolvedValue({ sessionId: "session-a", alias: "agent-a", state: "idle" });
  mocks.flush.mockResolvedValue(0);
  mocks.inbox.mockResolvedValue([]);
  mocks.update.mockResolvedValue([]);
  mocks.send.mockResolvedValue({
    status: "delivered", targetStatus: "idle",
    sender: { id: "session-a", label: "[agent-a]" }, target: { id: "session-b", label: "[agent-b]" },
    message: { id: "localmsg_1", kind: "message", intent: "notify", requiresUserRelay: false, text: "hello" },
  });
  mocks.reply.mockResolvedValue({
    status: "delivered", targetStatus: "idle",
    sender: { id: "session-a", label: "[agent-a]" }, target: { id: "session-b", label: "[agent-b]" },
    message: { id: "localmsg_reply", kind: "message", intent: "reply", correlationId: "localcorr_1", replyToMessageId: "localmsg_req", requiresUserRelay: true, text: "answer" },
  });
});

describe("native local agent API", () => {
  it("lists only same-principal live agents with the current session excluded", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/local-agents?session=session-a"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ agents: [{ id: "session-b", label: "[agent-b]", status: "idle" }] });
    expect(mocks.list).toHaveBeenCalledWith("cli:cli-test", { currentSessionId: "session-a", includeOffline: false });
  });

  it("sends an explicit local payload without routing through remote A2A", async () => {
    const response = await POST(post({ action: "send", sessionId: "session-a", target: "agent-b", message: "hello", kind: "message" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "delivered", target: { label: "[agent-b]" } });
    expect(mocks.send).toHaveBeenCalledWith({
      principal: "cli:cli-test", senderSessionId: "session-a", target: "agent-b", text: "hello", kind: "message",
      intent: undefined, correlationId: undefined, requiresUserRelay: false, requireActiveTarget: false,
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "agent.message", target: "session-b" }));
  });

  it("sends a deterministic reply to one exact correlated request", async () => {
    const response = await POST(post({ action: "reply", sessionId: "session-a", replyToMessageId: "localmsg_req", message: "answer" }));
    expect(response.status).toBe(200);
    expect(mocks.reply).toHaveBeenCalledWith({
      principal: "cli:cli-test", senderSessionId: "session-a", replyToMessageId: "localmsg_req", text: "answer", kind: undefined,
    });
    await expect(response.json()).resolves.toMatchObject({ message: { intent: "reply", replyToMessageId: "localmsg_req" } });
  });

  it("updates receive presence and flushes queued mail only when receivable", async () => {
    await POST(post({ action: "presence", sessionId: "session-a", instanceId: "tty:1", state: "busy" }));
    expect(mocks.flush).not.toHaveBeenCalled();
    await POST(post({ action: "presence", sessionId: "session-a", instanceId: "tty:1", state: "idle" }));
    expect(mocks.touch).toHaveBeenLastCalledWith("cli:cli-test", "session-a", "idle", "tty:1");
    expect(mocks.flush).toHaveBeenCalledWith("cli:cli-test", "session-a");
  });

  it("acks only messages addressed to the exact current durable session", async () => {
    mocks.update.mockResolvedValue([{ id: "localmsg_1", state: "read" }]);
    const response = await POST(post({ action: "ack", sessionId: "session-a", messageIds: ["localmsg_1"] }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("cli:cli-test", "session-a", ["localmsg_1"], "read");
  });
  it("rejects oversized API bodies before JSON parsing", async () => {
    const response = await POST(new NextRequest("http://localhost/api/v1/local-agents", {
      method: "POST", headers: { "content-type": "application/json", "content-length": String(200 * 1024) },
      body: JSON.stringify({ action: "send", sessionId: "session-a", target: "agent-b", message: "x" }),
    }));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "request_body_too_large" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

});
