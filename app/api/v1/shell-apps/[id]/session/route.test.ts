import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { verifyShellAppCredential } from "@/lib/surfaces/session";
const mocks = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: mocks.context }));
vi.mock("@/lib/demo", () => ({ IS_DEMO: false }));
const app = { id: "private-editor", origin: "https://editor.cockpit.example.test", title: "Editor", description: "", startPath: "/",
  renderer: "iframe", presentation: "inline", environment: "production", placements: ["shell"], sessionUpstream: "http://127.0.0.1:9131" };
const secret = "test-secret".repeat(4);
const context = { params: Promise.resolve({ id: app.id }) };
const request = (query = "") => new Request(`https://cockpit.example.test/api/v1/shell-apps/${app.id}/session${query}`);
beforeEach(() => {
  vi.stubEnv("OS_PUBLIC_ORIGIN", "https://cockpit.example.test"); vi.stubEnv("OS_SESSION_SECRET", secret);
  vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([app])); vi.stubEnv("PORT", "4005");
  mocks.context.mockResolvedValue({ role: "owner", session: { issued_at: Date.now(), expires_at: Date.now() + 3600_000,
    device_id: "owner-device", cookie_scope: "host", cookie_epoch: "test-cookie-epoch00000000" } });
});
afterEach(() => vi.unstubAllEnvs());
describe("connected-app browser handoff", () => {
  it.each([null, "viewer", "operator"])("refuses a handoff for %s", async role => {
    mocks.context.mockResolvedValue(role ? { role } : null);
    const result = await GET(request("?redirect=1"), context);
    expect(result.status).toBe(401); expect(result.headers.get("location")).toBeNull();
  });
  it("issues a minute-long app-bound ticket with no cached credential", async () => {
    const response = await GET(request(), context), body = await response.json();
    expect(body.origin).toBe(app.origin); expect(response.headers.get("cache-control")).toContain("no-store");
    const payload = verifyShellAppCredential(app, body.ticket, secret, "ticket")!;
    expect(payload.device_id).toBe("owner-device"); expect(payload.expires_at - Date.now()).toBeLessThanOrEqual(60_000);
  });
  it("redirects only into the reviewed origin with the ticket in a URL fragment", async () => {
    const response = await GET(request("?redirect=1&url=https://attacker.example.test"), context);
    const target = new URL(response.headers.get("location")!);
    expect(response.status).toBe(302); expect(target.origin).toBe(app.origin); expect(target.search).toBe("");
    expect(target.hash).toMatch(/^#app_ticket=/); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("does not enable login delegation for arbitrary external apps", async () => {
    vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([{ ...app, sessionUpstream: undefined }]));
    expect((await GET(request(), context)).status).toBe(404);
  });
});
