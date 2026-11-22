import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cellWidth, stripAnsi } from "./tui/cells.mjs";
import { cyclePane, formatPaneTitle, paneKinds, paneLines } from "./mso-agent-pane.mjs";
import { handleSessionCommand } from "./mso-agent-cmd-session.mjs";
import { mountScreenLoop } from "./mso-agent-screen-loop.mjs";

describe("mso-agent-pane-slots", () => {
  // Test 1: unpinned /pane cycles and wraps
  it("1. unpinned /pane cycles through every kind and wraps", async () => {
    const kinds = paneKinds();
    expect(kinds).toEqual(["todos", "diff", "files", "mcp", "context", "off"]);

    // Pure cyclePane helper checks
    expect(cyclePane("todos", { pinned: false })).toBe("diff");
    expect(cyclePane("diff", { pinned: false })).toBe("files");
    expect(cyclePane("files", { pinned: false })).toBe("mcp");
    expect(cyclePane("mcp", { pinned: false })).toBe("context");
    expect(cyclePane("context", { pinned: false })).toBe("off");
    expect(cyclePane("off", { pinned: false })).toBe("todos");

    // Command dispatch cycling across a session
    const session: any = { paneKind: "off", panePinned: false };
    const logs: string[] = [];
    const ctx = { session, C: {}, write: (s: string) => logs.push(s) };

    const expectedOrder = ["todos", "diff", "files", "mcp", "context", "off", "todos"];
    for (const expected of expectedOrder) {
      const res = await handleSessionCommand(ctx, "/pane", []);
      expect(res).toBe("handled");
      expect(session.paneKind).toBe(expected);
      expect(logs[logs.length - 1]).toContain(`side pane: ${expected}`);
    }
  });

  // Test 2: pin then /pane does not move
  it("2. pin then /pane does not move and reports the pinned slot", async () => {
    const session: any = { paneKind: "diff", panePinned: false };
    const logs: string[] = [];
    const ctx = { session, C: {}, write: (s: string) => logs.push(s) };

    // Explicit pin locks the current slot
    const resPin = await handleSessionCommand(ctx, "/pane", ["pin"]);
    expect(resPin).toBe("handled");
    expect(session.panePinned).toBe(true);
    expect(session.paneKind).toBe("diff");
    expect(logs[logs.length - 1]).toContain("side pane: diff (pinned)");

    // Bare /pane while pinned reports without advancing
    const resBare1 = await handleSessionCommand(ctx, "/pane", []);
    expect(resBare1).toBe("handled");
    expect(session.paneKind).toBe("diff");
    expect(logs[logs.length - 1]).toContain("side pane: diff (pinned)");

    const resBare2 = await handleSessionCommand(ctx, "/pane", []);
    expect(resBare2).toBe("handled");
    expect(session.paneKind).toBe("diff");
    expect(logs[logs.length - 1]).toContain("side pane: diff (pinned)");

    // Pure helper keeps current kind when pinned
    expect(cyclePane("diff", { pinned: true })).toBe("diff");
    expect(cyclePane("context", { pinned: true })).toBe("context");
  });

  // Test 3: pin then /pane todos restores unpinned cycling
  it("3. pin then /pane todos sets the slot and restores non-pinned cycling", async () => {
    const session: any = { paneKind: "diff", panePinned: true };
    const logs: string[] = [];
    const ctx = { session, C: {}, write: (s: string) => logs.push(s) };

    // Direct slot selection sets the requested kind and restores unpinned cycling
    const resSelect = await handleSessionCommand(ctx, "/pane", ["todos"]);
    expect(resSelect).toBe("handled");
    expect(session.paneKind).toBe("todos");
    expect(session.panePinned).toBe(false);
    expect(logs[logs.length - 1]).toContain("side pane: todos");

    // Subsequent bare /pane advances to diff because cycling was restored
    const resNext = await handleSessionCommand(ctx, "/pane", []);
    expect(resNext).toBe("handled");
    expect(session.paneKind).toBe("diff");
    expect(logs[logs.length - 1]).toContain("side pane: diff");
  });

  // Test 4: /pane off clears both
  it("4. /pane off clears both the pane and the pin", async () => {
    const session: any = { paneKind: "mcp", panePinned: true };
    const logs: string[] = [];
    const ctx = { session, C: {}, write: (s: string) => logs.push(s) };

    const resOff = await handleSessionCommand(ctx, "/pane", ["off"]);
    expect(resOff).toBe("handled");
    expect(session.paneKind).toBe("off");
    expect(session.panePinned).toBe(false);
    expect(logs[logs.length - 1]).toContain("side pane: off");

    // Once turned off, bare /pane cycles cleanly to todos without staying pinned
    const resCycle = await handleSessionCommand(ctx, "/pane", []);
    expect(resCycle).toBe("handled");
    expect(session.paneKind).toBe("todos");
    expect(session.panePinned).toBe(false);
  });

  // Test 5: pinned marker appears in the pane title and line still fits width
  it("5. pinned marker appears in the pane title and every line fits width", () => {
    expect(formatPaneTitle("Todos", { pinned: true })).toBe("Todos [pinned]");
    expect(formatPaneTitle("Todos", { pinned: false })).toBe("Todos");
    expect(formatPaneTitle("", { pinned: true })).toBe("");

    const widths = [12, 30, 42, 50];
    const rows = [3, 4, 8, 16];

    for (const w of widths) {
      for (const r of rows) {
        const lines = paneLines({
          kind: "todos",
          pinned: true,
          width: w,
          rows: r,
        });
        expect(lines.length).toBe(r);
        for (const line of lines) {
          expect(cellWidth(line)).toBe(w);
        }
        if (r >= 3 && w >= 30) {
          const stripped = lines.map((l) => stripAnsi(l)).join("\n");
          expect(stripped).toContain("[pinned]");
        }
      }
    }

    // Verify session.panePinned drives pinned marker in paneLines
    const sessionLines = paneLines({
      kind: "context",
      session: { panePinned: true },
      width: 40,
      rows: 6,
    });
    expect(sessionLines.map((l) => stripAnsi(l)).join("\n")).toContain("[pinned]");

    // Off pane never displays a pinned marker
    const offLines = paneLines({
      kind: "off",
      pinned: true,
      width: 40,
      rows: 6,
    });
    expect(offLines.map((l) => stripAnsi(l)).join("\n")).not.toContain("[pinned]");
  });

  // Test 6: session.paneKind remains the only field that decides rendering
  it("6. session.paneKind remains the only field that decides rendering", () => {
    const fakeStdout: any = { isTTY: true, columns: 120, rows: 24, write() {}, on() {}, off() {} };
    const session: any = { paneKind: "off", panePinned: true };

    const loop = mountScreenLoop({
      session,
      enabled: true,
      output: fakeStdout,
    });

    // Pinned alone does not cause pane rendering when paneKind is off
    const geomOff = loop.geometry();
    expect(geomOff.kind).toBeNull();
    expect(geomOff.pWidth).toBe(0);

    // Unpinned todos renders side pane
    session.paneKind = "todos";
    session.panePinned = false;
    const geomUnpinned = loop.geometry();
    expect(geomUnpinned.kind).toBe("todos");
    expect(geomUnpinned.pWidth).toBe(42);

    // Pinning does not alter rendering geometry or kind choice
    session.panePinned = true;
    const geomPinned = loop.geometry();
    expect(geomPinned.kind).toBe("todos");
    expect(geomPinned.pWidth).toBe(42);

    // Assert screen loop source does not consult panePinned or paneSlot
    const loopSrc = readFileSync(resolve(__dirname, "mso-agent-screen-loop.mjs"), "utf8");
    expect(loopSrc).not.toContain("panePinned");
    expect(loopSrc).not.toContain("paneSlot");
  });
});
