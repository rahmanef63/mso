import { TenantDenied } from "./authority";
import { addressKey, sameBinding, subjectKey, validBinding, validSubject, type TenantSnapshot } from "./persistence-schema";
import { applyMemoryTool, memorySnapshot, TENANT_LEDGER_KEY, validateTenantLedger } from "./memory-ledger";
import type { TenantAddress, TenantGrant } from "./types";
import type { TenantMemoryTool } from "./memory-tools";

function address(grant: TenantGrant, key: string): TenantAddress {
  return { tenantId: grant.binding.tenantId, principalId: grant.binding.principalId,
    mappingRevision: grant.binding.mappingRevision, collection: "memory", key };
}
export function authorizeMemoryGrant(s: TenantSnapshot, grant: TenantGrant) {
  if (!validSubject(grant.identity) || !validBinding(grant.binding)) throw new TenantDenied();
  const live = s.bindings.find(b => subjectKey(b) === subjectKey(grant.identity));
  if (!live || !sameBinding(live, grant.binding) || !live.enabled || !live.tenantEnabled
    || !Number.isFinite(grant.identity.expiresAt) || grant.identity.expiresAt <= Date.now()) throw new TenantDenied();
  return live;
}
export function rawMemoryValue(s: TenantSnapshot, scope: TenantAddress) {
  return s.memory.find(m => addressKey(m) === addressKey(scope));
}
export function readMemoryValue(s: TenantSnapshot, scope: TenantAddress): string | null {
  const row = rawMemoryValue(s, { ...scope, key: TENANT_LEDGER_KEY });
  if (row && (scope.key === "USER.md" || scope.key === "MEMORY.md")) {
    const view = memorySnapshot(validateTenantLedger(JSON.parse(row.value)));
    return scope.key === "USER.md" ? view.user : view.memory;
  }
  return rawMemoryValue(s, scope)?.value ?? null;
}
export function executeMemoryOnSnapshot(s: TenantSnapshot, grant: TenantGrant, tool: TenantMemoryTool, args: Readonly<Record<string, unknown>>) {
  const live = authorizeMemoryGrant(s, grant), now = new Date().toISOString();
  const scope = address(grant, TENANT_LEDGER_KEY), old = rawMemoryValue(s, scope);
  const user = rawMemoryValue(s, address(grant, "USER.md"))?.value ?? "";
  const memory = rawMemoryValue(s, address(grant, "MEMORY.md"))?.value ?? "";
  if (old && (user || memory)) throw new TenantDenied("ambiguous tenant memory storage");
  if (!old && (user || memory)) {
    if (tool === "agent_memory_read") return { result: { capturedAt: now, user, memory } };
    throw new TenantDenied("raw tenant memory requires a separately reviewed import");
  }
  const ledger = old ? validateTenantLedger(JSON.parse(old.value)) : { schemaVersion: 1 as const, updatedAt: now, records: [] };
  const result = applyMemoryTool(ledger, tool, args, now);
  if (tool === "agent_memory_read" || tool === "agent_memory_search") return { result };
  const value = JSON.stringify(validateTenantLedger(ledger));
  if (old) { old.value = value; old.version += 1; }
  else s.memory.push({ ...scope, value, version: 1 });
  return { result, event: { tenantId: live.tenantId, principalId: live.principalId, mappingRevision: live.mappingRevision,
    scope: "principal" as const, action: "memory.written" as const, key: args.document as string, tool } };
}
