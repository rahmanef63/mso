import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  isManagedAppId: vi.fn((id: string) => id === "hermes" || id === "openclaw"),
  getManagedAppLogs: vi.fn(async (_id: string) => ({ lines: ["started", "listening"] })),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/managed-apps/catalog", () => ({ isManagedAppId: mocks.isManagedAppId }));
vi.mock("@/lib/managed-apps/manager", () => ({ getManagedAppLogs: mocks.getManagedAppLogs }));

import { GET } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (id: string) => new Request(`https://mso.example.com/api/v1/managed-apps/${id}/logs`);

describe("GET /api/v1/managed-apps/[id]/logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAuth.mockResolvedValue(true);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await GET(req("hermes"), ctx("hermes"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.getManagedAppLogs).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown application id", async () => {
    const res = await GET(req("unknown-app"), ctx("unknown-app"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown managed application" });
    expect(mocks.getManagedAppLogs).not.toHaveBeenCalled();
  });

  it("returns app logs on happy path", async () => {
    const res = await GET(req("hermes"), ctx("hermes"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lines: ["started", "listening"] });
    expect(mocks.getManagedAppLogs).toHaveBeenCalledWith("hermes");
  });
});
