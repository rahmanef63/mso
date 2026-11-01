import { describe, expect, it } from "vitest";
import { cellWidth, stripAnsi } from "./tui/cells.mjs";
import {
  ACTIVITY_THRESHOLD_MS,
  sessionTable,
  stateOf,
} from "./mso-agent-session-list.mjs";

describe("MSO Agent session list table and state derivation", () => {
  it("renders three rows plus a header within width for three sessions", () => {
    const sessions = [
      { id: "s1", name: "eli", title: "First session", updatedAt: new Date().toISOString() },
      { id: "s2", name: "olive", title: "Second worker", updatedAt: new Date().toISOString() },
      { id: "s3", name: "milo", title: "Review auditor", updatedAt: new Date().toISOString() },
    ];
    const width = 80;
    const lines = sessionTable(sessions, { width, activeId: "s1" });

    // Expect 1 header line plus 3 session rows.
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(cellWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  it("marks the active session once and only once", () => {
    const sessions = [
      { id: "s1", name: "eli", title: "First session" },
      { id: "s2", name: "olive", title: "Second worker" },
      { id: "s3", name: "milo", title: "Review auditor" },
    ];
    const lines = sessionTable(sessions, { activeId: "s2" });

    // Header must not contain the active indicator bullet.
    expect(lines[0]).not.toContain("●");

    // Exactly one session line contains the active bullet indicator.
    const markedLines = lines.slice(1).filter((l) => l.includes("●"));
    expect(markedLines).toHaveLength(1);
    expect(markedLines[0]).toContain("@olive");

    // The other session lines must not contain the bullet.
    expect(lines[1]).not.toContain("●");
    expect(lines[3]).not.toContain("●");
  });

  it("evaluates boundary conditions for state derivation around threshold", () => {
    const now = 1_700_000_000_000;

    // Row exactly at the threshold: 60,000 ms elapsed.
    const exactThresholdRow = {
      id: "exact",
      updatedAt: new Date(now - ACTIVITY_THRESHOLD_MS).toISOString(),
    };
    const exactState = stateOf(exactThresholdRow, now);
    expect(exactState.state).toBe("working");
    expect(exactState.label).toBe("working");

    // Row just past the threshold: 60,001 ms elapsed.
    const pastThresholdRow = {
      id: "past",
      updatedAt: new Date(now - ACTIVITY_THRESHOLD_MS - 1).toISOString(),
    };
    const pastState = stateOf(pastThresholdRow, now);
    expect(pastState.state).toBe("idle");
    expect(pastState.label).toBe("idle");
  });

  it("renders documented fallback text for missing or unknown state and never green idle", () => {
    const now = 1_700_000_000_000;
    const missingStateRow = { id: "s-unknown", name: "ghost", title: "No timestamp" };

    const state = stateOf(missingStateRow, now);
    expect(state.state).toBe("unknown");
    expect(state.label).toBe("no activity data");

    const colors = {
      green: "\x1b[32m",
      dim: "\x1b[2m",
      reset: "\x1b[0m",
      bold: "\x1b[1m",
    };
    const lines = sessionTable([missingStateRow], { colors, width: 80, now });
    expect(lines).toHaveLength(2);

    const dataRow = lines[1];
    expect(dataRow).toContain("no activity data");
    expect(dataRow).not.toContain("idle");
    // Ensure green is never applied to the fallback text.
    expect(dataRow).not.toContain(`${colors.green}no activity data`);
    expect(dataRow).not.toContain(`${colors.green}idle`);
  });

  it("emits no ANSI escape codes when no colors are passed", () => {
    const sessions = [
      { id: "s1", name: "eli", title: "First session", updatedAt: new Date().toISOString() },
      { id: "s2", name: "olive", title: "Second session", updatedAt: new Date().toISOString() },
    ];
    const lines = sessionTable(sessions, { activeId: "s1", width: 80 });

    for (const line of lines) {
      expect(line).toBe(stripAnsi(line));
      expect(line).not.toMatch(/\x1b\[/);
    }
  });

  it("renders a single clear line when session list is empty", () => {
    const emptyLines = sessionTable([]);
    expect(emptyLines).toHaveLength(1);
    expect(emptyLines[0]).toBe("No active sessions.");

    const nullLines = sessionTable(null as unknown as []);
    expect(nullLines).toHaveLength(1);
    expect(nullLines[0]).toBe("No active sessions.");
  });
});
