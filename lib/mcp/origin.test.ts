import { afterEach, describe, expect, it, vi } from "vitest";
import { mcpRequestOriginAllowed, publicOrigin } from "./origin";

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
