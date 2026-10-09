import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { runInNewContext } from "node:vm";
import { createShellAppCredential, verifyShellAppCredential, sessionApps, shellAppSession, SHELL_APP_COOKIE, shellAppUpstreamHeaders } from "./session";
import { gateShellApp } from "./session-gate";
import { shellAppSocketPolicy } from "./socket-policy";
import { verifySession } from "@/lib/auth/session";
import type { SurfaceApp } from "@/lib/contracts/surface-app";

const authority = vi.hoisted(() => ({ role: "owner", revoked: false, epoch: "epoch-0000000000000000" }));
vi.mock("@/lib/auth/device-store", () => ({
  currentSessionPolicy: async () => ({ scope: "host", epoch: authority.epoch }),
  getApprovedDevice: async () => ({ approvedAt: 1, role: authority.role, ...(authority.revoked ? { sessionsRevokedAt: Date.now() } : {}) }),
}));
const secret = "test-signing-key".repeat(4), now = 1_800_000_000_000;
const app: SurfaceApp = { id: "private-vault", title: "Vault", description: "", origin: "https://vault.cockpit.example.test", startPath: "/",
  renderer: "iframe", presentation: "inline", environment: "production", placements: ["shell"], sessionUpstream: "http://127.0.0.1:9131" };
const parent = () => ({ issued_at: now - 1000, expires_at: now + 86_400_000, device_id: "owner-device", cookie_scope: "host", cookie_epoch: "epoch-0000000000000000" });
const token = (kind: "ticket" | "cookie" = "cookie") => createShellAppCredential(app, parent(), secret, kind);
const request = (path = "/", cookie = token(), extra: Record<string, string> = {}, method = "GET") => new NextRequest(app.origin + path, {
  method, headers: { host: new URL(app.origin).host, cookie: `${SHELL_APP_COOKIE}=${cookie}`, ...extra },
});
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); authority.role = "owner"; authority.revoked = false; authority.epoch = parent().cookie_epoch;
  vi.stubEnv("OS_SESSION_SECRET", secret); vi.stubEnv("OS_PUBLIC_ORIGIN", "https://cockpit.example.test");
  vi.stubEnv("OS_SESSION_COOKIE_DOMAIN", ""); vi.stubEnv("PORT", "4005"); vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([app]));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("isolated connected-app sessions", () => {
  it("binds credentials to purpose, exact app identity and origin, never cockpit authority", () => {
    const ticket = token("ticket"), cookie = token();
    expect(verifyShellAppCredential(app, ticket, secret, "ticket")).not.toBeNull();
    expect(verifyShellAppCredential(app, ticket, secret, "cookie")).toBeNull();
    expect(verifyShellAppCredential({ ...app, origin: "https://other.example.test" }, cookie, secret, "cookie")).toBeNull();
    expect(verifyShellAppCredential({ ...app, id: "other" }, cookie, secret, "cookie")).toBeNull();
    expect(verifySession(cookie, secret)).toBeNull();
  });
  it("expires tickets after one minute without shortening the derived session to ticket lifetime", () => {
    const ticket = token("ticket"), session = verifyShellAppCredential(app, ticket, secret, "ticket")!;
    const cookie = createShellAppCredential(app, session, secret, "cookie");
    vi.setSystemTime(now + 61_000);
    expect(verifyShellAppCredential(app, ticket, secret, "ticket")).toBeNull();
    expect(verifyShellAppCredential(app, cookie, secret, "cookie")?.expires_at).toBe(now + 7_200_000);
    const short = createShellAppCredential(app, { ...parent(), expires_at: now + 120_000 }, secret, "cookie");
    expect(verifyShellAppCredential(app, short, secret, "cookie")?.expires_at).toBe(now + 120_000);
  });
  it("requires the current owner role and durable session generation on every request", async () => {
    const req = request(); expect(await shellAppSession(req, app)).not.toBeNull();
    authority.role = "operator"; expect(await shellAppSession(req, app)).toBeNull();
    authority.role = "viewer"; expect(await shellAppSession(req, app)).toBeNull();
    authority.role = "owner"; authority.revoked = true; expect(await shellAppSession(req, app)).toBeNull();
    authority.revoked = false; authority.epoch = "epoch-replaced0000000000"; expect(await shellAppSession(req, app)).toBeNull();
  });
  it("admits only unambiguous reviewed HTTPS hosts and bounded loopback targets", async () => {
    expect(await sessionApps()).toHaveLength(1);
    for (const sessionUpstream of ["https://127.0.0.1:9131", "http://10.0.0.1:9131", "http://user:password@127.0.0.1:9131", "http://127.0.0.1:4005", "http://127.0.0.1:9131/?token=x"]) {
      vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([{ ...app, sessionUpstream }])); expect(await sessionApps()).toEqual([]);
    }
    vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([app, { ...app, id: "second" }])); expect(await sessionApps()).toEqual([]);
    vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([{ ...app, origin: "https://cockpit.example.test:9443" }])); expect(await sessionApps()).toEqual([]);
  });
  it("exchanges an origin-bound ticket for a Secure host-only cookie and strips it upstream", async () => {
    const result = await gateShellApp(request("/__mso_app_auth", "", { origin: app.origin, authorization: `Bearer ${token("ticket")}` }, "POST"), app);
    expect(result?.status).toBe(204);
    const cookie = result!.headers.get("set-cookie")!;
    for (const value of [SHELL_APP_COOKIE, "HttpOnly", "Secure", "SameSite=strict", "Path=/", "Max-Age=7200"]) expect(cookie).toContain(value);
    expect(cookie).not.toContain("Domain=");
    const upstream = shellAppUpstreamHeaders(new Headers({ cookie, authorization: "Bearer private", referer: "https://cockpit.example.test/" }), app);
    for (const name of ["cookie", "authorization", "referer"]) expect(upstream.has(name)).toBe(false);
  });
  it("refuses forged, wrong-origin, demoted and expired ticket exchanges", async () => {
    const ticket = token("ticket");
    expect((await gateShellApp(request("/__mso_app_auth", "", { origin: "https://other.example.test", authorization: `Bearer ${ticket}` }, "POST"), app))?.status).toBe(403);
    expect((await gateShellApp(request("/__mso_app_auth", "", { origin: app.origin, authorization: "Bearer forged-token00000000000" }, "POST"), app))?.status).toBe(401);
    authority.role = "operator";
    expect((await gateShellApp(request("/__mso_app_auth", "", { origin: app.origin, authorization: `Bearer ${ticket}` }, "POST"), app))?.status).toBe(401);
    authority.role = "owner"; vi.setSystemTime(now + 61_000);
    expect((await gateShellApp(request("/__mso_app_auth", "", { origin: app.origin, authorization: `Bearer ${ticket}` }, "POST"), app))?.status).toBe(401);
  });
  it("bootstraps documents through MSO and refuses unauthenticated API/data reads", async () => {
    expect((await gateShellApp(request("/", "", { "sec-fetch-dest": "iframe" }), app))?.status).toBe(200);
    expect((await gateShellApp(request("/api/websockets", ""), app))?.status).toBe(401);
    const script = await gateShellApp(request("/__mso_app_bootstrap.js", ""), app);
    expect(await script!.text()).toContain("document.body.dataset.msoLogin");
  });
  it("keeps app identifiers in encoded HTML data rather than generated JavaScript", async () => {
    const hostile = { ...app, id: 'x"><script>globalThis.injected=true</script>' };
    const html = await (await gateShellApp(request("/", "", { "sec-fetch-dest": "iframe" }), hostile))!.text();
    const value = /data-mso-login="([^"]+)"/.exec(html)![1];
    expect(html).not.toContain(hostile.id);
    const javascript = await (await gateShellApp(request("/__mso_app_bootstrap.js", ""), hostile))!.text();
    expect(javascript).toBe(await (await gateShellApp(request("/__mso_app_bootstrap.js", ""), app))!.text());
    const replace = vi.fn(), context = { URLSearchParams, decodeURIComponent, history: { replaceState: vi.fn() }, location: { hash: "", pathname: "/", search: "", replace }, document: { body: { dataset: { msoLogin: value }, textContent: "" } }, injected: false };
    await runInNewContext(javascript, context);
    expect(context.injected).toBe(false);
    const target = new URL(replace.mock.calls[0][0]);
    expect(target.origin).toBe("https://cockpit.example.test");
    expect(target.searchParams.get("returnTo")).toBe(`/api/v1/shell-apps/${encodeURIComponent(hostile.id)}/session?redirect=1`);
  });
  it("authorizes sockets with app credentials and stops authorizing after revocation or demotion", async () => {
    const req = request("/api/websockets", token(), { origin: app.origin, upgrade: "websocket" });
    const decision = await shellAppSocketPolicy(req);
    expect(decision?.target).toBe("http://127.0.0.1:9131/api/websockets");
    expect(decision?.headers.cookie).toBeUndefined(); expect(decision?.headers.authorization).toBeUndefined();
    authority.revoked = true; expect(await shellAppSocketPolicy(req)).toBeNull();
    authority.revoked = false; authority.role = "operator"; expect(await shellAppSocketPolicy(req)).toBeNull();
    authority.role = "owner"; expect(await shellAppSocketPolicy(request("/api/websockets", token(), { origin: "https://other.example.test" }))).toBeNull();
  });
});
