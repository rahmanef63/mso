import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ context: vi.fn(), page: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: mocks.context }));
vi.mock("@/lib/agent/session-monitor", () => ({ ownerSessionPage: mocks.page, ownerSessionDetail: mocks.detail }));
import { GET } from "./route";
beforeEach(() => { vi.clearAllMocks(); mocks.context.mockResolvedValue({ role: "owner", session: { device_id: "owner" } }); });
describe("session monitor route", () => {
  it.each([null, { role: "viewer" }, { role: "operator" }])("denies non-owner access before reading records: %j", async context => {
    mocks.context.mockResolvedValue(context);
    const response = await GET(new NextRequest("http://localhost/api/v1/agent-sessions?view=monitor"));
    expect(response.status).toBe(403); expect(mocks.page).not.toHaveBeenCalled(); expect(mocks.detail).not.toHaveBeenCalled();
  });
  it("uses explicit monitor pagination with private no-store responses", async () => {
    mocks.page.mockResolvedValue({ sessions: [], total: 0 });
    const response = await GET(new NextRequest("http://localhost/api/v1/agent-sessions?view=monitor&page=2&includeOffline=1"));
    expect(mocks.page).toHaveBeenCalledWith(2, true);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("returns 404 for a missing exact session and does not expose store error details", async () => {
    mocks.detail.mockResolvedValue(null);
    expect((await GET(new NextRequest("http://localhost/api/v1/agent-sessions?view=monitor&id=missing"))).status).toBe(404);
    mocks.detail.mockRejectedValue(new Error("private/path/token=hidden"));
    const response = await GET(new NextRequest("http://localhost/api/v1/agent-sessions?view=monitor&id=bad"));
    expect(JSON.stringify(await response.json())).not.toContain("hidden");
  });
});
