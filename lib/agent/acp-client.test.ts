import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AcpClient, AcpError, parseSessionUpdate, type AcpClientOptions } from "./acp-client";

// The fake agent is a real child process speaking newline-delimited JSON-RPC. It is
// injected through the SAME seam production uses — an explicit argv with shell:false —
// so there is no test-only branch inside the client.
const FAKE = String.raw`
const plan = JSON.parse(process.argv[2] || "{}");
const fs = require("node:fs");
const write = m => process.stdout.write(JSON.stringify(m) + "\n");
const record = line => { if (plan.record) fs.appendFileSync(plan.record, line + "\n"); };
const sessionId = "sess_fixture";
let authenticated = !plan.authRequired;
function handle(m) {
  const { id, method } = m;
  record("in:" + method);
  if (plan.silent) return;
  if (method === "initialize") return write({ jsonrpc: "2.0", id, result: { protocolVersion: 1,
    agentInfo: { name: "fake", version: "1" },
    agentCapabilities: { loadSession: !!plan.loadSession, sessionCapabilities: {} } } });
  if (method === "authenticate") { authenticated = true; return write({ jsonrpc: "2.0", id, result: {} }); }
  if (method === "session/new") {
    if (!authenticated) return write({ jsonrpc: "2.0", id, error: { code: -32000, message: "auth_required" } });
    if (plan.pidFile) fs.writeFileSync(plan.pidFile, String(process.pid));
    return write({ jsonrpc: "2.0", id, result: { sessionId } });
  }
  if (method === "session/prompt") {
    for (const update of plan.updates || []) write({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
    if (plan.permission) write({ jsonrpc: "2.0", id: 9001, method: "session/request_permission",
      params: { sessionId, toolCall: { toolCallId: "t1", title: "Run" }, options: plan.permission } });
    if (plan.oversized) { process.stdout.write("x".repeat(plan.oversized) + "\n"); return; }
    if (plan.hang) return;
    return write({ jsonrpc: "2.0", id, result: { stopReason: plan.stopReason || "end_turn" } });
  }
  if (method === "session/cancel") return;
  if (id !== undefined) write({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  for (;;) {
    const index = buffer.indexOf("\n");
    if (index < 0) return;
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.id === 9001) record("permission:" + JSON.stringify(message.result || message.error));
    handle(message);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

// Second agent: answers in reverse order and also sends a response for an id nobody
// asked about, which must not crash the client.
const REVERSING = String.raw`
let ids = [], buffer = "";
const write = m => process.stdout.write(JSON.stringify(m) + "\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  for (;;) {
    const index = buffer.indexOf("\n");
    if (index < 0) return;
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    ids.push({ id: m.id, method: m.method });
    const results = { initialize: { protocolVersion: 1, agentCapabilities: {} },
      "session/new": { sessionId: "sess_rev" }, "session/prompt": { stopReason: "end_turn" } };
    write({ jsonrpc: "2.0", id: 99999, result: { stale: true } });
    for (const row of [...ids].reverse()) write({ jsonrpc: "2.0", id: row.id, result: results[row.method] || {} });
    ids = [];
  }
});
process.stdin.on("end", () => process.exit(0));
`;

let root: string, agent: string, reversing: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mso-acp-client-"));
  agent = path.join(root, "fake-agent.cjs"); reversing = path.join(root, "fake-reversing.cjs");
  await writeFile(agent, FAKE); await writeFile(reversing, REVERSING);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const fake = (plan: object, extra: Partial<AcpClientOptions> = {}) =>
  new AcpClient({ command: process.execPath, args: [agent, JSON.stringify(plan)], ...extra });
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const settle = () => new Promise(resolve => setTimeout(resolve, 400));

describe("ACP stdio client", () => {
  it("correlates out-of-order responses, ignores an unknown id, and never crashes", async () => {
    const peer = new AcpClient({ command: process.execPath, args: [reversing] });
    expect((await peer.initialize()).protocolVersion).toBe(1);
    expect(await peer.newSession({ cwd: root })).toBe("sess_rev");
    expect(await peer.prompt("sess_rev", "go")).toBe("end_turn");
    peer.dispose();
  });

  it("dispatches session/update notifications apart from request replies", async () => {
    const updates: string[] = [];
    const peer = fake({ updates: [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } }] });
    peer.onUpdate = update => { updates.push(update.kind); };
    await peer.initialize();
    const session = await peer.newSession({ cwd: root });
    // A notification must not resolve the pending prompt; only the reply does.
    expect(await peer.prompt(session, "go")).toBe("end_turn");
    expect(updates).toEqual(["agent_message"]);
    peer.dispose();
  });

  it("ignores an unknown session/update kind without throwing", async () => {
    const updates: string[] = [];
    const peer = fake({ updates: [{ sessionUpdate: "future_extension_kind", payload: { x: 1 } },
      { sessionUpdate: "tool_call", toolCallId: "t1", name: "fs_read", status: "completed" }] });
    peer.onUpdate = update => { updates.push(update.kind); };
    await peer.initialize(); await peer.prompt(await peer.newSession({ cwd: root }), "go");
    expect(updates).toEqual(["other", "tool_call"]);
    peer.dispose();
  });

  it("DENIES session/request_permission with no policy, and never picks an always-grant", async () => {
    const none = path.join(root, "none.log"), allow = path.join(root, "allow.log");
    const options = [{ optionId: "always", kind: "allow_always", name: "Always" },
      { optionId: "once", kind: "allow_once", name: "Once" }, { optionId: "no", kind: "reject_once", name: "No" }];
    const denying = fake({ permission: options, record: none });
    await denying.initialize(); await denying.prompt(await denying.newSession({ cwd: root }), "go");
    await settle(); denying.dispose();
    expect((await readFile(none, "utf8")).split("\n").find(line => line.startsWith("permission:")))
      .toBe(`permission:{"outcome":{"outcome":"selected","optionId":"no"}}`);

    const allowing = fake({ permission: options, record: allow }, { permissionPolicy: () => true });
    await allowing.initialize(); await allowing.prompt(await allowing.newSession({ cwd: root }), "go");
    await settle(); allowing.dispose();
    // An allow policy still only yields `allow_once`: no project-wide widening.
    expect((await readFile(allow, "utf8")).split("\n").find(line => line.startsWith("permission:")))
      .toBe(`permission:{"outcome":{"outcome":"selected","optionId":"once"}}`);
  });

  it("cancels the turn when an allow-only menu cannot express a denial", async () => {
    const record = path.join(root, "cancelled.log");
    const peer = fake({ permission: [{ optionId: "always", kind: "allow_always", name: "Always" }], record });
    await peer.initialize(); await peer.prompt(await peer.newSession({ cwd: root }), "go");
    await settle(); peer.dispose();
    const lines = (await readFile(record, "utf8")).split("\n");
    expect(lines.find(line => line.startsWith("permission:"))).toBe(`permission:{"outcome":{"outcome":"cancelled"}}`);
    expect(lines).toContain("in:session/cancel");
  });

  it("abort rejects pending requests, kills the child's process group, and is idempotent", async () => {
    const pidFile = path.join(root, "child.pid");
    const peer = fake({ hang: true, pidFile });
    await peer.initialize(); await peer.newSession({ cwd: root });
    const pending = peer.prompt("sess_fixture", "never finishes");
    const pid = Number(await readFile(pidFile, "utf8"));
    expect(peer.pid).toBe(pid);
    peer.abort(new Error("test stop"));
    await expect(pending).rejects.toThrow(/acp_aborted:test stop/);
    expect(() => peer.abort()).not.toThrow();
    peer.abort(); peer.dispose();
    await settle();
    expect({ alive: alive(pid) }).toEqual({ alive: false });
  });

  it("kills the child and errors clearly when one inbound line exceeds the cap", async () => {
    // The agent answers initialize, then emits an oversized line for session/prompt.
    const peer = fake({ oversized: 4_096 }, { maxLineBytes: 1_024 });
    await peer.initialize();
    const pid = peer.pid!, session = await peer.newSession({ cwd: root });
    await expect(peer.prompt(session, "go")).rejects.toThrow(/acp_line_too_large/);
    await settle();
    expect({ alive: alive(pid) }).toEqual({ alive: false });
    peer.dispose();
  });

  it("times out a stalled control request, destroys the child, and refuses later work", async () => {
    const peer = fake({ silent: true }, { controlTimeoutMs: 150 });
    await expect(peer.initialize()).rejects.toThrow(/acp_request_timeout:initialize/);
    await expect(peer.request("session/new", {})).rejects.toBeInstanceOf(AcpError);
    peer.dispose();
  });
});

describe("session update parsing", () => {
  it("keeps unknown kinds instead of throwing", () => {
    expect(parseSessionUpdate({ sessionUpdate: "mystery", x: 1 })).toEqual({ kind: "other", sessionUpdate: "mystery" });
    expect(parseSessionUpdate(null)).toBeNull();
    expect(parseSessionUpdate({ sessionUpdate: "tool_call", toolCallId: "t", name: "n" }))
      .toEqual({ kind: "tool_call", toolCallId: "t", name: "n", status: "pending" });
  });
});
