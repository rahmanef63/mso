import { describe, expect, it, vi } from "vitest";
import { needsAttention, attentionReason, findAttentionSession } from "./mso-agent-session-list.mjs";
import { handleTabs, handleSessionCommand } from "./mso-agent-cmd-session.mjs";
import * as sessionUi from "./mso-agent-session-ui.mjs";

vi.mock("./mso-agent-session-ui.mjs", () => ({
  resumeInto: vi.fn().mockResolvedValue(true),
  persistSession: vi.fn(),
  renameCurrentSession: vi.fn(),
  renameCurrentSessionName: vi.fn(),
  startNewSession: vi.fn(),
  resumePicker: vi.fn(),
}));

describe("MSO Agent session unread and attention navigation", () => {
  // The premise was corrected after docs/AGENT-ACTIVITY-SIGNAL.md: updatedAt is written at turn
  // COMPLETION, so a fresh timestamp means the turn just ended, not that work is happening. Only an
  // explicit status is trusted.
  it("needsAttention trusts only an explicit status, never a timestamp", () => {
    const now = 1_700_000_000_000;
    // Updated 5s ago is within the 60s activity threshold.
    // A turn that just finished leaves a fresh timestamp while the agent sits idle at the prompt.
    const justFinished = { id: "s-active", name: "milo", updatedAt: new Date(now - 5_000).toISOString() };
    expect(needsAttention(justFinished, now)).toBe(false);
    // A turn streaming for three minutes still carries the previous turn's timestamp.
    const stillWorking = { id: "s-busy", name: "lara", updatedAt: new Date(now - 180_000).toISOString() };
    expect(needsAttention(stillWorking, now)).toBe(false);
    // An explicit status is the only trustworthy source.
    expect(needsAttention({ id: "s-x", name: "eli", status: "working" }, now)).toBe(true);

    // Updated 10m ago has expired past the 60s activity threshold.
    const row10m = { id: "s-idle", name: "olive", updatedAt: new Date(now - 600_000).toISOString() };
    expect(needsAttention(row10m, now)).toBe(false);

    // Missing activity data is excluded: jumping on a guess violates honesty.
    const rowNoTime = { id: "s-ghost", name: "ghost" };
    expect(needsAttention(rowNoTime, now)).toBe(false);

    // Explicit error states also require operator attention.
    const rowErr = { id: "s-err", name: "broken", error: "Turn execution failed" };
    expect(needsAttention(rowErr, now)).toBe(true);
  });

  // Requirement 2: /tabs next finds the next working session and skips idle ones.
  it("/tabs next finds the next working session and skips idle ones", async () => {
    const now = 1_700_000_000_000;
    const resumeSpy = vi.spyOn(sessionUi, "resumeInto").mockClear();
    const printed: Array<string> = [];
    const sessions = [
      { id: "s1", name: "eli", status: "idle" },
      { id: "s2", name: "olive", status: "idle" },
      { id: "s3", name: "milo", status: "working" },
      { id: "s4", name: "nora", status: "idle" },
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
    expect(printed.some((l) => l.includes("@milo") && l.includes("working"))).toBe(true);
  });

  // Requirement 3: /tabs next wraps once across the list.
  it("/tabs next wraps once from the end of the list", async () => {
    const now = 1_700_000_000_000;
    const resumeSpy = vi.spyOn(sessionUi, "resumeInto").mockClear();
    const printed: Array<string> = [];
    const sessions = [
      { id: "s1", name: "eli", status: "working" },
      { id: "s2", name: "olive", status: "idle" },
      { id: "s3", name: "nora", status: "idle" },
    ];
    // Active on s2: next checks s3 (idle), then wraps to s1 (working).
    const ctx = {
      rl: null,
      session: { agentSession: { id: "s2", name: "olive" } },
      sessions,
      now,
      C: {},
      write: (line: string) => printed.push(line),
    };

    const outcome = await handleTabs(ctx, ["next"]);
    expect(outcome).toBe("refresh");
    expect(resumeSpy).toHaveBeenCalledWith(null, ctx.session, "s1");
    expect(printed.some((l) => l.includes("@eli") && l.includes("working"))).toBe(true);
  });

  // Requirement 4: when none need attention it reports and does not switch.
  it("reports and does not switch when no sessions need attention", async () => {
    const now = 1_700_000_000_000;
    const resumeSpy = vi.spyOn(sessionUi, "resumeInto").mockClear();
    const printed: Array<string> = [];
    const sessions = [
      { id: "s1", name: "eli", status: "idle" },
      { id: "s2", name: "olive", status: "idle" },
      { id: "s3", name: "ghost" },
    ];
    const ctx = {
      rl: null,
      session: { agentSession: { id: "s2", name: "olive" } },
      sessions,
      now,
      C: {},
      write: (line: string) => printed.push(line),
    };

    const outcome = await handleTabs(ctx, ["next"]);
    expect(outcome).toBe("handled");
    expect(resumeSpy).not.toHaveBeenCalled();
    expect(printed).toContain("no sessions need attention");
  });

  // Requirement 5: /tabs prev mirrors navigation in reverse.
  it("/tabs prev mirrors navigation in reverse and wraps backward", async () => {
    const now = 1_700_000_000_000;
    const resumeSpy = vi.spyOn(sessionUi, "resumeInto").mockClear();
    const printed: Array<string> = [];
    const sessions = [
      { id: "s1", name: "eli", status: "working" },
      { id: "s2", name: "olive", status: "idle" },
      { id: "s3", name: "milo", status: "idle" },
      { id: "s4", name: "nora", status: "working" },
    ];
    // Active on s3: prev checks s2 (idle), then finds s1 (working).
    const ctx = {
      rl: null,
      session: { agentSession: { id: "s3", name: "milo" } },
      sessions,
      now,
      C: {},
      write: (line: string) => printed.push(line),
    };

    const outcome = await handleTabs(ctx, ["prev"]);
    expect(outcome).toBe("refresh");
    expect(resumeSpy).toHaveBeenCalledWith(null, ctx.session, "s1");
    expect(printed.some((l) => l.includes("@eli") && l.includes("working"))).toBe(true);

    // Active on s1: prev wraps backward to s4 (working).
    printed.length = 0;
    resumeSpy.mockClear();
    ctx.session.agentSession.id = "s1";
    ctx.session.agentSession.name = "eli";

    const outcomeWrap = await handleTabs(ctx, ["prev"]);
    expect(outcomeWrap).toBe("refresh");
    expect(resumeSpy).toHaveBeenCalledWith(null, ctx.session, "s4");
    expect(printed.some((l) => l.includes("@nora") && l.includes("working"))).toBe(true);
  });

  // Requirement 6: /tabs 2 and /tabs <name> still switch as before.
  it("/tabs 2 and /tabs <name> switch directly by index or name", async () => {
    const resumeSpy = vi.spyOn(sessionUi, "resumeInto").mockClear();
    const printed: Array<string> = [];
    const sessions = [
      { id: "s1", name: "eli", title: "First session" },
      { id: "s2", name: "olive", title: "Second session" },
      { id: "s3", name: "milo", title: "Third session" },
    ];
    const ctx = {
      rl: null,
      session: { agentSession: { id: "s1", name: "eli" } },
      sessions,
      C: {},
      write: (line: string) => printed.push(line),
    };

    // Switching by numeric 1-based index: /tabs 2
    const resNum = await handleTabs(ctx, ["2"]);
    expect(resNum).toBe("refresh");
    expect(resumeSpy).toHaveBeenCalledWith(null, ctx.session, "s2");

    // Switching by name: /tabs milo
    resumeSpy.mockClear();
    const resName = await handleTabs(ctx, ["milo"]);
    expect(resName).toBe("refresh");
    expect(resumeSpy).toHaveBeenCalledWith(null, ctx.session, "s3");

    // Route through handleSessionCommand
    resumeSpy.mockClear();
    const resRouter = await handleSessionCommand(ctx, "/tabs", ["2"]);
    expect(resRouter).toBe("refresh");
    expect(resumeSpy).toHaveBeenCalledWith(null, ctx.session, "s2");

    // Invalid target reports could not resolve
    printed.length = 0;
    const resInvalid = await handleTabs(ctx, ["99"]);
    expect(resInvalid).toBe("handled");
    expect(printed).toContain("could not resolve session: 99");
  });

  it("findAttentionSession pure resolution produces identical output for identical input", () => {
    const now = 1_700_000_000_000;
    const sessions = [
      { id: "s1", name: "eli", status: "working" },
      { id: "s2", name: "olive", status: "idle" },
    ];

    const res1 = findAttentionSession(sessions, "s2", "next", now);
    const res2 = findAttentionSession(sessions, "s2", "next", now);
    expect(res1).toBe(res2);
    expect(res1?.id).toBe("s1");
    expect(attentionReason(res1)).toBe("status: working");
  });
});
