import { tenantAccess, TenantDenied, type TenantContext } from "./authority";
import { memoryKey, revision, validText } from "./persistence-schema";
import type { TenantMemoryWritePort } from "./types";

/** Internal seam: no public tenant write tool is enabled until its protocol/audit contract is reviewed. */
export async function writeTenantMemory(context: TenantContext, key: "USER.md" | "MEMORY.md", value: string,
  expectedStoreRevision: number, expectedDocumentVersion: number) {
  if (!memoryKey(key) || !validText(value) || !revision(expectedStoreRevision) || !revision(expectedDocumentVersion)) {
    throw new TenantDenied();
  }
  const access = await tenantAccess(context);
  const port = access.storage as Partial<TenantMemoryWritePort>;
  if (typeof port.writeMemory !== "function") throw new TenantDenied("tenant memory writes are not configured");
  // The persistent adapter checks this grant again inside its write/revocation transaction.
  return port.writeMemory({ identity: access.identity, binding: access.binding }, key, value,
    expectedStoreRevision, expectedDocumentVersion);
}
