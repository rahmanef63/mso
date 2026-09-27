import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), save: vi.fn(), audit: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: mocks.session }));
vi.mock("@/lib/host/shell-apps-api", () => ({ shellAppSettings: mocks.list, manageShellApp: mocks.save, SurfaceConfigError: class extends Error { status = 409; } }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rate }));
vi.mock("@/lib/demo", () => ({ IS_DEMO: false }));
import { GET, POST } from "./route";
const request = (body?: unknown) => new NextRequest("https://cockpit.example.test/api/v1/shell-apps", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
beforeEach(() => { vi.clearAllMocks(); mocks.rate.mockReturnValue(false); mocks.list.mockResolvedValue({ schemaVersion: 1, apps: [] }); });
describe("shell application authority", () => {
  it.each([null, "viewer", "operator"])("denies read/write for %s", async role => {
    mocks.session.mockResolvedValue(role ? { session: { device_id: "fixture" }, role } : null);
    expect((await GET(request())).status).toBe(role ? 403 : 401);
    expect((await POST(request({}))).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("lists only through the bounded host API without caching", async () => {
    mocks.session.mockResolvedValue({ session: { device_id: "fixture" }, role: "owner" });
    const response = await GET(request());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.list).toHaveBeenCalledWith("https://cockpit.example.test");
  });
  it("passes a mutation to the host and audits only identity/action metadata", async () => {
    mocks.session.mockResolvedValue({ session: { device_id: "fixture" }, role: "owner" });
    mocks.save.mockResolvedValue({ id: "tool", revision: "new" });
    const body = { schemaVersion: 1, action: "remove", id: "tool", expectedRevision: "old", confirm: true };
    expect((await POST(request(body))).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(body, "https://cockpit.example.test");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ target: "tool", detail: "shell-app.remove" }));
  });
  it("rate limits before applying a write", async () => {
    mocks.session.mockResolvedValue({ session: { device_id: "fixture" }, role: "owner" }); mocks.rate.mockReturnValue(true);
    expect((await POST(request({}))).status).toBe(429); expect(mocks.save).not.toHaveBeenCalled();
  });
});
