import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentActivity } from "./mso-agent-activity.mjs";
import { agentRound, agentRoundLimit } from "./mso-agent-turn.mjs";

const colors = { blue: "", bold: "", reset: "", dim: "", c: "", cyan: "", warn: "", err: "" };

function session(overrides: Record<string, unknown> = {}) {
  return {
    history: [{ role: "user", text: "do the thing" }],
    permission: "yolo",
    state: { tools: [{ name: "fs_list", scope: "read" }, { name: "fs_write", scope: "write" }], modelMeta: null },
    agentSession: { id: "session-a", name: "ika" },
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    lastElapsedMs: 0,
    ...overrides,
  } as any;
}

function streamReturning(rounds: number) {
  let round = 0;
  return vi.fn(async () => {
    round += 1;
    return {
      text: `round ${round}`,
      usage: null,
      toolUses: round <= rounds
        ? [{ id: `call-${round}`, name: round % 2 ? "fs_list" : "fs_write", input: {} }]
        : [],
    };
  });
}

function ttyActivity() {
  const chunks: string[] = [];
  const lines: string[] = [];
  const activity = new AgentActivity({
    output: { isTTY: true, write: (v: string) => { chunks.push(String(v)); return true; } } as unknown as typeof process.stdout,
    colors,
    animate: true,
    print: (line: string) => lines.push(String(line)),
    setIntervalImpl: (() => 0) as unknown as typeof setInterval,
    clearIntervalImpl: (() => undefined) as unknown as typeof clearInterval,
  });
  return { activity, chunks, lines, text: () => chunks.join("") };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("MSO Agent turn rendering and round budget", () => {
  it("opens exactly one Agent work section for a multi-round turn", async () => {
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => { printed.push(String(line ?? "")); });
    const result = await agentRound(null, session(), null, undefined, null, {
      streamTurn: streamReturning(3), executeTool: vi.fn(async () => ({ ok: true, result: "ok" })),
    });
    const workSections = printed.filter((line) => line.includes("Agent work"));
    expect(result.rounds).toBe(4);
    expect(result.turnLimitReached).toBeUndefined();
    expect(workSections).toHaveLength(1);
    expect(printed.some((line) => line.includes("turn limit reached"))).toBe(false);
  });

  it("keeps tool progress on one repainted row and ends with one receipt", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { activity, lines, text } = ttyActivity();
    const result = await agentRound(null, session(), null, undefined, null, {
      quiet: false, activity, animate: true,
      streamTurn: streamReturning(2),
      apiRequest: vi.fn(async () => ({ ok: true, result: "ok" })),
    });
    expect(result.calls).toHaveLength(2);
    // Two rounds → one divider, and every paint rewrote the same physical row.
    expect((text().match(/\r\x1b\[2K/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(text()).toContain("fs_list");
    expect(text()).toContain("fs_write");
    expect(text()).not.toContain("\n");
    expect(lines.join("\n")).toMatch(/2 tools/);
    expect(lines.join("\n")).toMatch(/all ok/);
  });

  it("stops only at the configured round budget", async () => {
    vi.stubEnv("OS_AGENT_MAX_ROUNDS", "2");
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => { printed.push(String(line ?? "")); });
    const result = await agentRound(null, session(), null, undefined, null, {
      streamTurn: streamReturning(99), executeTool: vi.fn(async () => ({ ok: true, result: "ok" })),
    });
    expect(result.rounds).toBe(2);
    expect(result.turnLimitReached).toBe(true);
    expect(printed.filter((line) => line.includes("turn limit reached"))).toHaveLength(1);
    // The capped run still reported its work in a single section.
    expect(printed.filter((line) => line.includes("Agent work"))).toHaveLength(1);
  });

  it("defaults to a budget no real task reaches", () => {
    expect(agentRoundLimit()).toBe(1000);
    vi.stubEnv("OS_AGENT_MAX_ROUNDS", "0");
    expect(agentRoundLimit()).toBe(1000);
    vi.stubEnv("OS_AGENT_MAX_ROUNDS", "fifty");
    expect(agentRoundLimit()).toBe(1000);
    vi.stubEnv("OS_AGENT_MAX_ROUNDS", "37");
    expect(agentRoundLimit()).toBe(37);
  });
});
