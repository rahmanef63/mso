import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { COMPOSIO_CONNECT_KEY_MESSAGE } from "./composio";

type Mod = typeof import("./composio-session");
let root = "", storeFile = "", mod: Mod;
const SESSION_ID = "trs_1a2b3c4d5e6f";
const MCP_URL = "https://backend.composio.dev/tool_router/v3/trs_1a2b3c4d5e6f/mcp";

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-composio-session-"));
  storeFile = path.join(path.dirname(path.join(root, "infra.json")), "composio-sessions.json");
  vi.stubEnv("OS_INFRA_STORE", path.join(root, "infra.json"));
  vi.resetModules();
  mod = await import("./composio-session");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await fs.rm(root, { recursive: true, force: true });
  vi.resetModules();
});

const okResponse = (overrides: Record<string, unknown> = {}, mcpExtra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({
    session_id: SESSION_ID,
    mcp: { type: "http", url: MCP_URL, ...mcpExtra },
    tool_router_tools: [],
    config: { user_id: "mso:test" },
    config_version: 1,
    ...overrides,
  }), { status: 201, headers: { "content-type": "application/json" } });

describe("composio session creation", () => {
  it("refuses a ck_ Connect key with the existing Project MCP message and makes no request", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    await expect(mod.createComposioSession({ values: { apiKey: "ck_consumer_key" }, userId: "mso:test" }))
      .rejects.toThrow(COMPOSIO_CONNECT_KEY_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("composes the project-key credential the SDK exports when upstream returns no headers", async () => {
    let captured = "";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = new Headers(init?.headers).get("x-api-key") ?? "";
      expect(JSON.parse(String(init?.body))).toEqual({ user_id: "mso:instance-1:uid-1" });
      return okResponse({}, { headers: {} });
    });
    vi.stubGlobal("fetch", fetchMock);
    const session = await mod.createComposioSession({ values: { apiKey: "ak_project_synthetic" }, userId: "mso:instance-1:uid-1" });
    expect(session).toEqual({ sessionId: SESSION_ID, mcpUrl: MCP_URL, mcpHeaders: { "x-api-key": "ak_project_synthetic" } });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://backend.composio.dev/api/v3.1/tool_router/session");
    // Same-origin proof: the stored value is the exact header that authenticated the create call.
    expect(session.mcpHeaders["x-api-key"]).toBe(captured);
    expect(captured).toBe("ak_project_synthetic");
  });

  it("composes x-user-api-key for a uak_ user key and x-org-api-key for an org key", async () => {
    let captured = new Headers();
    vi.stubGlobal("fetch", vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => { captured = new Headers(init?.headers); return okResponse(); }));
    const user = await mod.createComposioSession({ values: { apiKey: "uak_user_synthetic" }, userId: "mso:u" });
    expect(user.mcpHeaders).toEqual({ "x-user-api-key": "uak_user_synthetic" });
    expect(user.mcpHeaders["x-user-api-key"]).toBe(captured.get("x-user-api-key"));
    expect(captured.get("x-api-key")).toBeNull();

    const org = await mod.createComposioSession({ values: { apiKey: "ak_project_synthetic", orgApiKey: "ak_org_synthetic" }, userId: "mso:u" });
    expect(org.mcpHeaders).toEqual({ "x-org-api-key": "ak_org_synthetic" });
    expect(org.mcpHeaders["x-org-api-key"]).toBe(captured.get("x-org-api-key"));
    expect(captured.get("x-api-key")).toBeNull();
  });

  it("prefers returned mcp.headers over the composed credential", async () => {
    const returned = { "x-api-key": "ak_returned_synthetic", "x-project-id": "proj_123" };
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({}, { headers: returned })));
    const session = await mod.createComposioSession({ values: { apiKey: "ak_project_synthetic" }, userId: "mso:u" });
    expect(session.mcpHeaders).toEqual(returned);
    expect(JSON.stringify(session.mcpHeaders)).not.toContain("ak_project_synthetic");
  });

  it("accepts the app.composio.dev host from the spec example and rejects any other host", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({}, { url: `https://app.composio.dev/tool_router/v3/${SESSION_ID}/mcp` })));
    const session = await mod.createComposioSession({ values: { apiKey: "ak_project_synthetic" }, userId: "mso:u" });
    expect(session.mcpUrl).toBe(`https://app.composio.dev/tool_router/v3/${SESSION_ID}/mcp`);

    vi.stubGlobal("fetch", vi.fn(async () => okResponse({}, { url: "https://evil.example.com/tool_router/v3/x/mcp" })));
    await expect(mod.createComposioSession({ values: { apiKey: "ak_project_synthetic" }, userId: "mso:u" }))
      .rejects.toThrow("invalid_composio_mcp_host");
  });

  it("redacts the credential an upstream error body echoes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: { message: "bad key ak_project_synthetic leaked", slug: "APIKey_InvalidAPIKey" } }),
      { status: 401 },
    )));
    const error = await mod.createComposioSession({ values: { apiKey: "ak_project_synthetic" }, userId: "mso:u" }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("ak_project_synthetic");
    expect((error as Error).message).toContain("APIKey_InvalidAPIKey");
  });

  it("rejects a non-HTTPS MCP URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({}, { url: "http://backend.composio.dev/tool_router/v3/x/mcp" })));
    await expect(mod.createComposioSession({ values: { apiKey: "ak_project_synthetic" }, userId: "mso:u" }))
      .rejects.toThrow("invalid_composio_mcp_endpoint");
  });

  it("rejects a session id or header set that is not what the API documents", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({ session_id: "../../etc" })));
    await expect(mod.createComposioSession({ values: { apiKey: "ak_project_synthetic" }, userId: "mso:u" }))
      .rejects.toThrow("invalid_composio_session_response");
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({}, { headers: { "x-api-key": "v", "bad header": "v" } })));
    await expect(mod.createComposioSession({ values: { apiKey: "ak_project_synthetic" }, userId: "mso:u" }))
      .rejects.toThrow("invalid_composio_session_headers");
  });
});

describe("composio session persistence", () => {
  it("writes 0600 in a 0700 directory and keeps the header value readable only by the owner", async () => {
    const state = { version: 2, instanceId: "instance-1", defaultUser: "lara", users: { lara: { id: "lara", uid: "uid-1", label: "Lara", defaults: {}, connections: {} } }, bindings: [] };
    await fs.mkdir(path.dirname(path.join(root, "infra.json")), { recursive: true });
    await fs.writeFile(path.join(root, "infra.json"), JSON.stringify(state), { mode: 0o600 });
    const fetchMock = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).user_id).toBe("mso:instance-1:uid-1");
      return okResponse({}, { headers: { "x-api-key": "ak_returned_credential_value" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await mod.composioSessionForUser({ values: { apiKey: "ak_project_synthetic" }, user: "lara" });

    const file = await fs.stat(storeFile);
    expect(file.mode & 0o777).toBe(0o600);
    const dir = await fs.stat(path.dirname(storeFile));
    expect(dir.mode & 0o777).toBe(0o700);
    expect((await fs.readFile(storeFile, "utf8"))).toContain("ak_returned_credential_value");

    // A second MSO user cannot read it: any permissive mode is refused when reading.
    await fs.chmod(storeFile, 0o644);
    await expect(mod.readComposioSessions()).rejects.toThrow("unsafe_composio_session_store");
    await fs.chmod(storeFile, 0o600);
    await expect(mod.readComposioSessions()).resolves.toMatchObject({ version: 1 });
  });

  it("reuses a stored session instead of creating a second one", async () => {
    const state = { version: 2, instanceId: "instance-1", defaultUser: "lara", users: { lara: { id: "lara", uid: "uid-1", label: "Lara", defaults: {}, connections: {} } }, bindings: [] };
    await fs.mkdir(path.dirname(path.join(root, "infra.json")), { recursive: true });
    await fs.writeFile(path.join(root, "infra.json"), JSON.stringify(state), { mode: 0o600 });
    const fetchMock = vi.fn(async () => okResponse({}, { headers: { "x-api-key": "ak_returned_credential_value" } }));
    vi.stubGlobal("fetch", fetchMock);
    const first = await mod.composioSessionForUser({ values: { apiKey: "ak_project_synthetic" }, user: "lara" });
    const second = await mod.composioSessionForUser({ values: { apiKey: "ak_project_synthetic" }, user: "lara" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.mcpHeaders).toEqual({ "x-api-key": "ak_returned_credential_value" });
  });

  it("creates a new session when the caller explicitly refreshes", async () => {
    const state = { version: 2, instanceId: "instance-1", defaultUser: "lara", users: { lara: { id: "lara", uid: "uid-1", label: "Lara", defaults: {}, connections: {} } }, bindings: [] };
    await fs.mkdir(path.dirname(path.join(root, "infra.json")), { recursive: true });
    await fs.writeFile(path.join(root, "infra.json"), JSON.stringify(state), { mode: 0o600 });
    const fetchMock = vi.fn(async () => okResponse({}, { headers: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await mod.composioSessionForUser({ values: { apiKey: "ak_project_synthetic" }, user: "lara" });
    const refreshed = await mod.composioSessionForUser({ values: { apiKey: "ak_project_synthetic" }, user: "lara", refresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshed.reused).toBe(false);
  });

  it("never returns a stored session belonging to another user", async () => {
    const state = {
      version: 2, instanceId: "instance-1", defaultUser: "lara",
      users: {
        lara: { id: "lara", uid: "uid-1", label: "Lara", defaults: {}, connections: {} },
        sams: { id: "sams", uid: "uid-2", label: "Sams", defaults: {}, connections: {} },
      },
      bindings: [],
    };
    await fs.mkdir(path.dirname(path.join(root, "infra.json")), { recursive: true });
    await fs.writeFile(path.join(root, "infra.json"), JSON.stringify(state), { mode: 0o600 });
    const fetchMock = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).user_id).toBe("mso:instance-1:uid-1");
      return okResponse({}, { headers: {} });
    });
    vi.stubGlobal("fetch", fetchMock);
    await mod.composioSessionForUser({ values: { apiKey: "ak_project_synthetic" }, user: "lara" });

    // Sams must not see Lara's row, and asking for it creates Sams' own session.
    expect(await mod.readComposioSession("instance-1", "uid-2")).toBeNull();
    const fetchSams = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).user_id).toBe("mso:instance-1:uid-2");
      return new Response(JSON.stringify({ session_id: "trs_sams_session", mcp: { type: "http", url: "https://backend.composio.dev/tool_router/v3/trs_sams_session/mcp" } }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchSams);
    const sams = await mod.composioSessionForUser({ values: { apiKey: "ak_project_synthetic" }, user: "sams" });
    expect(sams.sessionId).toBe("trs_sams_session");
    expect(sams.reused).toBe(false);
  });

  it("ignores an expired stored session", async () => {
    const key = "instance-1:uid-1";
    await fs.mkdir(path.dirname(storeFile), { recursive: true, mode: 0o700 });
    await fs.writeFile(storeFile, JSON.stringify({
      version: 1,
      sessions: {
        [key]: { sessionId: SESSION_ID, mcpUrl: MCP_URL, mcpHeaders: {}, instanceId: "instance-1", userUid: "uid-1", createdAt: 1, expiresAt: Date.now() - 1 },
      },
    }), { mode: 0o600 });
    expect(await mod.readComposioSession("instance-1", "uid-1")).toBeNull();
  });

  it("refuses to read a store that parses as an unknown format", async () => {
    await fs.mkdir(path.dirname(storeFile), { recursive: true, mode: 0o700 });
    await fs.writeFile(storeFile, JSON.stringify({ version: 9, sessions: {} }), { mode: 0o600 });
    await expect(mod.readComposioSessions()).rejects.toThrow("invalid_composio_session_store");
  });

  it("keeps the store keyed by instance and owner uid, so the same uid in another instance is separate", async () => {
    const row = { sessionId: randomUUID(), mcpUrl: MCP_URL, mcpHeaders: {}, instanceId: "instance-1", userUid: "uid-1", createdAt: Date.now() };
    await fs.mkdir(path.dirname(storeFile), { recursive: true, mode: 0o700 });
    await fs.writeFile(storeFile, JSON.stringify({ version: 1, sessions: { "instance-1:uid-1": row } }), { mode: 0o600 });
    expect((await mod.readComposioSession("instance-1", "uid-1"))?.sessionId).toBe(row.sessionId);
    expect(await mod.readComposioSession("instance-2", "uid-1")).toBeNull();
  });
});
