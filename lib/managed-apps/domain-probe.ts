import type { ManagedDomainConfig } from "@/lib/contracts/managed-domains";
import { cleanDomainOrigin, domainHostname } from "./domain-config";

async function probe(origin: string, hostname: string, appId: string, local: boolean): Promise<void> {
  cleanDomainOrigin(origin, local); domainHostname(hostname);
  const headers = local ? { host: hostname } : undefined;
  const response = await fetch(new URL("/__mso_app_bootstrap.js", origin), {
    headers, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000),
  });
  await response.body?.cancel();
  if (response.status !== 200 || response.headers.get("x-mso-managed-app") !== appId || !response.headers.get("content-type")?.startsWith("application/javascript")) {
    throw new Error(local
      ? "MSO app-host routing is not active locally; run mso domain repair-env --apply, then mso deploy (or mso update --rebuild for a gateway-owned runtime), and retry"
      : "public hostname does not reach the selected MSO application auth gate");
  }
  const anonymous = await fetch(new URL("/dashboard", origin), {
    headers, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000),
  });
  await anonymous.body?.cancel();
  if (anonymous.status !== 401 || anonymous.headers.get("x-mso-managed-app") !== appId) throw new Error("anonymous application access is not rejected by MSO; refusing to report the domain ready");
}

export function probeLocalManagedDomain(config: ManagedDomainConfig, hostname: string, appId: string): Promise<void> {
  return probe(config.localOrigin, hostname, appId, true);
}
export async function probePublicManagedDomain(hostname: string, appId: string): Promise<void> {
  try { await probe(`https://${hostname}`, hostname, appId, false); }
  catch (error) {
    const message = error instanceof Error ? error.message : "HTTPS probe failed";
    throw new Error(`HTTPS/auth verification pending for ${hostname}: ${message}. Check DNS propagation, the tunnel connector and a certificate covering this exact hostname; retry mso domain ensure ${appId} --apply`);
  }
}
