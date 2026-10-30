import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  listManagedApps: vi.fn(async () => [
    { id: "hermes", name: "Hermes", state: "running", dashboardUrl: "http://127.0.0.1:9119" },
  ]),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/managed-apps/manager", () => ({ listManagedApps: mocks.listManagedApps }));

import { GET } from "./route";

const req = () => new Request("https://mso.example.com/api/v1/managed-apps");

describe("GET /api/v1/managed-apps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAuth.mockResolvedValue(true);
    mocks.listManagedApps.mockResolvedValue([
      { id: "hermes", name: "Hermes", state: "running", dashboardUrl: "http://127.0.0.1:9119" } as never,
    ]);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.listManagedApps).not.toHaveBeenCalled();
  });

  it("returns managed apps list on happy path", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apps).toHaveLength(1);
    expect(body.apps[0].id).toBe("hermes");
    expect(mocks.listManagedApps).toHaveBeenCalledOnce();
  });

  it("returns 503 when manager fails", async () => {
    mocks.listManagedApps.mockRejectedValueOnce(new Error("daemon unreachable"));
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "managed applications unavailable" });
  });
});
