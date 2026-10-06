import { TenantDenied } from "./authority";
import type { TenantBinding, TenantCredentialBinding } from "./types";

const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v);
const fields = ["version", "issuer", "subject", "tenantId", "principalId", "mappingRevision"];
export function parseTenantCredential(value: unknown): Readonly<TenantCredentialBinding> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TenantDenied("invalid tenant credential binding");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !fields.includes(key)) || v.version !== 1
    || !id(v.issuer) || !id(v.subject) || !id(v.tenantId) || !id(v.principalId)
    || !Number.isSafeInteger(v.mappingRevision) || Number(v.mappingRevision) < 1) {
    throw new TenantDenied("invalid tenant credential binding");
  }
  return Object.freeze({ version: 1, issuer: v.issuer, subject: v.subject, tenantId: v.tenantId,
    principalId: v.principalId, mappingRevision: v.mappingRevision as number });
}
export function tenantCredentialFields(record: { tenantSubject?: unknown; tenantBinding?: unknown }): { tenantBinding?: Readonly<TenantCredentialBinding> } {
  // Subject-only records have no approved generation and cannot be grandfathered.
  if (record.tenantSubject !== undefined) throw new TenantDenied("unversioned tenant credential");
  return record.tenantBinding === undefined ? {} : { tenantBinding: parseTenantCredential(record.tenantBinding) };
}
export function credentialMatchesBinding(stamp: Readonly<TenantCredentialBinding>, binding: Readonly<TenantBinding>) {
  return binding.enabled === true && binding.tenantEnabled === true && stamp.tenantId === binding.tenantId
    && stamp.principalId === binding.principalId && stamp.mappingRevision === binding.mappingRevision;
}
