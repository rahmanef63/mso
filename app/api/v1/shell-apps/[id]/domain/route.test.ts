import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDomainRecord } from "@/lib/surfaces/app-domain-provision";

const mocks = vi.hoisted(() => ({ session: vi.fn(), ensure: vi.fn(), inspect: vi.fn(), audit: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: mocks.session }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rate }));
vi.mock("@/lib/demo", () => ({ IS_DEMO: false }));
vi.mock("@/lib/surfaces/app-domain-provision", async () => {
  const actual = await vi.importActual<typeof import("@/lib/surfaces/app-domain-provision")>("@/lib/surfaces/app-domain-provision");
  return { ...actual, ensureShellAppDomain: mocks.ensure, inspectShellAppDomain: mocks.inspect };
});
import { GET, POST } from "./route";

const owner = { session: { device_id: "dev-owner" }, role: "owner" };
const params = (id = "private-editor") => ({ params: Promise.resolve({ id }) });
const request = (body?: unknown, id = "private-editor") => new NextRequest(`https://cockpit.example.test/api/v1/shell-apps/${id}/domain`,
  body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const body = { provider: "cloudflare", hostname: "editor.example.net", target: { kind: "ipv4", value: "203.0.113.10" } };
const ready: AppDomainRecord = { appId: "private-editor", hostname: "editor.example.net", phase: "ready", provider: "cloudflare",
  dnsAction: "created", routeAction: "unchanged", localOrigin: "http://127.0.0.1:9131", verifiedAt: 1, updatedAt: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(owner);
  mocks.rate.mockReturnValue(false);
  mocks.ensure.mockResolvedValue(ready);
  mocks.inspect.mockResolvedValue(ready);
});

describe("shell-app domain authority", () => {
  it.each([null, "viewer", "operator"])("denies both verbs for %s", async role => {
    mocks.session.mockResolvedValue(role ? { session: { device_id: "fixture" }, role } : null);
    expect((await GET(request(), params())).status).toBe(role ? 403 : 401);
    expect((await POST(request(body), params())).status).toBe(role ? 403 : 401);
    expect(mocks.ensure).not.toHaveBeenCalled(); expect(mocks.inspect).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("answers 401 for a session without an approved device", async () => {
    mocks.session.mockResolvedValue({ session: {}, role: "owner" });
    expect((await POST(request(body), params())).status).toBe(401);
  });

  it("rate limits before the write and audits nothing on a refused call", async () => {
    mocks.rate.mockReturnValue(true);
    expect((await POST(request(body), params())).status).toBe(429);
    expect(mocks.rate).toHaveBeenCalledWith("shell-app-domain:dev-owner", 10, 60_000);
    expect(mocks.ensure).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("provisions through the library and audits only identity and phase metadata", async () => {
    const response = await POST(request(body), params());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.json()).toEqual(ready);
    expect(mocks.ensure).toHaveBeenCalledWith("private-editor", body);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "infra.write", actor: "dev-owner",
      target: "private-editor", ok: true, detail: "shell-app.domain.ready", meta: { hostname: "editor.example.net", provider: "cloudflare" } }));
  });

  it("returns null for an unprovisioned app without auditing a read", async () => {
    mocks.inspect.mockResolvedValue(null);
    const response = await GET(request(), params());
    expect(response.status).toBe(200); expect(await response.json()).toBeNull();
    expect(mocks.inspect).toHaveBeenCalledWith("private-editor");
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });

  it.each([
    ["invalid_hostname", 400],
    ["invalid_target", 400],
    ["unsupported_provider", 400],
    ["domain_conflict", 409],
    ["provider_unavailable", 503],
  ])("maps %s to %i and audits the failure", async (code, status) => {
    const { AppDomainError } = await vi.importActual<typeof import("@/lib/surfaces/app-domain-provision")>("@/lib/surfaces/app-domain-provision");
    mocks.ensure.mockRejectedValueOnce(new AppDomainError(code as never, status as never, "reason"));
    const response = await POST(request(body), params());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ ok: false, detail: `shell-app.domain.${code}` }));
  });

  it("fails closed on an unexpected library error without leaking its message", async () => {
    mocks.ensure.mockRejectedValueOnce(new Error("apiToken=super-secret leaked"));
    const response = await POST(request(body), params());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("super-secret");
  });

  it("rejects a non-JSON body without reaching the library", async () => {
    const response = await POST(new NextRequest("https://cockpit.example.test/api/v1/shell-apps/private-editor/domain",
      { method: "POST", body: "hostname=evil" }), params());
    expect(response.status).toBe(415);
    expect(mocks.ensure).not.toHaveBeenCalled();
  });
});
