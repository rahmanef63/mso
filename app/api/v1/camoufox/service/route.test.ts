import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), probe: vi.fn(), status: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.auth }));
vi.mock("@/lib/camoufox/viewer-transport", () => ({ probeViewerTransport: mocks.probe }));
vi.mock("@/lib/camoufox/service", () => ({ camoufoxStatus: mocks.status, setCamoufoxEnabled: vi.fn() }));
vi.mock("@/lib/host/request-api", () => ({ apiError: vi.fn(), readJson: vi.fn() }));
vi.mock("@/lib/host/audit-api", () => ({ audit: vi.fn() }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.limit }));
import { GET } from "./route";
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue(true); mocks.limit.mockReturnValue(false); });
it("does not probe any network target before authorization", async () => {
  mocks.auth.mockResolvedValue(false);
  expect((await GET(new Request("https://mso.example.com/api/v1/camoufox/service?probe=viewer"))).status).toBe(401);
  expect(mocks.probe).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled();
});
it("returns uncached public-transport metadata only on explicit inspection", async () => {
  mocks.probe.mockResolvedValue({ reachable: false, state: "tls", message: "TLS validation failed" });
  const response = await GET(new Request("https://mso.example.com/api/v1/camoufox/service?probe=viewer"));
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ reachable: false, state: "tls" });
  expect(mocks.status).not.toHaveBeenCalled();
});
it("bounds repeated explicit probes", async () => {
  mocks.limit.mockReturnValue(true);
  expect((await GET(new Request("https://mso.example.com/api/v1/camoufox/service?probe=viewer"))).status).toBe(429);
  expect(mocks.probe).not.toHaveBeenCalled();
});
it("keeps ordinary power-status requests local", async () => {
  mocks.status.mockResolvedValue({ running: true, viewerReady: true });
  expect(await (await GET(new Request("https://mso.example.com/api/v1/camoufox/service"))).json()).toMatchObject({ running: true });
  expect(mocks.probe).not.toHaveBeenCalled();
});
