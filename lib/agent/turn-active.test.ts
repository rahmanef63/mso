import { describe, expect, it } from "vitest";
import { summary } from "./session-record";
import type { AgentSession } from "./session-types";

const VALID_PRINCIPAL = "0".repeat(64);

function fixtureRecord(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "20261102_120000_00000001",
    principalHash: VALID_PRINCIPAL,
    source: "cli",
    name: "test-session",
    title: "Test Session",
    titleSource: "manual",
    createdAt: "2026-11-02T12:00:00.000Z",
    updatedAt: "2026-11-02T12:00:00.000Z",
    memorySnapshot: { user: "", memory: "", capturedAt: "2026-11-02T12:00:00.000Z" },
    history: [],
    events: [],
    estimatedTokens: 0,
    lifetimeEstimatedTokens: 0,
    compactThresholdTokens: 700000,
    compactionCount: 0,
    archiveCount: 0,
    ...overrides,
  };
}

describe("agent turn-active signal", () => {
  it("yields turnActive: true in summary() when turnStartedAt is set", () => {
    const record = fixtureRecord({ turnStartedAt: "2026-11-02T12:01:00.000Z" });
    const s = summary(record);
    expect(s.turnActive).toBe(true);
  });

  it("yields turnActive: false in summary() when turnStartedAt is missing or null", () => {
    const withoutField = fixtureRecord();
    expect(summary(withoutField).turnActive).toBe(false);

    const withNull = fixtureRecord({ turnStartedAt: null });
    expect(summary(withNull).turnActive).toBe(false);
  });

  it("serialises then parses a record with turnStartedAt round-trip", () => {
    const timestamp = "2026-11-02T12:05:00.000Z";
    const original = fixtureRecord({ turnStartedAt: timestamp });
    const json = JSON.stringify(original);
    const parsed = JSON.parse(json) as AgentSession;

    expect(parsed.turnStartedAt).toBe(timestamp);
    expect(summary(parsed).turnActive).toBe(true);
  });

  it("parses an old record without the turnStartedAt field as turnActive: false", () => {
    const oldPayload = JSON.stringify({
      id: "20260901_100000_00000002",
      principalHash: VALID_PRINCIPAL,
      source: "cli",
      name: "legacy-agent",
      title: "Legacy Agent Session",
      titleSource: "default",
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
      memorySnapshot: { user: "", memory: "", capturedAt: "2026-09-01T10:00:00.000Z" },
      history: [],
      events: [],
      estimatedTokens: 0,
      lifetimeEstimatedTokens: 0,
      compactThresholdTokens: 700000,
      compactionCount: 0,
      archiveCount: 0,
    });

    const parsed = JSON.parse(oldPayload) as AgentSession;
    expect(parsed.turnStartedAt).toBeUndefined();
    expect(summary(parsed).turnActive).toBe(false);
  });
});
