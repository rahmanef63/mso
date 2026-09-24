import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
const call = vi.fn();
const list = vi.fn();
vi.mock("@/lib/host/project-mcp-client", () => ({ callMcpServerTool: call, listMcpServerTools: list }));

let root = "";
let callNamedMcpConnectionTool: typeof import("./mcp-connection").callNamedMcpConnectionTool;
let listNamedMcpConnectionTools: typeof import("./mcp-connection").listNamedMcpConnectionTools;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-mcp-connection-"));
  process.env.OS_INFRA_STORE = path.join(root, "infra.json");
  process.env.VITEST = "1";
  const { integrationManage } = await import("./connection-manage");
  const service = await import("./connection-service");
  await integrationManage({ action: "user.create", confirm: true, user: "owner" });
  await integrationManage({ action: "connection.create", confirm: true, user: "owner", provider: "mcp", connection: "jev", source: "direct", authMethod: "direct" });
  const snapshot = await service.credentialSnapshot("mcp", { user: "owner", connection: "jev" });
  await service.saveConnectionValues("mcp", { user: "owner", connection: "jev" }, {
    endpoint: "https://www.jevai.org/api/mcp",
    accessToken: "opaque-private-token-123456",
    allowedTools: "jev_decide, jev_route_task",
  }, snapshot.connection, true);
  const module = await import("./mcp-connection");
  callNamedMcpConnectionTool = module.callNamedMcpConnectionTool;
  listNamedMcpConnectionTools = module.listNamedMcpConnectionTools;
});

afterAll(async () => {
  delete process.env.OS_INFRA_STORE;
  delete process.env.VITEST;
  await fs.rm(root, { recursive: true, force: true });
});

describe("named MCP integration execution", () => {
  it("uses the stored bearer only inside the transport and honors the allowlist", async () => {
    list.mockResolvedValue([{ name: "jev_decide" }, { name: "jev_route_task" }, { name: "other" }]);
    call.mockResolvedValue({ structuredContent: { answers: {} } });

    const listed = await listNamedMcpConnectionTools({ user: "owner", connection: "jev" });
    expect(listed.map((row: { name: string }) => row.name)).toEqual(["jev_decide", "jev_route_task"]);

    await callNamedMcpConnectionTool({ user: "owner", connection: "jev" }, "jev_decide", { state: { task: "route" }, questions: {} });
    expect(call).toHaveBeenCalledTimes(1);
    const [server, name] = call.mock.calls[0]!;
    expect(name).toBe("jev_decide");
    expect(server.url).toBe("https://www.jevai.org/api/mcp");
    expect(server.headers.Authorization).toBe("Bearer opaque-private-token-123456");

    await expect(callNamedMcpConnectionTool({ user: "owner", connection: "jev" }, "other", {})).rejects.toMatchObject({ code: "mcp_tool_not_allowed" });
  });
});
