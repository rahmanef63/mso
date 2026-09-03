import type { AgentMemoryLedger, AgentMemoryRecord, AgentMemoryResolvedRecord } from "./memory-types";

const AUTHORITY_RANK = { explicit: 4, observed: 3, inferred: 2, migration: 1 } as const;

function ms(value: string | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function recordEffectiveAt(record: AgentMemoryRecord, at: string): boolean {
  const target = Date.parse(at);
  if (!Number.isFinite(target)) throw new Error("memory query time must be ISO-8601");
  const validFrom = ms(record.validFrom);
  const validUntil = ms(record.validUntil);
  const retractedAt = ms(record.retractedAt);
  const supersededAt = ms(record.supersededAt);
  return validFrom <= target && target < validUntil && target < retractedAt && target < supersededAt;
}

export function recordCanBeEffectiveAtOrAfter(record: AgentMemoryRecord, at: string): boolean {
  const target = Date.parse(at);
  if (!Number.isFinite(target)) throw new Error("memory query time must be ISO-8601");
  const start = Math.max(target, ms(record.validFrom));
  const end = Math.min(ms(record.validUntil), ms(record.retractedAt), ms(record.supersededAt));
  return start < end;
}

function compare(a: AgentMemoryRecord, b: AgentMemoryRecord): number {
  const authority = AUTHORITY_RANK[b.provenance.authority] - AUTHORITY_RANK[a.provenance.authority];
  if (authority) return authority;
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  const observed = Date.parse(b.provenance.observedAt) - Date.parse(a.provenance.observedAt);
  if (observed) return observed;
  const created = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (created) return created;
  return a.id.localeCompare(b.id);
}

function forwardSupersessionBoundaries(records: AgentMemoryRecord[]): Map<string, number> {
  const boundaries = new Map<string, number>();
  for (const replacement of records) {
    const boundary = Date.parse(replacement.validFrom);
    if (!Number.isFinite(boundary)) continue;
    for (const supersededId of replacement.supersedes ?? []) {
      const existing = boundaries.get(supersededId);
      if (existing === undefined || boundary < existing) boundaries.set(supersededId, boundary);
    }
  }
  return boundaries;
}

export function resolveMemoryKey(
  ledger: AgentMemoryLedger,
  document: AgentMemoryRecord["document"],
  key: string,
  at = new Date().toISOString(),
): AgentMemoryResolvedRecord | null {
  const target = Date.parse(at);
  if (!Number.isFinite(target)) throw new Error("memory query time must be ISO-8601");
  const records = ledger.records.filter((record) => record.document === document && record.key === key);
  const forwardSupersededAt = forwardSupersessionBoundaries(records);
  const candidates = records
    .filter((record) => recordEffectiveAt(record, at) && target < (forwardSupersededAt.get(record.id) ?? Number.POSITIVE_INFINITY))
    .sort(compare);
  const winner = candidates[0];
  if (!winner) return null;
  return { record: winner, conflicts: candidates.slice(1).filter((record) => record.value !== winner.value) };
}

export function resolveMemoryLedger(ledger: AgentMemoryLedger, at = new Date().toISOString()): AgentMemoryResolvedRecord[] {
  const pairs = new Set(ledger.records.map((record) => `${record.document}\u0000${record.key}`));
  const out: AgentMemoryResolvedRecord[] = [];
  for (const pair of pairs) {
    const [document, key] = pair.split("\u0000") as [AgentMemoryRecord["document"], string];
    const resolved = resolveMemoryKey(ledger, document, key, at);
    if (resolved) out.push(resolved);
  }
  return out.sort((a, b) => a.record.document.localeCompare(b.record.document) || a.record.key.localeCompare(b.record.key));
}
