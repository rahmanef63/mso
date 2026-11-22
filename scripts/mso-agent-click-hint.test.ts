import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { CLICK_HINT_TEXT, formatClickHint, isInteractiveRegion, shouldShowClickHint } from "./mso-agent-click-hint.mjs";
import { mountScreenLoop } from "./mso-agent-screen-loop.mjs";

class FakeOutput extends EventEmitter {
  isTTY = true;
  columns = 120;
  rows = 30;
  chunks: string[] = [];
  write(str: string) {
    this.chunks.push(String(str));
    return true;
  }
}

describe("MSO Agent mouse click region hint", () => {
  const sessions = [
    { id: "s1", name: "alpha" },
    { id: "s2", name: "beta" },
    { id: "s3", name: "gamma" },
  ];

  it("pure decision and formatter behavior", () => {
    expect(formatClickHint()).toBe(CLICK_HINT_TEXT);
    expect(formatClickHint({ dim: "\x1b[2m", reset: "\x1b[0m" })).toBe(`\x1b[2m${CLICK_HINT_TEXT}\x1b[0m`);

    const geomVertical = { railWidth: 20, viewRows: 15, tabRowY: -1, cols: 120 };
    // Inside rail column
    expect(isInteractiveRegion({ x: 0, y: 0 }, geomVertical)).toBe(true);
    expect(isInteractiveRegion({ x: 19, y: 14 }, geomVertical)).toBe(true);
    // Transcript area (x >= railWidth, y < viewRows)
    expect(isInteractiveRegion({ x: 20, y: 5 }, geomVertical)).toBe(false);
    expect(isInteractiveRegion({ x: 80, y: 5 }, geomVertical)).toBe(false);
    // Below rail
    expect(isInteractiveRegion({ x: 10, y: 15 }, geomVertical)).toBe(false);

    const geomHoriz = { railWidth: 0, viewRows: 15, tabRowY: 16, cols: 80 };
    // Tab row band
    expect(isInteractiveRegion({ x: 5, y: 16 }, geomHoriz)).toBe(true);
    // Transcript area
    expect(isInteractiveRegion({ x: 5, y: 10 }, geomHoriz)).toBe(false);
  });

  it("(1) a click on a valid tab still switches and prints nothing", () => {
    const onTabClick = vi.fn();
    const output = new FakeOutput();
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

    const printed: string[] = [];
    const origSink = session.printSink;
    session.printSink = (line: string) => {
      printed.push(line);
      origSink?.(line);
    };

    // Row 1 (y=1) is beta (@beta). Col 3 (x=2) is within "@beta" segment.
    input.emit("data", "\x1b[<0;3;2M");
    expect(onTabClick).toHaveBeenCalledWith("s2");
    expect(printed).toHaveLength(0);

    loop.dispose();
  });

  it("(2) a click in the rail band that resolves to nothing prints exactly one hint", () => {
    const onTabClick = vi.fn();
    const output = new FakeOutput();
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

    const printed: string[] = [];
    const origSink = session.printSink;
    session.printSink = (line: string) => {
      printed.push(line);
      origSink?.(line);
    };

    const geom = loop.geometry();
    // Click on the rail border gutter column (x = railWidth - 1, 1-based: railWidth)
    input.emit("data", `\x1b[<0;${geom.railWidth};1M`);

    expect(onTabClick).not.toHaveBeenCalled();
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain(CLICK_HINT_TEXT);

    // (3) a second such click prints nothing (rate limited to 1 hint per session)
    input.emit("data", `\x1b[<0;${geom.railWidth};1M`);
    expect(printed).toHaveLength(1);

    loop.dispose();
  });

  it("(4) a click in the transcript area prints nothing even the first time", () => {
    const onTabClick = vi.fn();
    const output = new FakeOutput();
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

    const printed: string[] = [];
    const origSink = session.printSink;
    session.printSink = (line: string) => {
      printed.push(line);
      origSink?.(line);
    };

    // Click at x=50, y=5 (transcript viewport area)
    input.emit("data", "\x1b[<0;51;6M");

    expect(onTabClick).not.toHaveBeenCalled();
    expect(printed).toHaveLength(0);

    loop.dispose();
  });

  it("(5) no hint while suspended", () => {
    const onTabClick = vi.fn();
    const output = new FakeOutput();
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

    const printed: string[] = [];
    const origSink = session.printSink;
    session.printSink = (line: string) => {
      printed.push(line);
      origSink?.(line);
    };

    const geom = loop.geometry();
    loop.suspend();

    // While suspended, hook is disabled and suspend state prevents hint emission.
    input.emit("data", `\x1b[<0;${geom.railWidth};1M`);
    expect(printed).toHaveLength(0);

    // Decision function directly rejects suspended screen loop
    const shouldShow = shouldShowClickHint({
      event: { kind: "click", x: geom.railWidth - 1, y: 0 },
      geometry: geom,
      targetId: null,
      hintCount: 0,
      suspended: true,
    });
    expect(shouldShow).toBe(false);

    loop.resume();
    loop.dispose();
  });
});
