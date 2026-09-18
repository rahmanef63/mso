import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), apps: vi.fn(), metadata: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: mocks.session }));
vi.mock("@/lib/host/workflow-embeds-api", () => ({ workflowEmbedSettings: mocks.apps, saveWorkflowSurface: mocks.save, SurfaceConfigError: class extends Error {} }));
import { GET, POST } from "./route";
const request = () => new NextRequest("https://cockpit.example.test/api/v1/workflow-embeds");
beforeEach(() => { vi.clearAllMocks(); mocks.apps.mockResolvedValue({ apps: [], revision: "test", configurable: true }); });
describe("workflow embed metadata access", () => {
  it("requires an authenticated approved device", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(401); expect(mocks.apps).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each(["viewer", "operator"])("refuses %s access to owner reviewed endpoints", async (role) => {
    mocks.session.mockResolvedValue({ session: { device_id: "fixture" }, role });
    expect((await GET(request())).status).toBe(403); expect(mocks.apps).not.toHaveBeenCalled();
  });
  it("returns the current registry without caching for the owner", async () => {
    mocks.session.mockResolvedValue({ session: { device_id: "fixture" }, role: "owner" });
    const response = await GET(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ apps: [], revision: "test", configurable: true });
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(mocks.apps).toHaveBeenCalledWith("https://cockpit.example.test");
  });
});

it("rejects a viewer write before parsing or changing the registry", async () => {
  mocks.session.mockResolvedValue({ session: { device_id: "fixture" }, role: "viewer" });
  expect((await POST(request())).status).toBe(403); expect(mocks.save).not.toHaveBeenCalled();
});
