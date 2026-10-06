import { TenantDenied } from "./authority";

export function tenantPreviewEnabled(): boolean {
  const mode = process.env.OS_TENANCY_MODE;
  if (mode === undefined || mode === "" || mode === "legacy") return false;
  if (mode === "tenant-preview") return true;
  throw new TenantDenied("invalid tenancy mode");
}
