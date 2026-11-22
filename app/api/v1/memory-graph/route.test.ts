import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  session: vi.fn(),
  collect: vi.fn(async () => ({ nodes: [], edges: [] })),
}));

vi.mock("@/lib/agent/server", () => ({
  verifyAuth: mocks.verifyAuth,
}));
vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: mocks.session,
}));
vi.mock("@/lib/memory-graph/collect", () => ({
  collectMemoryGraph: mocks.collect,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.session.mockResolvedValue({ session: { device_id: "dev-owner" }, role: "owner" });
  mocks.collect.mockResolvedValue({ nodes: [], edges: [] });
});

describe("GET /api/v1/memory-graph", () => {
  it("refuses unauthenticated requests when verifyAuth fails", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await GET(new Request("https://mso.example/api/v1/memory-graph"));
    expect(res.status).toBe(401);
    expect(mocks.collect).not.toHaveBeenCalled();
  });

  it("refuses unauthenticated requests when session is missing", async () => {
    mocks.session.mockResolvedValue(null);
    const res = await GET(new Request("https://mso.example/api/v1/memory-graph"));
    expect(res.status).toBe(401);
    expect(mocks.collect).not.toHaveBeenCalled();
  });

  it.each(["viewer", "operator"])("refuses %s role with owner_required", async (role) => {
    mocks.session.mockResolvedValue({ session: { device_id: "dev-sub" }, role });
    const res = await GET(new Request("https://mso.example/api/v1/memory-graph"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_required" });
    expect(mocks.collect).not.toHaveBeenCalled();
  });

  it("collects memory graph with query parameters for owner", async () => {
    const res = await GET(
      new Request("https://mso.example/api/v1/memory-graph?root=%2Ftmp%2Fmem&project=p1"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ nodes: [], edges: [] });
    expect(mocks.collect).toHaveBeenCalledWith({
      root: "/tmp/mem",
      project: "p1",
      principal: "cli:dev-owner",
      ownerView: true,
    });
  });

  it("returns 500 when collectMemoryGraph throws", async () => {
    mocks.collect.mockRejectedValue(new Error("graph collection error"));
    const res = await GET(new Request("https://mso.example/api/v1/memory-graph"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "graph collection error" });
  });
});
