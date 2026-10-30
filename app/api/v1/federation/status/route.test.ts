import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  getBatonlyFederationWorkerStatus: vi.fn(),
}));

vi.mock("@/lib/agent/server", () => ({
  verifyAuth: mocks.verifyAuth,
}));

vi.mock("@/lib/mcp/federation/batonly-worker", () => ({
  getBatonlyFederationWorkerStatus: mocks.getBatonlyFederationWorkerStatus,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.getBatonlyFederationWorkerStatus.mockReturnValue({
    running: true,
    connected: true,
  });
});

describe("GET /api/v1/federation/status", () => {
  // federation/status uses verifyAuth with "owner" and yields 401 { error: "unauthorized" }
  it("returns 401 { error: 'unauthorized' } when unauthenticated and does not query worker", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const req = new Request("https://mso.example/api/v1/federation/status");
    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.verifyAuth).toHaveBeenCalledWith(req, "owner");
    expect(mocks.getBatonlyFederationWorkerStatus).not.toHaveBeenCalled();
  });

  it("returns 200 with worker status and no-store cache control when owner", async () => {
    const status = { running: true, connected: true, queueDepth: 0 };
    mocks.getBatonlyFederationWorkerStatus.mockReturnValue(status);

    const req = new Request("https://mso.example/api/v1/federation/status");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(status);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getBatonlyFederationWorkerStatus).toHaveBeenCalledTimes(1);
  });
});
