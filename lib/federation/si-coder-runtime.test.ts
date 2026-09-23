import { describe, expect, it, vi } from "vitest";

const runtimeFixture = vi.hoisted(() => {
  const required = [
    "sc.product.interview",
    "sc.user.connection.manage",
    "sc.doku.mcp.call",
    "sc.flow.run",
  ];
  const filler = Array.from({ length: 52 }, (_, index) => `sc.fixture.${index + 1}`);
  return {
    tools: [...required, ...filler].map((name) => ({ name, description: "synthetic reviewed function", inputSchema: { type: "object" } })),
  };
});

vi.mock("@/lib/host/sc-installation.mjs", () => ({
  inspectScInstallation: vi.fn(async () => ({
    name: "si-coder-agent",
    version: "0.9.8",
    root: "/synthetic/si-coder",
    bin: "/synthetic/si-coder/sc",
    mcpEntrypoint: "/synthetic/si-coder/scripts/sc-mcp.js",
  })),
}));
vi.mock("@/lib/host/sc-managed", () => ({
  resolveManagedSc: vi.fn(async (server) => ({
    name: server.name,
    transport: "stdio",
    command: process.execPath,
    args: ["/synthetic/si-coder/scripts/sc-mcp.js"],
    cwd: server.cwd,
    env: {},
    headers: {},
    oauthConfigured: false,
    consumer: "mso",
  })),
}));
vi.mock("@/lib/host/project-mcp-client", () => ({
  listMcpServerTools: vi.fn(async () => runtimeFixture.tools),
  callMcpServerTool: vi.fn(),
}));

import { inspectSiCoderFederationRuntime, siCoderFederationScope } from "./si-coder-runtime";

describe("SI-Coder federation runtime", () => {
  it("classifies current machine functions conservatively", () => {
    expect(siCoderFederationScope("sc.version")).toBe("read");
    expect(siCoderFederationScope("sc.user.create")).toBe("write");
    expect(siCoderFederationScope("sc.doku.mcp.call")).toBe("exec");
    expect(siCoderFederationScope("sc.flow.run")).toBe("exec");
  });

  it("discovers reviewed runtime metadata without depending on a host installation", async () => {
    const runtime = await inspectSiCoderFederationRuntime(process.cwd());
    expect(runtime.version).toBe("0.9.8");
    expect(runtime.functionCount).toBe(runtimeFixture.tools.length);
    expect(runtime.functionCount).toBeGreaterThanOrEqual(55);
    expect(runtime.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "sc.product.interview",
      "sc.user.connection.manage",
      "sc.doku.mcp.call",
      "sc.flow.run",
    ]));
  });
});
