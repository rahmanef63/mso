import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root = "";
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-infra-client-"));
  process.env.OS_INFRA_STORE = path.join(root, "infra.json");
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.OS_INFRA_STORE;
  await fs.rm(root, { recursive: true, force: true });
  vi.resetModules();
});

describe("infrastructure clients", () => {
  it("uses only exact per-record Cloudflare writes and defaults proxying off", async () => {
    const store = await import("./store");
    await store.setInfraProvider("cloudflare", { apiToken: "c".repeat(32) });
    const seen: Array<{ url: string; method: string; body: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); const method = init?.method ?? "GET"; seen.push({ url, method, body: String(init?.body ?? "") });
      if (url.includes("/zones?")) return response({ success: true, result: [{ id: "z1", name: "example.com" }], result_info: { total_pages: 1 } });
      if (method === "GET" && url.includes("dns_records?type=A")) return response({ success: true, result: [] });
      if (method === "GET" && url.includes("dns_records?type=CNAME")) return response({ success: true, result: [] });
      if (method === "POST") return response({ success: true, result: { id: "r1" } });
      throw new Error(`unexpected ${method} ${url}`);
    }));
    const client = await import("./clients");
    const result = await client.upsertCloudflareDns({ name: "app.example.com", type: "A", content: "203.0.113.7" });
    expect(result.action).toBe("created");
    expect(seen.some((call) => call.method === "PUT")).toBe(false);
    const write = seen.find((call) => call.method === "POST");
    expect(write?.url).toMatch(/\/zones\/z1\/dns_records$/);
    expect(JSON.parse(write?.body ?? "{}").proxied).toBe(false);
    expect(seen.some((call) => call.url.includes("name.exact=app.example.com"))).toBe(true);
  });

  it("refuses an ambiguous Cloudflare record instead of guessing which record to patch", async () => {
    const store = await import("./store");
    await store.setInfraProvider("cloudflare", { apiToken: "c".repeat(32) });
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/zones?")) return response({ success: true, result: [{ id: "z1", name: "example.com" }], result_info: { total_pages: 1 } });
      return response({ success: true, result: [
        { id: "a", name: "app.example.com", type: "A", content: "203.0.113.1" },
        { id: "b", name: "app.example.com", type: "A", content: "203.0.113.2" },
      ] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = await import("./clients");
    await expect(client.upsertCloudflareDns({ name: "app.example.com", type: "A", content: "203.0.113.7" })).rejects.toThrow("ambiguous");
    expect(fetchMock.mock.calls.every(([, init]) => !init || (init as RequestInit).method == null || (init as RequestInit).method === "GET")).toBe(true);
  });

  it("sends only the requested Hostinger RR-set so unrelated zone rows cannot be overwritten", async () => {
    const store = await import("./store");
    await store.setInfraProvider("hostinger", { apiToken: "h".repeat(32) });
    let putBody: unknown = null;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); const method = init?.method ?? "GET";
      if (url.includes("/domains/v1/portfolio")) return response([{ domain: "example.com" }]);
      if (url.includes("/dns/v1/zones/example.com") && method === "GET") return response([
        { name: "@", type: "MX", ttl: 14400, records: [{ content: "mail.example.com", is_disabled: false }] },
        { name: "app", type: "A", ttl: 14400, records: [{ content: "203.0.113.1", is_disabled: false }] },
      ]);
      if (url.includes("/dns/v1/zones/example.com") && method === "PUT") { putBody = JSON.parse(String(init?.body)); return response({ ok: true }); }
      throw new Error(`unexpected ${method} ${url}`);
    }));
    const client = await import("./clients");
    const result = await client.upsertHostingerDns({ name: "app.example.com", type: "A", content: "203.0.113.7" });
    expect(result.action).toBe("updated");
    const payload = putBody as { overwrite: boolean; zone: Array<{ name: string; type: string; records: Array<{ content: string }> }> };
    expect(payload.overwrite).toBe(true);
    expect(payload.zone).toHaveLength(1);
    expect(payload.zone[0]).toMatchObject({ name: "app", type: "A" });
    expect(payload.zone[0].records[0].content).toBe("203.0.113.7");
  });
});
