import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  readMcpActivity: vi.fn(async (_limit?: number): Promise<unknown[]> => []),
}));

vi.mock("@/lib/agent/server", () => ({
  verifyAuth: mocks.verifyAuth,
}));

vi.mock("@/lib/mcp/activity", () => ({
  readMcpActivity: mocks.readMcpActivity,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.readMcpActivity.mockResolvedValue([
    { id: "act-1", action: "tool_call", status: "completed" },
  ]);
});

describe("GET /api/mcp/activity", () => {
  // mcp/activity uses verifyAuth(req, "owner") and yields 401 { error: "unauthorized" }
  it("returns 401 { error: 'unauthorized' } when unauthenticated and does not read activity", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const req = new Request("https://mso.example/api/mcp/activity");
    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.verifyAuth).toHaveBeenCalledWith(req, "owner");
    expect(mocks.readMcpActivity).not.toHaveBeenCalled();
  });

  it("returns 200 with entries and defaults limit to 80 when query is omitted", async () => {
    const entries = [{ id: "act-1", action: "tool_call", status: "completed" }];
    mocks.readMcpActivity.mockResolvedValue(entries);

    const req = new Request("https://mso.example/api/mcp/activity");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries });
    expect(mocks.readMcpActivity).toHaveBeenCalledWith(80);
  });

  // limit is clamped to [1, 200]
  it("clamps limit between 1 and 200 and handles invalid query values", async () => {
    await GET(new Request("https://mso.example/api/mcp/activity?limit=500"));
    expect(mocks.readMcpActivity).toHaveBeenCalledWith(200);

    await GET(new Request("https://mso.example/api/mcp/activity?limit=-5"));
    expect(mocks.readMcpActivity).toHaveBeenCalledWith(1);

    await GET(new Request("https://mso.example/api/mcp/activity?limit=0"));
    // "0" parses to 0, which falsy evaluates in `Number("0") || 80` -> 80
    expect(mocks.readMcpActivity).toHaveBeenCalledWith(80);

    await GET(new Request("https://mso.example/api/mcp/activity?limit=not-a-number"));
    expect(mocks.readMcpActivity).toHaveBeenCalledWith(80);

    await GET(new Request("https://mso.example/api/mcp/activity?limit=42"));
    expect(mocks.readMcpActivity).toHaveBeenCalledWith(42);
  });
});
