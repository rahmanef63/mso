import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  actor: vi.fn(async () => "viewer-device"),
  rateLimited: vi.fn(() => false),
  updates: vi.fn(async () => ({ manager: "apt", available: true, updates: [], truncated: false, checkedAt: "now", source: "local-cache" })),
}));
vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.actor }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/host/package-updates", () => ({ packageUpdates: mocks.updates }));

beforeEach(() => {
  mocks.verifyAuth.mockReset().mockResolvedValue(true);
  mocks.rateLimited.mockReset().mockReturnValue(false);
  mocks.updates.mockClear();
});

describe("package update visibility API", () => {
  it("returns local-cache visibility without a mutation endpoint", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("https://mso.example/api/v1/sys/packages"));
    expect(response.status).toBe(200);
    expect(mocks.updates).toHaveBeenCalledOnce();
  });

  it("stops unauthorized or excessive checks before running a package manager", async () => {
    const { GET } = await import("./route");
    mocks.verifyAuth.mockResolvedValue(false);
    expect((await GET(new Request("https://mso.example/api/v1/sys/packages"))).status).toBe(401);
    mocks.verifyAuth.mockResolvedValue(true);
    mocks.rateLimited.mockReturnValue(true);
    expect((await GET(new Request("https://mso.example/api/v1/sys/packages"))).status).toBe(429);
    expect(mocks.updates).not.toHaveBeenCalled();
  });
});
