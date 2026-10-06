import { tenantAccess, TenantDenied, type TenantContext } from "./authority";
import type { TenantAddress, TenantCollection } from "./types";

const collections: readonly TenantCollection[] = ["memory", "sessions", "jobs", "projects", "artifacts", "backups"];
export async function readTenantValue(context: TenantContext, collection: TenantCollection, key: string): Promise<unknown | null> {
  if (!collections.includes(collection) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key)) throw new TenantDenied();
  const before = await tenantAccess(context);
  const address: Readonly<TenantAddress> = Object.freeze({ tenantId: before.binding.tenantId, principalId: before.binding.principalId,
    mappingRevision: before.binding.mappingRevision, collection, key });
  const result = await before.storage.read(address);
  const after = await tenantAccess(context);
  if (after.storage !== before.storage || after.binding !== before.binding) throw new TenantDenied();
  if (result === null) return null;
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new TenantDenied("invalid tenant storage envelope");
  for (const field of ["tenantId", "principalId", "mappingRevision", "collection", "key"] as const) {
    if (result[field] !== address[field]) throw new TenantDenied("tenant storage scope mismatch");
  }
  return structuredClone(result.value);
}
function document(value: unknown): string {
  if (value === null) return "";
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 65536) throw new TenantDenied("invalid tenant memory document");
  return value;
}
export async function readTenantMemory(context: TenantContext) {
  const results = await Promise.allSettled([
    readTenantValue(context, "memory", "USER.md"), readTenantValue(context, "memory", "MEMORY.md"),
  ]);
  const failure = results.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  const [user, memory] = results.map(result => result.status === "fulfilled" ? result.value : null);
  await tenantAccess(context);
  return { capturedAt: new Date().toISOString(), user: document(user), memory: document(memory) };
}
