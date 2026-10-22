import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentProfile, AgentProfileConfig } from "@/lib/contracts/agent-profile";
import type { AcpPermissionRequest } from "./acp-client";

const mock = vi.hoisted(() => ({ create: vi.fn(), event: vi.fn(), history: vi.fn() }));
vi.mock("./session-store", () => ({ createAgentSession: mock.create, appendAgentSessionEvent: mock.event, updateAgentSessionHistory: mock.history }));

const { ACP_PROFILE_RUN_TIMEOUT_MS, acpRunStatus, runAcpAgentProfile } = await import("./acp-runtime");
const { createAcpInstance } = await import("./acp-drivers");
const { AcpError } = await import("./acp-client");
const { parseProfileConfig, validateProfileStore } = await import("./profile-schema");

// Real child process, same seam production uses: explicit argv + shell:false.
const FAKE = String.raw`#!/usr/bin/env node
const write = m => process.stdout.write(JSON.stringify(m) + "\n");
const updates = JSON.parse(process.env.FAKE_ACP_UPDATES || "[]");
let buffer = "";
function handle(m) {
  const { id, method } = m;
  if (method === "initialize") return write({ jsonrpc: "2.0", id, result: { protocolVersion: 1, agentCapabilities: {} } });
  if (method === "session/new") return write({ jsonrpc: "2.0", id, result: { sessionId: "sess_run" } });
  if (method === "session/prompt") {
    for (const update of updates) write({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "sess_run", update } });
    if (process.env.FAKE_ACP_PERMISSION) write({ jsonrpc: "2.0", id: 9001, method: "session/request_permission",
      params: { sessionId: "sess_run", toolCall: { toolCallId: "t1" },
        options: [{ optionId: "once", kind: "allow_once", name: "Once" }, { optionId: "no", kind: "reject_once", name: "No" }] } });
    return write({ jsonrpc: "2.0", id, result: { stopReason: process.env.FAKE_ACP_STOP || "end_turn" } });
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

let root: string, agent: string;
const owner = "web:aaaaaaaaaaaaaaaa";
const profile = (config: Partial<AgentProfileConfig> = {}): AgentProfile => ({
  id: "profile_00000000-0000-0000-0000-000000000001", owner, revision: 3,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", enabled: true, history: [],
  config: { name: "ACP reader", avatar: "", instructions: "Be brief.", runtime: "acp-cli",
    model: { provider: "selected-account", model: "exact-model" }, tools: [], acp: { driver: "opencode" }, ...config },
});
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mso-acp-run-"));
  agent = path.join(root, "acp-agent"); await writeFile(agent, FAKE); await chmod(agent, 0o755);
  Object.values(mock).forEach(fn => fn.mockReset());
  mock.create.mockResolvedValue({ id: "run-fixture" }); mock.event.mockResolvedValue(undefined); mock.history.mockResolvedValue(undefined);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const instance = (env: Record<string, string> = {}, config: Partial<AgentProfileConfig> = {}) => ({
  shared: createAcpInstance("opencode", { executablePath: agent, cwd: root, env: { ...process.env, ...env } }),
  config });
function run(input: { env?: Record<string, string>; config?: Partial<AgentProfileConfig>; permissionPolicy?: (request: AcpPermissionRequest) => boolean | Promise<boolean>; liveAuthorization?: () => Promise<void> } = {}) {
  const { shared, config } = instance(input.env, input.config);
  return runAcpAgentProfile({ profile: profile(config), prompt: "Inspect source", principal: owner,
    signal: new AbortController().signal, liveAuthorization: input.liveAuthorization ?? vi.fn().mockResolvedValue(undefined),
    resolveInstance: () => shared, ...(input.permissionPolicy ? { permissionPolicy: input.permissionPolicy } : {}) })
    .finally(() => shared.dispose());
}

describe("ACP profile runtime bridge", () => {
  it("returns the SAME AgentProfileRunResult shape the mso-readonly runtime returns", async () => {
    const result = await run({ env: { FAKE_ACP_UPDATES: JSON.stringify([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Verified " } },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "source" } },
      { sessionUpdate: "tool_call", toolCallId: "t1", name: "fs_read", status: "pending" },
      { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" },
      { sessionUpdate: "tool_call", toolCallId: "t2", name: "fs_search", status: "in_progress" }]) } });
    expect(result).toEqual({ runId: "run-fixture", profileId: profile().id, profileRevision: 3,
      model: { provider: "selected-account", model: "exact-model" }, status: "completed", text: "Verified source",
      rounds: 1, toolCalls: [{ name: "fs_read", ok: true }, { name: "fs_search", ok: false }] });
    expect(mock.history).toHaveBeenCalledWith(owner, "run-fixture",
      [{ role: "user", text: "Inspect source" }, { role: "assistant", text: "Verified source" }]);
    expect(mock.event).toHaveBeenLastCalledWith(owner, "run-fixture", expect.objectContaining({ state: "completed" }));
  });

  it("maps refusal, cancellation and max_tokens to partial — never completed", async () => {
    expect(acpRunStatus("end_turn")).toBe("completed");
    expect(acpRunStatus("refusal")).toBe("partial");
    expect(acpRunStatus("cancelled")).toBe("partial");
    expect(acpRunStatus("max_tokens")).toBe("partial");
    expect((await run({ env: { FAKE_ACP_STOP: "refusal" } })).status).toBe("partial");
    expect((await run({ env: { FAKE_ACP_STOP: "cancelled" } })).status).toBe("partial");
  });

  it("treats a denied permission request as a partial turn, not a completed one", async () => {
    // No permissionPolicy at all: the client denies, so the run cannot report success.
    expect((await run({ env: { FAKE_ACP_PERMISSION: "1" } })).status).toBe("partial");
  });

  it("allows only when a narrow policy approves, and records the outcome the agent reported", async () => {
    const policy = vi.fn(async (_request: AcpPermissionRequest) => true);
    const result = await run({ env: { FAKE_ACP_PERMISSION: "1",
      FAKE_ACP_UPDATES: JSON.stringify([{ sessionUpdate: "tool_call", toolCallId: "t1", name: "fs_read", status: "completed" }]) },
      permissionPolicy: policy });
    expect(policy).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: "completed", toolCalls: [{ name: "fs_read", ok: true }] });
  });

  it("keeps the existing authority chain live before and after the turn", async () => {
    const liveAuthorization = vi.fn().mockResolvedValue(undefined);
    await run({ liveAuthorization });
    expect(liveAuthorization.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("withholds the final answer when authority is withdrawn after the turn", async () => {
    const liveAuthorization = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined).mockRejectedValue(new Error("profile_owner_session_revoked"));
    await expect(run({ liveAuthorization })).rejects.toThrow("profile_owner_session_revoked");
    expect(mock.event).toHaveBeenLastCalledWith(owner, "run-fixture", expect.objectContaining({ state: "failed" }));
  });

  it("refuses an acp-cli profile with no driver reference", async () => {
    const { acp: _acp, ...withoutAcp } = profile().config;
    void _acp;
    await expect(runAcpAgentProfile({ profile: { ...profile(), config: withoutAcp as AgentProfileConfig }, prompt: "x",
      principal: owner, signal: new AbortController().signal, liveAuthorization: async () => undefined }))
      .rejects.toThrow("profile_runtime_unsupported");
  });

  it("reports a not-installed or unknown driver clearly, without spawning a real CLI", async () => {
    // ACP bound is stated per runtime and is NOT the mso-readonly 60s bound.
    expect(ACP_PROFILE_RUN_TIMEOUT_MS).toBe(600_000);
    await expect(runAcpAgentProfile({ profile: profile({ acp: { driver: "not-a-driver" } }), prompt: "x",
      principal: owner, signal: new AbortController().signal, liveAuthorization: async () => undefined }))
      .rejects.toBeInstanceOf(AcpError);
  });
});

describe("profile config backward compatibility", () => {
  const old = { name: "Reader", avatar: "", instructions: "Show findings.", runtime: "mso-readonly",
    model: { provider: "selected-account", model: "exact-model" }, tools: ["fs_read"] };

  it("still parses an existing mso-readonly config to the byte-identical old shape", () => {
    // No `acp` key is invented for an old config.
    expect(parseProfileConfig(old)).toEqual(old);
    expect(JSON.stringify(parseProfileConfig(old))).toBe(JSON.stringify(old));
  });

  it("still rejects exactly what it rejected before: secrets, stronger runtimes, unknown fields", () => {
    expect(() => parseProfileConfig({ ...old, apiKey: "x" })).toThrow("unsupported_profile_field");
    expect(() => parseProfileConfig({ ...old, runtime: "acp" })).toThrow("profile_runtime_unsupported");
    expect(() => parseProfileConfig({ ...old, runtime: "shell" })).toThrow("profile_runtime_unsupported");
    expect(() => parseProfileConfig({ ...old, acp: { driver: "opencode" } })).toThrow("unsupported_profile_field");
    expect(() => parseProfileConfig({ ...old, tools: ["exec_run"] })).toThrow("profile_tool_unsupported");
    expect(() => parseProfileConfig({ ...old, model: { ...old.model, token: "x" } })).toThrow("unsupported_profile_field");
  });

  it("validates a stored old-shape profile after the new runtime kind was added", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const store = { version: 1 as const, revision: 1, defaultProfileId: "profile_00000000-0000-0000-0000-000000000001",
      profiles: [{ id: "profile_00000000-0000-0000-0000-000000000001", owner, revision: 1, createdAt: at, updatedAt: at,
        enabled: true, config: old, history: [{ revision: 1, at, actor: owner, action: "create" as const, reason: "First", config: old, enabled: true }] }] };
    expect(validateProfileStore(store, owner)).toEqual(store);
  });

  it("accepts the new acp-cli runtime with its driver reference, and keeps tools honest", () => {
    const accepted = parseProfileConfig({ ...old, runtime: "acp-cli", tools: [], acp: { driver: "opencode" } });
    expect(accepted).toMatchObject({ runtime: "acp-cli", acp: { driver: "opencode" }, tools: [] });
    expect(parseProfileConfig({ ...old, runtime: "acp-cli", tools: [], acp: { driver: "opencode", instance: "acp_abc-123" } }).acp)
      .toEqual({ driver: "opencode", instance: "acp_abc-123" });
    // An ACP agent owns its own tools; MSO must not also promise saved read tools.
    expect(() => parseProfileConfig({ ...old, runtime: "acp-cli", acp: { driver: "opencode" } })).toThrow("profile_tool_unsupported");
    expect(() => parseProfileConfig({ ...old, runtime: "acp-cli", tools: [] })).toThrow("profile_acp_required");
    expect(() => parseProfileConfig({ ...old, runtime: "acp-cli" })).toThrow("profile_acp_required");
    expect(() => parseProfileConfig({ ...old, runtime: "acp-cli", tools: [], acp: { driver: "../etc" } })).toThrow("invalid_profile_acp_driver");
    expect(() => parseProfileConfig({ ...old, runtime: "acp-cli", tools: [], acp: { driver: "opencode", instance: "x" } }))
      .toThrow("invalid_profile_acp_instance");
    expect(() => parseProfileConfig({ ...old, runtime: "acp-cli", tools: [], acp: { driver: "opencode", token: "x" } }))
      .toThrow("unsupported_profile_field");
  });
});
