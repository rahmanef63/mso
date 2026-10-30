import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { chromeLines, tabRow, tabsToSwitch } from "./mso-agent-chrome.mjs";
import { cellWidth, stripAnsi } from "./tui/cells.mjs";
import { AgentComposer } from "./mso-agent-composer.mjs";

describe("MSO Agent TUI chrome and session tabs", () => {
  it("a tab row with three sessions marks the active one and fits the width", () => {
    const sessions = [{ id: "s1", name: "main" }, { id: "s2", name: "worker" }, { id: "s3", name: "review" }];
    const colors = { blue: "\x1b[34m", bold: "\x1b[1m", dim: "\x1b[2m", reset: "\x1b[0m" };
    const row = tabRow(sessions, "s2", { colors, width: 80 });
    expect(row).toContain("● @worker");
    expect(row).toContain("@main");
    expect(row).toContain("@review");
    expect(cellWidth(row)).toBeLessThanOrEqual(80);
  });

  it("tabs that do not fit are dropped from the middle with a +N marker and the row stays within width", () => {
    const sessions = [
      { id: "s1", name: "alpha-orchestration" },
      { id: "s2", name: "beta-worker-pool" },
      { id: "s3", name: "gamma-analytics" },
      { id: "s4", name: "delta-subagent" },
      { id: "s5", name: "epsilon-monitoring" },
    ];
    const row = tabRow(sessions, "s1", { width: 34 });
    expect(row).toContain("+");
    expect(row).toContain("@alpha-orchestration");
    expect(cellWidth(row)).toBeLessThanOrEqual(34);
  });

  it("chromeLines returns at most two rows and drops empties", () => {
    const sessions = [{ id: "s1", name: "alpha" }];
    const twoLines = chromeLines({ sessions, activeId: "s1", footer: "mode ask : Tab cycle", width: 80 });
    expect(twoLines).toHaveLength(2);
    expect(twoLines[0]).toContain("@alpha");
    expect(twoLines[1]).toBe("mode ask : Tab cycle");

    const onlyFooter = chromeLines({ sessions: [], footer: "mode ask : Tab cycle", width: 80 });
    expect(onlyFooter).toEqual(["mode ask : Tab cycle"]);

    const onlyTabs = chromeLines({ sessions, activeId: "s1", footer: "", width: 80 });
    expect(onlyTabs).toHaveLength(1);
    expect(onlyTabs[0]).toContain("@alpha");

    expect(chromeLines({ sessions: [], footer: "" })).toEqual([]);
  });

  it("a terminal with 8 rows drops the footer, and with 6 rows drops both", () => {
    const sessions = [{ id: "s1", name: "primary" }];
    const footer = "mode ask : anthropic/claude-3-5-sonnet";

    const eightRows = chromeLines({ sessions, activeId: "s1", footer, width: 80, rows: 8 });
    expect(eightRows).toHaveLength(1);
    expect(eightRows[0]).toContain("@primary");
    expect(eightRows[0]).not.toContain("mode ask");

    const sixRows = chromeLines({ sessions, activeId: "s1", footer, width: 80, rows: 6 });
    expect(sixRows).toEqual([]);
  });

  it("no ANSI codes when no palette is passed", () => {
    const sessions = [{ id: "s1", name: "one" }, { id: "s2", name: "two" }];
    const row = tabRow(sessions, "s1", { width: 80 });
    expect(row).toBe(stripAnsi(row));
    expect(row).not.toMatch(/\x1b\[/);

    const lines = chromeLines({ sessions, activeId: "s1", footer: "mode ask : Tab cycle", width: 80 });
    for (const line of lines) {
      expect(line).toBe(stripAnsi(line));
      expect(line).not.toMatch(/\x1b\[/);
    }
  });

  it("tabsToSwitch resolves a valid index, resolves a unique name, and refuses an ambiguous name instead of picking one", () => {
    const s1 = { id: "sess-1", name: "alpha" }, s2 = { id: "sess-2", name: "beta" }, s3 = { id: "sess-3", name: "gamma" };
    const sessions = [s1, s2, s3];

    expect(tabsToSwitch(sessions, "1")).toBe(s1);
    expect(tabsToSwitch(sessions, 2)).toBe(s2);
    expect(tabsToSwitch(sessions, ["3"])).toBe(s3);
    expect(tabsToSwitch(sessions, "99")).toBe(null);

    expect(tabsToSwitch(sessions, "alpha")).toBe(s1);
    expect(tabsToSwitch(sessions, "@beta")).toBe(s2);

    const ambiguousSessions = [{ id: "a1", name: "worker" }, { id: "a2", name: "worker" }, { id: "a3", name: "leader" }];
    expect(tabsToSwitch(ambiguousSessions, "worker")).toBe(null);
    expect(tabsToSwitch(ambiguousSessions, "@worker")).toBe(null);

    const prefixSessions = [{ id: "b1", name: "job-run-1" }, { id: "b2", name: "job-run-2" }];
    expect(tabsToSwitch(prefixSessions, "job")).toBe(null);
  });

  it("an empty session list renders no tab row and does not throw", () => {
    expect(() => tabRow([], "s1", { width: 80 })).not.toThrow();
    expect(tabRow([], "s1", { width: 80 })).toBe("");
    expect(tabRow(null as never, "s1", { width: 80 })).toBe("");

    expect(() => chromeLines({ sessions: [] })).not.toThrow();
    expect(chromeLines({ sessions: [] })).toEqual([]);

    expect(() => tabsToSwitch([], "1")).not.toThrow();
    expect(tabsToSwitch([], "1")).toBe(null);
    expect(tabsToSwitch(null as never, "1")).toBe(null);
  });

  it("the composer paints chrome via writeFrame and emits no newline on repaint", async () => {
    class FakeInput extends EventEmitter {
      isRaw = false; resume() {} pause() {} setRawMode(value: boolean) { this.isRaw = value; }
    }
    class FakeOutput {
      isTTY = true; columns = 80; rows = 24; chunks: string[] = [];
      write(value: string) { this.chunks.push(String(value)); return true; }
    }

    const input = new FakeInput();
    const output = new FakeOutput();
    const composer = new AgentComposer({
      input: input as never, output: output as never,
      colors: { blue: "", bold: "", dim: "", reset: "" },
    });

    const sessions = [{ id: "s1", name: "primary" }, { id: "s2", name: "worker" }];
    const answer = composer.question("prompt > ", {
      footer: () => chromeLines({ sessions, activeId: "s1", footer: "mode ask : Tab cycle", width: output.columns, rows: output.rows }),
    } as never);

    const initialText = output.chunks.join("");
    expect(initialText).toContain("@primary");
    expect(initialText).toContain("@worker");
    expect(initialText).toContain("mode ask");

    const beforeKey = output.chunks.length;
    input.emit("keypress", "a", { name: "a", sequence: "a" });
    const redrawChunks = output.chunks.slice(beforeKey).join("");
    expect(redrawChunks).not.toContain("\n");
    expect(redrawChunks).toContain("prompt > a");

    input.emit("keypress", undefined, { ctrl: true, name: "c" });
    input.emit("keypress", undefined, { ctrl: true, name: "c" });
    await answer;
    composer.close();
  });
});
