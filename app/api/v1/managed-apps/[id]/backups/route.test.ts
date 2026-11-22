import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  isManagedAppId: vi.fn((id: string) => id === "hermes" || id === "openclaw"),
  listBackups: vi.fn(async (_id: string) => [
    { id: "bak-20261031-120000", timestamp: 1730376000000, size: 1048576 },
  ]),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/managed-apps/catalog", () => ({ isManagedAppId: mocks.isManagedAppId }));
vi.mock("@/lib/managed-apps/backups", () => ({ listBackups: mocks.listBackups }));

import { GET } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (id: string) => new Request(`https://mso.example.com/api/v1/managed-apps/${id}/backups`);

describe("GET /api/v1/managed-apps/[id]/backups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAuth.mockResolvedValue(true);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await GET(req("hermes"), ctx("hermes"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.listBackups).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown application id", async () => {
    const res = await GET(req("unknown-app"), ctx("unknown-app"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown managed application" });
    expect(mocks.listBackups).not.toHaveBeenCalled();
  });

  it("returns backups list on happy path", async () => {
    const res = await GET(req("hermes"), ctx("hermes"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      backups: [{ id: "bak-20261031-120000", timestamp: 1730376000000, size: 1048576 }],
    });
    expect(mocks.listBackups).toHaveBeenCalledWith("hermes");
  });
});
