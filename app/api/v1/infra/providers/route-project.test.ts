import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ view: vi.fn(), limited: vi.fn(), legacy: vi.fn() }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: vi.fn(async () => ({ role: "owner", session: { device_id: "dev-owner" } })) }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.limited }));
vi.mock("@/lib/infra/connection-service", () => ({
  withIntegrationSelection: (_selector: unknown, fn: () => unknown) => fn(),
  projectProviderQuery: mocks.view,
}));
vi.mock("@/lib/infra", () => ({
  INFRA_PROVIDER_IDS: ["dokploy"],
  isInfraProviderId: (id: string) => id === "dokploy",
  readInfraProvider: async () => ({}),
  removeInfraProvider: async () => undefined,
  setInfraProvider: async () => ({}),
  summarizeInfraProvider: (id: string) => ({ id }),
}));
import { GET } from "./route";

const SECRET = "synthetic_secret_deploy_key_do_not_leak";
const request = (query = "") => new NextRequest("http://localhost/api/v1/infra/providers" + query, { headers: { host: "localhost" } });

describe("/api/v1/infra/providers project view", () => {
  it("returns cloud and self-hosted rows together for one project, without duplication", async () => {
    mocks.limited.mockReturnValue(false);
    mocks.view.mockResolvedValue({
      project: "containerabc/baton",
      providers: [
        { user: "owner", provider: "convex", connection: "baton", label: "Baton", kind: "cloud", scope: "deployment", state: "linked-healthy", projects: ["containerabc/baton", "containerabc/mimin"], projectCount: 2, verifiedAt: 1 },
        { user: "owner", provider: "convex", connection: "zianinn", label: "Zianinn", kind: "self-hosted", scope: "server", state: "deployment-unreachable", projects: ["containerabc/baton"], projectCount: 1, verifiedAt: null },
      ],
    });
    const res = await GET(request("?project=containerabc%2Fbaton"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    const body = await res.json();
    expect(body.providers.map((row: { kind: string }) => row.kind)).toEqual(["cloud", "self-hosted"]);
    expect(body.providers.filter((row: { connection: string }) => row.connection === "baton")).toHaveLength(1);
    expect(body.providers[0].projectCount).toBe(2);
    expect(new Set(body.providers.flatMap((row: { projects: string[] }) => row.projects)).size).toBe(2);
    expect(mocks.view).toHaveBeenCalledWith({ project: "containerabc/baton", selector: { user: undefined, connection: undefined, cwd: undefined } });
  });

  it("keeps the three states distinct instead of collapsing down into invalid", async () => {
    mocks.limited.mockReturnValue(false);
    mocks.view.mockResolvedValue({
      project: "c/p",
      providers: ["linked-healthy", "deployment-unreachable", "credential-rejected"].map((state, index) => ({
        user: "owner", provider: "convex", connection: `c${index}`, label: `c${index}`, kind: "cloud", scope: "deployment", state, projects: ["c/p"], projectCount: 1, verifiedAt: null,
      })),
    });
    const body = await (await GET(request("?project=c%2Fp"))).json();
    expect(new Set(body.providers.map((row: { state: string }) => row.state))).toEqual(new Set(["linked-healthy", "deployment-unreachable", "credential-rejected"]));
  });

  it("never serializes a credential in a filtered response", async () => {
    mocks.limited.mockReturnValue(false);
    mocks.view.mockResolvedValue({ project: "c/p", providers: [{ user: "owner", provider: "convex", connection: "baton", label: "Baton", kind: "cloud", scope: "deployment", state: "linked-healthy", projects: ["c/p"], projectCount: 1, verifiedAt: null }] });
    const text = await (await GET(request("?project=c%2Fp"))).text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("deployKey");
    expect(text).not.toContain("values");
  });

  it("rejects a non-owner before any lookup", async () => {
    mocks.limited.mockReturnValue(false);
    mocks.view.mockReset();
    const { getSessionContext } = await import("@/lib/auth/require-session");
    vi.mocked(getSessionContext).mockResolvedValueOnce({ role: "operator", session: { device_id: "dev-op" } } as never);
    expect((await GET(request("?project=c%2Fp"))).status).toBe(401);
    expect(mocks.view).not.toHaveBeenCalled();
  });

  it("rate-limits and rejects a malformed project id before any lookup", async () => {
    mocks.view.mockReset();
    mocks.limited.mockReturnValueOnce(true);
    expect((await GET(request("?project=c%2Fp"))).status).toBe(429);
    mocks.limited.mockReturnValueOnce(false);
    const bad = await GET(request("?project=../../etc%2Fpasswd"));
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain("passwd");
    expect(mocks.view).not.toHaveBeenCalled();
  });
});
