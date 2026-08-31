import { describe, expect, it, vi } from "vitest";
import {
  codexMcpConfig,
  cursorMcpConfig,
  isRemoteMcpOrigin,
  mcpEndpoints,
  vscodeMcpConfig,
} from "./mcp-client-core";
import { probeMcpConnection } from "./mcp-probe";
import { mcpClientSteps } from "./mcp-client-steps";

describe("MCP client setup guides", () => {
  it("derives every endpoint from one normalized origin", () => {
    const endpoints = mcpEndpoints("https://mso.example.test/path");
    expect(endpoints.origin).toBe("https://mso.example.test");
    expect(endpoints.mcp).toBe("https://mso.example.test/mcp");
    expect(endpoints.protectedResource).toContain("/.well-known/oauth-protected-resource");
  });

  it("distinguishes a remotely reachable HTTPS origin from local loopback", () => {
    expect(isRemoteMcpOrigin("https://mso.example.test")).toBe(true);
    expect(isRemoteMcpOrigin("https://localhost:4005")).toBe(false);
    expect(isRemoteMcpOrigin("http://127.0.0.1:4005")).toBe(false);
  });

  it("builds client configs with no credential material", () => {
    const cursor = JSON.parse(cursorMcpConfig("https://mso.example.test"));
    const vscode = JSON.parse(vscodeMcpConfig("https://mso.example.test"));
    const codex = codexMcpConfig("https://mso.example.test");
    expect(cursor).toEqual({ mcpServers: { mso: { url: "https://mso.example.test/mcp" } } });
    expect(vscode).toEqual({ servers: { mso: { type: "http", url: "https://mso.example.test/mcp" } } });
    expect(codex).toContain('url = "https://mso.example.test/mcp"');
    expect(JSON.stringify({ cursor, vscode, codex })).not.toMatch(/password|client_secret|bearer\s+[a-z0-9]/i);
  });

  it("keeps ChatGPT setup explicit about Developer Mode, OAuth and tool scanning", () => {
    const text = mcpClientSteps("chatgpt", "https://mso.example.test").map((step) => `${step.title} ${step.body}`).join(" ");
    expect(text).toMatch(/Developer Mode/);
    expect(text).toMatch(/OAuth/);
    expect(text).toMatch(/Scan Tools/);
    expect(text).toMatch(/lowest scope/);
  });

  it("provides direct remote HTTP commands for major CLI clients", () => {
    const codex = mcpClientSteps("codex", "https://mso.example.test").flatMap((step) => step.copy?.value ?? []).join(" ");
    const claude = mcpClientSteps("claude-code", "https://mso.example.test").flatMap((step) => step.copy?.value ?? []).join(" ");
    const gemini = mcpClientSteps("gemini", "https://mso.example.test").flatMap((step) => step.copy?.value ?? []).join(" ");
    expect(codex).toContain("codex mcp add mso --url https://mso.example.test/mcp");
    expect(codex).toContain("codex mcp login mso");
    expect(claude).toContain("claude mcp add --transport http mso https://mso.example.test/mcp");
    expect(gemini).toContain("gemini mcp add --transport http mso https://mso.example.test/mcp");
  });

  it("accepts only matching endpoint, challenge and OAuth discovery metadata", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/mcp") && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "www-authenticate": 'Bearer realm="mso", resource_metadata="https://mso.example.test/.well-known/oauth-protected-resource"' },
        });
      }
      if (url.endsWith("/mcp")) return Response.json({ name: "mso MCP", authorization_servers: ["https://mso.example.test"] });
      if (url.endsWith("oauth-protected-resource")) return Response.json({ resource: "https://mso.example.test/mcp", authorization_servers: ["https://mso.example.test"] });
      return Response.json({
        issuer: "https://mso.example.test",
        authorization_endpoint: "https://mso.example.test/oauth/authorize",
        token_endpoint: "https://mso.example.test/oauth/token",
        registration_endpoint: "https://mso.example.test/oauth/register",
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    });
    await expect(probeMcpConnection("https://mso.example.test", fetcher)).resolves.toMatchObject({ ready: true });
  });

  it("fails the probe when discovery points at another deployment", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/mcp")) return Response.json({ name: "mso MCP", authorization_servers: ["https://other.test"] });
      return Response.json({});
    });
    await expect(probeMcpConnection("https://mso.example.test", fetcher)).resolves.toMatchObject({ ready: false });
  });
});
