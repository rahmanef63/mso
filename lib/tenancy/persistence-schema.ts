import { MAX_TENANT_LEDGER_BYTES, TENANT_LEDGER_KEY, validateTenantLedger } from "./memory-ledger";
import type { AuthenticatedSubject, TenantAddress, TenantBinding, TenantAuditEvent } from "./types";

export const MAX_STORE_BYTES = 16 * 1024 * 1024;
export const MAX_AUDIT = 10_000;
export const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v);
export const revision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export const memoryKey = (v: unknown): v is "USER.md" | "MEMORY.md" => v === "USER.md" || v === "MEMORY.md";
export const validText = (v: unknown): v is string => typeof v === "string" && Buffer.byteLength(v, "utf8") <= 65536;
export type SubjectKey = Pick<AuthenticatedSubject, "issuer" | "subject">;
export type Membership = SubjectKey & TenantBinding;
export type MemoryRecord = TenantAddress & { value: string; version: number };
export type { TenantAuditEvent } from "./types";
export type TenantSnapshot = {
  schema: 1; revision: number; bindings: Membership[]; memory: MemoryRecord[]; audit: TenantAuditEvent[];
};
export function subjectKey(v: SubjectKey) { return JSON.stringify([v.issuer, v.subject]); }
export function addressKey(v: TenantAddress) {
  return JSON.stringify([v.tenantId, v.principalId, v.mappingRevision, v.collection, v.key]);
}
export function validSubject(v: SubjectKey) { return validId(v.issuer) && validId(v.subject); }
export function validBinding(v: TenantBinding) {
  return validId(v.tenantId) && validId(v.principalId) && revision(v.mappingRevision) && v.mappingRevision > 0
    && typeof v.enabled === "boolean" && typeof v.tenantEnabled === "boolean";
}
export function sameBinding(a: TenantBinding, b: TenantBinding) {
  return a.tenantId === b.tenantId && a.principalId === b.principalId && a.mappingRevision === b.mappingRevision
    && a.enabled === b.enabled && a.tenantEnabled === b.tenantEnabled;
}
export function validAddress(v: TenantAddress) {
  return validId(v.tenantId) && validId(v.principalId) && revision(v.mappingRevision) && v.mappingRevision > 0
    && v.collection === "memory" && (memoryKey(v.key) || v.key === TENANT_LEDGER_KEY);
}
function storedMemory(m: MemoryRecord) {
  if (m.key !== TENANT_LEDGER_KEY) return validText(m.value);
  if (typeof m.value !== "string" || Buffer.byteLength(m.value) > MAX_TENANT_LEDGER_BYTES) return false;
  try { validateTenantLedger(JSON.parse(m.value)); return true; } catch { return false; }
}
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
function keys(v: object, allowed: string[]) { return Object.keys(v).every(k => allowed.includes(k)); }
function unique(values: string[]) { return new Set(values).size === values.length; }
export function validateSnapshot(value: unknown): TenantSnapshot {
  const fail = () => { throw new Error("invalid tenant persistence snapshot"); };
  if (!object(value) || !keys(value, ["schema", "revision", "bindings", "memory", "audit"]) || value.schema !== 1 || !revision(value.revision)
    || !Array.isArray(value.bindings) || value.bindings.length > 1000
    || !Array.isArray(value.memory) || value.memory.length > 4000
    || !Array.isArray(value.audit) || value.audit.length > MAX_AUDIT) return fail();
  const s = value as unknown as TenantSnapshot;
  if (s.bindings.some(b => !object(b) || !keys(b, ["issuer", "subject", "tenantId", "principalId", "mappingRevision", "enabled", "tenantEnabled"]) || !validSubject(b) || !validBinding(b) || b.mappingRevision > s.revision)
    || !unique(s.bindings.map(subjectKey))
    || !unique(s.bindings.map(b => JSON.stringify([b.tenantId, b.principalId])))) return fail();
  if (s.bindings.some(b => s.bindings.some(other => b.tenantId === other.tenantId && b.tenantEnabled !== other.tenantEnabled))) return fail();
  if (s.memory.some(m => !object(m) || !keys(m, ["tenantId", "principalId", "mappingRevision", "collection", "key", "value", "version"]) || !validAddress(m) || !storedMemory(m)
    || !revision(m.version) || m.version < 1 || m.version > s.revision || m.mappingRevision > s.revision)
    || !unique(s.memory.map(addressKey))) return fail();
  for (const ledger of s.memory.filter(m => m.key === TENANT_LEDGER_KEY)) {
    if (s.memory.some(m => m.tenantId === ledger.tenantId && m.principalId === ledger.principalId
      && m.mappingRevision === ledger.mappingRevision && m.key !== TENANT_LEDGER_KEY && m.value !== "")) return fail();
  }
  if (s.audit.length !== s.revision || s.audit.some((a, i) => !object(a) || !keys(a, ["id", "revision", "at", "tenantId", "principalId", "mappingRevision", "scope", "action", "key", "tool"]) || !validId(a.id)
    || a.revision !== i + 1 || !validId(a.tenantId) || !validId(a.principalId)
    || !revision(a.mappingRevision) || a.mappingRevision < 1 || a.mappingRevision > a.revision
    || typeof a.at !== "string" || a.at.length > 32 || !Number.isFinite(Date.parse(a.at))
    || !["principal", "tenant"].includes(a.scope) || (a.action === "memory.written" && a.scope !== "principal")
    || !["binding.changed", "memory.written"].includes(a.action)
    || (a.tool !== undefined && (a.action !== "memory.written" || !["agent_memory_remember", "agent_memory_forget"].includes(a.tool)))
    || (a.action === "memory.written" ? !memoryKey(a.key) : a.key !== undefined))
    || !unique(s.audit.map(a => a.id))) return fail();
  return s;
}
