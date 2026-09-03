import { describe, expect, it } from "vitest";
import { chooseAgentSessionRecord } from "./session-query";
import type { AgentSession } from "./session-types";

function row(n: number, title: string, updatedAt: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: `20260901_120000_${n.toString(16).padStart(8, "0")}`, principalHash: "p", source: "cli", name: `test-${n}`,
    title, titleSource: "auto", createdAt: updatedAt, updatedAt, memorySnapshot: { user: "", memory: "", capturedAt: updatedAt },
    history: [{ role: "user", text: title }], events: [], estimatedTokens: 1, lifetimeEstimatedTokens: 1,
    compactThresholdTokens: 700000, compactionCount: 0, archiveCount: 0, ...overrides,
  };
}

describe("full-store agent session resolver", () => {
  it("sorts latest/index by modified time and skips empty default CLI clutter", () => {
    const rows = [
      row(1, "Older", "2026-09-01T10:00:00Z"),
      row(2, "Newest", "2026-09-01T12:00:00Z"),
      row(3, "MSO Agent session", "2026-09-01T13:00:00Z", { titleSource: "default", history: [] }),
      row(4, "Middle", "2026-09-01T11:00:00Z"),
    ];
    expect(chooseAgentSessionRecord(rows, "latest").title).toBe("Newest");
    expect(chooseAgentSessionRecord(rows, "2").title).toBe("Middle");
  });

  it("can resolve a named session far beyond a 100-row client summary", () => {
    const rows = Array.from({ length: 350 }, (_, i) => row(i + 1, `Session ${i + 1}`, new Date(1_788_000_000_000 - i * 1000).toISOString()));
    rows[275]!.title = "Ancient Important Project";
    expect(chooseAgentSessionRecord(rows, "Ancient Important").title).toBe("Ancient Important Project");
    expect(chooseAgentSessionRecord(rows, rows[275]!.id.slice(-8)).id).toBe(rows[275]!.id);
  });

  it("supports unique fuzzy titles but refuses ambiguous matches using human labels", () => {
    const rows = [row(1, "Deploy Example Project", "2026-09-01T12:00:00Z"), row(2, "Audit Example Project", "2026-09-01T11:00:00Z")];
    expect(chooseAgentSessionRecord(rows, "Deploy Example").title).toBe("Deploy Example Project");
    expect(() => chooseAgentSessionRecord(rows, "Example Project")).toThrow(/Deploy Example Project.*Audit Example Project|Audit Example Project.*Deploy Example Project/);
  });
});
