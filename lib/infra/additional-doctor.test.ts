import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { doctorAdditionalProvider } from "./additional-doctor";
import { connectionCatalog } from "./connection-registry";
import { setupFields } from "./setup-guidance";
import { summarizeInfraProvider } from "./store";
const KEY = "synthetic_api_credential_for_unit_test";
afterEach(() => vi.unstubAllGlobals());
describe("additional native credential providers", () => {
  it("exposes thirteen native providers with guided method-specific fields", () => {
    const catalog = connectionCatalog(); expect(catalog).toHaveLength(13);
    for (const p of catalog) for (const m of p.sources.find(s=>s.id==="direct")!.methods) {
      expect(m.fields.length).toBeGreaterThan(0); expect(m.guidance.steps.length).toBeGreaterThan(1);
      expect(m.guidance.url).toMatch(/^https:\/\//); expect(m.guidance.reference).toMatch(/^https:\/\//);
    }
    expect(setupFields("convex-cloud", "personal").map(f => f.key)).toEqual(["personalToken"]);
    expect(setupFields("convex-cloud", "deployment").map(f => f.key)).toEqual(["deployKey", "deploymentName"]);
    expect(() => setupFields("convex-cloud", "organization")).toThrow();
    expect(setupFields("doku", "mcp").map(f => f.key)).toEqual(["mcpClientId", "mcpApiKey", "environment"]);
    expect(() => setupFields("doku", "direct")).toThrow();
  });
  it.each([
    ["github", "https://api.github.com/user", { apiKey: KEY }],
    ["vercel", "https://api.vercel.com/v2/user", { apiKey: KEY }],
    ["resend", "https://api.resend.com/domains", { apiKey: KEY }],
    ["stripe", "https://api.stripe.com/v1/account", { apiKey: KEY }],
    ["clerk", "https://api.clerk.com/v1/users?limit=1", { apiKey: KEY }],
    ["supabase", "https://api.supabase.com/v1/projects", { managementToken: KEY }],
    ["convex-cloud", "https://api.convex.dev/v1/list_personal_access_tokens?limit=1", { personalToken: KEY }],
  ])("checks %s at a fixed provider-owned endpoint", async (id, endpoint, values) => {
    const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("[]", { status: 200 })); vi.stubGlobal("fetch", mock);
    const result = await doctorAdditionalProvider(id as string, values as Record<string, string>);
    expect(result).toContain("authenticated"); expect(result).not.toContain(KEY);
    expect(mock.mock.calls[0]?.[0]).toBe(endpoint);
  });
  it("verifies DOKU MCP with a fixed official endpoint and never exposes credentials", async () => {
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api-sandbox.doku.com/doku-mcp-server/mcp");
      const headers = new Headers(init?.headers);
      expect(headers.get("Client-Id")).toBe("BRN-synthetic");
      expect(headers.get("authorization")).toBe(`Basic ${Buffer.from(`${KEY}:`).toString("base64")}`);
      expect(JSON.parse(String(init?.body))).toMatchObject({ method: "initialize", id: "mso-doku-doctor" });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "mso-doku-doctor", result: { protocolVersion: "2024-11-05", capabilities: {} } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", mock);
    const result = await doctorAdditionalProvider("doku", { mcpClientId: "BRN-synthetic", mcpApiKey: KEY, environment: "sandbox" });
    expect(result).toBe("authenticated; sandbox MCP initialize verified");
    expect(result).not.toContain(KEY);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("rejects arbitrary DOKU environments before sending credentials", async () => {
    const mock = vi.fn(); vi.stubGlobal("fetch", mock);
    await expect(doctorAdditionalProvider("doku", { mcpClientId: "BRN-synthetic", mcpApiKey: KEY, environment: "https://evil.invalid" })).rejects.toThrow("invalid environment");
    expect(mock).not.toHaveBeenCalled();
  });
  it("never echoes reflected provider errors or request secrets", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(KEY, { status: 401 })));
    await expect(doctorAdditionalProvider("github", { apiKey: KEY })).rejects.toThrow("GitHub HTTP 401");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(KEY); }));
    await expect(doctorAdditionalProvider("github", { apiKey: KEY })).rejects.toThrow("GitHub request failed");
  });
  it("rejects arbitrary Convex targets before sending any key", async () => {
    const mock = vi.fn(); vi.stubGlobal("fetch", mock);
    for (const apiUrl of ["http://169.254.169.254/", "https://owner:password@evil.invalid", "https://example.com/?credential=x"])
      await expect(doctorAdditionalProvider("convex", { apiUrl, adminKey: KEY })).rejects.toThrow("invalid deployment URL");
    await expect(doctorAdditionalProvider("convex-cloud", { deployKey: KEY, deploymentName: "test.example.com/" })).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
  });
  it("derives redaction from the field schema for every secret key name", () => {
    expect(JSON.stringify(summarizeInfraProvider("convex-cloud", { personalToken: KEY }))).not.toContain(KEY);
    expect(JSON.stringify(summarizeInfraProvider("convex", { adminKey: KEY, apiUrl: "https://convex.example.com" }))).not.toContain(KEY);
    expect(JSON.stringify(summarizeInfraProvider("supabase", { managementToken: KEY }))).not.toContain(KEY);
    expect(JSON.stringify(summarizeInfraProvider("doku", { mcpClientId: "BRN-synthetic", mcpApiKey: KEY, environment: "sandbox" }))).not.toContain(KEY);
  });
});
