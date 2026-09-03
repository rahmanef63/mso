import { materializeDocuments } from "./memory-ledger";
import { memoryLedgerBytes } from "./memory-retention";
import { recordCanBeEffectiveAtOrAfter, resolveMemoryLedger } from "./memory-resolution";
import type { AgentMemoryLedger, AgentMemoryRecord } from "./memory-types";

export interface AgentMemoryTelemetry {
  schemaVersion: 1;
  liveRecords: number;
  archivedRecords: number;
  totalStructuredRecords: number;
  resolvedKeyCount: number;
  supersededCount: number;
  retractedCount: number;
  futureScheduledCount: number;
  conflictCount: number;
  correctionDepthDistribution: {
    zero: number;
    one: number;
    twoToFive: number;
    sixToTwenty: number;
    twentyOneToHundred: number;
    overHundred: number;
  };
  maxCorrectionsPerKey: number;
  ledgerBytes: number;
  projectionBytes: number;
  archiveSegments: number;
  archiveBytes: number;
}

function dedupeRecords(archived: AgentMemoryRecord[], live: AgentMemoryRecord[]): AgentMemoryRecord[] {
  const byId = new Map<string, AgentMemoryRecord>();
  for (const record of archived) byId.set(record.id, record);
  for (const record of live) byId.set(record.id, record);
  return [...byId.values()];
}

export function collectMemoryTelemetry(
  ledger: AgentMemoryLedger,
  archived: AgentMemoryRecord[] = [],
  archiveMeta: { segmentCount?: number; bytes?: number } = {},
  at = new Date().toISOString(),
): AgentMemoryTelemetry {
  const all = dedupeRecords(archived, ledger.records);
  const grouped = new Map<string, number>();
  for (const record of all) {
    const group = `${record.document}\u0000${record.key}`;
    grouped.set(group, (grouped.get(group) ?? 0) + 1);
  }
  const distribution = { zero: 0, one: 0, twoToFive: 0, sixToTwenty: 0, twentyOneToHundred: 0, overHundred: 0 };
  let maxCorrectionsPerKey = 0;
  for (const count of grouped.values()) {
    const corrections = Math.max(0, count - 1);
    maxCorrectionsPerKey = Math.max(maxCorrectionsPerKey, corrections);
    if (corrections === 0) distribution.zero += 1;
    else if (corrections === 1) distribution.one += 1;
    else if (corrections <= 5) distribution.twoToFive += 1;
    else if (corrections <= 20) distribution.sixToTwenty += 1;
    else if (corrections <= 100) distribution.twentyOneToHundred += 1;
    else distribution.overHundred += 1;
  }
  const resolved = resolveMemoryLedger(ledger, at);
  const docs = materializeDocuments(ledger, at);
  return {
    schemaVersion: 1,
    liveRecords: ledger.records.length,
    archivedRecords: all.length - ledger.records.length,
    totalStructuredRecords: all.length,
    resolvedKeyCount: resolved.length,
    supersededCount: all.filter((record) => Boolean(record.supersededAt || record.supersededBy)).length,
    retractedCount: all.filter((record) => Boolean(record.retractedAt)).length,
    futureScheduledCount: ledger.records.filter((record) => Date.parse(record.validFrom) > Date.parse(at) && recordCanBeEffectiveAtOrAfter(record, at)).length,
    conflictCount: resolved.reduce((sum, row) => sum + row.conflicts.length, 0),
    correctionDepthDistribution: distribution,
    maxCorrectionsPerKey,
    ledgerBytes: memoryLedgerBytes(ledger),
    projectionBytes: Buffer.byteLength(JSON.stringify({ user: docs["USER.md"], memory: docs["MEMORY.md"] }), "utf8"),
    archiveSegments: archiveMeta.segmentCount ?? 0,
    archiveBytes: archiveMeta.bytes ?? 0,
  };
}
