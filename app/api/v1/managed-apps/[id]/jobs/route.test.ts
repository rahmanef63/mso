import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  isManagedAppId: vi.fn((id: string) => id === "hermes" || id === "openclaw"),
  listManagedAppJobs: vi.fn(async (_id: string) => [
    { id: "job-1", status: "running", applicationId: "hermes" },
  ]),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/managed-apps/catalog", () => ({ isManagedAppId: mocks.isManagedAppId }));
vi.mock("@/lib/managed-apps/jobs", () => ({ listManagedAppJobs: mocks.listManagedAppJobs }));

import { GET } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (id: string) => new Request(`https://mso.example.com/api/v1/managed-apps/${id}/jobs`);

describe("GET /api/v1/managed-apps/[id]/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAuth.mockResolvedValue(true);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await GET(req("hermes"), ctx("hermes"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.listManagedAppJobs).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown application id", async () => {
    const res = await GET(req("unknown-app"), ctx("unknown-app"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown managed application" });
    expect(mocks.listManagedAppJobs).not.toHaveBeenCalled();
  });

  it("returns jobs list on happy path", async () => {
    const res = await GET(req("hermes"), ctx("hermes"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      jobs: [{ id: "job-1", status: "running", applicationId: "hermes" }],
    });
    expect(mocks.listManagedAppJobs).toHaveBeenCalledWith("hermes");
  });
});
