import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const connect = vi.hoisted(() => ({ urls: [] as string[], status: 200 }));
vi.mock("@/lib/host/ssrf", () => ({
  safeProviderFetch: vi.fn(async (url: string, init?: RequestInit) => {
    connect.urls.push(String(url));
    if (connect.status !== 200) return new Response("{}", { status: connect.status });
    const body = JSON.parse(String(init?.body)) as { id?: unknown; method: string };
    const payload = body.method === "server/discover"
      ? { result: { resultType: "complete", protocolVersion: "2026-07-28" } }
      : { result: { resultType: "complete", tools: [{ name: "COMPOSIO_SEARCH_TOOLS", description: "Search", inputSchema: { type: "object" } }] } };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, ...payload }), { status: 200, headers: { "content-type": "application/json" } });
  }),
}));
import { COMPOSIO_CONNECT_KEY_MESSAGE, composioAuthHeader, composioKeyKind, doctorComposio } from "./composio";

afterEach(() => { vi.unstubAllGlobals(); connect.urls = []; connect.status = 200; });

describe("composio Connect key validation", () => {
  it("accepts a ck_ key by proving reach at the Connect MCP endpoint", async () => {
    const detail = await doctorComposio({ apiKey: "ck_synthetic_connect_validate_key" });
    expect(detail).toContain("Connect");
    expect(detail).toContain("1 tool(s) available");
    expect(detail).not.toContain("Platform key accepted");
    for (const url of connect.urls) expect(new URL(url).hostname).toBe("connect.composio.dev");
    expect(connect.urls.length).toBeGreaterThan(0);
  });

  it("never sends a ck_ key to the Platform API", async () => {
    const platform: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => { platform.push(String(url)); return new Response("{}", { status: 200 }); }));
    await doctorComposio({ apiKey: "ck_synthetic_connect_validate_key" });
    expect(platform).toHaveLength(0);
  });

  it("reports a rejected Connect key without echoing it", async () => {
    connect.status = 401;
    const failure = await doctorComposio({ apiKey: "ck_synthetic_connect_validate_key" }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("Composio rejected this Connect key");
    expect(String(failure)).not.toContain("ck_synthetic_connect_validate_key");
  });
});

describe("composio credential routing", () => {
  it("routes each key kind to its own header", () => {
    expect(composioAuthHeader({ apiKey: "ak_project" })).toEqual({ header: { "x-api-key": "ak_project" }, kind: "project" });
    expect(composioAuthHeader({ apiKey: "uak_user" })).toEqual({ header: { "x-user-api-key": "uak_user" }, kind: "user" });
    expect(composioAuthHeader({ orgApiKey: "org_admin", apiKey: "ak_project" })).toEqual({ header: { "x-org-api-key": "org_admin" }, kind: "organization" });
    expect(composioAuthHeader({})).toBeNull();
  });

  it("validates a user key at the session endpoint, never as x-api-key", async () => {
    const mock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-user-api-key")).toBe("uak_synthetic_user_key");
      expect(headers.has("x-api-key")).toBe(false);
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", mock);
    await expect(doctorComposio({ apiKey: "uak_synthetic_user_key" })).resolves.toBe("Composio user key accepted");
    expect(String(mock.mock.calls[0]?.[0])).toBe("https://backend.composio.dev/api/v3.1/auth/session/info");
  });

  it("reports a rejected key instead of claiming success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(doctorComposio({ apiKey: "uak_synthetic_user_key" })).rejects.toThrow("Composio rejected this user key (401)");
  });

  it("keeps the ak_ project key on backend.composio.dev /tools", async () => {
    const mock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("x-api-key")).toBe("ak_synthetic_project_key");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", mock);
    await expect(doctorComposio({ apiKey: "ak_synthetic_project_key" })).resolves.toBe("Composio project key accepted");
    expect(String(mock.mock.calls[0]?.[0])).toBe("https://backend.composio.dev/api/v3.1/tools?limit=1");
  });

  it("keeps the organisation key on x-org-api-key and its project list target", async () => {
    const mock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-org-api-key")).toBe("org_synthetic_admin_key");
      expect(headers.has("x-api-key")).toBe(false);
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", mock);
    await expect(doctorComposio({ orgApiKey: "org_synthetic_admin_key", apiKey: "ak_synthetic_project_key" })).resolves.toBe("Composio organization key accepted");
    expect(String(mock.mock.calls[0]?.[0])).toBe("https://backend.composio.dev/api/v3.1/org/owner/project/list");
  });
});

describe("composio connect consumer keys", () => {
  it("refuses a ck_ Connect key instead of sending it to the Platform API", () => {
    expect(() => composioAuthHeader({ apiKey: "ck_consumer_key" })).toThrow(/Connect key works for Composio Connect tool access/);
    expect(() => composioAuthHeader({ orgApiKey: "ck_consumer_key" })).toThrow(/cannot authorize Platform connected accounts/);
    expect(() => composioAuthHeader({ apiKey: "ak_project" })).not.toThrow();
    expect(COMPOSIO_CONNECT_KEY_MESSAGE).not.toMatch(/Project MCP/);
  });

  it("reports the key kind for a form without exposing the value", () => {
    expect(composioKeyKind({ apiKey: "ak_project" })).toBe("project");
    expect(composioKeyKind({ apiKey: "uak_user" })).toBe("user");
    expect(composioKeyKind({ orgApiKey: "org_admin" })).toBe("organization");
    expect(composioKeyKind({ apiKey: "ck_consumer_key" })).toBe("connect");
    expect(composioKeyKind({})).toBeNull();
  });
});
