import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { tenantFixture } from "@/lib/tenancy/test-fixtures";

const mocks = vi.hoisted(() => ({
  validate: vi.fn(), touch: vi.fn(async () => {}), client: vi.fn(),
  originAllowed: vi.fn(() => true), resolveTenant: vi.fn(), tenantDispatch: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(async () => ({ jsonrpc: "2.0", id: 1, result: {} })),
  legacyDispatch: vi.fn(async () => ({ jsonrpc: "2.0", id: 1, result: {} })),
  session: vi.fn(async () => ({ conversationBound: false })), standby: vi.fn(async () => {}),
}));
vi.mock("@/lib/mcp/store", () => ({ validateToken: mocks.validate, touchToken: mocks.touch, getClient: mocks.client }));
vi.mock("@/lib/tenancy/runtime", () => ({ resolveMcpTenant: mocks.resolveTenant, tenantRuntimeConfigurationPresent: () => false }));
vi.mock("@/lib/mcp/tenant-dispatch", () => ({ dispatchTenantRpc: mocks.tenantDispatch }));
vi.mock("@/lib/mcp/dispatch", () => ({
  dispatch: mocks.legacyDispatch, isNotification: (body: { id?: unknown }) => body.id === undefined,
  rpcError: (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } }),
  UNAUTHORIZED: -32001, RATE_LIMITED: -32002,
}));
vi.mock("@/lib/mcp/scope", () => ({ mcpEnabled: () => true, clampScope: (scope: string) => scope }));
vi.mock("@/lib/mcp/origin", () => ({
  publicOrigin: () => "https://mso.example.test", clientIp: () => "127.0.0.1",
  mcpCorsHeaders: () => ({}), mcpRequestOriginAllowed: mocks.originAllowed,
}));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: () => false, rateLimitedUntrusted: () => false }));
vi.mock("@/lib/mcp/tools", () => ({ TOOLS: [] }));
vi.mock("@/lib/mcp/capability-runtime", () => ({ msoCapabilityRuntime: {} }));
vi.mock("@/lib/mcp/session-context", () => ({ resolveMcpSession: mocks.session, mcpSessionHeaders: () => ({}) }));
vi.mock("@/lib/agent/local-agent-standby", () => ({ ensureLocalAgentStandbyRuntime: mocks.standby }));

import { POST, GET } from "./route";
function request(args = {}, extra: Record<string, unknown> = {}) {
  return new Request("https://mso.example.test/mcp", {
    method: "POST", headers: { authorization: "Bearer synthetic", "content-type": "application/json",
      "Mcp-Session-Id": "foreign-session", "Mso-Session-Id": "foreign-session" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "agent_memory_read", arguments: args, _meta: { "mso/sessionId": "foreign-session" } }, ...extra }),
  });
}
function noOwnerState() {
  for (const spy of [mocks.touch, mocks.client, mocks.legacyDispatch, mocks.session, mocks.standby]) expect(spy).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.originAllowed.mockReturnValue(true); vi.stubEnv("OS_TENANCY_MODE", "tenant-preview");
  mocks.validate.mockResolvedValue({ hash: "a".repeat(64), scope: "read", clientId: "shared-client",
    label: "synthetic", tenantBinding: { version: 1, issuer: "mso-local", subject: "alice", tenantId: "tenant-a", principalId: "principal-a", mappingRevision: 1 }, expiresAt: 5000 });
  const f = tenantFixture();
  mocks.resolveTenant.mockImplementation(token => f.authority.authenticate(f.identity(token.tenantBinding.subject), token.tenantBinding));
});
afterEach(() => vi.unstubAllEnvs());

it("binds tenant context only after bearer validation and skips all owner state", async () => {
  const response = await POST(request({}));
  expect(response.status).toBe(200);
  expect(mocks.resolveTenant).toHaveBeenCalledWith(expect.objectContaining({ tenantBinding: expect.objectContaining({ subject: "alice", mappingRevision: 1 }), clientId: "shared-client" }));
  expect(mocks.tenantDispatch).toHaveBeenCalledWith(expect.any(Object), "read", expect.stringMatching(/^mcp:/),
    expect.objectContaining({ tenantContext: { kind: "tenant-preview" } }));
  expect(mocks.tenantDispatch.mock.calls[0][3]).not.toHaveProperty("sessionId");
  noOwnerState();
});
it("does not let body/metadata or session headers become authenticated subject", async () => {
  await POST(request({ tenantSubject: "bob", tenantId: "tenant-b", user: "bob" }));
  expect(mocks.resolveTenant.mock.calls[0][0].tenantBinding.subject).toBe("alice");
  noOwnerState();
});
it("rejects invalid bearer before resolving a tenant", async () => {
  mocks.validate.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(401);
  expect(mocks.resolveTenant).not.toHaveBeenCalled(); expect(mocks.tenantDispatch).not.toHaveBeenCalled();
  noOwnerState();
});
it("rejects wrong resource binding before tenant resolution", async () => {
  mocks.validate.mockResolvedValue({ hash: "a".repeat(64), scope: "read", resource: "https://other.example/mcp" });
  expect((await POST(request())).status).toBe(401);
  expect(mocks.resolveTenant).not.toHaveBeenCalled(); noOwnerState();
});
it("resolver failure is fail-closed and sanitized", async () => {
  mocks.resolveTenant.mockRejectedValue(new Error("private registry detail"));
  const response = await POST(request());
  expect(response.status).toBe(401);
  expect(await response.text()).not.toContain("private registry detail");
  expect(mocks.tenantDispatch).not.toHaveBeenCalled(); noOwnerState();
});
it("legacy mode keeps the existing dispatcher when no tenant identity is bound", async () => {
  vi.stubEnv("OS_TENANCY_MODE", "legacy"); mocks.resolveTenant.mockResolvedValue(undefined);
  mocks.client.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(200);
  expect(mocks.legacyDispatch).toHaveBeenCalledOnce(); expect(mocks.tenantDispatch).not.toHaveBeenCalled();
});
it("preview diagnostics do not advertise host tools as tenant-safe", async () => {
  const response = await GET(new Request("https://mso.example.test/mcp"));
  expect(await response.json()).toMatchObject({ supportedTenantTools: ["agent_memory_read", "agent_memory_search", "agent_memory_remember", "agent_memory_forget"], productionTenantIsolationReady: false });
  noOwnerState();
});

it("preview GET retains origin and streaming guards", async () => {
  mocks.originAllowed.mockReturnValue(false);
  expect((await GET(new Request("https://mso.example.test/mcp"))).status).toBe(403);
  mocks.originAllowed.mockReturnValue(true);
  for (const headers of [new Headers({ accept: "text/event-stream" }), new Headers({ "MCP-Protocol-Version": "2026-07-28" })]) {
    expect((await GET(new Request("https://mso.example.test/mcp", { headers }))).status).toBe(405);
  }
  noOwnerState();
});
it("modern tenant method-not-found keeps HTTP404 semantics", async () => {
  mocks.tenantDispatch.mockResolvedValueOnce({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "unavailable" } });
  const body = { jsonrpc: "2.0", id: 1, method: "unsupported", params: { _meta: {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {},
  } } };
  const req = new Request("https://mso.example.test/mcp", { method: "POST", headers: {
    authorization: "Bearer synthetic", "content-type": "application/json", "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": "unsupported",
  }, body: JSON.stringify(body) });
  expect((await POST(req)).status).toBe(404); noOwnerState();
});
