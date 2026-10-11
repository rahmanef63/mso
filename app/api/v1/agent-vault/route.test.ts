import { gunzipSync } from "node:zlib";
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

describe("private vault response encoding", () => {
  const large = () => ({ state: { snapshots: [{ notes: Array.from({ length: 49 }, (_, i) => ({ path: `synthetic-note-${i}.md`, title: `Generated record ${i}` })) }] }, note: { content: "# Synthetic 読書\n\n" + "Generated QA text. ".repeat(100) } });
  const encodedRequest = (encoding?: string) => new NextRequest("http://localhost/api/v1/agent-vault?project=fixture&note=synthetic-note-0.md", { headers: encoding ? { "Accept-Encoding": encoding } : {} });
  it("compresses a synthetic 49-note response without changing JSON, privacy or read-only behavior", async () => {
    const value = large(); mocks.get.mockResolvedValue(value);
    const response = await GET(encodedRequest("br, GZIP, deflate"));
    expect(response.status).toBe(200); expect(response.headers.get("Content-Encoding")).toBe("gzip");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(response.headers.get("Vary")).toBe("Accept-Encoding");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.length).toBeLessThan(Buffer.byteLength(JSON.stringify(value)) / 2);
    expect(JSON.parse(gunzipSync(bytes).toString("utf8"))).toEqual(value);
    expect(mocks.get).toHaveBeenCalledWith("fixture", "synthetic-note-0.md"); expect(mocks.sync).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([undefined, "identity", "gzip;q=0", "gzip; q=1", "xgzip", "br"])("preserves the identity JSON response for %s", async encoding => {
    const value = large(); mocks.get.mockResolvedValue(value);
    const response = await GET(encodedRequest(encoding));
    expect(response.headers.get("Content-Encoding")).toBeNull(); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(value);
  });
  it("keeps metadata index responses as identity JSON even for 49 synthetic notes", async () => {
    const value = { state: large().state }; mocks.get.mockResolvedValue(value);
    const response = await GET(new NextRequest("http://localhost/api/v1/agent-vault?project=fixture", { headers: { "Accept-Encoding": "gzip" } }));
    expect(response.headers.get("Content-Encoding")).toBeNull(); expect(await response.json()).toEqual(value);
    expect(mocks.get).toHaveBeenCalledWith("fixture", undefined);
  });
  it("keeps tiny responses and unauthorized errors as identity JSON", async () => {
    mocks.get.mockResolvedValue({ state: {}, note: { content: "Generated tiny note." } });
    expect((await GET(encodedRequest("gzip"))).headers.get("Content-Encoding")).toBeNull();
    mocks.auth.mockResolvedValue(null); mocks.get.mockClear();
    const response = await GET(encodedRequest("gzip"));
    expect(response.status).toBe(401); expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(await response.json()).toEqual({ error: "unauthorized" }); expect(mocks.get).not.toHaveBeenCalled();
  });
});
