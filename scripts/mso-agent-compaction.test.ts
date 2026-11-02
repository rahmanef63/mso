import { describe, expect, it } from "vitest";
import {
  createCompactionWatcher,
  formatCompactionChip,
} from "./mso-agent-compaction.mjs";
import { statusParts } from "./mso-agent-status.mjs";

describe("MSO Agent session compaction visibility", () => {
  // Test 1: Compaction count increase produces exactly one transcript line, once, not per repaint.
  it("compaction count increase produces exactly one line, once, not per repaint", () => {
    const session = {
      agentSession: {
        id: "session-2026-turn",
        compactionCount: 0,
        compactThresholdTokens: 50000,
        estimatedTokens: 10000,
      },
    };
    const watcher = createCompactionWatcher(session);

    // Initial check before any compaction occurs produces no notice line.
    expect(watcher.check(session)).toBeNull();

    // Turn completes and compactionCount increments to 1.
    session.agentSession.compactionCount = 1;
    const noticeLine = watcher.check(session);
    expect(noticeLine).not.toBeNull();
    expect(noticeLine).toContain("#1");
    expect(noticeLine).toContain("50k");

    // Repaints on keystroke, mouse, or screen sync must NOT duplicate the notice.
    expect(watcher.check(session)).toBeNull();
    expect(watcher.check(session)).toBeNull();
    expect(watcher.lines()).toHaveLength(1);

    // Subsequent turn where count does not change produces no line.
    session.agentSession.estimatedTokens = 12000;
    expect(watcher.check(session)).toBeNull();
    expect(watcher.lines()).toHaveLength(1);

    // Another compaction turn increments count to 2.
    session.agentSession.compactionCount = 2;
    const secondNotice = watcher.check(session);
    expect(secondNotice).not.toBeNull();
    expect(secondNotice).toContain("#2");
    expect(watcher.check(session)).toBeNull();
    expect(watcher.lines()).toHaveLength(2);
  });

  // Test 2: No change produces no line.
  it("no change in compaction count produces no line", () => {
    const session = {
      agentSession: {
        id: "session-stable",
        compactionCount: 1,
        compactThresholdTokens: 50000,
        estimatedTokens: 25000,
      },
    };
    // Initialize watcher with existing count: past compactions must not emit events.
    const watcher = createCompactionWatcher(session);
    expect(watcher.check(session)).toBeNull();
    expect(watcher.lines()).toEqual([]);

    // Repeated repaints with unchanged count produce no lines.
    for (let i = 0; i < 5; i += 1) {
      expect(watcher.check(session)).toBeNull();
    }
    expect(watcher.lines()).toEqual([]);
  });

  // Test 3: The footer chip gains a warning tone above 80 percent and does not below it.
  it("the footer chip gains a warning tone above 80 percent and does not below it", () => {
    const colors = { warn: "\x1b[33m", reset: "\x1b[0m" };

    // Exactly 80% is not above 80%, so it must not have warning tone.
    const session80 = {
      agentSession: { compactThresholdTokens: 10000, estimatedTokens: 8000, compactionCount: 0 },
    };
    const chip80 = formatCompactionChip(session80, { colors });
    expect(chip80).not.toBeNull();
    expect(chip80).not.toContain(colors.warn);
    expect(chip80).toContain("session ~8.0k/10k");

    // 75% is below 80%, no warning tone.
    const session75 = {
      agentSession: { compactThresholdTokens: 10000, estimatedTokens: 7500, compactionCount: 0 },
    };
    const chip75 = formatCompactionChip(session75, { colors });
    expect(chip75).not.toBeNull();
    expect(chip75).not.toContain(colors.warn);
    expect(chip75).toContain("session ~7.5k/10k");

    // 85% is strictly above 80%, so it must gain the warning tone and show proximity percent.
    const session85 = {
      agentSession: { compactThresholdTokens: 10000, estimatedTokens: 8500, compactionCount: 0 },
    };
    const chip85 = formatCompactionChip(session85, { colors });
    expect(chip85).not.toBeNull();
    expect(chip85).toContain(colors.warn);
    expect(chip85).toContain(colors.reset);
    expect(chip85).toContain("85%");

    // Verify integration with statusParts: warn color is preserved in parts list.
    const parts85 = statusParts(session85, process.cwd(), { colors });
    const compactionPart = parts85.find((part) => part.includes("session ~"));
    expect(compactionPart).toBeDefined();
    expect(compactionPart).toContain(colors.warn);

    const parts75 = statusParts(session75, process.cwd(), { colors });
    const compactionPart75 = parts75.find((part) => part.includes("session ~"));
    expect(compactionPart75).toBeDefined();
    expect(compactionPart75).not.toContain(colors.warn);
  });

  // Test 4: Every field the chip shows today is still present at default, asserted against a fixture.
  it("every field the chip shows today is still present at default, asserted against a fixture", () => {
    // Default fixture representing baseline session state before compaction.
    const fixtureSession = {
      agentSession: {
        id: "20260901_120000_deadbeef",
        title: "Default baseline session",
        compactThresholdTokens: 700000,
        estimatedTokens: 120,
        compactionCount: 0,
      },
    };

    // Before this change, the chip produced exactly session ~120/700k.
    const chip = formatCompactionChip(fixtureSession);
    expect(chip).toBe("session ~120/700k");

    // Assert individual fields: prefix, estimated, slash, threshold.
    expect(chip).toContain("session ~");
    expect(chip).toContain("120");
    expect(chip).toContain("/");
    expect(chip).toContain("700k");

    // Assert that default state does not falsely report compaction.
    expect(chip).not.toContain("compacted");

    // Integration check: statusParts reproduces identical chip string.
    const parts = statusParts(fixtureSession);
    expect(parts).toContain("session ~120/700k");
  });

  // Test 5: A session with no compaction fields renders without throwing and without claiming a compaction happened.
  it("a session with no compaction fields renders without throwing and without claiming a compaction happened", () => {
    const sessionNoFields = {
      agentSession: { id: "legacy-session-no-compaction", name: "agent" },
    };

    // formatCompactionChip must return null when threshold is missing or 0.
    expect(() => formatCompactionChip(sessionNoFields)).not.toThrow();
    expect(formatCompactionChip(sessionNoFields)).toBeNull();

    // statusParts must not throw and must not contain any compaction chip or claim.
    let parts: string[] = [];
    expect(() => {
      parts = statusParts(sessionNoFields);
    }).not.toThrow();
    const joined = parts.join(" · ");
    expect(joined).not.toContain("session ~");
    expect(joined).not.toContain("compacted");

    // Watcher must also handle missing compaction fields safely without throwing.
    const watcher = createCompactionWatcher(sessionNoFields);
    expect(() => watcher.check(sessionNoFields)).not.toThrow();
    expect(watcher.check(sessionNoFields)).toBeNull();
    expect(watcher.lines()).toEqual([]);

    // Empty object or null session must also be handled gracefully.
    expect(() => formatCompactionChip(null)).not.toThrow();
    expect(formatCompactionChip(null)).toBeNull();
    expect(() => formatCompactionChip({})).not.toThrow();
    expect(formatCompactionChip({})).toBeNull();
  });

  // Additional check: When compacted at least once, chip says so briefly.
  it("when compacted at least once, chip says so briefly", () => {
    const sessionCompactedOnce = {
      agentSession: { compactThresholdTokens: 50000, estimatedTokens: 10000, compactionCount: 1 },
    };
    const chipOnce = formatCompactionChip(sessionCompactedOnce);
    expect(chipOnce).toBe("session ~10k/50k (compacted)");

    const sessionCompactedTwice = {
      agentSession: { compactThresholdTokens: 50000, estimatedTokens: 10000, compactionCount: 2 },
    };
    const chipTwice = formatCompactionChip(sessionCompactedTwice);
    expect(chipTwice).toBe("session ~10k/50k (compacted 2x)");
  });
});
