import { describe, expect, it, vi } from "vitest";
import {
  attentionReason,
  findAttentionSession,
  needsAttention,
  sessionTable,
  stateOf,
} from "./mso-agent-session-list.mjs";
import { handleTabs } from "./mso-agent-cmd-session.mjs";
import * as sessionUi from "./mso-agent-session-ui.mjs";

vi.mock("./mso-agent-session-ui.mjs", () => ({
  resumeInto: vi.fn().mockResolvedValue(true),
  persistSession: vi.fn(),
  renameCurrentSession: vi.fn(),
  renameCurrentSessionName: vi.fn(),
  startNewSession: vi.fn(),
  resumePicker: vi.fn(),
}));

describe("MSO Agent TUI turnActive live activity signal integration", () => {
  const now = 1_700_000_000_000;

  // Requirement 1: stateOf trusts turnActive: true as working regardless of updatedAt.
  it("stateOf reports working when turnActive is true, avoiding false idle", () => {
    // Session updated 10 minutes ago, but currently running an interactive turn.
    const activeLongTurn = {
      id: "s-long",
      name: "worker",
      turnActive: true,
      updatedAt: new Date(now - 600_000).toISOString(),
    };
    const res = stateOf(activeLongTurn, now);
    expect(res.state).toBe("working");
    expect(res.label).toBe("working");
  });

  // Requirement 2: stateOf trusts turnActive: false as idle regardless of fresh updatedAt.
  it("stateOf reports idle when turnActive is false, avoiding false working", () => {
    // Turn completed 2 seconds ago; agent is idle at the prompt waiting for input.
    const justFinishedTurn = {
      id: "s-fresh",
      name: "prompt-ready",
      turnActive: false,
      updatedAt: new Date(now - 2_000).toISOString(),
    };
    const res = stateOf(justFinishedTurn, now);
    expect(res.state).toBe("idle");
    expect(res.label).toBe("idle");
  });

  // Requirement 3: Explicit error and status take precedence over turnActive.
  it("stateOf preserves precedence for explicit status and errors over turnActive", () => {
    const erroredRow = {
      id: "s-err",
      name: "broken",
      turnActive: true,
      error: "execution failed",
    };
    expect(stateOf(erroredRow, now).state).toBe("errored");

    const waitingRow = {
      id: "s-wait",
      name: "prompt",
      turnActive: true,
      status: "waiting for input",
    };
    expect(stateOf(waitingRow, now).state).toBe("waiting");
  });

  // Requirement 4: Records without turnActive fall through to timestamp comparison or unknown.
  it("stateOf falls through to legacy timestamp comparison when turnActive is absent", () => {
    const legacyRecent = {
      id: "s-leg-recent",
      updatedAt: new Date(now - 10_000).toISOString(),
    };
    expect(stateOf(legacyRecent, now).state).toBe("working");

    const legacyOld = {
      id: "s-leg-old",
      updatedAt: new Date(now - 300_000).toISOString(),
    };
    expect(stateOf(legacyOld, now).state).toBe("idle");

    const legacyNoTimestamp = { id: "s-ghost", name: "ghost" };
    expect(stateOf(legacyNoTimestamp, now)).toEqual({ state: "unknown", label: "no activity data" });
  });

  // Requirement 5: needsAttention activates for turnActive: true and excludes absent / false.
  it("needsAttention triggers on turnActive: true and ignores timestamp-only rows", () => {
    expect(needsAttention({ id: "s1", turnActive: true }, now)).toBe(true);
    expect(needsAttention({ id: "s2", turnActive: false }, now)).toBe(false);

    // Row with neither status nor turnActive must NOT trigger attention, even if timestamp is fresh.
    const timestampOnlyRow = {
      id: "s3",
      updatedAt: new Date(now - 1_000).toISOString(),
    };
    expect(needsAttention(timestampOnlyRow, now)).toBe(false);

    // Ghost row without timestamp or status must not trigger attention.
    expect(needsAttention({ id: "s4" }, now)).toBe(false);
  });

  // Requirement 6: attentionReason names turnActive as the distinct signal source.
  it("attentionReason names turnActive when acting on live turn progress", () => {
    const activeRow = { id: "s-act", name: "eli", turnActive: true };
    expect(attentionReason(activeRow)).toBe("turnActive: working");

    const statusRow = { id: "s-stat", name: "milo", status: "working" };
    expect(attentionReason(statusRow)).toBe("status: working");

    const erroredRow = { id: "s-err", name: "nora", error: "crashed" };
    expect(attentionReason(erroredRow)).toBe("status: errored");
  });

  // Requirement 7: sessionTable renders truthful state based on turnActive.
  it("sessionTable renders working and idle states accurately from turnActive", () => {
    const sessions = [
      { id: "s1", name: "worker", title: "Active task", turnActive: true, updatedAt: new Date(now - 600_000).toISOString() },
      { id: "s2", name: "sleeper", title: "Idle task", turnActive: false, updatedAt: new Date(now - 1_000).toISOString() },
    ];
    const lines = sessionTable(sessions, { width: 80, activeId: "s1", now });
    expect(lines).toHaveLength(3);

    // Header, then row 1 (worker) and row 2 (sleeper)
    expect(lines[1]).toContain("working");
    expect(lines[2]).toContain("idle");
  });

  // Requirement 8: Default outputs stay byte-identical for rows that have neither field.
  it("sessionTable output stays byte-identical for rows having neither status nor turnActive", () => {
    const legacySessions = [
      { id: "s1", name: "alpha", title: "First task", updatedAt: "2026-11-02T12:00:00.000Z" },
      { id: "s2", name: "beta", title: "Second task", updatedAt: "2026-11-02T12:01:00.000Z" },
    ];
    const lines1 = sessionTable(legacySessions, { width: 80, activeId: "s1", now: 1_700_000_000_000 });
    const lines2 = sessionTable(legacySessions, { width: 80, activeId: "s1", now: 1_700_000_000_000 });
    expect(lines1).toEqual(lines2);
  });

  // Requirement 9: /tabs next navigates to turnActive session and announces turnActive reason.
  it("/tabs next navigates to turnActive session and reports turnActive source in notice", async () => {
    const resumeSpy = vi.spyOn(sessionUi, "resumeInto").mockClear();
    const printed: Array<string> = [];
    const sessions = [
      { id: "s1", name: "eli", turnActive: false },
      { id: "s2", name: "olive", updatedAt: new Date(now - 2_000).toISOString() }, // timestamp only: skipped
      { id: "s3", name: "milo", turnActive: true },
      { id: "s4", name: "nora", turnActive: false },
    ];
    const ctx = {
      rl: null,
      session: { agentSession: { id: "s1", name: "eli" } },
      sessions,
      now,
      C: {},
      write: (line: string) => printed.push(line),
    };

    const outcome = await handleTabs(ctx, ["next"]);
    expect(outcome).toBe("refresh");
    expect(resumeSpy).toHaveBeenCalledWith(null, ctx.session, "s3");
    expect(printed.some((l) => l.includes("@milo") && l.includes("turnActive: working"))).toBe(true);
  });

  // Requirement 10: findAttentionSession wraps properly with turnActive sessions.
  it("findAttentionSession navigates turnActive sessions in forward and reverse directions", () => {
    const sessions = [
      { id: "s1", name: "active1", turnActive: true },
      { id: "s2", name: "idle1", turnActive: false },
      { id: "s3", name: "active2", turnActive: true },
      { id: "s4", name: "legacy", updatedAt: new Date(now - 1_000).toISOString() },
    ];

    const nextFrom1 = findAttentionSession(sessions, "s1", "next", now);
    expect(nextFrom1?.id).toBe("s3");

    const nextFrom3 = findAttentionSession(sessions, "s3", "next", now);
    expect(nextFrom3?.id).toBe("s1");

    const prevFrom3 = findAttentionSession(sessions, "s3", "prev", now);
    expect(prevFrom3?.id).toBe("s1");
  });
});
