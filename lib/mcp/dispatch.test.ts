import { describe, expect, it, vi } from "vitest";
// The catalog reaches lib/camoufox + lib/managed-apps, which are `server-only`.
// Next aliases that specifier internally; vitest does not, so stub it — same
// pattern as lib/managed-apps/manager.test.ts.
vi.mock("server-only", () => ({}));
const localSessionMock = vi.hoisted(() => ({ handoffOwnerLocalSession: vi.fn() }));
vi.mock("@/lib/a2a/local-session", () => localSessionMock);

// Spy on the trail without writing to ~/.mso/audit.log. Everything else in
// @/lib/host stays REAL — the point of these cases is that the dispatcher, not
// each tool, is what records.
const audited: { action: string; actor?: string; target?: string; ok?: boolean }[] = [];
vi.mock("@/lib/host/audit-api", async (orig) => {
  const real = await orig<typeof import("@/lib/host/audit-api")>();
  return { ...real, audit: (e: { action: string }) => { audited.push(e); return Promise.resolve(); } };
});

const { dispatch, isNotification } = await import("./dispatch");
const { TOOLS } = await import("./tools");
const { MCP_SERVER_VERSION } = await import("./toolset");

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

  it("does not impersonate modern server/discover with an initialize-shaped result", async () => {
    const r = await dispatch({ id: 9, method: "server/discover" }, "read");
    expect(r.error).toMatchObject({ code: -32601 });
  });

  it("publishes server and toolset metadata so action drift is visible", async () => {
    const r = await dispatch({ id: 1, method: "initialize" }, "exec");
    const result = r.result as { serverInfo: { version: string }; _meta: { toolset: { toolCount: number; hash: string } } };
    expect(result.serverInfo.version).toBe(MCP_SERVER_VERSION);
    expect(result._meta.toolset.toolCount).toBe(TOOLS.length);
    expect(result._meta.toolset.hash).toMatch(/^[a-f0-9]{16}$/);
  });


  it("publishes OpenAI file binding metadata on the upload bridge", async () => {
    const r = await dispatch({ id: 1, method: "tools/list" }, "write");
    const tools = (r.result as { tools: Array<{ name: string; _meta?: Record<string, unknown> }> }).tools;
    const upload = tools.find((tool) => tool.name === "fs_upload_file");
    expect(upload?._meta).toEqual({ "openai/fileParams": ["file"], securitySchemes: [{ type: "oauth2", scopes: ["write"] }] });
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

describe("restricted service-token dispatch", () => {
  const context = {
    allowedTools: ["project_capabilities", "project_function_call"],
    toolArgumentConstraints: { project_function_call: { project: ["antinrml-game"], name: ["capture_scene"] } },
  } as const;

  it("filters list-time and call-time capability exposure", async () => {
    const listed = await dispatch({ id: 80, method: "tools/list" }, "exec", "mcp:service", context);
    const names = ((listed.result as { tools: Array<{ name: string }> }).tools ?? []).map((row) => row.name);
    expect(names).toEqual(["project_capabilities", "project_function_call"]);
    const denied = await dispatch(call("exec_run", { command: "id" }), "exec", "mcp:service", context);
    expect(denied.error).toMatchObject({ code: -32602 });
  });

  it("pins exact string arguments for the allowed project function", async () => {
    const wrongProject = await dispatch(call("project_function_call", { project: "mso", name: "capture_scene", input: {} }), "exec", "mcp:service", context);
    expect(wrongProject.error).toMatchObject({ code: -32602 });
    const wrongFunction = await dispatch(call("project_function_call", { project: "antinrml-game", name: "dangerous_write", input: {} }), "exec", "mcp:service", context);
    expect(wrongFunction.error).toMatchObject({ code: -32602 });
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
    expect(n).toContain("local_agent_request_wait");
    expect(n).not.toContain("local_agent_message_send");
    expect(n).not.toContain("local_agent_request");
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
    expect(n).not.toContain("local_agent_request");
    expect(n).not.toContain("exec_run");
    expect(n).not.toContain("browser_power");
  });

  it("shows an exec token the whole catalog", async () => {
    expect(await names("exec")).toHaveLength(TOOLS.length);
  });
});


describe("local agent request dispatch", () => {
  it("dispatches local_agent_request through the MCP catalog with the conversation-bound session context", async () => {
    localSessionMock.handoffOwnerLocalSession.mockResolvedValueOnce({
      session: { id: "20260902_120000_11111111", name: "milo" },
      task: { state: "completed", artifacts: [{ parts: [{ text: "worker result" }] }] },
    });
    const capabilities = { list: () => [], invoke: vi.fn(async () => ({ content: [] })) };
    const context = { principal: "cli:test-dispatch", sessionId: "20260902_120001_22222222", capabilities };
    const r = await dispatch(call("local_agent_request", { target: "milo", objective: "inspect this" }), "exec", "tester", context);
    expect(r.error).toBeUndefined();
    expect(localSessionMock.handoffOwnerLocalSession).toHaveBeenCalledWith(
      context.principal, "milo", "inspect this", capabilities, context.sessionId,
    );
    expect(JSON.stringify(r.result)).toContain("worker result");
  });
});
