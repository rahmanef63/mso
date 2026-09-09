type CatalogModule = typeof import("@/lib/managed-apps/catalog");
// The proxy route in SPLIT-ORIGIN mode: the dashboard is root-mounted on its own
// host (hermes.mso.example.com), which is what finally closes the window.top reach
// — the frame is cross-origin now, so `allow-same-origin` no longer grants the
// upstream a handle on the cockpit. Two claims are load-bearing here:
//   1. the OLD same-origin URL must stop answering, or the hole survives at it;
//   2. root-mounted means NOTHING is rewritten or injected, so the policy is
//      origin-scoped and there is no inline shim to pin.
// Single-origin mode is covered, unchanged, by proxy.test.ts + proxy-containment.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MANAGED_APP_HOST_HEADER } from "@/lib/managed-apps/origin";

vi.mock("@/lib/agent/server", () => ({ verifyAuth: vi.fn(async () => true) }));

const dashboardUrl = { current: "http://127.0.0.1:9119" };
vi.mock("@/lib/managed-apps/catalog", async () => {
  const real = await vi.importActual<CatalogModule>(
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

const TEMPLATE = "{id}.mso.example.com";
const APP_HOST = "hermes.mso.example.com";
const APP_ORIGIN = `https://${APP_HOST}/`;
const APP_SOCKET = APP_ORIGIN.replace("https:", "wss:");
const COCKPIT = "https://mso.example.com";
const PREFIX = "/api/v1/managed-apps/hermes/proxy";

// Verbatim head of ~/.hermes/hermes-agent/hermes_cli/web_dist/index.html.
const HERMES_INDEX = `<!doctype html>
<html lang="en"><head>
<script type="module" crossorigin src="/assets/index-CEmUNp2y.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-BbJ3HYO2.css">
</head><body><div id="root"></div></body></html>`;

/** Live `curl -D- http://127.0.0.1:18789/`, trimmed to the directives that matter. */
const OPENCLAW_CSP =
  "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; " +
  "script-src 'self' 'sha256-xlWU9W5DLkdwhgKfV5ywIgqPfePNDkqtaKOBVD1gkB4='; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://api.openai.com";

/** Env is read at module load, so each shape needs a fresh module graph. */
async function route(template = TEMPLATE, publicOrigin = COCKPIT) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", template);
  vi.stubEnv("OS_PUBLIC_ORIGIN", publicOrigin);
  return import("./[id]/proxy/[[...path]]/route");
}

/** As the route sees it after the middleware rewrite: app Host + the stamped id. */
function appReq(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("host", APP_HOST);
  headers.set("x-forwarded-proto", "https");
  headers.set(MANAGED_APP_HOST_HEADER, "hermes");
  return new Request(`https://${APP_HOST}${PREFIX}/${path}`, { ...init, headers });
}

const ctx = (path: string[]) => ({ params: Promise.resolve({ id: "hermes", path }) });
const body = (text: string, type: string) => new Response(text, { status: 200, headers: { "content-type": type } });
const directive = (csp: string, name: string) =>
  csp.split(";").map((part) => part.trim()).find((part) => part.split(" ")[0] === name)!;

beforeEach(() => {
  dashboardUrl.current = "http://127.0.0.1:9119";
  fetchMock.mockReset();
  vi.unstubAllEnvs();
});

describe("the cockpit-origin URL stops answering", () => {
  it("404s the proxy route without the middleware's app-host stamp", async () => {
    const { GET } = await route();
    // Same URL as before the split, on mso.example.com: same-origin with the
    // cockpit, allow-same-origin frame — the hole. It must not serve.
    const res = await GET(new Request(`${COCKPIT}${PREFIX}/chat`, { headers: { host: "mso.example.com" } }), ctx(["chat"]));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s a stamp that names a DIFFERENT app than the route", async () => {
    const { GET } = await route();
    const headers = new Headers({ host: APP_HOST, [MANAGED_APP_HOST_HEADER]: "openclaw" });
    const res = await GET(new Request(`https://${APP_HOST}${PREFIX}/chat`, { headers }), ctx(["chat"]));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never forwards the cockpit session cookie, even on the app host", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const { GET } = await route();
    await GET(
      appReq("chat", { headers: { cookie: "session=mso-secret; mapp_hermes_session=upstream-sid" } }),
      ctx(["chat"]),
    );
    expect((fetchMock.mock.calls[0][1].headers as Headers).get("cookie")).toBe("session=upstream-sid");
  });

  it("emits a same-origin Location unchanged and still refuses one that leaves", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/login?next=%2F" } }));
    const { GET } = await route();
    const hop = await GET(appReq(""), ctx([]));
    expect(hop.headers.get("location")).toBe("/login?next=%2F");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "//evil.example" } }));
    const off = await GET(appReq("auth/start"), ctx(["auth", "start"]));
    expect(off.status).toBe(502);
  });

  it("re-bases the referer off the app origin, with no prefix to strip", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const { GET } = await route();
    await GET(appReq("chat", { headers: { referer: `https://${APP_HOST}/login?next=%2Fchat` } }), ctx(["chat"]));
    expect((fetchMock.mock.calls[0][1].headers as Headers).get("referer")).toBe(
      "http://127.0.0.1:9119/login?next=%2Fchat",
    );
  });

  it("still refuses a service worker — it would outlive the window on this origin", async () => {
    const { GET } = await route();
    const res = await GET(appReq("sw.js"), ctx(["sw.js"]));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("root-mounted bodies are not rewritten", () => {
  it("leaves the HTML byte-identical: no <base>, no shim, no rebasing", async () => {
    fetchMock.mockResolvedValueOnce(body(HERMES_INDEX, "text/html; charset=utf-8"));
    const { GET } = await route();
    const out = await (await GET(appReq(""), ctx([]))).text();
    // `/assets/index-*.js` already resolves: the app owns this origin's root.
    expect(out).toBe(HERMES_INDEX);
    expect(out).not.toContain("<base");
    expect(out).not.toContain("window.fetch=function");
  });

  it("leaves a stylesheet's root-absolute url() alone", async () => {
    const sheet = `@font-face{src:url(/assets/Collapse-Regular-DysayoTY.woff2) format("woff2")}`;
    fetchMock.mockResolvedValueOnce(body(sheet, "text/css"));
    const { GET } = await route();
    expect(await (await GET(appReq("assets/x.css"), ctx(["assets", "x.css"]))).text()).toBe(sheet);
  });
});

describe("root-mounted policy", () => {
  it("scopes to the app ORIGIN and names the cockpit as the framer", async () => {
    fetchMock.mockResolvedValueOnce(body(HERMES_INDEX, "text/html"));
    const { GET } = await route();
    const csp = (await GET(appReq(""), ctx([]))).headers.get("content-security-policy")!;
    expect(directive(csp, "default-src")).toBe(`default-src ${APP_ORIGIN}`);
    expect(csp).not.toContain(PREFIX);
    // Cross-origin now, so without this the browser refuses to display the frame.
    expect(directive(csp, "frame-ancestors")).toBe(`frame-ancestors 'self' ${COCKPIT}`);
    // Nothing is injected, so nothing may be pinned: a hash here would make the
    // upstream's own 'unsafe-inline' inert and kill Hermes' /login script.
    expect(csp).not.toContain("sha256-");
    expect(directive(csp, "worker-src")).toBe("worker-src blob:");
    // No `https:` wildcard: the widened session cookie rides a credentialed
    // `new Image().src = "<cockpit>/api/v1/fs/raw?path=…"`, and onload/onerror is
    // then an existence oracle. font-src keeps it — font fetches are anonymous.
    expect(directive(csp, "img-src")).toBe(`img-src ${APP_ORIGIN} data: blob:`);
    expect(directive(csp, "font-src")).toContain("https:");
  });

  it("names the cockpit on the route's OWN error responses too", async () => {
    // Stop a managed app and the proxy 502s. next.config stamps X-Frame-Options:
    // DENY on every path, so unless the error's own policy names the framer the
    // browser refuses to DISPLAY it — the user gets a blank frame instead of
    // "upstream unavailable", which is the one thing this header exists to prevent.
    // 'self' alone is the APP host here; the framer is the cockpit.
    fetchMock.mockRejectedValueOnce(new Error("connection refused"));
    const { GET } = await route();
    const res = await GET(appReq("chat"), ctx(["chat"]));
    expect(res.status).toBe(502);
    expect(res.headers.get("content-security-policy")).toBe(
      `default-src 'none'; frame-ancestors 'self' ${COCKPIT}`,
    );
  });

  it("keeps the upstream intersection — OpenClaw's hash pins survive", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("ok", { status: 200, headers: { "content-security-policy": OPENCLAW_CSP } }),
    );
    const { GET } = await route();
    const csp = (await GET(appReq("chat"), ctx(["chat"]))).headers.get("content-security-policy")!;
    expect(directive(csp, "script-src")).toContain("'sha256-xlWU9W5DLkdwhgKfV5ywIgqPfePNDkqtaKOBVD1gkB4='");
    expect(directive(csp, "style-src")).toContain("https://fonts.googleapis.com");
    expect(directive(csp, "connect-src")).toContain("https://api.openai.com");
    // Injecting nothing means the upstream's own base-uri can win — tighter, and
    // the policy OpenClaw's own deployment already runs under.
    expect(directive(csp, "base-uri")).toBe("base-uri 'none'");
    // And being framed by the cockpit stays ours: 'none' would defeat the window.
    expect(directive(csp, "frame-ancestors")).toBe(`frame-ancestors 'self' ${COCKPIT}`);
  });

  // CSP matches the scheme literally, so naming only the https origin let the frame
  // call this host over HTTP but not over ws — and these dashboards ARE the socket.
  // The twin must stay exactly one origin wide: OPENCLAW_CSP declares bare `ws: wss:`
  // and a bare scheme is every host on earth, so it is never copied.
  it("authorises the app's OWN socket without inheriting the upstream's blanket wss:", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200, headers: { "content-security-policy": OPENCLAW_CSP } }));
    const { GET } = await route();
    const csp = (await GET(appReq("chat"), ctx(["chat"]))).headers.get("content-security-policy")!;
    const connect = directive(csp, "connect-src");
    expect(connect).toContain(APP_SOCKET);
    expect(connect).not.toMatch(/(?:^|\s)wss?:(?:\s|$)/);
    expect(connect).not.toContain(COCKPIT.replace("https:", "wss:"));
  });

  it("never honours the COCKPIT origin out of an upstream policy", async () => {
    // A compromised upstream granting itself the cockpit would be calling
    // /api/v1/exec from inside the frame. On an app host the cockpit is a
    // different host, so the same-host rule alone would let it through.
    fetchMock.mockResolvedValueOnce(
      new Response("ok", {
        status: 200,
        headers: { "content-security-policy": `default-src 'self'; connect-src 'self' ${COCKPIT} https://api.openai.com` },
      }),
    );
    const { GET } = await route();
    const csp = (await GET(appReq("chat"), ctx(["chat"]))).headers.get("content-security-policy")!;
    // The wss twin of the app origin rides along: CSP matches the scheme part
    // literally, so `https://host` does not authorise `wss://host`, and the socket
    // that drives these dashboards would be blocked by a policy that already allows
    // every HTTP call to the same host. It is the same origin, not a new one.
    expect(directive(csp, "connect-src")).toBe(`connect-src ${APP_ORIGIN} ${APP_SOCKET} https://api.openai.com`);
    // frame-ancestors is the ONLY directive that may name it — that one is about
    // who may frame us, not about what the frame may reach.
    for (const name of ["default-src", "connect-src", "script-src", "form-action", "frame-src"]) {
      expect(directive(csp, name)).not.toContain(COCKPIT);
    }
  });

  it.each([
    ["unset", ""],
    ["missing a scheme", "mso.example.com"],
  ])("falls back to the host template's parent when OS_PUBLIC_ORIGIN is %s", async (_label, value) => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const { GET } = await route(TEMPLATE, value);
    const csp = (await GET(appReq("chat"), ctx(["chat"]))).headers.get("content-security-policy")!;
    expect(directive(csp, "frame-ancestors")).toBe(`frame-ancestors 'self' ${COCKPIT}`);
  });

  it("fails CLOSED when no cockpit origin can be derived at all", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    // Single-label parent: not an origin anyone should be handed. A frame that
    // refuses to display is visible; a guessed framer is a silent invitation.
    const { GET } = await route("{id}.localhost", "");
    const headers = new Headers({ host: "hermes.localhost", [MANAGED_APP_HOST_HEADER]: "hermes" });
    const res = await GET(new Request(`https://hermes.localhost${PREFIX}/chat`, { headers }), ctx(["chat"]));
    expect(directive(res.headers.get("content-security-policy")!, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });
});
