import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const mocks = { session: vi.fn(), limited: vi.fn(() => false), audit: vi.fn() };
const SESSION_ID = "trs_route_session";
const MCP_URL = `https://backend.composio.dev/tool_router/v3/${SESSION_ID}/mcp`;
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: mocks.session }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.limited }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));

let root = "", route: typeof import("./route");
const owner = { role: "owner", session: { device_id: "device-1" } };
const request = (body?: unknown) => new NextRequest("http://localhost/api/v1/integrations/composio/session", {
  method: "POST",
  headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-composio-route-"));
  const state = {
    version: 2, instanceId: "instance-1", defaultUser: "lara",
    users: { lara: { id: "lara", uid: "uid-1", label: "Lara", defaults: { composio: "project" }, connections: { composio: { project: { id: "project", uid: "conn-1", label: "Project", provider: "composio", source: "direct", authMethod: "project", scope: "account", revision: 1, values: { apiKey: "ak_project_synthetic" }, createdAt: 0, updatedAt: 0 } } } } },
    bindings: [],
  };
  await fs.writeFile(path.join(root, "infra.json"), JSON.stringify(state), { mode: 0o600 });
  vi.stubEnv("OS_INFRA_STORE", path.join(root, "infra.json"));
  vi.resetModules();
  mocks.session.mockResolvedValue(owner);
  mocks.limited.mockReturnValue(false);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    session_id: SESSION_ID, mcp: { type: "http", url: MCP_URL, headers: { "x-api-key": "ak_returned_credential_value" } },
  }), { status: 201 })));
  route = await import("./route");
});
afterEach(async () => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); mocks.session.mockReset(); mocks.limited.mockReset(); await fs.rm(root, { recursive: true, force: true }); vi.resetModules();
});

describe("POST /api/v1/integrations/composio/session", () => {
  it("returns the MCP URL and never the session headers", async () => {
    const response = await route.POST(request({}));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ mcpUrl: MCP_URL });
    expect(JSON.stringify(body)).not.toContain("ak_returned_credential_value");
    expect(JSON.stringify(body)).not.toContain("ak_project_synthetic");
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });

  it("refuses a non-owner session", async () => {
    mocks.session.mockResolvedValue({ ...owner, role: "operator" });
    expect((await route.POST(request({}))).status).toBe(403);
    mocks.session.mockResolvedValue(null);
    expect((await route.POST(request({}))).status).toBe(403);
  });

  it("refuses to take a userId from the body", async () => {
    const response = await route.POST(request({ user: "sams" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_session_fields");
  });

  it("is rate limited", async () => {
    mocks.limited.mockReturnValue(true);
    const response = await route.POST(request({}));
    expect(response.status).toBe(429);
    expect(mocks.limited).toHaveBeenCalledWith("composio.session:device-1", 10, 60_000);
  });

  it("reuses the stored session on a second call", async () => {
    await route.POST(request({}));
    await route.POST(request({}));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("never leaks the composed credential when upstream returns no headers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ session_id: SESSION_ID, mcp: { type: "http", url: MCP_URL } }), { status: 201 })));
    const response = await route.POST(request({}));
    expect(response.status).toBe(200);
    const text = JSON.stringify(await response.json());
    expect(text).toBe(JSON.stringify({ mcpUrl: MCP_URL }));
    expect(text).not.toContain("ak_project_synthetic");
    expect(text).not.toContain("x-api-key");
  });

  it("does not expose the credential when upstream fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "key ak_project_synthetic rejected", slug: "APIKey_InvalidAPIKey" } }), { status: 401 })));
    const response = await route.POST(request({}));
    expect(response.status).toBe(401);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("ak_project_synthetic");
  });
});

describe("GET /api/v1/integrations/composio/session", () => {
  it("reports only the key kind for the form", async () => {
    const response = await route.GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ keyKind: "project" });
  });

  it("reports a Connect key as connect, so the UI offers Project MCP instead", async () => {
    await fs.writeFile(path.join(root, "infra.json"), JSON.stringify({
      version: 2, instanceId: "instance-1", defaultUser: "lara",
      users: { lara: { id: "lara", uid: "uid-1", label: "Lara", defaults: { composio: "c" }, connections: { composio: { c: { id: "c", uid: "conn-2", label: "Connect", provider: "composio", source: "direct", authMethod: "project", scope: "account", revision: 1, values: { apiKey: "ck_consumer_key" }, createdAt: 0, updatedAt: 0 } } } } },
      bindings: [],
    }), { mode: 0o600 });
    expect(await (await route.GET()).json()).toEqual({ keyKind: "connect" });
  });
});
