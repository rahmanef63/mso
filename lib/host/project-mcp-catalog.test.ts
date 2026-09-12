import { describe, expect, it, vi } from "vitest";
let calls = 0, token = "first";
vi.mock("./project-mcp-auth", () => ({ projectMcpAuthorization: async (server: object) => ({ server: { ...server, headers: { authorization: token } }, allowed: null }) }));
vi.mock("./project-mcp-transport", () => ({ withProjectMcpServer: async (_server: unknown, work: (rpc: () => Promise<unknown>) => Promise<unknown>) => {
  calls++; return work(async () => ({ result: { tools: Array.from({ length: 151 }, (_,i) => ({ name: "tool_" + i, inputSchema: { type: "object" }, outputSchema: { type: "object" }, _meta: { ui: { resourceUri: "ui://fixture" } } })) } }));
} }));
import { listMcpToolPage } from "./project-mcp-catalog";
const server = { name: "fixture", transport: "http" as const, url: "https://example.com/mcp", headers: {}, oauthConfigured: false };
describe("complete bounded MCP discovery", () => {
  it("paginates beyond 128 tools, retains schemas/UI metadata and reuses only matching auth cache", async () => {
    const a = await listMcpToolPage(server, { limit: 100 });
    expect(a.tools).toHaveLength(100); expect(a.complete).toBe(false);
    const b = await listMcpToolPage(server, { cursor: a.nextCursor, limit: 100 });
    expect(b.tools).toHaveLength(51); expect(b.complete).toBe(true); expect(calls).toBe(1);
    expect(b.tools[0]).toMatchObject({ outputSchema: { type: "object" }, _meta: { ui: { resourceUri: "ui://fixture" } } });
    token = "rotated";
    await expect(listMcpToolPage(server, { cursor: a.nextCursor })).rejects.toThrow("another connection");
    await listMcpToolPage(server); expect(calls).toBe(2);
  });
});
