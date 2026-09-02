import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

const root = mkdtempSync(path.join(os.tmpdir(), "mso-mcp-local-two-way-"));
process.env.OS_AGENT_SESSIONS_DIR = path.join(root, "sessions");
process.env.OS_LOCAL_AGENT_PRESENCE_STORE = path.join(root, "presence.json");
process.env.OS_LOCAL_AGENT_MESSAGE_STORE = path.join(root, "messages.json");
process.env.OS_LOCAL_AGENT_LEASE_MS = "15000";
process.env.NEXT_PUBLIC_OS_DEMO = "0";

const store = await import("@/lib/agent/session-store");
const events = await import("@/lib/agent/local-agent-events");
const { dispatch } = await import("./dispatch");

const principal = "mcp-client:two-way-test";
let a: Awaited<ReturnType<typeof store.createAgentSession>>;
let b: Awaited<ReturnType<typeof store.createAgentSession>>;

const call = (name: string, args: Record<string, unknown> = {}) =>
  ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

function textResult<T>(response: Awaited<ReturnType<typeof dispatch>>): T {
  const result = response.result as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0].text) as T;
}

async function waitForSubscriber(sessionId: string): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (events.localAgentSubscriberCount(sessionId) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`receiver ${sessionId} never subscribed`);
}

beforeAll(async () => {
  a = await store.createAgentSession(principal, "mcp", { title: "Chat A", titleSource: "manual" });
  b = await store.createAgentSession(principal, "mcp", { title: "Chat B", titleSource: "manual" });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("two-way Local Agent MCP receive", () => {
  it("keeps each foreground inbox receivable and wakes both ChatGPT-style sessions without spawning a worker", async () => {
    const contextA = { principal, sessionId: a.id };
    const contextB = { principal, sessionId: b.id };

    const receiveB = dispatch(call("local_agent_inbox", { wait_ms: 1000 }), "read", "mcp:b", contextB);
    await waitForSubscriber(b.id);

    const sent = await dispatch(call("local_agent_message_send", {
      target: b.name,
      message: "PING_FROM_A",
      intent: "request",
    }), "write", "mcp:a", contextA);
    expect(textResult<{ status: string }>(sent).status).toBe("delivered");

    const inboxB = textResult<Array<{ id: string; text: string; intent: string }>>(await receiveB);
    expect(inboxB).toHaveLength(1);
    expect(inboxB[0]).toMatchObject({ text: "PING_FROM_A", intent: "request" });
    expect(events.localAgentSubscriberCount(b.id)).toBe(0);

    const receiveA = dispatch(call("local_agent_inbox", { wait_ms: 1000 }), "read", "mcp:a", contextA);
    await waitForSubscriber(a.id);

    const replied = await dispatch(call("local_agent_reply", {
      reply_to_message_id: inboxB[0].id,
      message: "PONG_FROM_B",
    }), "write", "mcp:b", contextB);
    expect(textResult<{ status: string }>(replied).status).toBe("delivered");

    const inboxA = textResult<Array<{ text: string; intent: string; replyToMessageId?: string }>>(await receiveA);
    expect(inboxA).toHaveLength(1);
    expect(inboxA[0]).toMatchObject({
      text: "PONG_FROM_B",
      intent: "reply",
      replyToMessageId: inboxB[0].id,
    });
    expect(events.localAgentSubscriberCount(a.id)).toBe(0);
  });

  it("preserves immediate reads when wait_ms is omitted", async () => {
    const startedAt = Date.now();
    const response = await dispatch(call("local_agent_inbox"), "read", "mcp:a", { principal, sessionId: a.id });
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(Array.isArray(textResult<unknown[]>(response))).toBe(true);
  });
});
