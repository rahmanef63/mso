import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
}));

vi.mock("@/lib/agent/server", () => ({
  verifyAuth: mocks.verifyAuth,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
});

describe("GET /api/v1/apps", () => {
  // apps uses verifyAuth (default role) and returns 401 { error: "unauthorized" }
  it("returns 401 { error: 'unauthorized' } when unauthenticated", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const req = new Request("https://mso.example/api/v1/apps");
    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.verifyAuth).toHaveBeenCalledWith(req);
  });

  // runtime apps list is empty array by contract for localStorage app registry
  it("returns 200 with empty array when authenticated", async () => {
    const req = new Request("https://mso.example/api/v1/apps");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(mocks.verifyAuth).toHaveBeenCalledWith(req);
  });
});
