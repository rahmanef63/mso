import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
const callNamedMcpConnectionTool = vi.fn(async (_selection, name, args) => ({ name, args, ok: true }));
const listNamedMcpConnectionTools = vi.fn(async () => [{ name: "jev_decide", inputSchema: { type: "object", properties: {} } }]);
vi.mock("./mcp-connection", () => ({ callNamedMcpConnectionTool, listNamedMcpConnectionTools }));

let root = "";
let executeIntegrationAction: typeof import("./connection-dispatch").executeIntegrationAction;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-mcp-dispatch-"));
  process.env.OS_INFRA_STORE = path.join(root, "infra.json");
  process.env.VITEST = "1";

  const { integrationManage } = await import("./connection-manage");
  const service = await import("./connection-service");
  await integrationManage({ action: "user.create", confirm: true, user: "owner" });
  await integrationManage({ action: "connection.create", confirm: true, user: "owner", provider: "mcp", connection: "jev", source: "direct", authMethod: "direct" });
  const snapshot = await service.credentialSnapshot("mcp", { user: "owner", connection: "jev" });
  await service.saveConnectionValues("mcp", { user: "owner", connection: "jev" }, {
    endpoint: "https://jev.example.test/mcp",
    accessToken: "synthetic_mcp_token_123456789",
    allowedTools: "jev_decide",
  }, snapshot.connection, true);
  executeIntegrationAction = (await import("./connection-dispatch")).executeIntegrationAction;
});

afterAll(async () => {
  delete process.env.OS_INFRA_STORE;
  delete process.env.VITEST;
  await fs.rm(root, { recursive: true, force: true });
});

it("keeps generic MCP connection execution behind confirmation and metadata-only arguments", async () => {
  await expect(executeIntegrationAction({
    user: "owner", provider: "mcp", connection: "jev", operation: "mcp.tool",
    arguments: { name: "jev_decide", arguments: { state: "safe" } },
  })).rejects.toMatchObject({ code: "confirmation_required" });

  await expect(executeIntegrationAction({
    user: "owner", provider: "mcp", connection: "jev", operation: "mcp.tool", confirm: true,
    arguments: { name: "jev_decide", arguments: { token: "must-not-enter-tool-json" } },
  })).rejects.toMatchObject({ code: "secret_input_forbidden" });

  await expect(executeIntegrationAction({
    user: "owner", provider: "mcp", connection: "jev", operation: "mcp.tool", confirm: true,
    arguments: { name: "jev_decide", arguments: { state: { task: "compact" }, questions: {} } },
  })).resolves.toMatchObject({ result: { name: "jev_decide", ok: true } });

  expect(callNamedMcpConnectionTool).toHaveBeenCalledWith(
    { user: "owner", connection: "jev" },
    "jev_decide",
    { state: { task: "compact" }, questions: {} },
  );
});

it("lists tools only through the exact selected MCP connection", async () => {
  await expect(executeIntegrationAction({
    user: "owner", provider: "mcp", connection: "jev", operation: "mcp.tools.list", confirm: true, arguments: {},
  })).resolves.toMatchObject({ result: [{ name: "jev_decide" }] });
  expect(listNamedMcpConnectionTools).toHaveBeenCalledWith({ user: "owner", connection: "jev" });
});
