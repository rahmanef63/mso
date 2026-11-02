import { describe, expect, it, vi } from "vitest";
import { cellWidth, stripAnsi } from "./tui/cells.mjs";
import { mountScreenLoop } from "./mso-agent-screen-loop.mjs";
import { paneLines } from "./mso-agent-pane.mjs";
import { formatContextContent } from "./mso-agent-pane-context.mjs";

class FakeTerminalOutput {
  columns = 120;
  rows = 24;
  isTTY = true;
  chunks: string[] = [];
  write(val: string) { this.chunks.push(String(val)); return true; }
}

describe("mso-agent-pane-live: live context and MCP pane rendering", () => {
  // Test 1: mutating session.usage.totalTokens between two syncs changes the rendered context line
  it("mutating session.usage.totalTokens between two syncs changes the rendered context line", () => {
    const output = new FakeTerminalOutput();
    const session: any = {
      paneKind: "context",
      state: { config: { provider: "anthropic", model: "claude-3-5-sonnet" }, modelMeta: { context: 100_000 } },
      history: [{ role: "user", text: "hello" }],
      usage: { totalTokens: 1_000 },
    };

    const beforeContent = formatContextContent({ session });
    const beforeRow = beforeContent.rows.find((r) => r.text.startsWith("tokens:"));
    expect(beforeRow?.text).toBe("tokens: ~1.0k / 100k");

    const loop = mountScreenLoop({ session, enabled: true, output: output as any });
    expect(stripAnsi(output.chunks.join(""))).toContain("tokens: ~1.0k / 100k");

    const writeIndex = output.chunks.length;
    session.usage.totalTokens = 42_000;
    loop.sync();

    const afterContent = formatContextContent({ session });
    const afterRow = afterContent.rows.find((r) => r.text.startsWith("tokens:"));
    expect(afterRow?.text).toBe("tokens: ~42k / 100k");
    expect(beforeRow?.text).not.toBe(afterRow?.text);

    const diff = stripAnsi(output.chunks.slice(writeIndex).join(""));
    expect(diff).toContain("tokens: ~42k / 100k");
    loop.dispose();
  });

  // Test 2: a compaction or a turn does not throw in the pane
  it("a compaction or a turn does not throw in the pane", () => {
    const output = new FakeTerminalOutput();
    const session: any = {
      paneKind: "context",
      state: { config: { provider: "openai", model: "gpt-4o" }, modelMeta: { context: 128_000 } },
      agentSession: { id: "sess-live", compactThresholdTokens: 50_000, estimatedTokens: 45_000, compactionCount: 0 },
      history: [{ role: "user", text: "start" }, { role: "assistant", text: "ok" }],
      usage: { totalTokens: 10_000, apiCalls: 1 },
      mcpServers: [{ name: "gw", toolCount: 5 }],
    };

    const loop = mountScreenLoop({ session, enabled: true, output: output as any });

    // Turn completion simulation
    expect(() => {
      session.history.push({ role: "user", text: "next" }, { role: "assistant", text: "done" });
      session.usage.totalTokens = 35_000;
      session.usage.apiCalls = 2;
      loop.sync();
      paneLines({ kind: "context", session, width: 42, rows: 20 });
      paneLines({ kind: "mcp", session, width: 42, rows: 20 });
    }).not.toThrow();

    // Compaction event simulation
    expect(() => {
      session.agentSession.compactionCount = 1;
      session.agentSession.estimatedTokens = 12_000;
      session.history = [{ role: "user", text: "compacted summary" }];
      session.usage.totalTokens = 15_000;
      loop.sync();
      paneLines({ kind: "context", session, width: 42, rows: 20 });
      paneLines({ kind: "mcp", session, width: 42, rows: 20 });
    }).not.toThrow();

    loop.dispose();
  });

  // Test 3: if you add an MCP refresh, a failed refresh keeps the previous list rather than blanking the pane
  it("if you add an MCP refresh, a failed refresh keeps the previous list rather than blanking the pane", async () => {
    const output = new FakeTerminalOutput();
    const session: any = {
      paneKind: "mcp",
      mcpServers: [
        { name: "github", toolCount: 8, connected: true },
        { name: "filesystem", toolCount: 4, connected: true },
      ],
    };

    const refreshMcp = vi.fn().mockRejectedValue(new Error("network error"));
    const loop = mountScreenLoop({ session, enabled: true, output: output as any, refreshMcp });

    const beforeLines = paneLines({ kind: "mcp", session, width: 42, rows: 10 });
    const beforeText = beforeLines.map((l) => stripAnsi(l)).join("\n");
    expect(beforeText).toContain("github (8 tools)");
    expect(beforeText).not.toContain("no MCP servers");

    // Trigger sync which calls the failing refresh
    loop.sync();
    await new Promise((r) => setTimeout(r, 10));
    expect(refreshMcp).toHaveBeenCalledTimes(1);

    // Assert previous list is kept and pane was not blanked
    expect(session.mcpServers).toEqual([
      { name: "github", toolCount: 8, connected: true },
      { name: "filesystem", toolCount: 4, connected: true },
    ]);
    const failedLines = paneLines({ kind: "mcp", session, width: 42, rows: 10 });
    expect(failedLines.map((l) => stripAnsi(l)).join("\n")).toContain("github (8 tools)");

    // Successful refresh replaces the server list
    const updated = [{ name: "docker", toolCount: 6, connected: true }];
    refreshMcp.mockResolvedValueOnce(updated);
    loop.sync();
    await new Promise((r) => setTimeout(r, 10));

    expect(session.mcpServers).toEqual(updated);
    const updatedLines = paneLines({ kind: "mcp", session, width: 42, rows: 10 });
    expect(updatedLines.map((l) => stripAnsi(l)).join("\n")).toContain("docker (6 tools)");
    loop.dispose();
  });

  // Test 4: the pane renders exactly rows lines and never exceeds width
  it("the pane renders exactly rows lines and never exceeds width", () => {
    const testCases: Array<{ kind: "context" | "mcp", session: any }> = [
      {
        kind: "context",
        session: {
          state: {
            config: { provider: "very-long-provider-name-that-overflows", model: "model-identifier-suffix" },
            modelMeta: { context: 200_000 },
          },
          history: [{ role: "user", text: "Long text ".repeat(40) }],
          usage: { totalTokens: 150_000 },
          systemTokens: 2_500,
        },
      },
      {
        kind: "context",
        session: { state: { config: {}, modelMeta: null }, history: [], usage: {} },
      },
      {
        kind: "mcp",
        session: {
          mcpServers: [
            { name: "日本語サーバー漢字名ツールテスト", toolCount: 42, connected: true },
            { name: "offline-server", status: "disconnected", toolCount: 0 },
          ],
        },
      },
      {
        kind: "mcp",
        session: { mcpServers: [] },
      },
    ];

    for (const { kind, session } of testCases) {
      for (const w of [30, 42, 50]) {
        for (const r of [1, 2, 3, 4, 10, 24]) {
          const lines = paneLines({ kind, session, width: w, rows: r });
          expect(lines.length).toBe(r);
          for (const line of lines) {
            expect(cellWidth(line)).toBe(w);
          }
        }
      }
    }
  });

  // Test 5: proportion bar tracks live usage when totalTokens increases
  it("proportion bar recomputes and tracks live usage updates", () => {
    const session: any = {
      paneKind: "context",
      state: { config: { provider: "openai", model: "gpt-4o" }, modelMeta: { context: 100_000 } },
      history: [{ role: "user", text: "short" }],
      usage: { totalTokens: 10_000 },
    };

    const before = formatContextContent({ session });
    const beforeBar = before.rows.find((r) => r.text.startsWith("bar:"));
    expect(beforeBar?.text).toContain("10%");

    session.usage.totalTokens = 80_000;
    const after = formatContextContent({ session });
    const afterBar = after.rows.find((r) => r.text.startsWith("bar:"));
    expect(afterBar?.text).toContain("80%");
  });
});
