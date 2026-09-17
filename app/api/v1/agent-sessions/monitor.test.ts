import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ context: vi.fn(), page: vi.fn(), detail: vi.fn(), graph: vi.fn(), resolveOwner: vi.fn(), artifact: vi.fn() }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: mocks.context }));
vi.mock("@/lib/agent/session-monitor", () => ({ ownerSessionPage: mocks.page, ownerSessionDetail: mocks.detail, ownerSessionGraph: mocks.graph }));
vi.mock("@/lib/agent/session-query", () => ({ ownerSessionSummaries: vi.fn(), resolveAgentSessionOwnerRef: mocks.resolveOwner, resumeAgentSessionForOwner: vi.fn() }));
vi.mock("@/lib/agent/session-artifact-resolver", () => ({ resolveHistoricalSessionArtifactForOwner: mocks.artifact }));
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
    const response = await GET(new NextRequest("http://localhost/api/v1/agent-sessions?view=monitor&page=2&includeOffline=1&q=fixture"));
    expect(mocks.page).toHaveBeenCalledWith(2, true, "fixture");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("serves the owner-only session graph projection with private no-store caching", async () => {
    mocks.graph.mockResolvedValue({ session: { label: "fara-context" }, graph: { name: "fara-context" } });
    const response = await GET(new NextRequest("http://localhost/api/v1/agent-sessions?view=graph&id=20260901_100000_aabbccdd"));
    expect(response.status).toBe(200);
    expect(mocks.graph).toHaveBeenCalledWith("20260901_100000_aabbccdd", 120);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("serves owner-scoped artifact history without exposing resolver failures", async () => {
    mocks.resolveOwner.mockResolvedValue({ id: "internal", principalHash: "a".repeat(64) });
    mocks.artifact.mockResolvedValue({ artifact: { ref: "artifact_a", relativePath: "src/a.ts" }, history: { capture: { state: "captured", exactAtCapture: true }, historical: { available: true, exact: true }, diff: { available: true, changed: true } } });
    const response = await GET(new NextRequest("http://localhost/api/v1/agent-sessions?view=artifact&id=20260901_100000_aabbccdd&action_ref=S3.A4"));
    expect(response.status).toBe(200);
    expect(mocks.resolveOwner).toHaveBeenCalledWith("20260901_100000_aabbccdd");
    expect(mocks.artifact).toHaveBeenCalledWith(expect.objectContaining({ id: "internal" }), "S3.A4");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    mocks.artifact.mockRejectedValue(new Error("/private/path token=hidden"));
    const failed = await GET(new NextRequest("http://localhost/api/v1/agent-sessions?view=artifact&id=x&action_ref=S3.A4"));
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toMatch(/private|hidden/);
  });

  it("returns 404 for a missing exact session and does not expose store error details", async () => {
    mocks.detail.mockResolvedValue(null);
    expect((await GET(new NextRequest("http://localhost/api/v1/agent-sessions?view=monitor&id=missing"))).status).toBe(404);
    mocks.detail.mockRejectedValue(new Error("private/path/token=hidden"));
    const response = await GET(new NextRequest("http://localhost/api/v1/agent-sessions?view=monitor&id=bad"));
    expect(JSON.stringify(await response.json())).not.toContain("hidden");
  });
});
