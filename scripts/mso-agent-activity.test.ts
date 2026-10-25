import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentActivity, activityText, formatDuration, formatElapsed,
  resumeActiveActivity, suspendActiveActivity,
} from "./mso-agent-activity.mjs";

const colors = { dim: "", reset: "", c: "", warn: "", err: "", bold: "" };

function collector() {
  const chunks: string[] = [];
  return {
    chunks,
    output: { isTTY: true, write: (value: string) => { chunks.push(String(value)); return true; } } as unknown as typeof process.stdout,
    text: () => chunks.join(""),
  };
}

function discrete(animate: boolean) {
  const lines: string[] = [];
  const sink = collector();
  const activity = new AgentActivity({
    output: sink.output, colors, animate, print: (line: string) => lines.push(String(line)),
    setIntervalImpl: (() => 0) as unknown as typeof setInterval,
    clearIntervalImpl: (() => undefined) as unknown as typeof clearInterval,
  });
  return { activity, lines, sink };
}

afterEach(() => { suspendActiveActivity(); resumeActiveActivity(); vi.restoreAllMocks(); });

describe("MSO Agent live activity row", () => {
  it("repaints one row in place instead of appending a line per tool", () => {
    const { activity, sink, lines } = discrete(true);
    activity.begin().setToolTotal(2);
    activity.toolStart({ name: "fs_search", scope: "read" });
    activity.toolStart({ name: "fs_read", scope: "read" });
    activity.toolEnd({ name: "fs_read", scope: "read" }, true);
    activity.finish("2 tools  ·  all ok  ·  1s");

    const frame = sink.text();
    // Every paint addresses the same physical row (carriage return + erase-line).
    expect(frame.match(/\r\x1b\[2K/g)?.length).toBeGreaterThanOrEqual(4);
    expect(frame).toContain("fs_search");
    expect(frame).toContain("1/2 tools");
    expect(frame).toContain("✓ fs_read");
    expect(frame).toContain("1/2 ok");
    // The animated row never terminates itself; only the receipt is a real line.
    expect(frame).not.toContain("\n");
    expect(lines).toEqual(["2 tools  ·  all ok  ·  1s"]);
  });

  it("keeps the historical discrete lines when stdout is not a tty", () => {
    const { activity, lines, sink } = discrete(false);
    activity.begin().setToolTotal(1);
    activity.label({ name: "workflow_start", scope: "write" });
    activity.toolStart({ name: "workflow_start", scope: "write" });
    activity.toolEnd({ name: "workflow_start", scope: "write" }, true);
    activity.finish("1 tool  ·  all ok  ·  0s");

    expect(lines).toEqual([
      "[write] workflow_start",
      "  ↳ workflow_start…",
      "\r  ✓ workflow_start",
      "1 tool  ·  all ok  ·  0s",
    ]);
    // Nothing animated: a pipe never receives cursor control.
    expect(sink.text()).toBe("");
  });

  it("clears the live row before streamed model text and before foreign writers", () => {
    const { activity, sink } = discrete(true);
    activity.begin();
    activity.waiting("thinking");
    activity.clear();
    expect(sink.text().endsWith("\r\x1b[2K")).toBe(true);

    activity.waiting("thinking");
    suspendActiveActivity();
    expect(sink.text().endsWith("\r\x1b[2K")).toBe(true);
    const frozen = sink.chunks.length;
    activity.toolStart({ name: "fs_list", scope: "read" });
    expect(sink.chunks.length).toBe(frozen);
    resumeActiveActivity();
    expect(sink.chunks.length).toBeGreaterThan(frozen);
  });

  it("reports progress with elapsed time and a tool tally", () => {
    let clock = 1_000;
    const { activity, sink } = discrete(true);
    Object.defineProperty(activity, "now", { value: () => clock });
    activity.begin().setToolTotal(3);
    clock += 12_000;
    activity.toolStart({ name: "exec_run", scope: "exec" });
    expect(sink.text()).toContain("exec_run");
    expect(sink.text()).toContain("1/3 tools");
    expect(sink.text()).toContain("12s");
  });

  it("formats durations and joins only non-empty segments", () => {
    expect(formatElapsed(0, 900)).toBe("0s");
    expect(formatElapsed(0, 12_400)).toBe("12s");
    expect(formatElapsed(0, 64_000)).toBe("1m04s");
    expect(formatDuration(0)).toBe("0s");
    expect(activityText(["fs_search", "", null, undefined, "2/5 tools"])).toBe("fs_search  ·  2/5 tools");
  });
});
