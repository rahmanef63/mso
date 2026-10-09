import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), get: vi.fn(), sync: vi.fn(), audit: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: mocks.auth }));
vi.mock("@/lib/host/agent-vault-api", () => ({ getAgentVault: mocks.get, syncAgentVault: mocks.sync }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rate }));
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
const request = (method: string, body?: string) => new NextRequest("http://localhost/api/v1/agent-vault?project=fixture", { method, ...(body ? { body, headers: { "content-type": "application/json" } } : {}) });
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ role: "owner", session: { device_id: "fixture-owner" } }); mocks.rate.mockReturnValue(false); mocks.get.mockResolvedValue({ state: {} }); mocks.sync.mockResolvedValue({ state: { root: "/fixture/data" } }); });
describe("agent vault owner-private route", () => {
  it.each(["viewer", "operator"])("refuses %s reads and refreshes before touching data", async role => {
    mocks.auth.mockResolvedValue({ role, session: { device_id: "fixture" } });
    expect((await GET(request("GET"))).status).toBe(403); expect((await POST(request("POST", "{}"))).status).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated reads", async () => { mocks.auth.mockResolvedValue(null); expect((await GET(request("GET"))).status).toBe(401); });
  it("reads without mutation and audits an owner refresh", async () => {
    expect((await GET(request("GET"))).headers.get("Cache-Control")).toContain("no-store"); expect(mocks.audit).not.toHaveBeenCalled();
    expect((await POST(request("POST", '{"project":"fixture"}'))).status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith("fixture"); expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actor: "fixture-owner", action: "fs.write" }));
  });
  it("rejects malformed inputs and rate-limits refreshes", async () => {
    expect((await POST(request("POST", '{"project":1}'))).status).toBe(400); expect(mocks.sync).not.toHaveBeenCalled();
    mocks.rate.mockReturnValue(true); expect((await POST(request("POST", "{}"))).status).toBe(429); expect(mocks.sync).not.toHaveBeenCalled();
  });
});
