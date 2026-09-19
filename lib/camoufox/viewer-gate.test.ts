import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signSession } from "@/lib/auth/session";
import {
  CAMOUFOX_VIEWER_COOKIE,
  CAMOUFOX_VIEWER_TICKET_TTL_MS,
  createCamoufoxViewerCookie,
  createCamoufoxViewerTicket,
} from "@/lib/camoufox/viewer-auth";

const approved = vi.hoisted(() => ({
  value: true,
  role: "owner" as "viewer" | "operator" | "owner",
}));
vi.mock("@/lib/auth/device-store", () => ({
  getApprovedDevice: async () => approved.value
    ? { label: "test device", approvedAt: 1, role: approved.role }
    : null,
}));

const TEMPLATE = "{id}.mso.example.com";

async function loadProxy(template: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", template);
  return (await import("../../proxy")).proxy;
}

function req(host: string, path: string, headers: Record<string, string> = {}): NextRequest {
  const h = new Headers(headers);
  h.set("host", host);
  return new NextRequest("https://" + host + path, { headers: h });
}

const rewriteOf = (res: Response) => res.headers.get("x-middleware-rewrite");

describe("the Camoufox split-origin VNC bridge", () => {
  const SECRET = "y".repeat(48);
  const NOVNC = "http://127.0.0.1:6080";
  const VIEWER_HOST = "camoufox-mso.example.com";
  const DEVICE = "dev-1234567890abcdef";

  function cockpitSession(secret = SECRET): string {
    const now = Date.now();
    return signSession({
      issued_at: now,
      expires_at: now + 3_600_000,
      device_id: DEVICE,
      cookie_scope: "host",
      cookie_epoch: "epoch-0000000000000000",
    }, secret);
  }

  function viewerCookie(): string {
    return createCamoufoxViewerCookie(DEVICE, SECRET);
  }

  function viewerTicket(now = Date.now()): string {
    return createCamoufoxViewerTicket(DEVICE, SECRET, now);
  }

  async function load(novnc = NOVNC) {
    vi.stubEnv("OS_SESSION_SECRET", SECRET);
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.com");
    vi.stubEnv("CAMOUFOX_NOVNC_URL", novnc);
    vi.stubEnv("CAMOUFOX_VIEWER_ORIGIN", "https://" + VIEWER_HOST);
    approved.value = true;
    approved.role = "owner";
    return loadProxy(TEMPLATE);
  }

  const vnc = (cookie?: string, path = "/vnc_lite.html", extra: Record<string, string> = {}) =>
    req(VIEWER_HOST, path, cookie ? { cookie: CAMOUFOX_VIEWER_COOKIE + "=" + cookie, ...extra } : extra);

  it("serves only the inert authorization bootstrap before a viewer cookie exists", async () => {
    const proxy = await load();
    const page = await proxy(vnc(undefined, "/vnc.html"));
    expect(page.status).toBe(200);
    expect(rewriteOf(page)).toBeNull();
    expect(await page.text()).toContain("/__viewer_bootstrap.js");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors https://mso.example.com");
    expect(page.headers.get("set-cookie")).toBeNull();

    const asset = await proxy(vnc(undefined, "/app/ui.js"));
    expect(asset.status).toBe(404);
  });

  it("does not accept the cockpit session cookie on the sibling viewer host", async () => {
    const proxy = await load();
    const page = await proxy(req(VIEWER_HOST, "/vnc.html", { cookie: "session=" + cockpitSession() }));
    expect(page.status).toBe(200);
    expect(rewriteOf(page)).toBeNull();
    expect(await page.text()).toContain("Authorizing secure browser viewer");
  });

  it("exchanges a fragment-carried ticket for a host-only HttpOnly cookie", async () => {
    const proxy = await load();
    const auth = new NextRequest("https://" + VIEWER_HOST + "/__viewer_auth", {
      method: "POST",
      headers: { host: VIEWER_HOST, authorization: "Bearer " + viewerTicket() },
    });
    const response = await proxy(auth);
    expect(response.status).toBe(204);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(CAMOUFOX_VIEWER_COOKIE + "=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=strict");
    expect(setCookie).toContain("Path=/");
    expect(setCookie.toLowerCase()).not.toContain("domain=");
  });

  it("rejects forged, expired, revoked, and viewer-role credentials", async () => {
    const proxy = await load();
    const forged = new NextRequest("https://" + VIEWER_HOST + "/__viewer_auth", {
      method: "POST",
      headers: { host: VIEWER_HOST, authorization: "Bearer anything.anything" },
    });
    expect((await proxy(forged)).status).toBe(404);

    const expired = new NextRequest("https://" + VIEWER_HOST + "/__viewer_auth", {
      method: "POST",
      headers: {
        host: VIEWER_HOST,
        authorization: "Bearer " + viewerTicket(Date.now() - CAMOUFOX_VIEWER_TICKET_TTL_MS - 1),
      },
    });
    expect((await proxy(expired)).status).toBe(404);

    approved.value = false;
    expect((await proxy(vnc(viewerCookie()))).status).toBe(404);
    approved.value = true;
    approved.role = "viewer";
    expect((await proxy(vnc(viewerCookie()))).status).toBe(404);
  });

  it("maps an approved sibling viewer to loopback noVNC and strips credentials upstream", async () => {
    const proxy = await load();
    const res = await proxy(vnc(viewerCookie(), "/websockify", {
      upgrade: "websocket",
      connection: "Upgrade",
      authorization: "Bearer must-not-leak",
    }));
    const target = new URL(rewriteOf(res)!);
    expect(target.origin).toBe(NOVNC);
    expect(target.pathname).toBe("/websockify");
    expect(res.headers.get("x-middleware-request-cookie")).toBeNull();
    expect(res.headers.get("x-middleware-request-authorization")).toBeNull();
  });

  it("maps root to the full noVNC UI and preserves only viewer query state", async () => {
    const proxy = await load();
    expect(new URL(rewriteOf(await proxy(vnc(viewerCookie(), "/")))!).pathname).toBe("/vnc.html");
    const res = await proxy(vnc(viewerCookie(), "/vnc.html?path=websockify&resize=remote"));
    expect(new URL(rewriteOf(res)!).search).toBe("?path=websockify&resize=remote");
  });

  it("never exposes the retired same-origin bridge", async () => {
    const proxy = await load();
    const res = await proxy(req("mso.example.com", "/camoufox-vnc/vnc.html", { cookie: "session=" + cockpitSession() }));
    expect(res.status).toBe(404);
    expect(rewriteOf(res)).toBeNull();
  });

  it("refuses non-read viewer methods and off-box noVNC destinations", async () => {
    const proxy = await load();
    const post = new NextRequest("https://" + VIEWER_HOST + "/vnc.html", {
      method: "POST",
      headers: { host: VIEWER_HOST, cookie: CAMOUFOX_VIEWER_COOKIE + "=" + viewerCookie() },
      body: "x",
    });
    expect((await proxy(post)).status).toBe(404);

    const offBox = await load("http://evil.example");
    expect((await offBox(vnc(viewerCookie()))).status).toBe(404);
  });
});
