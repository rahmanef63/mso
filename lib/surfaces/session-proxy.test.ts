import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createShellAppCredential, SHELL_APP_COOKIE } from "./session";
import { proxy } from "../../proxy";
import { socketPolicy } from "@/lib/managed-apps/socket-policy";

vi.mock("@/lib/auth/device-store", () => ({
  currentSessionPolicy: async () => ({ scope: "host", epoch: "test-cookie-epoch00000000" }),
  getApprovedDevice: async () => ({ approvedAt: 1, role: "owner" }),
}));
const app = { id: "private-editor", origin: "https://editor.cockpit.example.test", title: "Editor", description: "", startPath: "/",
  renderer: "iframe", presentation: "inline", environment: "production", placements: ["shell"], sessionUpstream: "http://127.0.0.1:9131" };
const secret = "test-secret".repeat(4);
const credential = () => createShellAppCredential(app, { issued_at: Date.now(), expires_at: Date.now() + 3600_000,
  device_id: "owner-device", cookie_scope: "host", cookie_epoch: "test-cookie-epoch00000000" }, secret, "cookie");
const request = (path = "/", method = "GET", origin = app.origin, cookie = credential()) => new NextRequest(app.origin + path, {
  method, headers: { host: new URL(app.origin).host, origin, cookie: `${SHELL_APP_COOKIE}=${cookie}; session=cockpit-cookie`, authorization: "Bearer cockpit-secret", upgrade: method === "GET" ? "h2c" : "" },
});
beforeEach(() => {
  vi.stubEnv("OS_PUBLIC_ORIGIN", "https://cockpit.example.test"); vi.stubEnv("OS_SESSION_SECRET", secret);
  vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([app])); vi.stubEnv("PORT", "4005");
});
afterEach(() => vi.unstubAllEnvs());
describe("connected-app proxy authority", () => {
  it("routes a private app to its reviewed loopback target without forwarding MSO credentials", async () => {
    const result = await proxy(request("/api/settings?view=1"));
    expect(result.headers.get("x-middleware-rewrite")).toBe("http://127.0.0.1:9131/api/settings?view=1");
    expect(result.headers.get("x-middleware-request-cookie")).toBeNull();
    expect(result.headers.get("x-middleware-request-authorization")).toBeNull();
    expect(result.headers.get("content-security-policy")).toBe("frame-ancestors https://cockpit.example.test");
  });
  it("rejects cross-origin app mutations and missing derived credentials", async () => {
    expect((await proxy(request("/api/settings", "POST", "https://other.example.test"))).status).toBe(403);
    expect((await proxy(request("/api/settings", "POST", app.origin, ""))).status).toBe(401);
  });
  it("never makes the cockpit API or framework assets available on the private app host", async () => {
    expect((await proxy(request("/api/v1/exec"))).headers.get("x-middleware-rewrite")).toBe("http://127.0.0.1:9131/api/v1/exec");
    expect((await proxy(request("/_next/static/script.js"))).status).toBe(404);
  });
  it("sends the upgrade through the existing continuously authorized relay", async () => {
    const req = request("/api/websockets"); req.headers.set("upgrade", "websocket");
    expect((await proxy(req)).status).toBe(404);
    expect((await socketPolicy(req))?.target).toBe("http://127.0.0.1:9131/api/websockets");
    req.headers.set("cookie", "session=cockpit-cookie"); expect(await socketPolicy(req)).toBeNull();
  });
});
