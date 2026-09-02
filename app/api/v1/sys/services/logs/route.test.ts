import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  actor: vi.fn(async () => "operator-device"),
  rateLimited: vi.fn(() => false),
  logs: vi.fn(async () => ({ unit: "mso.service", scope: "user", entries: ["ok"], available: true })),
}));
vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.actor }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/host/request-api", () => ({
  apiError: (_label: string, error: unknown) => Response.json({ error: String(error) }, { status: 400 }),
}));
vi.mock("@/lib/host/services", () => ({ serviceLogs: mocks.logs }));

beforeEach(() => {
  mocks.verifyAuth.mockReset().mockResolvedValue(true);
  mocks.actor.mockClear();
  mocks.rateLimited.mockReset().mockReturnValue(false);
  mocks.logs.mockClear();
});

describe("service logs API", () => {
  it("passes only bounded query fields to the host helper", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("https://mso.example/api/v1/sys/services/logs?scope=user&unit=mso.service&limit=9999"));
    expect(response.status).toBe(200);
    expect(mocks.logs).toHaveBeenCalledWith("user", "mso.service", 9999);
  });

  it("rejects unauthorized and rate-limited requests before journalctl", async () => {
    const { GET } = await import("./route");
    mocks.verifyAuth.mockResolvedValue(false);
    expect((await GET(new Request("https://mso.example/api/v1/sys/services/logs"))).status).toBe(401);
    mocks.verifyAuth.mockResolvedValue(true);
    mocks.rateLimited.mockReturnValue(true);
    expect((await GET(new Request("https://mso.example/api/v1/sys/services/logs"))).status).toBe(429);
    expect(mocks.logs).not.toHaveBeenCalled();
  });
});
