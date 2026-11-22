import { describe, expect, it } from "vitest";
import {
  tabAtPoint,
  tabLayout,
  tabRailLines,
  tabRow,
  tabStatusGlyph,
} from "./mso-agent-chrome.mjs";
import { SETTINGS } from "./mso-agent-settings-entries.mjs";
import { applySettings } from "./mso-agent-cmd-settings.mjs";

describe("MSO Agent TUI status indicators on tabs", () => {
  const sessions = [
    { id: "s1", name: "alpha", status: "working" },
    { id: "s2", name: "beta", status: "idle" },
    { id: "s3", name: "gamma", updatedAt: "2026-11-02T12:00:00.000Z" },
  ];

  // Requirement 1: Default numbers output is byte-identical to recorded fixture.
  it("default numbers output is byte-identical to a recorded fixture", () => {
    const fixtureHorizontal = "● @alpha  @beta  @gamma";
    const defaultRow = tabRow(sessions, "s1");
    const explicitNumbersRow = tabRow(sessions, "s1", { indicators: "numbers" });

    expect(defaultRow).toBe(fixtureHorizontal);
    expect(explicitNumbersRow).toBe(fixtureHorizontal);

    const fixtureVertical = [
      "● @alpha           │",
      "@beta              │",
      "@gamma             │",
    ];
    const defaultRail = tabRailLines(sessions, "s1", { width: 20, rows: 3 });
    const explicitRail = tabRailLines(sessions, "s1", { width: 20, rows: 3, indicators: "numbers" });

    expect(defaultRail).toEqual(fixtureVertical);
    expect(explicitRail).toEqual(fixtureVertical);
  });

  // Requirement 2: status shows a glyph for an explicit working status.
  it("status shows a glyph for an explicit working status", () => {
    const workingList = [
      { id: "w1", name: "work-one", status: "working" },
      { id: "w2", name: "work-two", status: "busy" },
      { id: "w3", name: "work-three", status: "running" },
    ];
    for (const s of workingList) {
      expect(tabStatusGlyph(s)).toBe("●");
      const row = tabRow([s], s.id, { indicators: "status" });
      expect(row).toBe(`● @${s.name}`);
    }
  });

  // Requirement 3: status shows the unknown placeholder, not a guess, for a row with only updatedAt.
  it("status shows the unknown placeholder, not a guess, for a row with only updatedAt", () => {
    const timestampOnly = {
      id: "u1",
      name: "timestamped",
      updatedAt: "2026-11-02T12:00:00.000Z",
    };

    // The glyph must be a space character, never a guessed working or idle dot.
    expect(tabStatusGlyph(timestampOnly)).toBe(" ");

    const row = tabRow([timestampOnly], "u1", { indicators: "status" });
    // Stable column width: one space glyph placeholder followed by one delimiter space before @
    expect(row).toBe("  @timestamped");
    expect(row).not.toContain("●");
    expect(row).not.toContain("○");
  });

  // Requirement 4: a row with turnActive: true shows the working glyph.
  it("a row with turnActive: true shows the working glyph", () => {
    const activeTurn = {
      id: "t1",
      name: "turn-session",
      turnActive: true,
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    expect(tabStatusGlyph(activeTurn)).toBe("●");

    const row = tabRow([activeTurn], "t1", { indicators: "status" });
    expect(row).toBe("● @turn-session");
  });

  // Requirement 5: an error status shows the error glyph.
  it("an error status shows the error glyph", () => {
    const erroredSessions = [
      { id: "e1", name: "err-explicit", status: "error" },
      { id: "e2", name: "err-errored", status: "errored" },
      { id: "e3", name: "err-failed", status: "failed" },
      { id: "e4", name: "err-boolean", error: true },
    ];
    for (const s of erroredSessions) {
      expect(tabStatusGlyph(s)).toBe("!");
      const row = tabRow([s], s.id, { indicators: "status" });
      expect(row).toBe(`! @${s.name}`);
    }
  });

  // Requirement 6: tabAtPoint still resolves every visible cell correctly in both orientations with the indicator on.
  it("tabAtPoint still resolves every visible cell correctly in both orientations with the indicator on", () => {
    const testSessions = [
      { id: "s1", name: "alpha", status: "working" },
      { id: "s2", name: "beta", status: "idle" },
      { id: "s3", name: "gamma", updatedAt: "2026-11-02T12:00:00.000Z" },
    ];

    // Horizontal resolution test
    const horiz = tabLayout(testSessions, "s1", { indicators: "status", width: 80 });
    for (const seg of horiz.segments) {
      if (seg.type === "tab") {
        for (let x = seg.start; x < seg.end; x++) {
          const hit = tabAtPoint(testSessions, "s1", { x, y: 0, tabRow: 0, width: 80, indicators: "status" });
          expect(hit).toBe(seg.id);
        }
      }
    }

    // Vertical resolution test
    const vert = tabLayout(testSessions, "s1", { indicators: "status", orientation: "vertical", width: 20, rows: 5 });
    for (const seg of vert.segments) {
      if (seg.type === "tab") {
        for (let x = seg.start; x < seg.end; x++) {
          const hit = tabAtPoint(testSessions, "s1", { x, y: seg.row, orientation: "vertical", width: 20, rows: 5, indicators: "status" });
          expect(hit).toBe(seg.id);
        }
      }
    }
  });

  // Settings registry and propagation test
  it("declares tabs.indicators in SETTINGS and applies it via applySettings", () => {
    const entry = SETTINGS.find((s) => s.path === "tabs.indicators");
    expect(entry).toBeDefined();
    expect(entry?.default).toBe("numbers");
    expect(entry?.values).toEqual(["status", "numbers"]);

    const session: Record<string, any> = {};
    applySettings(session, { "tabs.indicators": "status" });
    expect(session.tabsIndicators).toBe("status");
  });

  // Renders working, idle, and unknown in row and rail
  it("renders status indicator for working, idle, and unknown session in row and rail", () => {
    const trio = [
      { id: "s1", name: "alpha", status: "working" },
      { id: "s2", name: "beta", status: "idle" },
      { id: "s3", name: "gamma", updatedAt: "2026-11-02T12:00:00.000Z" },
    ];
    const row = tabRow(trio, "s1", { indicators: "status" });
    expect(row).toBe("● @alpha  ○ @beta    @gamma");

    const rail = tabRailLines(trio, "s1", { indicators: "status", width: 20, rows: 3 });
    expect(rail).toEqual([
      "● @alpha           │",
      "○ @beta            │",
      "  @gamma           │",
    ]);
  });
});
