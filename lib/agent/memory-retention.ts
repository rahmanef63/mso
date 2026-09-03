import { recordCanBeEffectiveAtOrAfter } from "./memory-resolution";
import type { AgentMemoryLedger, AgentMemoryRecord } from "./memory-types";

export const MEMORY_RETENTION_TRIGGER_RECORDS = 1400;
export const MEMORY_RETENTION_TARGET_RECORDS = 1000;
export const MEMORY_RETENTION_TRIGGER_BYTES = 1400 * 1024;
export const MEMORY_RETENTION_TARGET_BYTES = 1024 * 1024;
const RECENT_FINISHED_RESERVE = 100;

export function memoryLedgerBytes(ledger: AgentMemoryLedger): number {
  return Buffer.byteLength(JSON.stringify(ledger, null, 2), "utf8");
}

function endedAt(record: AgentMemoryRecord): number | null {
  const values = [record.validUntil, record.retractedAt, record.supersededAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

function archiveCandidates(ledger: AgentMemoryLedger, at: string): AgentMemoryRecord[] {
  const target = Date.parse(at);
  if (!Number.isFinite(target)) throw new Error("memory retention time must be ISO-8601");
  return ledger.records
    .filter((record) => {
      const end = endedAt(record);
      return end !== null && end <= target && !recordCanBeEffectiveAtOrAfter(record, at);
    })
    .sort((a, b) => (endedAt(a) ?? 0) - (endedAt(b) ?? 0) || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
}

export interface AgentMemoryRetentionPlan {
  ledger: AgentMemoryLedger;
  archiveRecords: AgentMemoryRecord[];
  triggered: boolean;
  targetReached: boolean;
  beforeRecords: number;
  afterRecords: number;
  beforeBytes: number;
  afterBytes: number;
}

export function planMemoryRetention(ledger: AgentMemoryLedger, at = new Date().toISOString()): AgentMemoryRetentionPlan {
  const beforeBytes = memoryLedgerBytes(ledger);
  const triggered = ledger.records.length >= MEMORY_RETENTION_TRIGGER_RECORDS || beforeBytes >= MEMORY_RETENTION_TRIGGER_BYTES;
  if (!triggered) {
    return { ledger, archiveRecords: [], triggered: false, targetReached: true, beforeRecords: ledger.records.length, afterRecords: ledger.records.length, beforeBytes, afterBytes: beforeBytes };
  }

  const candidates = archiveCandidates(ledger, at);
  if (!candidates.length) {
    return { ledger, archiveRecords: [], triggered: true, targetReached: false, beforeRecords: ledger.records.length, afterRecords: ledger.records.length, beforeBytes, afterBytes: beforeBytes };
  }

  const preferredCount = Math.max(0, candidates.length - RECENT_FINISHED_RESERVE);
  const ordered = [...candidates.slice(0, preferredCount), ...candidates.slice(preferredCount)];
  const selected = new Set<string>();
  const minimumByCount = Math.max(0, ledger.records.length - MEMORY_RETENTION_TARGET_RECORDS);
  for (let i = 0; i < Math.min(minimumByCount, ordered.length); i += 1) selected.add(ordered[i].id);

  let retainedRecords = ledger.records.filter((record) => !selected.has(record.id));
  let retained: AgentMemoryLedger = { ...ledger, records: retainedRecords };
  let selectedCount = selected.size;
  while (memoryLedgerBytes(retained) > MEMORY_RETENTION_TARGET_BYTES && selectedCount < ordered.length) {
    selected.add(ordered[selectedCount].id);
    selectedCount += 1;
    retainedRecords = ledger.records.filter((record) => !selected.has(record.id));
    retained = { ...ledger, records: retainedRecords };
  }

  const afterBytes = memoryLedgerBytes(retained);
  const targetReached = retained.records.length <= MEMORY_RETENTION_TARGET_RECORDS && afterBytes <= MEMORY_RETENTION_TARGET_BYTES;
  return {
    ledger: retained,
    archiveRecords: ordered.filter((record) => selected.has(record.id)),
    triggered: true,
    targetReached,
    beforeRecords: ledger.records.length,
    afterRecords: retained.records.length,
    beforeBytes,
    afterBytes,
  };
}
