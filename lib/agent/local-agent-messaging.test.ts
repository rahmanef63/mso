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
  it("assigns deterministic readable placeholders to two live unnamed sessions", async () => {
    const rows = await directory.listLocalAgents(owner);
    expect(rows.map((row) => row.label)).toEqual(["[agent-a]", "[agent-b]"]);
    expect(rows.map((row) => row.status)).toEqual(["idle", "idle"]);
  });

  it("manual rename changes the label without changing the durable identity", async () => {
    const id = a.id;
    await store.renameAgentSession(owner, a.id, "zahra");
    const rows = await directory.listLocalAgents(owner);
    expect(rows.find((row) => row.id === id)?.label).toBe("[zahra]");
    expect(rows.find((row) => row.id === id)?.id).toBe(id);
  });

  it("lightly disambiguates duplicate manual names while preserving aliases", async () => {
    await store.renameAgentSession(owner, b.id, "zahra");
    const rows = await directory.listLocalAgents(owner);
    expect(rows.map((row) => row.label)).toEqual(["[zahra · a]", "[zahra · b]"]);
    expect(() => rows.map((row) => row.alias)).not.toThrow();
    await store.renameAgentSession(owner, b.id, "rahman");
  });

  it("delivers an idle-target message to the live feed and durable inbox", async () => {
    const received: unknown[] = [];
    const unsubscribe = events.subscribeLocalAgentMessages(b.id, (message) => received.push(message));
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
    expect(result.target.label).toBe("[rahman]");
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
      principal: owner, senderSessionId: a.id, target: "foreign", text: "nope",
    })).rejects.toThrow(/target not found/);
    await expect(mailbox.listLocalAgentInbox(owner, foreign.id)).rejects.toThrow(/not found/);
  });
});
