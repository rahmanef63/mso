import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { tabAtPoint, tabRow } from "./mso-agent-chrome.mjs";
import {
  disableMouse,
  enableMouse,
  handleMouse,
  MOUSE_OFF,
  MOUSE_ON,
  parseMouseChunk,
} from "./mso-agent-mouse.mjs";
import { mountScreenLoop } from "./mso-agent-screen-loop.mjs";

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

describe("MSO Agent TUI mouse support", () => {
  it("parse a press, a release, a wheel up and a wheel down", () => {
    // Left button press at col 10, row 5 (1-based from terminal)
    const press = parseMouseChunk("\x1b[<0;10;5M");
    expect(press).toHaveLength(1);
    expect(press[0]).toEqual({
      kind: "click", button: "left", x: 9, y: 4, shift: false, alt: false, ctrl: false,
    });

    // Left button release at col 10, row 5
    const release = parseMouseChunk("\x1b[<0;10;5m");
    expect(release).toHaveLength(1);
    expect(release[0]).toEqual({
      kind: "release", button: "left", x: 9, y: 4, shift: false, alt: false, ctrl: false,
    });

    // Wheel up at col 20, row 15
    const wheelUp = parseMouseChunk("\x1b[<64;20;15M");
    expect(wheelUp).toHaveLength(1);
    expect(wheelUp[0]).toEqual({
      kind: "wheel", button: "up", x: 19, y: 14, shift: false, alt: false, ctrl: false,
    });

    // Wheel down at col 20, row 15
    const wheelDown = parseMouseChunk("\x1b[<65;20;15M");
    expect(wheelDown).toHaveLength(1);
    expect(wheelDown[0]).toEqual({
      kind: "wheel", button: "down", x: 19, y: 14, shift: false, alt: false, ctrl: false,
    });
  });

  it("a chunk with two sequences returns two events", () => {
    const chunk = "\x1b[<0;10;5M\x1b[<0;10;5m";
    const events = parseMouseChunk(chunk);
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe("click");
    expect(events[1].kind).toBe("release");
  });

  it("a non-mouse chunk returns []", () => {
    expect(parseMouseChunk("plain user text")).toEqual([]);
    expect(parseMouseChunk("\x1b[A")).toEqual([]);
    expect(parseMouseChunk("")).toEqual([]);
  });

  it("a malformed sequence does not throw", () => {
    expect(() => parseMouseChunk("\x1b[<not;a;numberM")).not.toThrow();
    expect(parseMouseChunk("\x1b[<not;a;numberM")).toEqual([]);
    expect(() => parseMouseChunk(null as never)).not.toThrow();
    expect(parseMouseChunk(null as never)).toEqual([]);
  });

  it("wheel up and wheel down each move the offset by 3 and are consumed", () => {
    const scroll = { offset: 0 };
    const upConsumed = handleMouse(scroll, { kind: "wheel", button: "up" });
    expect(upConsumed).toBe(true);
    expect(scroll.offset).toBe(3);

    const downConsumed = handleMouse(scroll, { kind: "wheel", button: "down" });
    expect(downConsumed).toBe(true);
    expect(scroll.offset).toBe(0);

    // Non-wheel event must not be consumed or alter offset
    const clickConsumed = handleMouse(scroll, { kind: "click", button: "left" });
    expect(clickConsumed).toBe(false);
    expect(scroll.offset).toBe(0);
  });

  it("the tab hit test returns the correct session id for a click on each tab of a 3-tab row including the +N case", () => {
    const sessions = [
      { id: "s1", name: "alpha" },
      { id: "s2", name: "beta" },
      { id: "s3", name: "gamma" },
    ];

    // Width 20 forces middle tab to be dropped with +1 marker: "● @alpha  +1  @gamma"
    const rendered = tabRow(sessions, "s1", { width: 20 });
    expect(rendered).toBe("● @alpha  +1  @gamma");

    // Click on visible tab 1 (@alpha: cols 0-7) returns s1
    expect(tabAtPoint(sessions, "s1", { x: 0, y: 0, width: 20 })).toBe("s1");
    expect(tabAtPoint(sessions, "s1", { x: 7, y: 0, width: 20 })).toBe("s1");

    // Click on visible tab 3 (@gamma: cols 14-19) returns s3
    expect(tabAtPoint(sessions, "s1", { x: 14, y: 0, width: 20 })).toBe("s3");
    expect(tabAtPoint(sessions, "s1", { x: 19, y: 0, width: 20 })).toBe("s3");

    // Clicking each position of the +1 marker (cols 10 and 11) returns null
    expect(tabAtPoint(sessions, "s1", { x: 10, y: 0, width: 20 })).toBe(null);
    expect(tabAtPoint(sessions, "s1", { x: 11, y: 0, width: 20 })).toBe(null);

    // Separators (cols 8-9 and 12-13) return null
    expect(tabAtPoint(sessions, "s1", { x: 8, y: 0, width: 20 })).toBe(null);
    expect(tabAtPoint(sessions, "s1", { x: 13, y: 0, width: 20 })).toBe(null);
  });

  it("a click below the tab row returns null", () => {
    const sessions = [{ id: "s1", name: "main" }];
    // Tab row is at y: 0; click at y: 1 is below the tab row
    expect(tabAtPoint(sessions, "s1", { x: 2, y: 1, tabRow: 0 })).toBe(null);
    expect(tabAtPoint(sessions, "s1", { x: 2, y: 5, tabRow: 2 })).toBe(null);
  });

  it("disabled mode writes nothing", () => {
    const output = new FakeOutput();
    const session = { agentSession: { id: "s1", name: "test" }, history: [] };
    const loop = mountScreenLoop({ enabled: false, session, output });

    expect(loop.active).toBe(false);
    expect(output.chunks).toHaveLength(0);

    loop.paint();
    loop.sync();
    loop.follow();
    loop.dispose();

    expect(output.chunks).toHaveLength(0);
  });

  it("enableMouse and disableMouse are idempotent and write expected escape codes", () => {
    const output = new FakeOutput();
    expect(enableMouse(output)).toBe(true);
    expect(output.chunks).toEqual([MOUSE_ON]);

    // Second call is a no-op
    expect(enableMouse(output)).toBe(false);
    expect(output.chunks).toEqual([MOUSE_ON]);

    // Disable writes MOUSE_OFF
    expect(disableMouse(output)).toBe(true);
    expect(output.chunks).toEqual([MOUSE_ON, MOUSE_OFF]);

    // Second disable is a no-op
    expect(disableMouse(output)).toBe(false);
    expect(output.chunks).toEqual([MOUSE_ON, MOUSE_OFF]);
  });

  it("dispose disables mouse reporting and restores input.emit", () => {
    const output = new FakeOutput();
    const input = new EventEmitter();
    const originalEmit = input.emit;
    const session = { agentSession: { id: "s1", name: "test" }, history: [] };

    const loop = mountScreenLoop({ enabled: true, session, output, input });
    expect(output.chunks[0]).toBe(MOUSE_ON);
    expect(input.emit).not.toBe(originalEmit);

    loop.dispose();
    expect(input.emit).toBe(originalEmit);
    expect(output.chunks).toContain(MOUSE_OFF);
  });
});
