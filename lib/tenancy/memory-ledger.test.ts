import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { applyMemoryTool, validateTenantLedger } from "./memory-ledger";
import { validateMemoryArguments } from "./memory-tools";
import type { AgentMemoryLedger } from "@/lib/agent/memory-types";
const now = "2026-01-01T00:00:00.000Z";
function ledger() {
  const value: AgentMemoryLedger = { schemaVersion: 1, updatedAt: now, records: [] };
  for (const key of ["one", "two"]) applyMemoryTool(value, "agent_memory_remember",
    validateMemoryArguments("agent_memory_remember", { document: "MEMORY.md", key, value: key }), now);
  return value;
}
describe("strict tenant claim ledger", () => {
  it("validates a generated typed ledger", () => { expect(validateTenantLedger(ledger()).records).toHaveLength(2); });
  it.each(["duplicate-id", "unknown-field", "unknown-provenance", "bad-confidence", "bad-date", "bad-kind",
    "bad-sensitivity", "nul-key", "foreign-supersedes", "foreign-supersededBy", "missing-reference", "future-created"])("rejects %s", kind => {
    const value = ledger(), r = value.records[1];
    if (kind === "duplicate-id") r.id = value.records[0].id;
    if (kind === "unknown-field") Object.assign(r, { token: "synthetic" });
    if (kind === "unknown-provenance") Object.assign(r.provenance, { subject: "other" });
    if (kind === "bad-confidence") r.confidence = NaN;
    if (kind === "bad-date") r.validUntil = "2025-01-01T00:00:00.000Z";
    if (kind === "bad-kind") Object.assign(r, { kind: "unknown" });
    if (kind === "bad-sensitivity") Object.assign(r, { sensitivity: null });
    if (kind === "nul-key") r.key = "bad\u0000key";
    if (kind === "foreign-supersedes") r.supersedes = [value.records[0].id];
    if (kind === "foreign-supersededBy") r.supersededBy = value.records[0].id;
    if (kind === "missing-reference") r.supersedes = ["mem_" + randomUUID()];
    if (kind === "future-created") r.createdAt = "2030-01-01T00:00:00.000Z";
    expect(() => validateTenantLedger(value)).toThrow();
  });
  it("bounds total record count", () => {
    const value = ledger();
    value.records = Array.from({ length: 257 }, () => ({ ...value.records[0], id: "mem_" + randomUUID() }));
    expect(() => validateTenantLedger(value)).toThrow();
  });
  it("bounds cumulative document text including history", () => {
    const value = ledger();
    value.records = Array.from({ length: 8 }, (_, i) => ({ ...value.records[0], id: "mem_" + randomUUID(), key: "key-" + i, value: "x".repeat(8192) }));
    expect(() => validateTenantLedger(value)).toThrow();
  });
  it("bounds encoded claim history even when displayed text is short", () => {
    const value = ledger();
    value.records = Array.from({ length: 256 }, () => ({ ...value.records[0], id: "mem_" + randomUUID() }));
    for (let i = 1; i < value.records.length; i++) value.records[i].supersedes = value.records.slice(0, i).map(r => r.id);
    expect(() => validateTenantLedger(value)).toThrow();
  });
  it("deduplicates an ordinary repeated replace without discarding explicit claims", () => {
    const value = ledger(), args = { document: "MEMORY.md", key: "one", value: "one" };
    applyMemoryTool(value, "agent_memory_remember", validateMemoryArguments("agent_memory_remember", args), now);
    expect(value.records).toHaveLength(2);
    applyMemoryTool(value, "agent_memory_remember", validateMemoryArguments("agent_memory_remember", { ...args, mode: "claim" }), now);
    expect(value.records).toHaveLength(3);
  });
});
