import { randomUUID } from "node:crypto";
import { recordCanBeEffectiveAtOrAfter, recordEffectiveAt, resolveMemoryKey, resolveMemoryLedger } from "@/lib/agent/memory-resolution";
import { queryMemoryLedger } from "@/lib/agent/memory-query";
import type { AgentMemoryDocument, AgentMemoryKind, AgentMemoryLedger, AgentMemoryRecord, AgentMemorySensitivity } from "@/lib/agent/memory-types";
import { TenantMemoryInputError, type TenantMemoryTool } from "./memory-tools";

export const TENANT_LEDGER_KEY = "CLAIMS.v1";
export const MAX_TENANT_LEDGER_BYTES = 512 * 1024;
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const exact = (v: object, fields: string[]) => Object.keys(v).every(key => fields.includes(key));
const iso = (v: unknown): v is string => typeof v === "string" && v.length <= 32 && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const id = (v: unknown): v is string => typeof v === "string" && /^mem_[0-9a-f-]{36}$/.test(v);
export function validateTenantLedger(value: unknown): AgentMemoryLedger {
  const fail = (): never => { throw new Error("invalid tenant claim ledger"); };
  if (!object(value) || !exact(value, ["schemaVersion", "updatedAt", "records"]) || value.schemaVersion !== 1
    || !iso(value.updatedAt) || !Array.isArray(value.records) || value.records.length > 256) return fail();
  const ledger = value as unknown as AgentMemoryLedger;
  const ids = new Set<string>(), bytes = { "USER.md": 0, "MEMORY.md": 0 };
  for (const r of ledger.records) {
    if (!object(r) || !exact(r, ["id", "document", "key", "value", "kind", "confidence", "sensitivity", "validFrom", "validUntil",
      "createdAt", "provenance", "supersedes", "supersededAt", "supersededBy", "retractedAt"])
      || !id(r.id) || ids.has(r.id) || !["USER.md", "MEMORY.md"].includes(r.document)
      || typeof r.key !== "string" || !/^[^\r\n\0]{1,80}$/.test(r.key) || r.key.startsWith("#")
      || typeof r.value !== "string" || !r.value || Buffer.byteLength(r.value) > 8192
      || !["semantic", "episodic", "procedural"].includes(r.kind) || !["normal", "private", "restricted"].includes(r.sensitivity)
      || !Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 1 || !iso(r.createdAt) || !iso(r.validFrom)
      || (r.validUntil !== undefined && (!iso(r.validUntil) || Date.parse(r.validUntil) <= Date.parse(r.validFrom)))
      || (r.supersededAt !== undefined && !iso(r.supersededAt)) || (r.retractedAt !== undefined && !iso(r.retractedAt))
      || (r.supersededBy !== undefined && !id(r.supersededBy))
      || (r.supersedes !== undefined && (!Array.isArray(r.supersedes) || r.supersedes.length > 256 || r.supersedes.some(x => !id(x))))
      || !object(r.provenance) || !exact(r.provenance, ["authority", "channel", "observedAt"])
      || r.provenance.authority !== "explicit" || r.provenance.channel !== "mcp" || !iso(r.provenance.observedAt)) return fail();
    ids.add(r.id); bytes[r.document] += Buffer.byteLength("## " + r.key + "\n" + r.value + "\n\n");
  }
  if (Object.values(bytes).some(n => n > 65536) || Buffer.byteLength(JSON.stringify(ledger)) > MAX_TENANT_LEDGER_BYTES) return fail();
  const records = new Map(ledger.records.map(r => [r.id, r]));
  for (const r of ledger.records) {
    if (Date.parse(r.createdAt) > Date.parse(ledger.updatedAt) || r.provenance.observedAt !== r.createdAt) return fail();
    for (const ref of [...(r.supersedes ?? []), ...(r.supersededBy ? [r.supersededBy] : [])]) {
      const target = records.get(ref);
      if (!target || target.id === r.id || target.document !== r.document || target.key !== r.key) return fail();
    }
  }
  return ledger;
}
export function memorySnapshot(ledger: AgentMemoryLedger, at = new Date().toISOString()) {
  const docs: Record<AgentMemoryDocument, string[]> = { "USER.md": [], "MEMORY.md": [] };
  for (const { record } of resolveMemoryLedger(ledger, at)) docs[record.document].push("## " + record.key + "\n" + record.value);
  const text = (document: AgentMemoryDocument) => docs[document].length ? docs[document].join("\n\n") + "\n" : "";
  return { capturedAt: at, user: text("USER.md"), memory: text("MEMORY.md"), schemaVersion: 1, recordCount: ledger.records.length };
}
export function applyMemoryTool(ledger: AgentMemoryLedger, tool: TenantMemoryTool, a: Readonly<Record<string, unknown>>, now: string) {
  if (tool === "agent_memory_read") return memorySnapshot(ledger, now);
  if (tool === "agent_memory_search") return queryMemoryLedger(ledger, { query: a.query as string | undefined,
    document: a.document as AgentMemoryDocument | undefined, kind: a.kind as AgentMemoryKind | undefined,
    at: a.at as string | undefined, limit: a.limit as number | undefined, includeHistory: a.include_history === true });
  const document = a.document as AgentMemoryDocument, key = (a.key as string).trim();
  if (tool === "agent_memory_forget") {
    for (const r of ledger.records) if (r.document === document && r.key === key && recordCanBeEffectiveAtOrAfter(r, now)) r.retractedAt = now;
  } else {
    const validFrom = a.valid_from === undefined ? now : new Date(a.valid_from as string).toISOString();
    const validUntil = a.valid_until === undefined ? undefined : new Date(a.valid_until as string).toISOString();
    if (validUntil && Date.parse(validUntil) <= Date.parse(validFrom)) throw new TenantMemoryInputError("invalid tenant memory validity interval");
    const r: AgentMemoryRecord = { id: "mem_" + randomUUID(), document, key, value: (a.value as string).trim(),
      kind: (a.kind as AgentMemoryKind | undefined) ?? "semantic", confidence: Math.round(((a.confidence as number | undefined) ?? 1) * 1000) / 1000,
      sensitivity: (a.sensitivity as AgentMemorySensitivity | undefined) ?? "normal", validFrom, ...(validUntil ? { validUntil } : {}), createdAt: now,
      provenance: { authority: "explicit", channel: "mcp", observedAt: now } };
    const current = resolveMemoryKey(ledger, document, key, now)?.record;
    const mode = a.mode ?? "replace";
    if (mode === "replace" && a.valid_from === undefined && a.valid_until === undefined && current
      && current.value === r.value && current.kind === r.kind && current.confidence === r.confidence && current.sensitivity === r.sensitivity) return memorySnapshot(ledger, now);
    if (mode === "replace") {
      const old = ledger.records.filter(v => v.document === document && v.key === key && recordEffectiveAt(v, validFrom));
      if (old.length) r.supersedes = old.map(v => v.id);
      for (const v of old) { v.supersededAt = validFrom; v.supersededBy = r.id; }
    }
    ledger.records.push(r);
  }
  ledger.updatedAt = now;
  validateTenantLedger(ledger);
  return memorySnapshot(ledger, now);
}
