import { beforeEach, describe, it, expect, vi } from "vitest";
// The catalog reaches lib/camoufox + lib/managed-apps, which are `server-only`.
// Next aliases that specifier internally; vitest does not, so stub it — same
// pattern as lib/managed-apps/manager.test.ts.
vi.mock("server-only", () => ({}));

// Spy on the trail without writing to ~/.mso/audit.log. Everything else in
// @/lib/host stays REAL — the point of these cases is that the dispatcher, not
// each tool, is what records.
const audited: { action: string; actor?: string; target?: string; ok?: boolean }[] = [];
vi.mock("@/lib/host", async (orig) => {
  const real = await orig<typeof import("@/lib/host")>();
  return { ...real, audit: (e: { action: string }) => { audited.push(e); return Promise.resolve(); } };
});

const { dispatch, isNotification } = await import("./dispatch");
const { TOOLS } = await import("./tools");
const { activeWorkflowForActor } = await import("@/lib/skills/memory");

const call = (name: string, args: Record<string, unknown> = {}) =>
  ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

describe("protocol", () => {
  it("echoes the client's protocolVersion when it sends one", async () => {
    const r = await dispatch({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, "read");
    expect((r.result as Record<string, unknown>).protocolVersion).toBe("2025-06-18");
  });

  it("advertises only the workflow operations available at each scope", async () => {
    const read = await dispatch({ id: 1, method: "initialize" }, "read");
    const readInstructions = (read.result as { instructions?: string }).instructions;
    expect(readInstructions).toContain("skills_search");
    expect(readInstructions).not.toContain("workflow_start");
    expect(readInstructions).not.toContain("workflow_cancel");
    expect(readInstructions).not.toContain("workflow_finish");

    const exec = await dispatch({ id: 2, method: "initialize" }, "exec");
    const execInstructions = (exec.result as { instructions?: string }).instructions;
    expect(execInstructions).toContain("workflow_start");
    expect(execInstructions).toContain("workflow_cancel");
    expect(execInstructions).toContain("workflow_finish");
  });

  it("publishes server and toolset metadata so action drift is visible", async () => {
    const r = await dispatch({ id: 1, method: "initialize" }, "exec");
    const result = r.result as { serverInfo: { version: string }; _meta: { toolset: { toolCount: number; hash: string } } };
    expect(result.serverInfo.version).toBe("1.6.0");
    expect(result._meta.toolset.toolCount).toBe(TOOLS.length);
    expect(result._meta.toolset.hash).toMatch(/^[a-f0-9]{16}$/);
  });


  it("publishes OpenAI file binding metadata on the upload bridge", async () => {
    const r = await dispatch({ id: 1, method: "tools/list" }, "write");
    const tools = (r.result as { tools: Array<{ name: string; _meta?: Record<string, unknown> }> }).tools;
    const upload = tools.find((tool) => tool.name === "fs_upload_file");
    expect(upload?._meta).toEqual({ "openai/fileParams": ["file"] });
  });

  it("answers ping and initialized", async () => {
    expect(await dispatch({ id: 2, method: "ping" }, "read")).toMatchObject({ result: {} });
    expect(await dispatch({ id: 3, method: "notifications/initialized" }, "read")).toMatchObject({ result: {} });
  });

  it("returns a JSON-RPC error for an unknown method", async () => {
    const r = await dispatch({ id: 4, method: "tools/nope" }, "read");
    expect((r.error as { code: number }).code).toBe(-32601);
  });

  it("recognises notifications, which must be acked without a body", () => {
    expect(isNotification({ jsonrpc: "2.0", method: "notifications/cancelled" })).toBe(true);
    expect(isNotification({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toBe(false);
    expect(isNotification({ jsonrpc: "2.0", id: 1, method: "notifications/initialized" })).toBe(false);
  });
});

describe("tools/list is scope-filtered", () => {
  const names = async (scope: "read" | "write" | "exec") => {
    const r = await dispatch({ id: 1, method: "tools/list" }, scope);
    return ((r.result as { tools: { name: string }[] }).tools).map((t) => t.name);
  };

  it("shows a read token only read tools", async () => {
    const n = await names("read");
    expect(n).toContain("fs_list");
    expect(n).toContain("sys_stats");
    expect(n).toContain("skills_search");
    expect(n).toContain("projects_list");
    expect(n).toContain("skills_list");
    expect(n).toContain("skills_read");
    expect(n).toContain("local_agents_list");
    expect(n).toContain("local_agent_inbox");
    expect(n).not.toContain("local_agent_message_send");
    expect(n).not.toContain("workflow_start");
    expect(n).not.toContain("fs_write");
    expect(n).not.toContain("exec_run");
  });

  it("shows a write token everything but the shell", async () => {
    const n = await names("write");
    expect(n).toContain("fs_write");
    expect(n).toContain("fs_delete");
    expect(n).toContain("workflow_start");
    expect(n).toContain("workflow_cancel");
    expect(n).toContain("workflow_finish");
    expect(n).toContain("local_agent_message_send");
    expect(n).not.toContain("exec_run");
    expect(n).not.toContain("browser_power");
  });

  it("shows an exec token the whole catalog", async () => {
    expect(await names("exec")).toHaveLength(TOOLS.length);
  });
});

describe("tools/call enforces scope even when the tool was never listed", () => {
  it("refuses exec_run for a write token, and says how to fix it", async () => {
    const r = await dispatch(call("exec_run", { command: "id" }), "write");
    const res = r.result as { isError: boolean; content: { text: string }[] };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('needs "exec"');
    // NOT a JSON-RPC error — ChatGPT hides those from the user entirely.
    expect(r.error).toBeUndefined();
  });

  it("refuses fs_delete for a read token", async () => {
    const r = await dispatch(call("fs_delete", { path: "/tmp/x" }), "read");
    expect((r.result as { isError: boolean }).isError).toBe(true);
  });

  it("rejects an unknown tool name", async () => {
    expect((await dispatch(call("rm_rf_slash"), "exec")).error).toMatchObject({ code: -32602 });
  });

  it("rejects a call missing a required argument before running anything", async () => {
    expect((await dispatch(call("fs_read", {}), "read")).error).toMatchObject({ code: -32602 });
  });


  it("records missing required arguments as invalid_args inside the exact workflow", async () => {
    const actor = "mcp:invalid-args";
    const started = await dispatch(call("workflow_start", { intent: "test invalid argument telemetry" }), "write", actor);
    const workflowId = (JSON.parse((started.result as { content: { text: string }[] }).content[0].text) as { workflow: { id: string } }).workflow.id;
    const bad = await dispatch(call("fs_write", { path: "/tmp/test", workflow_id: workflowId }), "write", actor);
    expect(bad.error).toMatchObject({ code: -32602 });
    expect((await activeWorkflowForActor(actor, workflowId))?.steps.at(-1)).toMatchObject({ tool: "fs_write", state: "invalid_args" });
    await dispatch(call("workflow_cancel", { workflow_id: workflowId, reason: "test cleanup" }), "write", actor);
  });

  it("returns a handler failure as isError text, never as a protocol error", async () => {
    // Outside every read root → lib/host refuses. The point is the SHAPE.
    const r = await dispatch(call("fs_read", { path: "/proc/1/environ" }), "read");
    expect(r.error).toBeUndefined();
    expect((r.result as { isError?: boolean }).isError).toBe(true);
  });

  it("isolates parallel runs and treats missing workflow ids as standalone", async () => {
    const actor = "mcp:workflow-context";
    const firstStart = await dispatch(call("workflow_start", {
      intent: "check server stats as the first correlated test",
    }), "write", actor);
    const first = JSON.parse((firstStart.result as { content: { text: string }[] }).content[0].text) as {
      workflow: { id: string };
    };
    const secondStart = await dispatch(call("workflow_start", {
      intent: "check server stats as the second correlated test",
    }), "write", actor);
    const second = JSON.parse((secondStart.result as { content: { text: string }[] }).content[0].text) as {
      workflow: { id: string };
    };

    await dispatch(call("sys_stats", { workflow_id: first.workflow.id }), "read", actor);
    await dispatch(call("sys_stats", { workflow_id: second.workflow.id }), "read", actor);
    expect((await activeWorkflowForActor(actor, first.workflow.id))?.steps.map((step) => step.tool)).toEqual(["sys_stats"]);
    expect((await activeWorkflowForActor(actor, second.workflow.id))?.steps.map((step) => step.tool)).toEqual(["sys_stats"]);

    await dispatch(call("sys_stats"), "read", actor);
    expect((await activeWorkflowForActor(actor, first.workflow.id))?.steps).toHaveLength(1);
    expect((await activeWorkflowForActor(actor, second.workflow.id))?.steps).toHaveLength(1);

    const wrong = await dispatch(call("sys_stats", { workflow_id: "wrong" }), "read", actor);
    expect((wrong.result as { isError?: boolean }).isError).toBe(true);
    expect((await activeWorkflowForActor(actor, first.workflow.id))?.steps).toHaveLength(1);

    await dispatch(call("workflow_cancel", { workflow_id: first.workflow.id, reason: "test cleanup" }), "write", actor);
    await dispatch(call("workflow_cancel", { workflow_id: second.workflow.id, reason: "test cleanup" }), "write", actor);
    await expect(activeWorkflowForActor(actor, first.workflow.id)).resolves.toBeNull();
    await expect(activeWorkflowForActor(actor, second.workflow.id)).resolves.toBeNull();
  });

  it("supports direct MCP image content for visual tools", async () => {
    const tool = TOOLS.find((t) => t.name === "screen_capture");
    expect(tool).toBeTruthy();
    // Do not launch Chrome in the unit suite; temporarily replace the handler so
    // this test only locks the dispatcher response shape.
    const original = tool!.run;
    tool!.run = async () => ({
      __mcpDirect: true,
      content: [
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
        { type: "text", text: "shot" },
      ],
    });
    try {
      const r = await dispatch(call("screen_capture"), "read", "mcp:test");
      const content = (r.result as { content: Array<{ type: string }> }).content;
      expect(content.map((c) => c.type)).toEqual(["image", "text"]);
    } finally {
      tool!.run = original;
    }
  });
});

describe("catalog hygiene", () => {
  it("every tool is snake_case and uniquely named", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("offers optional workflow correlation on every operational tool", () => {
    const exempt = new Set(["skills_search", "workflow_start", "workflow_cancel", "workflow_finish"]);
    for (const tool of TOOLS) {
      if (exempt.has(tool.name)) continue;
      expect(tool.inputSchema.properties, tool.name).toHaveProperty("workflow_id");
      expect(tool.inputSchema.required ?? [], tool.name).not.toContain("workflow_id");
    }
  });

  it("every required arg is declared in properties — a mismatch is unfixable by the model", () => {
    for (const t of TOOLS) {
      for (const k of t.inputSchema.required ?? []) {
        expect(Object.keys(t.inputSchema.properties), `${t.name}.${k}`).toContain(k);
      }
    }
  });

  it("read-scope tools are all annotated readOnlyHint, and no write tool claims it", () => {
    for (const t of TOOLS) {
      if (t.scope === "read") expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      else expect(t.annotations?.readOnlyHint, t.name).not.toBe(true);
    }
  });

  it("the irreversible tools carry destructiveHint so clients keep prompting", () => {
    for (const name of ["fs_delete", "exec_run", "browser_power"]) {
      expect(TOOLS.find((t) => t.name === name)?.annotations?.destructiveHint, name).toBe(true);
    }
  });
});

describe("audit trail", () => {
  beforeEach(() => {
    audited.length = 0;
  });

  it("records a scope refusal — a read token reaching for exec IS the injection signal", async () => {
    await dispatch(call("exec_run", { command: "id" }), "read", "mcp:abc123");
    expect(audited).toEqual([
      expect.objectContaining({ action: "mcp.denied", actor: "mcp:abc123", target: "exec_run", ok: false }),
    ]);
  });

  it("records a failed write with its target, so a blocked path is visible", async () => {
    await dispatch(call("fs_write", { path: "/etc/shadow", content: "x" }), "write", "mcp:abc123");
    expect(audited).toEqual([
      expect.objectContaining({ action: "fs.write", actor: "mcp:abc123", target: "/etc/shadow", ok: false }),
    ]);
    expect(audited[0]).toMatchObject({ meta: { via: "mcp", scope: "write" } });
  });

  it("records exec_run with the command as the target", async () => {
    await dispatch(call("exec_run", { command: "echo hi" }), "exec", "mcp:abc123");
    expect(audited[0]).toMatchObject({ action: "exec.run", target: "echo hi", ok: true, detail: "exit 0" });
  });

  it("records a REFUSED command as exec.blocked, not a successful exec.run", async () => {
    // runCommand refuses by RETURNING {code:126}, not by throwing, so "did not
    // throw" is not success. This shipped wrong on 2026-08-10: a blocked command
    // landed in the trail as ok:true, and exec.blocked could never be emitted over
    // MCP at all. Mirrors app/api/v1/exec/run/route.ts.
    await dispatch(call("exec_run", { command: "rm -rf /" }), "exec", "mcp:abc123");
    expect(audited[0]).toMatchObject({ action: "exec.blocked", ok: false });
  });

  it("records a non-zero exit as a failure, with the code", async () => {
    await dispatch(call("exec_run", { command: "exit 3" }), "exec", "mcp:abc123");
    expect(audited[0]).toMatchObject({ action: "exec.run", ok: false, detail: "exit 3" });
  });

  it("does NOT record reads — bounded and high-volume, same rule /api/v1 follows", async () => {
    await dispatch(call("sys_stats"), "read", "mcp:abc123");
    await dispatch(call("fs_list", { path: "~/projects" }), "read", "mcp:abc123");
    await dispatch({ id: 1, method: "tools/list" }, "exec", "mcp:abc123");
    expect(audited).toEqual([]);
  });

  it("every write/exec tool declares an audit action, and no read tool does", () => {
    for (const t of TOOLS) {
      if (t.scope === "read") expect(t.audit, t.name).toBeUndefined();
      else expect(t.audit?.action, t.name).toBeTruthy();
    }
  });
});
