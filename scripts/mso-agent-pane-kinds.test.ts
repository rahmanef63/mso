import { describe, expect, it } from "vitest";
import { cellWidth, stripAnsi } from "./tui/cells.mjs";
import { cyclePane, paneKinds, paneLines } from "./mso-agent-pane.mjs";

describe("mso-agent-pane-kinds", () => {
  it("paneKinds() includes all five and cyclePane walks every one and wraps", () => {
    const kinds = paneKinds();
    expect(kinds).toContain("todos");
    expect(kinds).toContain("diff");
    expect(kinds).toContain("files");
    expect(kinds).toContain("mcp");
    expect(kinds).toContain("context");
    expect(kinds).toEqual(["todos", "diff", "files", "mcp", "context", "off"]);

    expect(cyclePane("todos")).toBe("diff");
    expect(cyclePane("diff")).toBe("files");
    expect(cyclePane("files")).toBe("mcp");
    expect(cyclePane("mcp")).toBe("context");
    expect(cyclePane("context")).toBe("off");
    expect(cyclePane("off")).toBe("todos");
    expect(cyclePane("unknown")).toBe("todos");
  });

  it("mcp with two connected servers renders one line each with the tool counts, exactly rows lines total, no line wider than width", () => {
    const mcpServers = [
      { name: "github", toolCount: 12 },
      { name: "filesystem", tools: 4 },
    ];
    const width = 42;
    const rows = 10;
    const lines = paneLines({
      kind: "mcp",
      mcpServers,
      width,
      rows,
    });
    expect(lines.length).toBe(rows);
    for (const line of lines) {
      expect(cellWidth(line)).toBe(width);
    }
    const text = lines.map((l) => stripAnsi(l)).join("\n");
    expect(text).toContain("github (12 tools)");
    expect(text).toContain("filesystem (4 tools)");
  });

  it("mcp with none renders the empty-state line, not blank rows above the border", () => {
    const lines = paneLines({
      kind: "mcp",
      mcpServers: [],
      width: 40,
      rows: 8,
    });
    expect(lines.length).toBe(8);
    for (const line of lines) {
      expect(cellWidth(line)).toBe(40);
    }
    const text = lines.map((l) => stripAnsi(l)).join("\n");
    expect(text).toContain("(no MCP servers)");
  });

  it("context with a known window renders the proportion bar and the token count; with an unknown window renders ? and no invented percentage", () => {
    const sessionWithWindow = {
      state: {
        config: { provider: "anthropic", model: "claude-3-5-sonnet" },
        modelMeta: { context: 100_000 },
      },
      history: [
        { role: "user", text: "hello".repeat(200) },
      ],
    };

    const linesKnown = paneLines({
      kind: "context",
      session: sessionWithWindow,
      width: 42,
      rows: 10,
    });
    expect(linesKnown.length).toBe(10);
    const textKnown = linesKnown.map((l) => stripAnsi(l)).join("\n");
    expect(textKnown).toMatch(/tokens:\s*~\d+/);
    expect(textKnown).toContain("100k");
    expect(textKnown).toMatch(/bar:\s*\[[█░]+\]\s*\d+%/);

    const sessionWithoutWindow = {
      state: {
        config: { provider: "custom", model: "unknown-model" },
        modelMeta: null,
      },
      history: [
        { role: "user", text: "hello".repeat(200) },
      ],
    };

    const linesUnknown = paneLines({
      kind: "context",
      session: sessionWithoutWindow,
      width: 42,
      rows: 10,
    });
    expect(linesUnknown.length).toBe(10);
    const textUnknown = linesUnknown.map((l) => stripAnsi(l)).join("\n");
    expect(textUnknown).toContain("tokens: ~");
    expect(textUnknown).toContain("/ ?");
    expect(textUnknown).toContain("bar: ?");
    expect(textUnknown).not.toContain("%");
  });

  it("context on a fresh session with no usage does not throw and still renders exactly rows lines", () => {
    const freshSessions = [
      {},
      { state: null, history: [] },
      { state: {}, history: [] },
      null,
    ];

    for (const session of freshSessions) {
      for (const r of [1, 2, 3, 4, 8, 20]) {
        let lines: string[] = [];
        expect(() => {
          lines = paneLines({
            kind: "context",
            session,
            width: 40,
            rows: r,
          });
        }).not.toThrow();
        expect(lines.length).toBe(r);
        for (const line of lines) {
          expect(cellWidth(line)).toBe(40);
        }
      }
    }
  });

  it("a CJK character in a server name does not push the line past width", () => {
    const cjkServers = [
      { name: "データベース管理サーバー日本語テスト", toolCount: 8 },
      { name: "API連携", toolCount: 1 },
    ];

    for (const w of [30, 35, 42, 50]) {
      const lines = paneLines({
        kind: "mcp",
        mcpServers: cjkServers,
        width: w,
        rows: 8,
      });
      expect(lines.length).toBe(8);
      for (const line of lines) {
        expect(cellWidth(line)).toBe(w);
      }
    }
  });
});
