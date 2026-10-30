import { beforeEach, describe, expect, it, vi } from "vitest";

// app/api/skills is the last untested route, and it is worth its own file because of one
// branch: a bare skill name that matches several projects returns 409 "ambiguous" with
// candidates, NOT 404 and NOT a guess. Returning one project's instructions under another
// project's name is the exact bug that branch exists to prevent, so it gets an assertion.

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(async (_role?: string) => true),
  catalogSkillsDetailed: vi.fn(async () => ({ skills: [] as unknown[] })),
  resolveSkill: vi.fn(() => ({ skill: null, ambiguous: null }) as unknown),
  readSkillFile: vi.fn(async () => null as string | null),
  catalogGet: vi.fn(async () => ({ skills: [] as unknown[], scan: {} as unknown }) as unknown),
  listLearnedRecipes: vi.fn(async () => [] as unknown[]),
  searchSkillMemory: vi.fn(async () => ({ hits: [] }) as unknown),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/demo", () => ({ IS_DEMO: false }));
vi.mock("@/lib/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/skills/catalog", () => ({
  catalogSkillsDetailed: mocks.catalogSkillsDetailed,
  resolveSkill: mocks.resolveSkill,
  readSkillFile: mocks.readSkillFile,
}));
vi.mock("@/lib/skills/catalog-ttl", () => ({ catalogTtl: { get: mocks.catalogGet } }));
vi.mock("@/lib/workflow", () => ({ listLearnedRecipes: mocks.listLearnedRecipes }));
vi.mock("@/lib/skills/search", () => ({ searchSkillMemory: mocks.searchSkillMemory }));

const { GET } = await import("./route");

// This handler reads req.nextUrl (NextRequest), not new URL(req.url). A plain Request makes it
// throw before any assertion, which would have made every test below a 500 rather than a check
// on the branch it names. Shim nextUrl onto the request the same way Next supplies it.
const get = (qs = "") => {
  const url = new URL(`https://mso.example/api/skills${qs}`);
  const req = new Request(url);
  Object.defineProperty(req, "nextUrl", { value: url, configurable: true });
  return GET(req as never);
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue(true);
  mocks.catalogSkillsDetailed.mockResolvedValue({ skills: [] });
  mocks.resolveSkill.mockReturnValue({ skill: null, ambiguous: null });
  mocks.readSkillFile.mockResolvedValue(null);
  mocks.catalogGet.mockResolvedValue({ skills: [], scan: {} });
  mocks.listLearnedRecipes.mockResolvedValue([]);
});

describe("GET /api/skills", () => {
  it("returns 401 Unauthorized without an owner session", async () => {
    mocks.requireSession.mockResolvedValue(false);
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    // The catalog must not be read for a caller who cannot see it.
    expect(mocks.catalogGet).not.toHaveBeenCalled();
  });

  it("lists skills and learned recipes on the bare path", async () => {
    mocks.catalogGet.mockResolvedValue({ skills: [{ id: "a", name: "a" }], scan: { at: 1 } });
    mocks.listLearnedRecipes.mockResolvedValue([
      { id: "r1", intent: "i", project: "p", summary: "s", attempts: 2, successes: 2, failures: 0, fastestDurationMs: 9, updatedAt: 1 },
    ]);
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills).toHaveLength(1);
    expect(body.recipes[0].id).toBe("r1");
  });

  it("returns 409 ambiguous rather than guessing between projects", async () => {
    // The whole point of the branch: two projects ship a skill with this bare name.
    mocks.catalogSkillsDetailed.mockResolvedValue({ skills: [{ id: "x" }, { id: "y" }] });
    mocks.resolveSkill.mockReturnValue({ skill: null, ambiguous: ["proj-a/lint", "proj-b/lint"] });
    const res = await get("?name=lint");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("ambiguous");
    expect(body.candidates).toEqual(["proj-a/lint", "proj-b/lint"]);
    // A 409 must not carry content — that would be the guess this branch forbids.
    expect(body.content).toBeUndefined();
  });

  it("returns 404 when the name resolves to nothing", async () => {
    mocks.resolveSkill.mockReturnValue({ skill: null, ambiguous: null });
    const res = await get("?name=missing");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 404 when the file behind a known skill is gone", async () => {
    mocks.resolveSkill.mockReturnValue({ skill: { id: "a", name: "a", path: "/gone" }, ambiguous: null });
    mocks.readSkillFile.mockResolvedValue(null);
    const res = await get("?name=a");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("truncates skill content at 24k and says so", async () => {
    mocks.resolveSkill.mockReturnValue({ skill: { id: "a", name: "a", path: "/f" }, ambiguous: null });
    mocks.readSkillFile.mockResolvedValue("x".repeat(30_000));
    const res = await get("?name=a");
    const body = await res.json();
    expect(body.content).toHaveLength(24_000);
    expect(body.truncated).toBe(true);
  });

  it("routes a query to memory search with the owner view forced on", async () => {
    const res = await get("?q=deploy");
    expect(res.status).toBe(200);
    expect(mocks.searchSkillMemory).toHaveBeenCalledWith(
      "deploy",
      expect.objectContaining({ recipeAccess: { ownerView: true } }),
    );
  });

  it("passes refresh through to the TTL cache", async () => {
    await get("?refresh=1");
    expect(mocks.catalogGet).toHaveBeenCalledWith({ refresh: true });
  });
});
