import { resolveMemoryLedger } from "./memory-resolution";
import type { AgentMemoryLedger, AgentMemoryQuery, AgentMemoryRecord } from "./memory-types";

export function memoryQueryTime(value = new Date().toISOString()): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("at must be ISO-8601");
  return new Date(parsed).toISOString();
}

function words(value: string): string[] {
  return value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*/gu) ?? [];
}

function fieldScore(field: string, query: string, queryWords: string[], weight: number): number {
  const normalized = field.normalize("NFKC").toLowerCase();
  const fieldWords = words(normalized);
  let score = normalized === query ? weight * 20 : normalized.includes(query) ? weight * 5 : 0;
  for (const token of queryWords) {
    if (fieldWords.includes(token)) { score += weight * 4; continue; }
    if (/^\p{L}{4,}$/u.test(token) && fieldWords.some((word) => word.startsWith(token))) score += weight;
  }
  return score;
}

function searchScore(record: AgentMemoryRecord, query: string): number {
  if (!query) return 1;
  const normalized = query.normalize("NFKC").toLowerCase().trim();
  const tokens = words(normalized);
  if (!tokens.length) return 0;
  return fieldScore(record.key, normalized, tokens, 4) + fieldScore(record.value, normalized, tokens, 1);
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
