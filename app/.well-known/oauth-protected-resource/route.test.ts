import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, OPTIONS } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("OS_MCP_ENABLED", "1");
  vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
});

describe("GET /.well-known/oauth-protected-resource", () => {
  it("serves discovery document without a session or auth headers (public-by-design)", async () => {
    // RFC 9728: MCP clients probe discovery before authenticating; requiring a session breaks discovery
    const req = new Request("https://mso.example.test/.well-known/oauth-protected-resource");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const body = await res.json();
    expect(body).toEqual({
      resource: "https://mso.example.test/mcp",
      authorization_servers: ["https://mso.example.test"],
      scopes_supported: ["read", "write", "exec", "offline_access"],
      bearer_methods_supported: ["header"],
    });
  });

  it("derives resource and authorization_servers from configured origin, not a hardcoded host", async () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://custom-gateway.internal:8443");
    const req = new Request("https://custom-gateway.internal:8443/.well-known/oauth-protected-resource");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource).toBe("https://custom-gateway.internal:8443/mcp");
    expect(body.authorization_servers).toEqual(["https://custom-gateway.internal:8443"]);
  });

  it("returns 404 when MCP is disabled via configuration", async () => {
    vi.stubEnv("OS_MCP_ENABLED", "0");
    const req = new Request("https://mso.example.test/.well-known/oauth-protected-resource");
    const res = await GET(req);

    expect(res.status).toBe(404);
  });
});

describe("OPTIONS /.well-known/oauth-protected-resource", () => {
  it("handles CORS preflight with 204 and wildcard origin", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });
});
