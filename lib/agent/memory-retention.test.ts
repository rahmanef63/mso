import { describe, expect, it } from "vitest";
import { planMemoryRetention, MEMORY_RETENTION_TARGET_RECORDS } from "./memory-retention";
import { recordCanBeEffectiveAtOrAfter } from "./memory-resolution";
import type { AgentMemoryLedger, AgentMemoryRecord } from "./memory-types";

const BASE = Date.parse("2026-01-01T00:00:00.000Z");

function record(i: number, total: number): AgentMemoryRecord {
  const validFrom = new Date(BASE + i * 1000).toISOString();
  const next = i + 1 < total ? new Date(BASE + (i + 1) * 1000).toISOString() : undefined;
  return {
    id: `ret_${i}`,
    document: "MEMORY.md",
    key: "Runtime",
    value: `Runtime-${i}`,
    kind: "semantic",
    confidence: 1,
    sensitivity: "normal",
    validFrom,
    createdAt: validFrom,
    provenance: { authority: "explicit", channel: "system", observedAt: validFrom },
    ...(next ? { supersededAt: next, supersededBy: `ret_${i + 1}` } : {}),
  };
}

function ledger(records: AgentMemoryRecord[]): AgentMemoryLedger {
  return { schemaVersion: 1, updatedAt: "2026-09-03T00:00:00.000Z", records };
}

describe("agent memory retention planner", () => {
  it("archives only finished history and keeps the effective record live", () => {
    const records = Array.from({ length: 1400 }, (_, i) => record(i, 1400));
    const at = "2026-09-03T00:00:00.000Z";
    const plan = planMemoryRetention(ledger(records), at);
    expect(plan.triggered).toBe(true);
    expect(plan.targetReached).toBe(true);
    expect(plan.ledger.records.length).toBeLessThanOrEqual(MEMORY_RETENTION_TARGET_RECORDS);
    expect(plan.archiveRecords.length).toBeGreaterThan(0);
    expect(plan.ledger.records.some((row) => row.id === "ret_1399")).toBe(true);
    expect(plan.archiveRecords.every((row) => !recordCanBeEffectiveAtOrAfter(row, at))).toBe(true);
  });

  it("fails closed instead of archiving current or future-effective claims", () => {
    const at = "2026-09-03T00:00:00.000Z";
    const records = Array.from({ length: 1400 }, (_, i) => ({
      ...record(i, 1),
      id: `active_${i}`,
      key: `Key ${i}`,
      validFrom: i % 2 ? at : "2026-09-04T00:00:00.000Z",
      supersededAt: undefined,
      supersededBy: undefined,
    }));
    const plan = planMemoryRetention(ledger(records), at);
    expect(plan.triggered).toBe(true);
    expect(plan.archiveRecords).toHaveLength(0);
    expect(plan.targetReached).toBe(false);
    expect(plan.ledger.records).toHaveLength(records.length);
  });
});
