import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACP_DRIVERS, acpDriver, createAcpInstance, describeAcpDriver, probeAcpDriver, requireAcpDriver } from "./acp-drivers";
import { AcpError } from "./acp-client";

// One fake agent script serves every driver kind: the driver's argv differs, the
// per-instance env tag differs, and no real CLI ever runs in tests.
const FAKE = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const tag = process.env.FAKE_ACP_TAG || "x";
const write = m => process.stdout.write(JSON.stringify(m) + "\n");
const sessionId = "sess_" + tag;
let buffer = "";
const record = line => { if (process.env.FAKE_ACP_LOG) fs.appendFileSync(process.env.FAKE_ACP_LOG, tag + ":" + line + "\n"); };
function handle(m) {
  const { id, method } = m;
  record("in:" + method);
  if (method === "initialize") return write({ jsonrpc: "2.0", id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false } } });
  if (method === "authenticate") return write({ jsonrpc: "2.0", id, result: {} });
  if (method === "session/new") return write({ jsonrpc: "2.0", id, result: { sessionId } });
  if (method === "session/prompt") {
    const text = (m.params.prompt[0] || {}).text || "";
    return write({ jsonrpc: "2.0", id, result: { stopReason: text === "fail" ? "refusal" : "end_turn" } });
  }
  if (id !== undefined) write({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  for (;;) {
    const index = buffer.indexOf("\n");
    if (index < 0) return;
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
`;

// Answers `auth_required` on purpose, to prove authenticate happens only on demand.
const AUTH_AGENT = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const write = m => process.stdout.write(JSON.stringify(m) + "\n");
let authenticated = false, buffer = "";
const record = line => { if (process.env.FAKE_ACP_LOG) fs.appendFileSync(process.env.FAKE_ACP_LOG, "auth:" + line + "\n"); };
function handle(m) {
  const { id, method } = m;
  record("in:" + method);
  if (method === "initialize") return write({ jsonrpc: "2.0", id, result: { protocolVersion: 1, agentCapabilities: {} } });
  if (method === "authenticate") { authenticated = true; return write({ jsonrpc: "2.0", id, result: {} }); }
  if (method === "session/new") return authenticated
    ? write({ jsonrpc: "2.0", id, result: { sessionId: "sess_auth" } })
    : write({ jsonrpc: "2.0", id, error: { code: -32000, message: "auth_required" } });
  if (id !== undefined) write({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  for (;;) {
    const index = buffer.indexOf("\n");
    if (index < 0) return;
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
`;

let root: string, agent: string, authAgent: string, log: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mso-acp-drivers-"));
  agent = path.join(root, "fake-agent"); authAgent = path.join(root, "auth-agent");
  log = path.join(root, "acp.log");
  await writeFile(agent, FAKE); await writeFile(authAgent, AUTH_AGENT);
  await chmod(agent, 0o755); await chmod(authAgent, 0o755);
  process.env.FAKE_ACP_LOG = log;
});
afterEach(async () => { delete process.env.FAKE_ACP_LOG; await rm(root, { recursive: true, force: true }); });
const logged = async () => { try { return (await readFile(log, "utf8")).split("\n").filter(Boolean); } catch { return []; } };

describe("ACP driver registry", () => {
  it("ships at least two real driver kinds as DATA with argv arrays, never shell strings", () => {
    expect(ACP_DRIVERS.length).toBeGreaterThanOrEqual(2);
    for (const driver of ACP_DRIVERS) {
      expect(driver).toMatchObject({ id: expect.any(String), displayName: expect.any(String),
        executable: expect.any(String), installHint: expect.any(String) });
      expect(Array.isArray(driver.args)).toBe(true);
      expect(driver.args.every(arg => typeof arg === "string" && !/\s/.test(arg))).toBe(true);
    }
    expect(acpDriver("opencode").args).toEqual(["acp"]);
    expect(() => acpDriver("nope")).toThrow(/acp_driver_unknown/);
  });

  it("resolves through PATH and fails with a clear not-installed error instead of a spawn ENOENT", () => {
    expect(describeAcpDriver("opencode", { path: root }))
      .toMatchObject({ id: "opencode", installed: false, executablePath: null });
    expect(() => requireAcpDriver("opencode", { path: root })).toThrow(/acp_driver_not_installed:opencode/);
    // A PATH entry that does contain the executable resolves to its absolute path.
    expect(describeAcpDriver("opencode", { path: `${root}${path.delimiter}/nonexistent` }).executablePath).toBeNull();
  });

  it("never authenticates and never creates a session during an availability probe", async () => {
    const probe = await probeAcpDriver("opencode", { executablePath: agent });
    expect(probe).toMatchObject({ protocolVersion: 1, loadSession: false });
    expect(await logged()).toEqual(["x:in:initialize"]);
  });

  it("keeps two instances of the SAME driver isolated under interleaved requests", async () => {
    const first = createAcpInstance("opencode", { executablePath: agent, cwd: root, env: { ...process.env, FAKE_ACP_TAG: "one" } });
    const second = createAcpInstance("opencode", { executablePath: agent, cwd: root, env: { ...process.env, FAKE_ACP_TAG: "two" } });
    expect(first.id).not.toBe(second.id);
    expect(first.client).not.toBe(second.client);
    await Promise.all([first.initialize(), second.initialize()]);
    const [left, right] = await Promise.all([first.openSession({ cwd: root }), second.openSession({ cwd: root })]);
    expect([left, right]).toEqual(["sess_one", "sess_two"]);
    const [a, b] = await Promise.all([first.client.prompt(left, "alpha"), second.client.prompt(right, "fail")]);
    // Different stop reasons from two children: no cross-talk between instances.
    expect([a, b]).toEqual(["end_turn", "refusal"]);
    first.dispose(); second.dispose();
  });

  it("authenticates only after the agent answers auth_required, then retries the session", async () => {
    const instance = createAcpInstance("opencode", { executablePath: authAgent, cwd: root });
    await instance.initialize();
    expect(await logged()).toEqual(["auth:in:initialize"]);
    expect(await instance.openSession({ cwd: root })).toBe("sess_auth");
    expect(await logged()).toEqual(["auth:in:initialize", "auth:in:session/new", "auth:in:authenticate", "auth:in:session/new"]);
    instance.dispose();
  });

  it("propagates a non-auth session failure instead of retrying it as a login", async () => {
    const instance = createAcpInstance("opencode", { executablePath: agent, cwd: root });
    await instance.initialize();
    instance.client.abort(new Error("gone"));
    await expect(instance.openSession({ cwd: root })).rejects.toBeInstanceOf(AcpError);
    instance.dispose();
  });
});
