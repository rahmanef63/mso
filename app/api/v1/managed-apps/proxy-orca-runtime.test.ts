import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/managed-apps/session", () => ({ managedAppSession: vi.fn(async () => ({ device_id: "test" })) }));
vi.mock("@/lib/managed-apps/orca-readiness", () => ({ getOrcaReadiness: vi.fn() }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const HOST_HEADER = "x-os-managed-app-host";
const ctx = { params: Promise.resolve({ id: "orca", path: ["chat"] }) };
const READY = {
  available: true as const,
  pairingUrl: "orca://pair?code=fixture",
  webClientUrl: "https://orca.mso.example.com/web-index.html",
  runtimeId: "rt_fixture",
  serverPid: 4242,
  startTicks: "99887766",
  boundEndpoint: "ws://127.0.0.1:7777",
  advertisedEndpoint: "wss://orca.mso.example.com",
};

function req(): Request {
  return new Request("https://orca.mso.example.com/api/v1/managed-apps/orca/proxy/chat", {
    headers: { [HOST_HEADER]: "orca", "sec-fetch-dest": "empty" },
  });
}

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", "{id}.mso.example.com");
  vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.com");
  vi.resetModules();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
  const { getOrcaReadiness } = await import("@/lib/managed-apps/orca-readiness");
  vi.mocked(getOrcaReadiness).mockReset();
  vi.mocked(getOrcaReadiness).mockResolvedValue(READY);
});

describe("Orca HTTP proxy runtime revalidation", () => {
  it("re-verifies readiness on every request and proxies to the verified endpoint", async () => {
    const { GET } = await import("./[id]/proxy/[[...path]]/route");
    const { getOrcaReadiness } = await import("@/lib/managed-apps/orca-readiness");

    expect((await GET(req(), ctx)).status).toBe(200);
    expect((await GET(req(), ctx)).status).toBe(200);
    expect(vi.mocked(getOrcaReadiness)).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:7777/chat");
    expect(String(fetchMock.mock.calls[1][0])).toBe("http://127.0.0.1:7777/chat");
  });

  it("rejects a changed or port-taken-over runtime instead of reaching the upstream", async () => {
    const { GET } = await import("./[id]/proxy/[[...path]]/route");
    const { getOrcaReadiness } = await import("@/lib/managed-apps/orca-readiness");
    vi.mocked(getOrcaReadiness).mockResolvedValue({ available: false, reason: "listener_not_owned_by_process" });

    const res = await GET(req(), ctx);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "managed application runtime is unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns a readiness throw into a safe 503, never an unhandled route error", async () => {
    const { GET } = await import("./[id]/proxy/[[...path]]/route");
    const { getOrcaReadiness } = await import("@/lib/managed-apps/orca-readiness");
    vi.mocked(getOrcaReadiness).mockRejectedValueOnce(new Error("procfs exploded"));

    const res = await GET(req(), ctx);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "managed application runtime is unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when the verified success lacks a kernel start tick", async () => {
    const { GET } = await import("./[id]/proxy/[[...path]]/route");
    const { getOrcaReadiness } = await import("@/lib/managed-apps/orca-readiness");
    vi.mocked(getOrcaReadiness).mockResolvedValue({ ...READY, startTicks: undefined });

    const res = await GET(req(), ctx);
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
