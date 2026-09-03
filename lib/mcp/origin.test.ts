import { afterEach, describe, expect, it, vi } from "vitest";
import { mcpCorsHeaders, mcpRequestOriginAllowed, publicOrigin } from "./origin";

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

afterEach(() => vi.unstubAllEnvs());

describe("MCP public origin boundary", () => {
  it("prefers the deployment-owned origin", () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test/path");
    expect(publicOrigin(req("http://127.0.0.1:4005/mcp", { host: "127.0.0.1:4005" }))).toBe("https://mso.example.test");
  });

  it("allows server-to-server clients that omit Origin", () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
    expect(mcpRequestOriginAllowed(req("https://mso.example.test/mcp"))).toBe(true);
  });

  it("allows the configured public browser origin", () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
    expect(mcpRequestOriginAllowed(req("https://mso.example.test/mcp", { origin: "https://mso.example.test", host: "mso.example.test" }))).toBe(true);
  });

  it("allows ChatGPT browser requests only against the configured public MCP origin", () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
    const publicReq = req("https://mso.example.test/mcp", { origin: "https://chatgpt.com", host: "mso.example.test" });
    expect(mcpRequestOriginAllowed(publicReq)).toBe(true);
    expect(mcpCorsHeaders(publicReq)).toMatchObject({
      "Access-Control-Allow-Origin": "https://chatgpt.com",
      "Access-Control-Allow-Headers": expect.stringContaining("Authorization"),
      Vary: "Origin",
    });
    const loopbackReq = req("http://127.0.0.1:4005/mcp", { origin: "https://chatgpt.com", host: "127.0.0.1:4005" });
    expect(mcpRequestOriginAllowed(loopbackReq)).toBe(false);
  });

  it("supports exact operator-added browser origins without accepting suffix spoofing", () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
    vi.stubEnv("OS_MCP_BROWSER_ORIGINS", "https://claude.example, https://cursor.example/path");
    expect(mcpRequestOriginAllowed(req("https://mso.example.test/mcp", { origin: "https://claude.example", host: "mso.example.test" }))).toBe(true);
    expect(mcpRequestOriginAllowed(req("https://mso.example.test/mcp", { origin: "https://evil.claude.example", host: "mso.example.test" }))).toBe(false);
  });

  it("keeps the Settings self-probe working on a loopback cockpit", () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
    expect(mcpRequestOriginAllowed(req("http://127.0.0.1:4005/mcp", { origin: "http://127.0.0.1:4005", host: "127.0.0.1:4005" }))).toBe(true);
  });

  it("rejects a different loopback origin or port", () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
    expect(mcpRequestOriginAllowed(req("http://127.0.0.1:4005/mcp", { origin: "http://localhost:4005", host: "127.0.0.1:4005" }))).toBe(false);
    expect(mcpRequestOriginAllowed(req("http://127.0.0.1:4005/mcp", { origin: "http://127.0.0.1:9999", host: "127.0.0.1:4005" }))).toBe(false);
  });

  it("rejects an arbitrary browser origin even when Host is attacker controlled", () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", "");
    expect(mcpRequestOriginAllowed(req("http://attacker.example/mcp", { origin: "http://attacker.example", host: "attacker.example" }))).toBe(false);
  });

  it("rejects a foreign origin when a public origin is configured", () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
    expect(mcpRequestOriginAllowed(req("https://mso.example.test/mcp", { origin: "https://evil.example", host: "mso.example.test" }))).toBe(false);
  });
});
