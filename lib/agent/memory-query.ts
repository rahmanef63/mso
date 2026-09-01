import { resolveMemoryLedger } from "./memory-resolution";
import type { AgentMemoryLedger, AgentMemoryQuery, AgentMemoryRecord } from "./memory-types";

export function memoryQueryTime(value = new Date().toISOString()): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("at must be ISO-8601");
  return new Date(parsed).toISOString();
}

function searchScore(record: AgentMemoryRecord, query: string): number {
  if (!query) return 1;
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const key = record.key.toLowerCase(), value = record.value.toLowerCase();
  return tokens.reduce((score, token) => score + (key.includes(token) ? 4 : 0) + (value.includes(token) ? 1 : 0), 0);
}

export function queryMemoryLedger(ledger: AgentMemoryLedger, query: AgentMemoryQuery = {}) {
  const at = memoryQueryTime(query.at), needle = (query.query ?? "").trim();
  const limit = Math.max(1, Math.min(100, Math.trunc(query.limit ?? 20) || 20));
  const resolved = resolveMemoryLedger(ledger, at)
    .filter(({ record }) => (!query.document || record.document === query.document) && (!query.kind || record.kind === query.kind));
  let rows = query.includeHistory
    ? ledger.records.filter((record) => (!query.document || record.document === query.document) && (!query.kind || record.kind === query.kind))
      .map((record) => ({ record, conflicts: [] as AgentMemoryRecord[] }))
    : resolved;
  rows = rows.map((row) => ({ ...row, score: searchScore(row.record, needle) }))
    .filter((row) => !needle || row.score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.record.provenance.observedAt) - Date.parse(a.record.provenance.observedAt) || a.record.key.localeCompare(b.record.key))
    .slice(0, limit);
  return { at, schemaVersion: 1 as const, total: rows.length, records: rows };
}
