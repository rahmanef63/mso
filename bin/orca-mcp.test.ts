import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createServer, orca, toolDescriptors, TOOLS } from "./orca-mcp.mjs";
import { buildArgv, needsEnvironmentId } from "./orca-mcp-tools.mjs";

// Fake orca CLI: echoes its argv as JSON.
function fakeBin(body = `process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }));`): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-mcp-"));
  const file = path.join(dir, "orca");
  fs.writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  return file;
}

const call = (bin: string, name: string, args: unknown) =>
  createServer(bin).handle({ id: 1, method: "tools/call", params: { name, arguments: args } });

describe("orca-mcp tool table", () => {
  it("describes every tool with an object schema and annotations", () => {
    const tools = toolDescriptors();
    expect(tools.length).toBe(Object.keys(TOOLS).length);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.description.length).toBeGreaterThan(20);
    }
    expect(tools.find((t) => t.name === "orca_terminal_close")?.annotations.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "orca_status")?.annotations.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "orca_terminal_read")?.annotations.readOnlyHint).toBe(true);
  });

  it("maps snake_case args onto orca flags in declaration order", () => {
    expect(buildArgv("orca_terminal_create", { worktree: "active", title: "agent", command: "codex", focus: true }))
      .toEqual(["terminal", "create", "--worktree", "active", "--title", "agent", "--command", "codex", "--focus"]);
  });

  it("omits absent optional args and false switches", () => {
    expect(buildArgv("orca_terminal_read", { terminal: "term_1" })).toEqual(["terminal", "read", "--terminal", "term_1"]);
    expect(buildArgv("orca_terminal_list", { focus: false, limit: 3 })).toEqual(["terminal", "list", "--limit", "3"]);
  });

  it("converts numbers to strings for flag values", () => {
    expect(buildArgv("orca_terminal_wait", { terminal: "t", for: "exit", timeout_ms: 5000 }))
      .toEqual(["terminal", "wait", "--terminal", "t", "--for", "exit", "--timeout-ms", "5000"]);
  });

  it("returns null for a missing required arg or an unknown tool", () => {
    expect(buildArgv("orca_worktree_create", {})).toBeNull();
    expect(buildArgv("orca_terminal_send", { terminal: "t" })).toBeNull();
    expect(buildArgv("orca_nope", {})).toBeNull();
  });

  it("requires a close target and defaults --all to the active worktree", () => {
    expect(buildArgv("orca_terminal_close", {})).toBeNull();
    expect(buildArgv("orca_terminal_close", { all: true })).toEqual(["terminal", "close", "--all", "--worktree", "active"]);
    expect(buildArgv("orca_terminal_close", { terminal: "t", tab: true })).toEqual(["terminal", "close", "--terminal", "t", "--tab"]);
  });
});

describe("orca-mcp host routing", () => {
  it("adds --environment for a paired runtime on every routed command", () => {
    expect(buildArgv("orca_worktree_ps", { host: "remote-vps", limit: 3 }))
      .toEqual(["worktree", "ps", "--environment", "remote-vps", "--limit", "3"]);
    expect(buildArgv("orca_terminal_list", { host: "remote-vps" }))
      .toEqual(["terminal", "list", "--environment", "remote-vps"]);
  });

  it("omits routing flags for the local host", () => {
    expect(buildArgv("orca_worktree_ps", { limit: 3 })).toEqual(["worktree", "ps", "--limit", "3"]);
    expect(buildArgv("orca_worktree_ps", { host: "local" })).toEqual(["worktree", "ps"]);
  });

  it("passes an explicit runtime:/ssh: id straight through as --host", () => {
    expect(buildArgv("orca_worktree_create", { host: "runtime:46174843-7c8e-4023-adc6-3488a102ae64", name: "x", repo: "name:mso" }))
      .toEqual(["worktree", "create", "--host", "runtime:46174843-7c8e-4023-adc6-3488a102ae64", "--name", "x", "--repo", "name:mso"]);
  });

  it("flags a bare environment name that must be resolved to an id", () => {
    expect(needsEnvironmentId("orca_worktree_create", { host: "remote-vps" })).toBe(true);
    expect(needsEnvironmentId("orca_worktree_create", { host: "runtime:abc" })).toBe(false);
    expect(needsEnvironmentId("orca_worktree_create", {})).toBe(false);
    expect(needsEnvironmentId("orca_worktree_ps", { host: "remote-vps" })).toBe(false);
  });

  it("never routes orca_host_list, which rejects --environment", () => {
    expect(buildArgv("orca_host_list", { host: "remote-vps" })).toEqual(["host", "list"]);
  });
});

describe("orca-mcp stdio server", () => {
  it("appends --json and returns the CLI payload as text content", async () => {
    const reply = await call(fakeBin(), "orca_worktree_ps", { limit: 2 });
    expect(JSON.parse(reply.result.content[0].text)).toEqual({ argv: ["worktree", "ps", "--limit", "2", "--json"] });
    expect(reply.result.isError).toBeUndefined();
  });

  it("surfaces a CLI failure as an MCP error result", async () => {
    const bin = fakeBin(`process.stderr.write("Orca is not running. Run 'orca open' first."); process.exit(1);`);
    const reply = await call(bin, "orca_status", {});
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toContain("orca open");
  });

  it("rejects an unknown tool and a missing required argument", async () => {
    expect((await call(fakeBin(), "orca_nope", {})).result.isError).toBe(true);
    expect((await call(fakeBin(), "orca_worktree_create", {})).result.isError).toBe(true);
  });

  it("answers initialize/ping and ignores notifications", async () => {
    const { handle } = createServer(fakeBin());
    const init = await handle({ id: 7, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(init.result.capabilities.tools).toBeDefined();
    expect(init.result.serverInfo.name).toBe("mso-orca");
    expect((await handle({ id: 8, method: "ping" })).result).toEqual({});
    expect(await handle({ method: "notifications/initialized" })).toBeNull();
    expect((await handle({ id: 9, method: "bogus" })).error.code).toBe(-32601);
  });

  it("stamps each board row with the host it was routed to", async () => {
    const bin = fakeBin(`process.stdout.write(JSON.stringify({ result: { worktrees: [{ displayName: "a" }, { displayName: "b" }] } }));`);
    const local = await call(bin, "orca_worktree_ps", { limit: 2 });
    const remote = await call(bin, "orca_worktree_ps", { host: "remote-vps", limit: 2 });
    const rows = (reply: { result: { content: { text: string }[] } }) => JSON.parse(reply.result.content[0].text).result.worktrees.map((r: { host: string }) => r.host);
    expect(rows(local as never)).toEqual(["local", "local"]);
    expect(rows(remote as never)).toEqual(["remote-vps", "remote-vps"]);
  });

  it("times out instead of hanging on a wedged CLI", async () => {
    const bin = fakeBin("setTimeout(() => {}, 60000);");
    const result = await orca(bin, ["status"], { timeoutMs: 300 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
  });
});
