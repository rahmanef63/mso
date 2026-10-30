import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(async (_role?: string) => true),
  listDokployProjects: vi.fn(async () => [
    { id: "proj-1", name: "Production", description: "Main stack" },
  ]),
  withIntegrationSelection: vi.fn(async (_sel: unknown, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/infra", () => ({
  listDokployProjects: mocks.listDokployProjects,
}));
vi.mock("@/lib/infra/connection-service", () => ({
  withIntegrationSelection: mocks.withIntegrationSelection,
}));

import { GET } from "./route";

const req = (url = "https://mso.example.com/api/v1/infra/dokploy/projects") => new Request(url);

describe("GET /api/v1/infra/dokploy/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue(true);
    mocks.listDokployProjects.mockResolvedValue([
      { id: "proj-1", name: "Production", description: "Main stack" } as never,
    ]);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.requireSession.mockResolvedValue(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.listDokployProjects).not.toHaveBeenCalled();
  });

  it("returns 200 with projects list on happy path", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      projects: [{ id: "proj-1", name: "Production", description: "Main stack" }],
    });
    expect(mocks.listDokployProjects).toHaveBeenCalledOnce();
  });

  it("returns 503 when dokploy integration fails", async () => {
    mocks.listDokployProjects.mockRejectedValueOnce(new Error("dokploy API unreachable"));
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "dokploy API unreachable" });
  });
});
