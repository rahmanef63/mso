import { describe, expect, it } from "vitest";
import { BEL, createAttentionNotifier, evaluateAttention } from "./mso-agent-attention.mjs";
import { SETTINGS } from "./mso-agent-settings-entries.mjs";

function fakeOutput() {
  const chunks: string[] = [];
  const output = {
    isTTY: true,
    write(chunk: string) {
      chunks.push(String(chunk));
      return true;
    },
  };
  return {
    output,
    chunks,
    raw: () => chunks.join(""),
    count: () => chunks.length,
    clear: () => { chunks.length = 0; },
  };
}

describe("terminal session attention notification", () => {
  it("setting registry declares attention notification with default off", () => {
    const entry = SETTINGS.find((s) => s.key === "attention");
    expect(entry).toBeDefined();
    expect(entry?.category).toBe("Alerts");
    expect(entry?.path).toBe("attention.notifications");
    expect(entry?.default).toBe("off");
    expect(entry?.values).toEqual(["off", "bell"]);
  });

  it("1. off emits nothing (zero writes, assert byte-for-byte empty)", () => {
    const { output, raw, count } = fakeOutput();
    const notifier = createAttentionNotifier({ output, mode: "off", activeId: "s1" });

    // Background session s2 needs attention, but mode is off
    const result = notifier.notify([
      { id: "s1", status: "idle" },
      { id: "s2", status: "working" },
    ]);

    expect(result.shouldRing).toBe(false);
    expect(count()).toBe(0);
    // Byte-for-byte assertion: absolutely zero characters emitted
    expect(raw()).toBe("");
  });

  it("2. bell emits exactly one BEL on a transition", () => {
    const { output, raw, count } = fakeOutput();
    const notifier = createAttentionNotifier({ output, mode: "bell", activeId: "s1" });

    // Initial state: s2 is idle, so no transition into needing attention
    notifier.notify([
      { id: "s1", status: "idle" },
      { id: "s2", status: "idle" },
    ]);
    expect(raw()).toBe("");
    expect(count()).toBe(0);

    // s2 transitions into working (needs attention)
    const result = notifier.notify([
      { id: "s1", status: "idle" },
      { id: "s2", status: "working" },
    ]);

    expect(result.shouldRing).toBe(true);
    expect(result.transitions).toEqual(["s2"]);
    // Exactly one BEL byte emitted
    expect(count()).toBe(1);
    expect(raw()).toBe(BEL);
    expect(raw()).toBe("\x07");
  });

  it("3. a second render with no state change emits nothing", () => {
    const { output, raw, count, clear } = fakeOutput();
    const notifier = createAttentionNotifier({ output, mode: "bell", activeId: "s1" });

    // First render triggers transition for s2
    notifier.notify([
      { id: "s1", status: "idle" },
      { id: "s2", status: "working" },
    ]);
    expect(count()).toBe(1);
    expect(raw()).toBe(BEL);

    // Clear buffer to observe next render in isolation
    clear();

    // Second render: s2 is still working, no state transition
    const secondResult = notifier.notify([
      { id: "s1", status: "idle" },
      { id: "s2", status: "working" },
    ]);

    expect(secondResult.shouldRing).toBe(false);
    expect(secondResult.transitions).toEqual([]);
    expect(count()).toBe(0);
    expect(raw()).toBe("");
  });

  it("4. the active session never rings", () => {
    const { output, raw, count } = fakeOutput();
    const notifier = createAttentionNotifier({ output, mode: "bell", activeId: "s1" });

    // s1 is active and transitions to working
    const result1 = notifier.notify([
      { id: "s1", status: "working" },
      { id: "s2", status: "idle" },
    ]);
    expect(result1.shouldRing).toBe(false);
    expect(result1.transitions).toEqual([]);
    expect(count()).toBe(0);
    expect(raw()).toBe("");

    // s1 transitions to errored while still active
    const result2 = notifier.notify([
      { id: "s1", status: "errored", error: true },
      { id: "s2", status: "idle" },
    ]);
    expect(result2.shouldRing).toBe(false);
    expect(result2.transitions).toEqual([]);
    expect(count()).toBe(0);
    expect(raw()).toBe("");
  });

  it("5. a suspend and resume cycle emits nothing", () => {
    const { output, raw, count, clear } = fakeOutput();
    const notifier = createAttentionNotifier({ output, mode: "bell", activeId: "s1" });

    // Background session s2 transitions before suspension
    notifier.notify([
      { id: "s1", status: "idle" },
      { id: "s2", status: "working" },
    ]);
    expect(count()).toBe(1);
    expect(raw()).toBe(BEL);
    clear();

    // Suspension begins
    notifier.suspend();
    expect(notifier.isSuspended()).toBe(true);

    // Repaint during suspension must never emit BEL
    notifier.notify([
      { id: "s1", status: "idle" },
      { id: "s2", status: "working" },
      { id: "s3", status: "working" },
    ]);
    expect(count()).toBe(0);
    expect(raw()).toBe("");

    // Panel resumes from suspension
    notifier.resume();
    expect(notifier.isSuspended()).toBe(false);

    // Immediate repaint upon resume must never emit BEL
    const resumeRepaintResult = notifier.notify([
      { id: "s1", status: "idle" },
      { id: "s2", status: "working" },
      { id: "s3", status: "working" },
    ]);
    expect(resumeRepaintResult.shouldRing).toBe(false);
    expect(count()).toBe(0);
    expect(raw()).toBe("");
  });

  it("pure evaluateAttention function tracks transitions correctly", () => {
    const sessions = [
      { id: "s1", status: "idle" },
      { id: "s2", status: "working" },
    ];
    const initial = evaluateAttention(sessions, new Set(), { activeId: "s1", mode: "bell" });
    expect(initial.shouldRing).toBe(true);
    expect(initial.transitions).toEqual(["s2"]);

    // Subsequent evaluation with updated known set produces no transitions
    const subsequent = evaluateAttention(sessions, initial.nextAttention, { activeId: "s1", mode: "bell" });
    expect(subsequent.shouldRing).toBe(false);
    expect(subsequent.transitions).toEqual([]);
  });
});
