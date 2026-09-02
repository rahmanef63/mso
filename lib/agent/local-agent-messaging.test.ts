import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(os.tmpdir(), "mso-local-agent-messaging-"));
process.env.OS_AGENT_SESSIONS_DIR = path.join(root, "sessions");
process.env.OS_LOCAL_AGENT_PRESENCE_STORE = path.join(root, "presence.json");
process.env.OS_LOCAL_AGENT_MESSAGE_STORE = path.join(root, "messages.json");
process.env.OS_LOCAL_AGENT_LEASE_MS = "15000";
process.env.NEXT_PUBLIC_OS_DEMO = "0";

const store = await import("./session-store");
const presence = await import("./local-agent-presence");
const directory = await import("./local-agent-directory");
const mailbox = await import("./local-agent-mailbox");
const messaging = await import("./local-agent-messaging");
const events = await import("./local-agent-events");

const owner = "mcp-client:alpha";
let a: Awaited<ReturnType<typeof store.createAgentSession>>;
let b: Awaited<ReturnType<typeof store.createAgentSession>>;

beforeAll(async () => {
  a = await store.createAgentSession(owner, "mcp");
  b = await store.createAgentSession(owner, "mcp");
  await presence.touchLocalAgentPresence(owner, a.id, "idle", "test:a");
  await presence.touchLocalAgentPresence(owner, b.id, "idle", "test:b");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("native local session agents", () => {
  it("assigns short familiar unique public names to two live sessions", async () => {
    const rows = await directory.listLocalAgents(owner);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => /^[a-z][a-z0-9-]{1,23}$/.test(row.name))).toBe(true);
    expect(new Set(rows.map((row) => row.name)).size).toBe(2);
    expect(rows.every((row) => row.label === `[${row.name}]`)).toBe(true);
    expect(rows.map((row) => row.status)).toEqual(["idle", "idle"]);
    expect(rows.every((row) => row.consumerConnected === false && row.consumerCount === 0)).toBe(true);
  });

  it("session-name rename changes only the public handle and keeps durable identity/title", async () => {
    const id = a.id, title = a.title;
    a = await store.renameAgentSessionName(owner, a.id, "zahra");
    const rows = await directory.listLocalAgents(owner);
    expect(rows.find((row) => row.id === id)).toMatchObject({ id, name: "zahra", label: "[zahra]", title });
  });

  it("rejects duplicate public handles, then accepts a unique rename", async () => {
    await expect(store.renameAgentSessionName(owner, b.id, "zahra")).rejects.toThrow(/already in use/i);
    b = await store.renameAgentSessionName(owner, b.id, "rahman");
    const rows = await directory.listLocalAgents(owner);
    expect(rows.map((row) => row.name).sort()).toEqual(["rahman", "zahra"]);
    expect(rows.find((row) => row.id === b.id)?.alias).toBe("agent-b");
  });

  it("delivers an idle-target message to the live feed and durable inbox", async () => {
    const received: unknown[] = [];
    const unsubscribe = events.subscribeLocalAgentMessages(b.id, (message) => received.push(message));
    const subscribed = await directory.listLocalAgents(owner);
    expect(subscribed.find((row) => row.id === b.id)).toMatchObject({ consumerConnected: true, consumerCount: 1 });
    const result = await messaging.sendLocalAgentMessage({
      principal: owner,
      senderSessionId: a.id,
      target: "rahman",
      text: "please review this",
      kind: "message",
    });
    unsubscribe();
    expect(result.status).toBe("delivered");
    expect(result.sender.label).toBe("[zahra]");
    expect(result.target).toMatchObject({ label: "[rahman]", consumerConnected: true, consumerCount: 1 });
    expect(received).toHaveLength(1);
    const inbox = await mailbox.listLocalAgentInbox(owner, b.id);
    expect(inbox.some((row) => row.id === result.message.id && row.text === "please review this")).toBe(true);
  });

  it("correlates an explicit request and inherits correlation/user relay on reply", async () => {
    await presence.touchLocalAgentPresence(owner, a.id, "idle", "test:a");
    await presence.touchLocalAgentPresence(owner, b.id, "idle", "test:b");
    const request = await messaging.sendLocalAgentMessage({
      principal: owner, senderSessionId: a.id, target: "rahman", text: "tebak ini",
      intent: "request", requiresUserRelay: true,
    });
    expect(request.message.intent).toBe("request");
    expect(request.message.correlationId).toMatch(/^localcorr_/);
    const reply = await messaging.replyLocalAgentMessage({
      principal: owner, senderSessionId: b.id, replyToMessageId: request.message.id, text: "piano",
    });
    expect(reply.message).toMatchObject({
      intent: "reply", replyToMessageId: request.message.id, correlationId: request.message.correlationId, requiresUserRelay: true,
    });
    expect(reply.target.id).toBe(a.id);
    const original = await mailbox.getLocalAgentInboxMessage(owner, b.id, request.message.id);
    expect(original?.state).toBe("read");
    const waited = await messaging.waitForLocalAgentReply({
      principal: owner, senderSessionId: a.id, requestMessageId: request.message.id, timeoutMs: 0,
    });
    expect(waited).toMatchObject({ state: "replied", reply: { id: reply.message.id } });
  });

  it("defaults ordinary sends to notify-only semantics", async () => {
    const sent = await messaging.sendLocalAgentMessage({ principal: owner, senderSessionId: a.id, target: "rahman", text: "FYI" });
    expect(sent.message.intent).toBe("notify");
    expect(sent.message.requiresUserRelay).toBe(false);
  });

  it("queues while busy and delivers when the target becomes idle", async () => {
    await presence.touchLocalAgentPresence(owner, b.id, "busy", "test:b");
    const result = await messaging.sendLocalAgentMessage({
      principal: owner,
      senderSessionId: a.id,
      target: "agent-b",
      text: "queued task",
      kind: "task",
    });
    expect(result.status).toBe("queued");
    expect(result.message.state).toBe("queued");
    const received: string[] = [];
    const unsubscribe = events.subscribeLocalAgentMessages(b.id, (message) => received.push(message.id));
    await presence.touchLocalAgentPresence(owner, b.id, "idle", "test:b");
    expect(await messaging.flushLocalAgentQueue(owner, b.id)).toBeGreaterThanOrEqual(1);
    unsubscribe();
    expect(received).toContain(result.message.id);
  });

  it("returns consumer_absent for a bounded request wait when lease is active but no receiver is subscribed", async () => {
    await presence.touchLocalAgentPresence(owner, b.id, "idle", "test:b");
    const request = await messaging.sendLocalAgentMessage({
      principal: owner, senderSessionId: a.id, target: "rahman", text: "wait status", intent: "request",
    });
    const waited = await messaging.waitForLocalAgentReply({
      principal: owner, senderSessionId: a.id, requestMessageId: request.message.id, timeoutMs: 0,
    });
    expect(waited.state).toBe("consumer_absent");
    expect(waited.target).toMatchObject({ id: b.id, status: "idle", consumerConnected: false, consumerCount: 0 });
  });

  it("returns target_offline for a known expired receiver while retaining the payload", async () => {
    const old = Date.now() - 30_000;
    await presence.touchLocalAgentPresence(owner, b.id, "idle", "test:b", old);
    const rows = await directory.listLocalAgents(owner, { includeOffline: true });
    expect(rows.find((row) => row.id === b.id)?.status).toBe("offline");
    expect((await directory.listLocalAgents(owner)).some((row) => row.id === b.id)).toBe(false);
    const result = await messaging.sendLocalAgentMessage({
      principal: owner,
      senderSessionId: a.id,
      target: "rahman",
      text: "hold until you return",
    });
    expect(result.status).toBe("target_offline");
    expect(result.targetStatus).toBe("offline");
    expect(result.message.state).toBe("queued");
    const request = await messaging.sendLocalAgentMessage({
      principal: owner, senderSessionId: a.id, target: "rahman", text: "offline request", intent: "request",
    });
    const waited = await messaging.waitForLocalAgentReply({
      principal: owner, senderSessionId: a.id, requestMessageId: request.message.id, timeoutMs: 100,
    });
    expect(waited.state).toBe("target_offline");
    await presence.touchLocalAgentPresence(owner, b.id, "idle", "test:b");
  });

  it("redacts secret-shaped payload values and strips terminal control bytes", async () => {
    const result = await messaging.sendLocalAgentMessage({
      principal: owner, senderSessionId: a.id, target: "rahman",
      text: "\u001b[31mpassword=supersecret\u001b[0m",
    });
    expect(result.message.text).not.toContain("\u001b");
    expect(result.message.text).toContain("password=[redacted]");
    expect(result.message.text).not.toContain("supersecret");
  });

  it("rejects invalid target and oversized payload", async () => {
    await expect(messaging.sendLocalAgentMessage({
      principal: owner, senderSessionId: a.id, target: "does-not-exist", text: "x",
    })).rejects.toThrow(/target not found/);
    await expect(messaging.sendLocalAgentMessage({
      principal: owner, senderSessionId: a.id, target: "rahman", text: "x".repeat(17 * 1024),
    })).rejects.toThrow(/16 KiB/);
  });

  it("isolates discovery, send, and inbox by session principal", async () => {
    const other = "mcp-client:other";
    const foreign = await store.createAgentSession(other, "mcp", { title: "foreign", titleSource: "manual" });
    await presence.touchLocalAgentPresence(other, foreign.id, "idle", "other:1");
    expect((await directory.listLocalAgents(owner)).some((row) => row.id === foreign.id)).toBe(false);
    await expect(messaging.sendLocalAgentMessage({
      principal: owner, senderSessionId: a.id, target: foreign.name, text: "nope",
    })).rejects.toThrow(/target not found/);
    await expect(mailbox.listLocalAgentInbox(owner, foreign.id)).rejects.toThrow(/not found/);
  });
});
