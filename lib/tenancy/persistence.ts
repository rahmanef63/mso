import { executeMemoryOnSnapshot, rawMemoryValue, readMemoryValue } from "./persistence-memory";
import { TENANT_LEDGER_KEY } from "./memory-ledger";
import { tenantMemoryTool, validateMemoryArguments } from "./memory-tools";
import { randomUUID } from "node:crypto";
import { TenantDenied } from "./authority";
import { tenantFile, TenantStoreConflict } from "./persistence-file";
import {
  addressKey, MAX_AUDIT, MAX_STORE_BYTES, memoryKey, revision, sameBinding, subjectKey, validAddress,
  validBinding, validId, validSubject, validText, type Membership, type SubjectKey,
  type TenantAuditEvent, type TenantSnapshot,
} from "./persistence-schema";
import type { AuthenticatedSubject, TenantAddress, TenantBinding, TenantPublicMemoryPort, TenantAuditPort } from "./types";

export async function openTenantPersistence(options: { root: string; initialize?: boolean; guard?: () => void }) {
  options.guard?.();
  const file = await tenantFile(options.root);
  await file.transaction(async (directory, sync) => {
    try { await file.read(directory); options.guard?.(); return undefined; }
    catch (error) {
      if (!options.initialize || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await file.write(directory, sync, { schema: 1, revision: 0, bindings: [], memory: [], audit: [] }, "initialize", options.guard);
      return { operationId: "initialize" };
    }
  });
  async function inspect<T>(fn: (state: TenantSnapshot) => T) {
    return file.transaction(async directory => { const s = await file.read(directory); options.guard?.(); return fn(s); });
  }
  function available(s: TenantSnapshot) { if (s.audit.length >= MAX_AUDIT || Buffer.byteLength(JSON.stringify(s)) >= MAX_STORE_BYTES - 131072) {
    throw new TenantDenied("tenant store capacity requires recovery");
  } }
  function matching(state: TenantSnapshot, address: TenantAddress) {
    return state.bindings.some(b => b.enabled && b.tenantEnabled && b.tenantId === address.tenantId
      && b.principalId === address.principalId && b.mappingRevision === address.mappingRevision);
  }
  async function mutate<T>(expected: number | null, fn: (s: TenantSnapshot, next: number) => { result: T; event: Omit<TenantAuditEvent, "id" | "revision" | "at"> }) {
    if (expected !== null && !revision(expected)) throw new TenantStoreConflict("invalid expected store revision");
    return file.transaction(async (directory, sync) => {
      const s = await file.read(directory);
      options.guard?.();
      if (expected !== null && s.revision !== expected) throw new TenantStoreConflict("tenant store revision conflict");
      if (s.audit.length >= MAX_AUDIT || s.revision === Number.MAX_SAFE_INTEGER) throw new Error("tenant store capacity reached");
      const next = s.revision + 1;
      const { result, event } = fn(s, next);
      const id = randomUUID();
      s.revision = next;
      s.audit.push({ ...event, id, revision: next, at: new Date().toISOString() });
      await file.write(directory, sync, s, id, options.guard);
      return { result, revision: next, operationId: id };
    });
  }
  const registry = Object.freeze({
    async resolve(identity: Readonly<AuthenticatedSubject>) {
      const subject = { issuer: identity.issuer, subject: identity.subject };
      if (!validSubject(subject)) throw new TenantDenied();
      return inspect(s => {
        available(s);
        const b = s.bindings.find(b => subjectKey(b) === subjectKey(subject));
        if (!b) return null;
        return { tenantId: b.tenantId, principalId: b.principalId, mappingRevision: b.mappingRevision,
          enabled: b.enabled, tenantEnabled: b.tenantEnabled };
      });
    },
  });
  const storage = Object.freeze<TenantPublicMemoryPort>({
    async read(address: Readonly<TenantAddress>) {
      const scope = { ...address };
      if (!validAddress(scope)) throw new TenantDenied();
      return inspect(s => {
        available(s);
        if (!matching(s, scope)) throw new TenantDenied();
        const value = readMemoryValue(s, scope);
        return value === null ? null : { ...scope, value };
      });
    },
    async writeMemory(grant, key, value, expectedStoreRevision, expectedDocumentVersion) {
      const request = structuredClone({ grant, key, value });
      if (!validSubject(request.grant.identity) || !validBinding(request.grant.binding)
        || !memoryKey(key) || !validText(value) || !revision(expectedDocumentVersion)) throw new TenantDenied();
      return mutate(expectedStoreRevision, (s) => {
        const { identity, binding } = request.grant;
        const live = s.bindings.find(b => subjectKey(b) === subjectKey(identity));
        if (!live || !sameBinding(live, binding) || !live.enabled || !live.tenantEnabled
          || !Number.isFinite(identity.expiresAt) || identity.expiresAt <= Date.now()) throw new TenantDenied();
        const address: TenantAddress = { tenantId: live.tenantId, principalId: live.principalId,
          mappingRevision: live.mappingRevision, collection: "memory", key: request.key };
        if (rawMemoryValue(s, { ...address, key: TENANT_LEDGER_KEY })) throw new TenantDenied("typed memory requires public memory operations");
        const old = s.memory.find(m => addressKey(m) === addressKey(address));
        if ((old?.version ?? 0) !== expectedDocumentVersion) throw new TenantStoreConflict("tenant document version conflict");
        const version = expectedDocumentVersion + 1;
        if (old) { old.value = request.value; old.version = version; }
        else s.memory.push({ ...address, value: request.value, version });
        return { result: { version }, event: { tenantId: live.tenantId, principalId: live.principalId,
          mappingRevision: live.mappingRevision, scope: "principal", action: "memory.written", key: request.key } };
      });
    },
    async operateMemory(grant, tool, args) {
      if (!tenantMemoryTool(tool)) throw new TenantDenied();
      const request = structuredClone({ grant, tool, args: validateMemoryArguments(tool, args) });
      if (tool === "agent_memory_read" || tool === "agent_memory_search") {
        return inspect(s => { available(s); return executeMemoryOnSnapshot(s, request.grant, tool, request.args).result; });
      }
      const committed = await mutate(null, s => {
        available(s);
        const outcome = executeMemoryOnSnapshot(s, request.grant, tool, request.args);
        if (!outcome.event) throw new TenantDenied();
        return { result: outcome.result, event: outcome.event };
      });
      return committed.result;
    },
  });
  // Internal control-plane adapter only. No route, tool or token grants access to these methods.
  const administration = Object.freeze({
    async setBinding(subject: SubjectKey, binding: Omit<TenantBinding, "mappingRevision">, expectedRevision: number) {
      const input = structuredClone({ subject, binding });
      if (!validSubject(input.subject) || !validBinding({ ...input.binding, mappingRevision: 1 })) throw new TenantDenied();
      return mutate(expectedRevision, (s, next) => {
        const b: Membership = { issuer: input.subject.issuer, subject: input.subject.subject,
          tenantId: input.binding.tenantId, principalId: input.binding.principalId, enabled: input.binding.enabled,
          tenantEnabled: input.binding.tenantEnabled, mappingRevision: next };
        const tenantChanged = s.bindings.some(v => v.tenantId === b.tenantId && v.tenantEnabled !== b.tenantEnabled);
        if (tenantChanged) for (const v of s.bindings) {
          if (v.tenantId === b.tenantId) { v.tenantEnabled = b.tenantEnabled; v.mappingRevision = next; }
        }
        if (s.bindings.some(v => subjectKey(v) !== subjectKey(b) && v.tenantId === b.tenantId && v.principalId === b.principalId)) {
          throw new TenantDenied("principal already bound");
        }
        const index = s.bindings.findIndex(v => subjectKey(v) === subjectKey(b));
        if (index < 0) s.bindings.push(b); else s.bindings[index] = b;
        return { result: { ...b }, event: { tenantId: b.tenantId, principalId: b.principalId,
          mappingRevision: next, scope: tenantChanged ? "tenant" : "principal", action: "binding.changed" } };
      });
    },
    async operationStatus(id: string) {
      if (!validId(id)) throw new TenantDenied();
      return inspect(s => s.audit.find(a => a.id === id) ?? null);
    },
    async status() { return inspect(s => ({ revision: s.revision, auditEntries: s.audit.length })); },
  });
  const audit = Object.freeze<TenantAuditPort>({
    async read(binding: Readonly<TenantBinding>) {
      const copy = { ...binding };
      if (!validBinding(copy)) throw new TenantDenied();
      return inspect(s => {
        available(s);
        if (!s.bindings.some(b => sameBinding(b, copy) && b.enabled && b.tenantEnabled)) throw new TenantDenied();
        return s.audit.filter(a => a.tenantId === copy.tenantId && (a.scope === "tenant" || a.principalId === copy.principalId)
          && a.mappingRevision === copy.mappingRevision).map(a => {
            if (a.scope !== "tenant") return { ...a };
            return { id: a.id, revision: a.revision, at: a.at, tenantId: a.tenantId,
              mappingRevision: a.mappingRevision, scope: a.scope, action: a.action };
          });
      });
    },
  });
  return Object.freeze({ registry, storage, administration, audit });
}
