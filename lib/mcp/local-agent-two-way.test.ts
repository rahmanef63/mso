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
  it("keeps read tokens from acknowledging messages or changing session metadata", async () => {
    const c = await store.createAgentSession(principal, "mcp", { title: "Read boundary", titleSource: "manual" });
    const inboxContext = { principal, sessionId: c.id };
    const receive = dispatch(call("local_agent_inbox", { wait_ms: 10000 }), "read", "mcp:c", inboxContext);
    await waitForSubscriber(c.id);
    await dispatch(call("local_agent_message_send", { target: c.name, message: "ACK_BOUNDARY" }), "write", "mcp:a", { principal, sessionId: a.id });
    const inbox = textResult<Array<{id:string}>>(await receive);
    expect(inbox).toHaveLength(1);
    const legacy = await dispatch(call("local_agent_inbox", { acknowledge: true }), "read", "mcp:c", inboxContext);
    expect(JSON.stringify(legacy)).toContain("local_agent_inbox_acknowledge");
    const denied = await dispatch(call("local_agent_inbox_acknowledge", { message_ids: [inbox[0].id] }), "read", "mcp:c", inboxContext);
    expect(denied.result).toMatchObject({isError:true});
    expect(textResult<unknown[]>(await dispatch(call("local_agent_inbox"), "read", "mcp:c", inboxContext))).toHaveLength(1);
    const opened = await dispatch(call("agent_session_open", { conversation_key: "read-boundary", title: "Changed" }), "read", "mcp:c", inboxContext);
    expect(opened.result).toMatchObject({isError:true});
    const acknowledged = await dispatch(call("local_agent_inbox_acknowledge", { message_ids: [inbox[0].id] }), "write", "mcp:c", inboxContext);
    expect(acknowledged.error).toBeUndefined();
    expect(textResult<unknown[]>(await dispatch(call("local_agent_inbox"), "read", "mcp:c", inboxContext))).toEqual([]);
  });
  it.each(["revoked", "disconnected"])("closes a %s inbox wait before serializing later private messages", async kind => {
    const c = await store.createAgentSession(principal, "mcp", { title: "Revocation boundary", titleSource: "manual" });
    const controller = new AbortController(); let authorized = true;
    const liveAuthorization = async () => { if (!authorized) throw new Error("authorization revoked"); };
    const receive = dispatch(call("local_agent_inbox", { wait_ms: 10000 }), "read", "mcp:c", { principal, sessionId: c.id, signal: controller.signal, liveAuthorization });
    await waitForSubscriber(c.id);
    if (kind === "revoked") authorized = false; else controller.abort(new Error("disconnected"));
    await dispatch(call("local_agent_message_send", { target: c.name, message: "PRIVATE_AFTER_REVOCATION" }), "write", "mcp:a", { principal, sessionId: a.id });
    expect(JSON.stringify(await receive)).not.toContain("PRIVATE_AFTER_REVOCATION");
    expect(events.localAgentSubscriberCount(c.id)).toBe(0);
  });
  it("keeps each foreground inbox receivable and wakes both ChatGPT-style sessions without spawning a worker", async () => {
    const contextA = { principal, sessionId: a.id };
    const contextB = { principal, sessionId: b.id };

    // Coverage under concurrent builds can exceed 1s; keep the real receiver
    // alive while asserting the same delivered/acknowledged semantics.
    const receiveB = dispatch(call("local_agent_inbox", { wait_ms: 10000 }), "read", "mcp:b", contextB);
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

    const receiveA = dispatch(call("local_agent_inbox", { wait_ms: 10000 }), "read", "mcp:a", contextA);
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
  }, 20000);

  it("preserves immediate reads when wait_ms is omitted", async () => {
    const subscribe = vi.spyOn(events, "subscribeLocalAgentMessages");
    const response = await dispatch(call("local_agent_inbox"), "read", "mcp:a", { principal, sessionId: a.id });
    expect(subscribe).not.toHaveBeenCalled();
    subscribe.mockRestore();
    expect(Array.isArray(textResult<unknown[]>(response))).toBe(true);
  });
  it("discards a correlated private reply after wait authorization expires", async () => {
    const sender = await store.createAgentSession(principal,"mcp",{title:"Wait sender",titleSource:"manual"});
    const receiver = await store.createAgentSession(principal,"mcp",{title:"Wait receiver",titleSource:"manual"});
    const receiverContext = {principal,sessionId:receiver.id}, senderContext = {principal,sessionId:sender.id};
    const inbox = dispatch(call("local_agent_inbox",{wait_ms:10000}),"read","mcp:receiver",receiverContext);
    await waitForSubscriber(receiver.id);
    await dispatch(call("local_agent_message_send",{target:receiver.name,message:"REQUEST",intent:"request"}),"write","mcp:sender",senderContext);
    const message = textResult<Array<{id:string}>>(await inbox)[0];
    let live=true, entered=false;
    const waiting = dispatch(call("local_agent_request_wait",{request_message_id:message.id,timeout_ms:10000}),"read","mcp:sender",{...senderContext,liveAuthorization:async()=>{entered=true;if(!live)throw new Error("expired");}});
    while (!entered) await new Promise(resolve=>setTimeout(resolve,1));
    live=false;
    await dispatch(call("local_agent_reply",{reply_to_message_id:message.id,message:"PRIVATE_EXPIRED_REPLY"}),"write","mcp:receiver",receiverContext);
    const result = await waiting;
    expect(result.result).toMatchObject({isError:true}); expect(JSON.stringify(result)).not.toContain("PRIVATE_EXPIRED_REPLY");
  });
});
