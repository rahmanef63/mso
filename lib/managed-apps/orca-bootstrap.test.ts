import { beforeEach, describe, expect, it, vi } from "vitest";
import vm from "node:vm";
import { NextRequest } from "next/server";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE = "{id}.mso.example.com";
  process.env.OS_PUBLIC_ORIGIN = "https://mso.example.com";
});

import { gateManagedApp } from "./session";
import { MANAGED_APP_HOST_HEADER } from "./origin";

const sessionMock = vi.fn();
vi.mock("@/lib/managed-apps/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/managed-apps/session")>();
  return {
    ...actual,
    managedAppSession: (req: Request, id: string) => sessionMock(req, id),
  };
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const TEMPLATE = "{id}.mso.example.com";
const APP_HOST = "orca.mso.example.com";
const PREFIX = "/api/v1/managed-apps/orca/proxy";

async function getProxyRoute() {
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", TEMPLATE);
  vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.com");
  return import("@/app/api/v1/managed-apps/[id]/proxy/[[...path]]/route");
}

function proxyReq(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("host", APP_HOST);
  headers.set("x-forwarded-proto", "https");
  headers.set(MANAGED_APP_HOST_HEADER, "orca");
  return new Request(`https://${APP_HOST}${PREFIX}/${path}`, { ...init, headers });
}

const proxyCtx = (path: string[]) => ({ params: Promise.resolve({ id: "orca", path }) });

describe("gateManagedApp actual bootstrap JS execution in isolated VM", () => {
  it("executes the actual gate script: validates fetch, strips ticket, preserves pairing, and reloads", async () => {
    vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", TEMPLATE);
    const req = new NextRequest("https://orca.mso.example.com/__mso_app_bootstrap.js");
    const res = await gateManagedApp(req, "orca");
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toContain("application/javascript");

    const scriptSource = await res!.text();
    expect(scriptSource).toContain("app_ticket");

    const reloadMock = vi.fn();
    const fetchApiMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 204,
    }));

    const sandbox = {
      location: {
        pathname: "/editor",
        search: "",
        hash: "#pairing=enc_v1_secret_code_xyz&app_ticket=bearer_ticket_token_123",
        reload: reloadMock,
      },
      history: {
        replaceState: vi.fn((_state: unknown, _title: string, url: string) => {
          const u = new URL(url, "https://orca.mso.example.com");
          sandbox.location.pathname = u.pathname;
          sandbox.location.search = u.search;
          sandbox.location.hash = u.hash;
        }),
      },
      document: {
        body: { textContent: "" },
      },
      fetch: fetchApiMock,
      URL,
      URLSearchParams,
    };

    const context = vm.createContext(sandbox);
    vm.runInContext(scriptSource, context);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchApiMock).toHaveBeenCalledTimes(1);
    const [authUrl, authInit] = fetchApiMock.mock.calls[0] as [string, RequestInit];
    expect(authUrl).toBe("/__mso_app_auth");
    expect(authInit.method).toBe("POST");
    expect((authInit.headers as Record<string, string>)?.authorization).toBe("Bearer bearer_ticket_token_123");
    expect(authInit.credentials).toBe("include");
    expect(authInit.cache).toBe("no-store");

    expect(sandbox.location.hash).toBe("#pairing=enc_v1_secret_code_xyz");
    expect(sandbox.location.hash).not.toContain("app_ticket");
    expect(sandbox.location.search).toBe("");
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed on auth failure: shows error message and does not reload", async () => {
    vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", TEMPLATE);
    const req = new NextRequest("https://orca.mso.example.com/__mso_app_bootstrap.js");
    const res = await gateManagedApp(req, "orca");
    const scriptSource = await res!.text();

    const reloadMock = vi.fn();
    const sandbox = {
      location: {
        pathname: "/",
        search: "",
        hash: "#pairing=key&app_ticket=bad_ticket",
        reload: reloadMock,
      },
      history: { replaceState: vi.fn() },
      document: { body: { textContent: "" } },
      fetch: vi.fn(async () => ({ ok: false, status: 401 })),
      URL,
      URLSearchParams,
    };

    const context = vm.createContext(sandbox);
    vm.runInContext(scriptSource, context);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(reloadMock).not.toHaveBeenCalled();
    expect(sandbox.document.body.textContent).toContain("Application authorization failed");
  });
});

describe("Actual proxy route worker and service worker enforcement", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    sessionMock.mockReset();
  });

  it("denies Sec-Fetch-Dest serviceworker on arbitrary path without calling upstream fetch", async () => {
    sessionMock.mockResolvedValueOnce({ device_id: "test" });
    const { GET } = await getProxyRoute();
    const request = proxyReq("assets/foo.js", {
      headers: {
        "sec-fetch-dest": "serviceworker",
        cookie: "__Host-mapp_orca_session=valid",
      },
    });

    const res = await GET(request, proxyCtx(["assets", "foo.js"]));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("denies dedicated worker if unauthenticated, and forwards to upstream when authenticated", async () => {
    sessionMock.mockResolvedValueOnce(null);
    const { GET } = await getProxyRoute();
    const unauthReq = proxyReq("assets/editor.worker.js", {
      headers: { "sec-fetch-dest": "worker" },
    });
    const unauthRes = await GET(unauthReq, proxyCtx(["assets", "editor.worker.js"]));
    expect(unauthRes.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();

    sessionMock.mockResolvedValueOnce({ device_id: "test" });
    fetchMock.mockResolvedValueOnce(
      new Response("/* worker code */", {
        status: 200,
        headers: { "content-type": "application/javascript" },
      }),
    );
    const authReq = proxyReq("assets/editor.worker.js", {
      headers: {
        "sec-fetch-dest": "worker",
        cookie: "__Host-mapp_orca_session=valid_cookie",
      },
    });
    const authRes = await GET(authReq, proxyCtx(["assets", "editor.worker.js"]));
    expect(authRes.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await authRes.text()).toBe("/* worker code */");
  });
});
