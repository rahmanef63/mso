import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(async (_role?: string) => true),
  listCloudflareZones: vi.fn(async () => [
    { id: "zone-1", name: "example.com", status: "active" },
  ]),
  withIntegrationSelection: vi.fn(async (_sel: unknown, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/infra", () => ({
  listCloudflareZones: mocks.listCloudflareZones,
}));
vi.mock("@/lib/infra/connection-service", () => ({
  withIntegrationSelection: mocks.withIntegrationSelection,
}));

import { GET } from "./route";

const req = (url = "https://mso.example.com/api/v1/infra/cloudflare/zones") => new Request(url);

describe("GET /api/v1/infra/cloudflare/zones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue(true);
    mocks.listCloudflareZones.mockResolvedValue([
      { id: "zone-1", name: "example.com", status: "active" } as never,
    ]);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.requireSession.mockResolvedValue(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.listCloudflareZones).not.toHaveBeenCalled();
  });

  it("returns 200 with zones list on happy path", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      zones: [{ id: "zone-1", name: "example.com", status: "active" }],
    });
    expect(mocks.listCloudflareZones).toHaveBeenCalledOnce();
  });

  it("returns 503 when cloudflare integration fails", async () => {
    mocks.listCloudflareZones.mockRejectedValueOnce(new Error("cloudflare API rate limit exceeded"));
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "cloudflare API rate limit exceeded" });
  });
});
