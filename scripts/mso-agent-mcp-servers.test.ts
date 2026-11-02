import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchMcpServers, mapMcpServers } from "./mso-agent-mcp-servers.mjs";
import { formatMcpContent } from "./mso-agent-pane-context.mjs";
import { paneLines } from "./mso-agent-pane.mjs";
import { stripAnsi } from "./tui/cells.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("mso-agent-mcp-servers", () => {
  // Test requirement 1: Mapping produces the exact shape the pane accepts,
  // asserted against a fixture copied from the real pane's expectations in mso-agent-pane-kinds.test.ts.
  it("mapping produces the exact shape the pane accepts against fixture from pane expectations", () => {
    // Fixture copied directly from scripts/mso-agent-pane-kinds.test.ts (line 25).
    const paneFixture = [
      { name: "github", toolCount: 12 },
      { name: "filesystem", tools: 4 },
    ];

    // Raw configuration map as found in standard MCP configs or API responses.
    const rawConfig = {
      mcpServers: {
        github: { command: "node", args: ["./gh.js"], toolCount: 12 },
        filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"], tools: 4 },
      },
    };

    const mapped = mapMcpServers(rawConfig);
    expect(mapped).toEqual(paneFixture);

    // Verify formatMcpContent accepts the mapped output on session.mcpServers.
    const paneContent = formatMcpContent({ session: { mcpServers: mapped }, mcpServers: null });
    expect(paneContent.emptyText).toBeNull();
    expect(paneContent.rows).toEqual([
      { text: "github (12 tools)", tone: "normal" },
      { text: "filesystem (4 tools)", tone: "normal" },
    ]);
  });

  // Test requirement 2: A server without a tool count still renders as connected.
  it("a server without a tool count still renders as connected", () => {
    const rawWithoutCounts = {
      mcpServers: {
        sqlite: { command: "sqlite3", args: ["test.db"] },
      },
    };

    const mapped = mapMcpServers(rawWithoutCounts);
    expect(mapped).toEqual([{ name: "sqlite" }]);

    // The pane formats the server with (0 tools) and tone: normal, rather than (offline) and tone: dim.
    const paneContent = formatMcpContent({ session: { mcpServers: mapped }, mcpServers: null });
    expect(paneContent.rows).toEqual([
      { text: "sqlite (0 tools)", tone: "normal" },
    ]);

    const lines = paneLines({
      kind: "mcp",
      mcpServers: mapped,
      width: 40,
      rows: 6,
    });
    const rendered = lines.map((l) => stripAnsi(l)).join("\n");
    expect(rendered).toContain("sqlite (0 tools)");
    expect(rendered).not.toContain("offline");
  });

  // Test requirement 3: A fetch failure returns null and does not throw.
  it("a fetch failure returns null and does not throw", async () => {
    const failingApi = vi.fn().mockRejectedValue(new Error("network failure"));
    const failingReadFile = vi.fn().mockRejectedValue(new Error("ENOENT: no such file"));

    const result = await fetchMcpServers({
      apiFn: failingApi,
      filePath: "/nonexistent/mcp.json",
      readFile: failingReadFile,
    });

    expect(result).toBeNull();
  });

  // Test requirement 4: An empty list returns an empty array, not null, so the pane can
  // distinguish "none configured" from "could not read".
  it("an empty list returns an empty array, not null", async () => {
    // 4a. API returns empty list
    const emptyApi = vi.fn().mockResolvedValue({ servers: [] });
    const apiResult = await fetchMcpServers({ apiFn: emptyApi });
    expect(apiResult).toEqual([]);

    // 4b. Local config file defines empty servers
    const emptyFileRead = vi.fn().mockResolvedValue(JSON.stringify({ mcpServers: {} }));
    const fileResult = await fetchMcpServers({
      apiFn: vi.fn().mockRejectedValue(new Error("404")),
      filePath: "/tmp/fake-empty-mcp.json",
      readFile: emptyFileRead,
    });
    expect(fileResult).toEqual([]);
  });

  // Proof requirement: No network call inside a render path.
  it("proves no render module imports the fetch function", () => {
    const paneSource = fs.readFileSync(path.join(__dirname, "mso-agent-pane.mjs"), "utf8");
    const paneContextSource = fs.readFileSync(path.join(__dirname, "mso-agent-pane-context.mjs"), "utf8");
    const screenLoopSource = fs.readFileSync(path.join(__dirname, "mso-agent-screen-loop.mjs"), "utf8");

    expect(paneSource).not.toContain("fetchMcpServers");
    expect(paneSource).not.toContain("mso-agent-mcp-servers");
    expect(paneContextSource).not.toContain("fetchMcpServers");
    expect(paneContextSource).not.toContain("mso-agent-mcp-servers");
    expect(screenLoopSource).not.toContain("fetchMcpServers");
    expect(screenLoopSource).not.toContain("mso-agent-mcp-servers");
  });
});
