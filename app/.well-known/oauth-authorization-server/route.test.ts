import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, OPTIONS } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("OS_MCP_ENABLED", "1");
  vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
});

describe("GET /.well-known/oauth-authorization-server", () => {
  it("serves authorization server metadata without a session or auth headers (public-by-design)", async () => {
    // RFC 8414: MCP clients and OAuth tools inspect metadata prior to login
    const req = new Request("https://mso.example.test/.well-known/oauth-authorization-server");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const body = await res.json();
    expect(body).toEqual({
      issuer: "https://mso.example.test",
      authorization_endpoint: "https://mso.example.test/oauth/authorize",
      token_endpoint: "https://mso.example.test/oauth/token",
      registration_endpoint: "https://mso.example.test/oauth/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["read", "write", "exec", "offline_access"],
      authorization_response_iss_parameter_supported: true,
    });
  });

  it("derives issuer and endpoints from configured origin, not a hardcoded host", async () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://auth.company.corp:9000");
    const req = new Request("https://auth.company.corp:9000/.well-known/oauth-authorization-server");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issuer).toBe("https://auth.company.corp:9000");
    expect(body.authorization_endpoint).toBe("https://auth.company.corp:9000/oauth/authorize");
    expect(body.token_endpoint).toBe("https://auth.company.corp:9000/oauth/token");
    expect(body.registration_endpoint).toBe("https://auth.company.corp:9000/oauth/register");
  });

  it("returns 404 when MCP is disabled via configuration", async () => {
    vi.stubEnv("OS_MCP_ENABLED", "0");
    const req = new Request("https://mso.example.test/.well-known/oauth-authorization-server");
    const res = await GET(req);

    expect(res.status).toBe(404);
  });
});

describe("OPTIONS /.well-known/oauth-authorization-server", () => {
  it("handles CORS preflight with 204 and wildcard origin", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });
});
