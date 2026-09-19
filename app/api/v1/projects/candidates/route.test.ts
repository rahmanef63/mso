import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  limited: vi.fn(),
  resolve: vi.fn(),
  inspect: vi.fn(),
  revision: vi.fn(),
  search: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: mocks.session }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.limited }));
vi.mock("@/lib/host/projects-api", () => ({
  resolveProjectHint: mocks.resolve,
  inspectProject: mocks.inspect,
}));
vi.mock("@/lib/host/project-candidate-index", () => ({
  projectCandidateRevision: mocks.revision,
  searchProjectCandidateIndex: mocks.search,
}));

const { GET } = await import("./route");

describe("GET /api/v1/projects/candidates", () => {
  beforeEach(() => {
    mocks.session.mockReset().mockResolvedValue({
      role: "viewer",
      session: { device_id: "device-1" },
    });
    mocks.limited.mockReset().mockReturnValue(false);
    mocks.resolve.mockReset().mockResolvedValue({
      id: "root/mso",
      name: "mso",
      path: "/srv/mso",
    });
    mocks.inspect.mockReset().mockResolvedValue({ git: { head: { sha: "abc" }, changes: [] } });
    mocks.revision.mockReset().mockReturnValue("revision-1");
    mocks.search.mockReset().mockResolvedValue({
      revision: "revision-1",
      rebuilt: false,
      reusedSeed: false,
      indexedEntries: 3,
      candidates: [{ path: "lib/workflow/replay.ts", kind: "path", size: 100, score: 1 }],
      matches: [{ path: "lib/workflow/replay.ts", line: 1, preview: "bounded replay" }],
      truncated: false,
      truncationReasons: [],
    });
  });

  it("requires an authenticated session", async () => {
    mocks.session.mockResolvedValue(null);
    const res = await GET(new Request("http://mso.test/api/v1/projects/candidates?project=mso&q=replay"));
    expect(res.status).toBe(401);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("shares the 30/min read bound with the MCP capability", async () => {
    mocks.limited.mockReturnValue(true);
    const res = await GET(new Request("http://mso.test/api/v1/projects/candidates?project=mso&q=replay"));
    expect(res.status).toBe(429);
    expect(mocks.limited).toHaveBeenCalledWith("projects.candidates:device-1", 30, 60_000);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("resolves the project and delegates to the same bounded candidate primitive", async () => {
    const res = await GET(new Request(
      "http://mso.test/api/v1/projects/candidates?project=root%2Fmso&q=bounded+replay&limit=999&cursor=next",
    ));
    expect(res.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith("root/mso");
    expect(mocks.revision).toHaveBeenCalled();
    expect(mocks.search).toHaveBeenCalledWith({
      projectPath: "/srv/mso",
      query: "bounded replay",
      revision: "revision-1",
      limit: 40,
      cursor: "next",
    });
    await expect(res.json()).resolves.toMatchObject({
      project: { id: "root/mso", name: "mso", path: "/srv/mso" },
      candidates: [{ path: "lib/workflow/replay.ts" }],
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
