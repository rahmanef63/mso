import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  listTokens: vi.fn(async () => []),
  publicOrigin: vi.fn(() => "https://mso.example.test"),
  mintPatToken: vi.fn(async (input: { label: string; scope: string; ttlDays?: number | null }) => ({
    rawToken: "mso_pat_test123",
    tokenView: {
      id: "test1234",
      label: input.label,
      clientId: "manual:pat",
      scope: input.scope,
      createdAt: Date.now(),
      expiresAt: input.ttlDays ? Date.now() + input.ttlDays * 86_400_000 : 0,
      status: "active" as const,
    },
  })),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/mcp/store", () => ({
  listTokens: mocks.listTokens,
  revokeToken: vi.fn(),
  revokeAllTokens: vi.fn(),
  mintPatToken: mocks.mintPatToken,
}));
vi.mock("@/lib/mcp/scope", () => ({ mcpEnabled: () => true, maxScope: () => "exec", parseScope: (s: string) => s, clampScope: (s: string) => s }));
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
    await expect(response.json()).resolves.toMatchObject({ enabled: true, maxScope: "exec", origin: "https://mso.example.test" });
    expect(mocks.publicOrigin).toHaveBeenCalledWith(request);
  });

  it("does not reveal connection metadata without owner auth", async () => {
    mocks.verifyAuth.mockResolvedValueOnce(false);
    const { GET } = await import("./route");
    const response = await GET(new Request("https://mso.example.test/api/mcp/tokens"));
    expect(response.status).toBe(401);
  });

  it("mints Personal Access Tokens (PAT) via POST with owner auth", async () => {
    const { POST } = await import("./route");
    const request = new Request("https://mso.example.test/api/mcp/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Antigravity CLI", scope: "exec", ttlDays: 0 }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.token).toBe("mso_pat_test123");
    expect(data.tokenView.label).toBe("Antigravity CLI");
    expect(data.tokenView.expiresAt).toBe(0);
    expect(mocks.mintPatToken).toHaveBeenCalledWith({
      label: "Antigravity CLI",
      scope: "exec",
      ttlDays: null,
    });
  });

  it("rejects PAT generation without owner auth or with empty label", async () => {
    mocks.verifyAuth.mockResolvedValueOnce(false);
    const { POST } = await import("./route");
    const unauthRes = await POST(new Request("https://mso.example.test/api/mcp/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Test" }),
    }));
    expect(unauthRes.status).toBe(401);

    const emptyRes = await POST(new Request("https://mso.example.test/api/mcp/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "   " }),
    }));
    expect(emptyRes.status).toBe(400);
  });
});
