import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { archiveMemoryRecords, readMemoryArchive } from "./memory-archive";
import { ledgerFile, materializeDocuments, readMemoryLedger, seedLedger, writeMemoryLedger } from "./memory-ledger";
import { queryMemoryLedger } from "./memory-query";
import { planMemoryRetention } from "./memory-retention";
import { recordCanBeEffectiveAtOrAfter, recordEffectiveAt } from "./memory-resolution";
import { collectMemoryTelemetry, type AgentMemoryTelemetry } from "./memory-telemetry";
import type { AgentMemoryDocument, AgentMemoryLedger, AgentMemoryQuery, AgentMemoryRecord, AgentMemoryWriteOptions } from "./memory-types";

export type { AgentMemoryDocument, AgentMemoryKind, AgentMemoryQuery, AgentMemoryRecord, AgentMemorySensitivity, AgentMemoryWriteOptions } from "./memory-types";
export type { AgentMemoryTelemetry } from "./memory-telemetry";
export interface AgentMemorySnapshot { capturedAt: string; user: string; memory: string; schemaVersion?: 1; recordCount?: number; }

const ROOT = path.resolve(process.env.OS_AGENT_MEMORY_DIR || path.join(os.homedir(), ".mso", "agent-memory"));
const MAX_DOC_BYTES = 64 * 1024;
const KEY_RE = /^[^\r\n]{1,80}$/;

function principalKey(principal: string): string {
  if (!principal || principal.length > 512) throw new Error("invalid agent memory principal");
  return createHash("sha256").update(principal).digest("hex").slice(0, 32);
}
function dirFor(principal: string): string { return path.join(ROOT, principalKey(principal)); }
function fileFor(principal: string, document: AgentMemoryDocument): string { return path.join(dirFor(principal), document); }

async function readDocument(principal: string, document: AgentMemoryDocument): Promise<string> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(fileFor(principal, document), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_DOC_BYTES) throw new Error("agent memory document has an invalid file shape");
    if ((stat.mode & 0o077) !== 0) throw new Error("agent memory permissions are too broad; expected 0600");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("agent memory is not owned by the MSO user");
    return await handle.readFile("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  } finally { await handle?.close().catch(() => undefined); }
}

async function writeDocument(principal: string, document: AgentMemoryDocument, content: string): Promise<void> {
  if (Buffer.byteLength(content, "utf8") > MAX_DOC_BYTES) throw new Error("agent memory document exceeds 64 KiB");
  const file = fileFor(principal, document), dir = path.dirname(file), tmp = `${file}.${randomUUID()}.tmp`;
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(ROOT, 0o700).catch(() => undefined); await fs.chmod(dir, 0o700).catch(() => undefined);
  await fs.writeFile(tmp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.chmod(tmp, 0o600); await fs.rename(tmp, file); await fs.chmod(file, 0o600);
}

function cleanKey(key: string): string {
  const value = key.trim();
  if (!KEY_RE.test(value) || value.startsWith("#")) throw new Error("memory key must be one line, 1-80 characters");
  return value;
}
function cleanValue(value: string): string {
  const clean = value.trim();
  if (!clean || Buffer.byteLength(clean, "utf8") > 8 * 1024) throw new Error("memory value must be 1-8192 bytes");
  return clean;
}
function iso(value: string | undefined, fallback: string, field: string): string {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be ISO-8601`);
  return new Date(parsed).toISOString();
}
function confidence(value: number | undefined): number {
  const n = value ?? 1;
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error("memory confidence must be between 0 and 1");
  return Math.round(n * 1000) / 1000;
}
function dedupeRecords(archived: AgentMemoryRecord[], live: AgentMemoryRecord[]): AgentMemoryRecord[] {
  const byId = new Map<string, AgentMemoryRecord>();
  for (const record of archived) byId.set(record.id, record);
  for (const record of live) byId.set(record.id, record); // live ledger wins after an interrupted archive-before-ledger commit.
  return [...byId.values()];
}

async function legacyDocs(principal: string) { const [user, memory] = await Promise.all([readDocument(principal, "USER.md"), readDocument(principal, "MEMORY.md")]); return { user, memory }; }
async function ledgerForRead(principal: string): Promise<AgentMemoryLedger> {
  const ledger = await readMemoryLedger(dirFor(principal));
  if (ledger) return ledger;
  const docs = await legacyDocs(principal); return seedLedger(docs.user, docs.memory);
}
async function ledgerForQuery(principal: string, query: AgentMemoryQuery): Promise<AgentMemoryLedger> {
  const live = await ledgerForRead(principal);
  if (!query.includeHistory && !query.at) return live;
  const archived = await readMemoryArchive(dirFor(principal));
  if (!archived.records.length) return live;
  return { ...live, records: dedupeRecords(archived.records, live.records) };
}
function snapshotFromLedger(ledger: AgentMemoryLedger, capturedAt = new Date().toISOString()): AgentMemorySnapshot {
  const docs = materializeDocuments(ledger, capturedAt);
  return { capturedAt, user: docs["USER.md"], memory: docs["MEMORY.md"], schemaVersion: 1, recordCount: ledger.records.length };
}
async function persistProjection(principal: string, ledger: AgentMemoryLedger, at: string): Promise<void> {
  const docs = materializeDocuments(ledger, at);
  await writeDocument(principal, "USER.md", docs["USER.md"]); await writeDocument(principal, "MEMORY.md", docs["MEMORY.md"]);
}
async function persistLedgerMutation(principal: string, ledger: AgentMemoryLedger, at: string): Promise<AgentMemoryLedger> {
  const retention = planMemoryRetention(ledger, at);
  if (retention.archiveRecords.length) await archiveMemoryRecords(dirFor(principal), retention.archiveRecords);
  await writeMemoryLedger(dirFor(principal), retention.ledger);
  await persistProjection(principal, retention.ledger, at);
  return retention.ledger;
}

export async function snapshotAgentMemory(principal: string): Promise<AgentMemorySnapshot> {
  const stored = await readMemoryLedger(dirFor(principal));
  if (stored) return snapshotFromLedger(stored);
  const docs = await legacyDocs(principal); return { capturedAt: new Date().toISOString(), ...docs };
}
export const readAgentMemory = snapshotAgentMemory;

export async function rememberAgentMemory(principal: string, document: AgentMemoryDocument, key: string, value: string, options: AgentMemoryWriteOptions = {}): Promise<AgentMemorySnapshot> {
  const safeKey = cleanKey(key), safeValue = cleanValue(value), now = new Date().toISOString();
  const validFrom = iso(options.validFrom, now, "valid_from"), validUntil = options.validUntil ? iso(options.validUntil, now, "valid_until") : undefined;
  if (validUntil && Date.parse(validUntil) <= Date.parse(validFrom)) throw new Error("valid_until must be after valid_from");
  const record: AgentMemoryRecord = {
    id: `mem_${randomUUID()}`, document, key: safeKey, value: safeValue, kind: options.kind ?? "semantic",
    confidence: confidence(options.confidence), sensitivity: options.sensitivity ?? "normal", validFrom,
    ...(validUntil ? { validUntil } : {}), createdAt: now,
    provenance: { authority: options.provenance?.authority ?? "explicit", channel: options.provenance?.channel ?? "system", observedAt: iso(options.provenance?.observedAt, now, "observed_at"), ...(options.provenance?.sessionHash ? { sessionHash: options.provenance.sessionHash } : {}) },
  };
  let result!: AgentMemoryLedger;
  await withSecurityStoreLock(ledgerFile(dirFor(principal)), async () => {
    const current = await readMemoryLedger(dirFor(principal)) ?? await (async () => { const docs = await legacyDocs(principal); return seedLedger(docs.user, docs.memory, now); })();
    if ((options.mode ?? "replace") === "replace") {
      let searchable = current.records;
      if (Date.parse(validFrom) < Date.parse(now)) {
        const archived = await readMemoryArchive(dirFor(principal));
        searchable = dedupeRecords(archived.records, current.records);
      }
      const superseded = searchable.filter((row) => row.document === document && row.key === safeKey && recordEffectiveAt(row, validFrom));
      if (superseded.length) record.supersedes = superseded.map((row) => row.id);
      const supersededIds = new Set(superseded.map((row) => row.id));
      for (const row of current.records) {
        if (supersededIds.has(row.id)) { row.supersededAt = validFrom; row.supersededBy = record.id; }
      }
    }
    current.records.push(record); current.updatedAt = now; result = await persistLedgerMutation(principal, current, now);
  });
  return snapshotFromLedger(result, now);
}

export async function forgetAgentMemory(principal: string, document: AgentMemoryDocument, key: string): Promise<AgentMemorySnapshot> {
  const safeKey = cleanKey(key), now = new Date().toISOString(); let result!: AgentMemoryLedger;
  await withSecurityStoreLock(ledgerFile(dirFor(principal)), async () => {
    const current = await readMemoryLedger(dirFor(principal)) ?? await (async () => { const docs = await legacyDocs(principal); return seedLedger(docs.user, docs.memory, now); })();
    for (const row of current.records) {
      if (row.document === document && row.key === safeKey && recordCanBeEffectiveAtOrAfter(row, now)) row.retractedAt = now;
    }
    current.updatedAt = now; result = await persistLedgerMutation(principal, current, now);
  });
  return snapshotFromLedger(result, now);
}

export async function queryAgentMemory(principal: string, query: AgentMemoryQuery = {}) {
  return queryMemoryLedger(await ledgerForQuery(principal, query), query);
}

export async function agentMemoryTelemetry(principal: string): Promise<AgentMemoryTelemetry> {
  const live = await ledgerForRead(principal);
  const archived = await readMemoryArchive(dirFor(principal));
  return collectMemoryTelemetry(live, archived.records, { segmentCount: archived.segmentCount, bytes: archived.bytes });
}
