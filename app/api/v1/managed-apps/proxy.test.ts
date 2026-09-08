// Integration tests for /api/v1/managed-apps/[id]/proxy/[[...path]] — the
// reverse proxy in front of the loopback-only Hermes/OpenClaw dashboards.
// Auth and the catalog are mocked, fetch is stubbed: we exercise ONLY the
// route's header plumbing (cookie isolation, Set-Cookie rewriting) and its entry
// guards. Redirect refusal, body rewriting and the policy header are covered in
// proxy-containment.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/server", () => ({ verifyAuth: vi.fn(async () => true) }));

const dashboardUrl = { current: "http://127.0.0.1:9119" };
vi.mock("@/lib/managed-apps/catalog", async () => {
  const real = await vi.importActual<typeof import("@/lib/managed-apps/catalog")>(
    "@/lib/managed-apps/catalog",
  );
  return {
    ...real,
    getManagedAppDefinition: (id: "hermes" | "openclaw") => ({
      ...real.getManagedAppDefinition(id),
      dashboardUrl: dashboardUrl.current,
    }),
  };
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const PREFIX = "/api/v1/managed-apps/hermes/proxy";
const HOST_HEADER = "x-os-managed-app-host";
// Dashboards are only served from an app host, so every test runs in that shape.
const APP_HOSTS = "{id}.mso.example.com";
const ctx = (path: string[]) => ({ params: Promise.resolve({ id: "hermes", path }) });

// Middleware stamps the app host it matched; the route 404s without it, because that
// header is the only proof the request arrived on the app's own origin rather than the
// cockpit's. Tests call the route directly, so they stamp it themselves.
function req(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has(HOST_HEADER)) headers.set(HOST_HEADER, "hermes");
  return new Request(`http://localhost${PREFIX}/${path}`, { ...init, headers });
}

/** Headers of the single upstream fetch the route performed. */
function sentHeaders(): Headers {
  return fetchMock.mock.calls[0][1].headers as Headers;
}

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", APP_HOSTS);
  vi.resetModules();
  dashboardUrl.current = "http://127.0.0.1:9119";
  fetchMock.mockReset();
  const { verifyAuth } = await import("@/lib/agent/server");
  vi.mocked(verifyAuth).mockResolvedValue(true);
});

describe("managed-app proxy cookie isolation", () => {
  it("never forwards the mso session cookie, only namespaced ones", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const { GET } = await import("./[id]/proxy/[[...path]]/route");
    await GET(
      req("chat", {
        headers: {
          cookie: "session=mso-secret; mso-device=deadbeef; mapp_hermes_session=upstream-sid",
          origin: "http://localhost",
          referer: "https://hermes.mso.example.com/login?next=%2Fchat",
        },
      }),
      ctx(["chat"]),
    );
    const sent = sentHeaders();
    // De-prefixed back to the upstream's own cookie name, nothing else.
    expect(sent.get("cookie")).toBe("session=upstream-sid");
    expect(sent.get("cookie")).not.toContain("mso-secret");
    expect(sent.get("cookie")).not.toContain("deadbeef");
    // Login/CSRF checks compare these against the upstream's own origin.
    expect(sent.get("origin")).toBe("http://127.0.0.1:9119");
    expect(sent.get("referer")).toBe("http://127.0.0.1:9119/login?next=%2Fchat");
  });

  it("sends no cookie header at all when the browser holds none for the app", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const { GET } = await import("./[id]/proxy/[[...path]]/route");
    await GET(req("chat", { headers: { cookie: "session=mso-secret" } }), ctx(["chat"]));
    expect(sentHeaders().has("cookie")).toBe(false);
  });

  it("namespaces upstream set-cookie and pins it to the proxy path", async () => {
    const upstream = new Response("ok", { status: 200 });
    upstream.headers.append(
      "set-cookie",
      "session=abc123; Domain=127.0.0.1; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600",
    );
    fetchMock.mockResolvedValueOnce(upstream);
    const { GET } = await import("./[id]/proxy/[[...path]]/route");
    const res = await GET(req("chat"), ctx(["chat"]));
    const cookie = res.headers.getSetCookie()[0];
    expect(cookie).toContain("mapp_hermes_session=abc123");
    // Root-mounted on the app host: the app owns "/" there, so that is the scope.
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Max-Age=3600");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain");
    // Plain http hop: a Secure cookie would be dropped by the browser.
    expect(cookie).not.toContain("Secure");
    expect(res.headers.get("x-managed-app")).toBe("hermes");
  });

  it("marks cookies Secure when the browser hop was https", async () => {
    const upstream = new Response("ok", { status: 200 });
    upstream.headers.append("set-cookie", "session=abc123; Path=/");
    fetchMock.mockResolvedValueOnce(upstream);
    const { GET } = await import("./[id]/proxy/[[...path]]/route");
    const res = await GET(req("chat", { headers: { "x-forwarded-proto": "https" } }), ctx(["chat"]));
    expect(res.headers.getSetCookie()[0]).toContain("Secure");
  });

  it("keeps every set-cookie of a form-POST login redirect", async () => {
    const upstream = new Response(null, { status: 302, headers: { location: "/chat" } });
    upstream.headers.append("set-cookie", "session=sid1; Path=/; HttpOnly");
    upstream.headers.append("set-cookie", "csrftoken=tok2; Path=/");
    fetchMock.mockResolvedValueOnce(upstream);
    const { POST } = await import("./[id]/proxy/[[...path]]/route");
    const res = await POST(
      req("login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "username=rahman&password=hunter2",
      }),
      ctx(["login"]),
    );
    expect(res.status).toBe(302);
    // Root-relative, never absolute: an absolute value would carry whatever host
    // `req.url` was built from (the bind address under `next start --hostname 0.0.0.0`).
    // Root-mounted there is no prefix to add either — the upstream's own path IS the
    // path on the app host.
    expect(res.headers.get("location")).toBe("/chat");
    expect(res.headers.get("location")).not.toMatch(/^https?:\/\//);
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("mapp_hermes_session=sid1");
    expect(cookies[1]).toContain("mapp_hermes_csrftoken=tok2");
    expect(cookies.every((cookie) => cookie.includes("Path=/"))).toBe(true);
    // The urlencoded body reaches the upstream untouched.
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(new TextDecoder().decode(init.body)).toBe("username=rahman&password=hunter2");
    expect(sentHeaders().get("content-type")).toBe("application/x-www-form-urlencoded");
  });

  it("forwards the login response headers a browser needs, minus the auth challenge", async () => {
    const upstream = new Response("nope", {
      status: 401,
      headers: {
        "content-type": "text/plain",
        "www-authenticate": 'Basic realm="hermes"',
        vary: "Cookie",
        "content-disposition": "inline",
      },
    });
    fetchMock.mockResolvedValueOnce(upstream);
    const { GET } = await import("./[id]/proxy/[[...path]]/route");
    const res = await GET(req("chat"), ctx(["chat"]));
    expect(res.status).toBe(401);
    expect(res.headers.get("vary")).toBe("Cookie");
    expect(res.headers.get("content-disposition")).toBe("inline");
    // Relaying the challenge would make the browser prompt on the mso origin.
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("never forwards an Authorization header to the upstream", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const { GET } = await import("./[id]/proxy/[[...path]]/route");
    await GET(req("chat", { headers: { authorization: "Basic cmFobWFuOmh1bnRlcjI=" } }), ctx(["chat"]));
    expect(sentHeaders().has("authorization")).toBe(false);
  });

  it("feeds the upstream policy into ours instead of only dropping it", async () => {
    // The allowlist still refuses to echo it (frame-ancestors 'none' would un-frame
    // the app), but its hardening has to survive — see proxy-csp.test.ts.
    fetchMock.mockResolvedValueOnce(
      new Response("ok", {
        status: 200,
        headers: {
          "x-frame-options": "DENY",
          "content-security-policy":
            "default-src 'self'; frame-ancestors 'none'; script-src 'self' 'sha256-abc='; connect-src 'self' https://api.openai.com",
        },
      }),
    );
    const { GET } = await import("./[id]/proxy/[[...path]]/route");
    const res = await GET(req("chat", { headers: { host: "mso.example.com", "x-forwarded-proto": "https" } }), ctx(["chat"]));
    const csp = res.headers.get("content-security-policy")!;
    const appUrl = "https://hermes.mso.example.com/";
    expect(res.headers.get("x-frame-options")).toBeNull();
    // The upstream's hash pin survives; its frame-ancestors 'none' does not, or the
    // cockpit could not display the dashboard it is proxying.
    expect(csp).toContain(`script-src ${appUrl} 'sha256-abc='`);
    expect(csp).toContain("frame-ancestors 'self' https://mso.example.com");
    expect(csp).toContain(`connect-src ${appUrl} wss://hermes.mso.example.com/ https://api.openai.com`);
    expect(csp).not.toContain("'unsafe-inline'");
  });
});

describe("managed-app proxy guards", () => {
  it("returns 401 and never calls the upstream without a session", async () => {
    const { verifyAuth } = await import("@/lib/agent/server");
    vi.mocked(verifyAuth).mockResolvedValueOnce(false);
    const { GET } = await import("./[id]/proxy/[[...path]]/route");
    const res = await GET(req("chat", { headers: { cookie: "mapp_hermes_session=x" } }), ctx(["chat"]));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    // Without frame-ancestors, next.config's X-Frame-Options: DENY makes the browser
    // refuse to display the error and the user sees an empty window instead.
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
  });

  // Displaying the error was half the job; the frame is a surface a person reads. A
  // 401 here is most often a session issued before OS_SESSION_COOKIE_DOMAIN was set —
  // host-only, so never sent to this host — which no status code can convey.
  it("renders a failure as a page for the frame and as JSON for the upstream's fetch", async () => {
    const { verifyAuth } = await import("@/lib/agent/server");
    const { GET } = await import("./[id]/proxy/[[...path]]/route");

    vi.mocked(verifyAuth).mockResolvedValueOnce(false);
    const framed = await GET(req("chat", { headers: { "sec-fetch-dest": "iframe" } }), ctx(["chat"]));
    expect(framed.headers.get("content-type")).toContain("text/html");
    expect(await framed.text()).toContain("sign in again");

    vi.mocked(verifyAuth).mockResolvedValueOnce(false);
    const xhr = await GET(req("api/status", { headers: { "sec-fetch-dest": "empty" } }), ctx(["api", "status"]));
    expect(xhr.headers.get("content-type")).toContain("application/json");
    expect(await xhr.json()).toEqual({ error: "unauthorized" });
  });

  it("refuses a non-loopback upstream target", async () => {
    dashboardUrl.current = "http://evil.example.com";
    const { GET } = await import("./[id]/proxy/[[...path]]/route");
    const res = await GET(req("chat"), ctx(["chat"]));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/loopback/);
    expect(fetchMock).not.toHaveBeenCalled();
  });


  it("rejects traversal segments before touching the upstream", async () => {
    const { GET } = await import("./[id]/proxy/[[...path]]/route");
    const res = await GET(req("..", {}), ctx(["..", "etc"]));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
