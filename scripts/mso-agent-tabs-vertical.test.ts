import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { tabAtPoint, tabLayout, tabRailLines, tabRailWidth, tabRow } from "./mso-agent-chrome.mjs";
import { mountScreenLoop } from "./mso-agent-screen-loop.mjs";
import { cellWidth } from "./tui/cells.mjs";

class FakeOutput extends EventEmitter {
  isTTY = true;
  columns = 80;
  rows = 24;
  chunks: string[] = [];
  write(str: string) {
    this.chunks.push(String(str));
    return true;
  }
}

describe("MSO Agent TUI vertical tab rail", () => {
  const sessions = [
    { id: "s1", name: "alpha" },
    { id: "s2", name: "beta" },
    { id: "s3", name: "gamma" },
  ];

  it("tabLayout with orientation: vertical yields segments that tabAtPoint resolves correctly at every visible cell", () => {
    const { segments } = tabLayout(sessions, "s1", { orientation: "vertical", width: 20, rows: 10 });
    expect(segments).toHaveLength(3);

    for (const seg of segments) {
      if (seg.type === "tab") {
        for (let x = seg.start; x < seg.end; x++) {
          const hit = tabAtPoint(sessions, "s1", { x, y: seg.row, orientation: "vertical", width: 20, rows: 10 });
          expect(hit).toBe(seg.id);
        }
      }
    }

    const horiz = tabLayout(sessions, "s1", { orientation: "horizontal", width: 80 });
    for (const seg of horiz.segments) {
      if (seg.type === "tab") {
        for (let x = seg.start; x < seg.end; x++) {
          const hit = tabAtPoint(sessions, "s1", { x, y: 0, orientation: "horizontal", width: 80, tabRow: 0 });
          expect(hit).toBe(seg.id);
        }
      }
    }
  });

  it("a click on a rail cell switches to that session id", () => {
    const onTabClick = vi.fn();
    const output = new FakeOutput();
    output.columns = 120;
    output.rows = 30;
    const input = new EventEmitter();
    const session: any = { agentSession: { id: "s1", name: "alpha" }, history: [] };

    const loop = mountScreenLoop({
      enabled: true,
      session,
      output: output as never,
      input: input as never,
      getSessions: () => sessions,
      onTabClick,
      tabsLayout: "vertical",
    });

    const geom = loop.geometry();
    expect(geom.railWidth).toBeGreaterThan(0);

    // Beta tab is on row 1 (y=1). Left click at col 3, row 2 in SGR escape syntax is x=2, y=1
    input.emit("data", "\x1b[<0;3;2M");
    expect(onTabClick).toHaveBeenCalledWith("s2");

    loop.dispose();
  });

  it("a click on the rail gutter returns null", () => {
    // Column 19 is the border gutter when rail width is 20
    const gutterHit = tabAtPoint(sessions, "s1", { x: 19, y: 0, orientation: "vertical", width: 20, rows: 10 });
    expect(gutterHit).toBeNull();

    // Far beyond rail width returns null
    const outsideHit = tabAtPoint(sessions, "s1", { x: 25, y: 0, orientation: "vertical", width: 20, rows: 10 });
    expect(outsideHit).toBeNull();

    // In a running loop, a click on the rail border gutter does not trigger tab switch
    const onTabClick = vi.fn();
    const output = new FakeOutput();
    output.columns = 120;
    output.rows = 30;
    const input = new EventEmitter();
    const session: any = { agentSession: { id: "s1", name: "alpha" }, history: [] };

    const loop = mountScreenLoop({
      enabled: true,
      session,
      output: output as never,
      input: input as never,
      getSessions: () => sessions,
      onTabClick,
      tabsLayout: "vertical",
    });

    const geom = loop.geometry();
    // Click on border column x = railWidth - 1 (1-based: railWidth) on row y = 0 (1-based: 1)
    input.emit("data", `\x1b[<0;${geom.railWidth};1M`);
    expect(onTabClick).not.toHaveBeenCalled();

    loop.dispose();
  });

  it("the rail returns zero width below 100 columns", () => {
    // Guards transcript width from rail crowding on narrow terminals
    expect(tabRailWidth(79)).toBe(0);
    expect(tabRailWidth(80)).toBe(0);
    expect(tabRailWidth(99)).toBe(0);
    expect(tabRailWidth(100)).toBeGreaterThan(0);
    expect(tabRailWidth(120)).toBeGreaterThan(0);

    const narrowOut = new FakeOutput();
    narrowOut.columns = 80;
    const session: any = { agentSession: { id: "s1", name: "alpha" }, history: [] };
    const loopNarrow = mountScreenLoop({ enabled: true, session, output: narrowOut as never, tabsLayout: "vertical" });
    expect(loopNarrow.geometry().railWidth).toBe(0);
    loopNarrow.dispose();
  });

  it("overflow drops from the middle with +N and the rail stays within its width", () => {
    const manySessions = [
      { id: "s1", name: "alpha-orchestration-service" },
      { id: "s2", name: "beta-worker-pool-runner" },
      { id: "s3", name: "gamma-analytics-aggregator" },
      { id: "s4", name: "delta-subagent-dispatch" },
      { id: "s5", name: "epsilon-monitoring-probe" },
    ];

    const { segments } = tabLayout(manySessions, "s1", { orientation: "vertical", width: 20, rows: 3 });
    expect(segments).toHaveLength(3);
    expect(segments[0].id).toBe("s1");
    expect(segments[1].type).toBe("marker");
    expect(segments[1].text).toBe("+3");
    expect(segments[2].id).toBe("s5");

    const lines = tabRailLines(manySessions, "s1", { width: 20, rows: 3 });
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(cellWidth(line)).toBe(20);
    }

    // Clicking marker returns null
    expect(tabAtPoint(manySessions, "s1", { x: 1, y: 1, orientation: "vertical", width: 20, rows: 3 })).toBeNull();
  });

  it("horizontal output is unchanged when the option is absent", () => {
    const defaultLayout = tabLayout(sessions, "s1", { width: 80 });
    const explicitLayout = tabLayout(sessions, "s1", { width: 80, orientation: "horizontal" });
    expect(defaultLayout).toEqual(explicitLayout);

    const defaultRow = tabRow(sessions, "s1", { width: 80 });
    const explicitRow = tabRow(sessions, "s1", { width: 80, orientation: "horizontal" });
    expect(defaultRow).toBe(explicitRow);
    expect(defaultRow).toBe("● @alpha  @beta  @gamma");

    // Disabled loop with rail off writes nothing
    const outDisabled = new FakeOutput();
    const session: any = { agentSession: { id: "s1", name: "alpha" }, history: [] };
    const loopDisabled = mountScreenLoop({ enabled: false, session, output: outDisabled as never });
    loopDisabled.paint();
    expect(outDisabled.chunks).toHaveLength(0);
    loopDisabled.dispose();

    // Baseline horizontal frame is byte-identical whether tabsLayout is omitted or horizontal
    const out1 = new FakeOutput();
    const out2 = new FakeOutput();
    const loop1 = mountScreenLoop({ enabled: true, session, output: out1 as never, getSessions: () => sessions });
    const loop2 = mountScreenLoop({ enabled: true, session, output: out2 as never, getSessions: () => sessions, tabsLayout: "horizontal" });
    expect(out1.chunks).toEqual(out2.chunks);
    loop1.dispose();
    loop2.dispose();
  });
});
