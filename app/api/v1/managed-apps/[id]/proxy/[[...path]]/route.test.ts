import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(async (): Promise<{ device_id: string } | null> => ({ device_id: "test" })),
  gateManagedApp: vi.fn(async () => null),
  fetch: vi.fn(async () => new Response("upstream-ok", { status: 200 })),
}));

vi.mock("server-only", () => ({}));
vi.stubGlobal("fetch", mocks.fetch);

vi.mock("@/lib/managed-apps/origin", () => ({
  MANAGED_APP_HOST_HEADER: "x-os-managed-app-host",
  splitOriginEnabled: () => true,
  managedAppOrigin: (id: string) => `https://${id}.mso.example.com`,
  cockpitOrigin: () => "https://mso.example.com",
  managedAppHost: (id: string) => `${id}.mso.example.com`,
}));

vi.mock("@/lib/managed-apps/session", () => ({
  managedAppSession: mocks.session,
  gateManagedApp: mocks.gateManagedApp,
}));

vi.mock("@/lib/managed-apps/catalog", () => ({
  isManagedAppId: (id: string) => id === "hermes" || id === "openclaw",
  getManagedAppDefinition: (id: string) => ({
    id,
    name: id,
    dashboardUrl: "http://127.0.0.1:9119",
  }),
}));

import { GET } from "./route";

const APP_HOSTS = "{id}.mso.example.com";
const ctx = (id: string, path: string[] = ["test"]) => ({
  params: Promise.resolve({ id, path }),
});

function makeReq(id: string, path = "test", hostHeader: string | null = id) {
  const headers = new Headers();
  if (hostHeader) headers.set("x-os-managed-app-host", hostHeader);
  return new Request(`https://${id}.mso.example.com/api/v1/managed-apps/${id}/proxy/${path}`, {
    headers,
  });
}

describe("GET /api/v1/managed-apps/[id]/proxy/[[...path]]", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", APP_HOSTS);
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ device_id: "test" } as never);
    mocks.gateManagedApp.mockResolvedValue(null);
    mocks.fetch.mockResolvedValue(new Response("upstream-ok", { status: 200 }));
  });

  it("returns 404 for unknown managed application", async () => {
    const res = await GET(makeReq("unknown-app"), ctx("unknown-app"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown managed application" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("returns 401 when the managed app gate/session returns null", async () => {
    mocks.session.mockResolvedValueOnce(null);
    const res = await GET(makeReq("hermes"), ctx("hermes"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("proxies to upstream and returns response when gate/session succeeds", async () => {
    mocks.session.mockResolvedValueOnce({ device_id: "valid-session" } as never);
    const res = await GET(makeReq("hermes", "chat"), ctx("hermes", ["chat"]));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("upstream-ok");
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it("rejects path traversal segments with 400", async () => {
    const res = await GET(makeReq("hermes", ".."), ctx("hermes", [".."]));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid upstream path" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
