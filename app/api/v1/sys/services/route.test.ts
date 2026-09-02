import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  list: vi.fn(async () => ({ services: [], diagnostics: [], truncated: false, controlAllowlistConfigured: false, generatedAt: "now" })),
  power: vi.fn(async () => ({ unit: "mso.service", scope: "user", load: "loaded", active: "active", sub: "running", description: "MSO", controllable: true })),
  audit: vi.fn(async () => {}),
  actor: vi.fn(async () => "owner-device"),
  rateLimited: vi.fn(() => false),
}));
vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/host/request-api", () => ({
  apiError: (_label: string, error: unknown) => Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }),
}));
vi.mock("@/lib/host/services", () => ({
  listSystemServices: mocks.list,
  servicePower: mocks.power,
}));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.actor }));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockClear();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.rateLimited.mockReturnValue(false);
});

describe("system service API", () => {
  it("returns bounded inventory through the viewer policy", async () => {
    const { GET } = await import("./route");
    const request = new Request("https://mso.example/api/v1/sys/services");
    expect((await GET(request)).status).toBe(200);
    expect(mocks.verifyAuth).toHaveBeenCalledWith(request);
    expect(mocks.list).toHaveBeenCalledOnce();
  });

  it("passes only typed scope/unit/action to the allowlisted host helper and audits it", async () => {
    const { POST } = await import("./route");
    const request = new Request("https://mso.example/api/v1/sys/services", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "user", unit: "mso.service", action: "restart" }),
    });
    expect((await POST(request)).status).toBe(200);
    expect(mocks.power).toHaveBeenCalledWith("user", "mso.service", "restart");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "sys.service", actor: "owner-device", target: "user:mso.service", detail: "restart",
    }));
  });

  it("does not call the host when authorization fails", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const { POST } = await import("./route");
    const response = await POST(new Request("https://mso.example/api/v1/sys/services", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
    expect(mocks.power).not.toHaveBeenCalled();
  });

  it("rate-limits inventory and actions per approved device before spawning", async () => {
    mocks.rateLimited.mockReturnValue(true);
    const { GET, POST } = await import("./route");
    expect((await GET(new Request("https://mso.example/api/v1/sys/services"))).status).toBe(429);
    expect((await POST(new Request("https://mso.example/api/v1/sys/services", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "user", unit: "mso.service", action: "restart" }),
    }))).status).toBe(429);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.power).not.toHaveBeenCalled();
  });
});
