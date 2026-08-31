import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  listTokens: vi.fn(async () => []),
  publicOrigin: vi.fn(() => "https://mso.example.test"),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/mcp/store", () => ({ listTokens: mocks.listTokens, revokeToken: vi.fn(), revokeAllTokens: vi.fn() }));
vi.mock("@/lib/mcp/scope", () => ({ mcpEnabled: () => true, maxScope: () => "write" }));
vi.mock("@/lib/mcp/tools", () => ({ TOOLS: [] }));
vi.mock("@/lib/mcp/toolset", () => ({ toolsetInfo: () => ({ serverVersion: "1", version: "v", hash: "h", changedAt: "2026-08-31", toolCount: 0, byScope: { read: 0, write: 0, exec: 0 } }) }));
vi.mock("@/lib/mcp/origin", () => ({ publicOrigin: mocks.publicOrigin }));

beforeEach(() => vi.clearAllMocks());

describe("Settings MCP state", () => {
  it("returns the deployment-owned public origin instead of forcing the browser origin", async () => {
    const { GET } = await import("./route");
    const request = new Request("http://127.0.0.1:4005/api/mcp/tokens");
    const response = await GET(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ enabled: true, maxScope: "write", origin: "https://mso.example.test" });
    expect(mocks.publicOrigin).toHaveBeenCalledWith(request);
  });

  it("does not reveal connection metadata without owner auth", async () => {
    mocks.verifyAuth.mockResolvedValueOnce(false);
    const { GET } = await import("./route");
    const response = await GET(new Request("https://mso.example.test/api/mcp/tokens"));
    expect(response.status).toBe(401);
  });
});
