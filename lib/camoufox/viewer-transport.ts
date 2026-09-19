import "server-only";
import { safeProviderFetch } from "@/lib/host/ssrf";
import { camoufoxViewerOrigin } from "./origin";
import { PRIVATE_ROUTE_CODE } from "@/lib/host/provider-network-policy";
import { CAMOUFOX_VIEWER_ENTRY_PATH } from "./viewer-path";

export type ViewerTransport = {
  reachable: boolean;
  state: "reachable" | "unconfigured" | "tls" | "dns" | "network" | "http" | "client-only";
  clientOnly?: boolean;
  message: string;
  status?: number;
};

function failure(error: unknown): ViewerTransport {
  const codes: string[] = [];
  let value = error;
  for (let i = 0; i < 4 && value && typeof value === "object"; i++) {
    const row = value as { code?: unknown; name?: unknown; cause?: unknown };
    codes.push(String(row.code ?? ""), String(row.name ?? "")); value = row.cause;
  }
  const code = codes.join(" ");
  if (codes.includes(PRIVATE_ROUTE_CODE)) return {
    reachable: false, state: "client-only", clientOnly: true,
    message: "The server did not access this deployment-owned private route. The client browser must validate its HTTPS, authentication and viewer connection.",
  };
  if (/TLS|SSL|CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return {
    reachable: false, state: "tls",
    message: "The browser is running, but its separate HTTPS viewer failed TLS validation. Check certificate coverage for the exact viewer hostname; restarting the browser will not repair TLS.",
  };
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return {
    reachable: false, state: "dns", message: "The viewer hostname could not resolve. Check its DNS record before reconnecting.",
  };
  return { reachable: false, state: "network", message: "The separate HTTPS viewer could not be reached. Check its proxy route, DNS and certificate; the local browser has not been stopped." };
}

/** No cookies/passwords, no redirects, public DNS pinned by the existing SSRF guard.
 * Reachable means transport only: authentication and the VNC handshake are separate. */
export async function inspectViewerTransport(origin: string | null, fetcher = safeProviderFetch): Promise<ViewerTransport> {
  if (!origin) return { reachable: false, state: "unconfigured", message: "Configure the separate browser viewer hostname before connecting." };
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.username || url.password || url.origin !== origin) throw new Error("Invalid viewer origin");
    url.pathname = CAMOUFOX_VIEWER_ENTRY_PATH;
    const signal = AbortSignal.timeout(4_000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        fetcher(url, { method: "HEAD", redirect: "error", cache: "no-store", signal }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Viewer probe timed out")), 4_500); }),
      ]);
      await response.body?.cancel().catch(() => undefined);
      // Private viewers refuse anonymous requests. Do not forward cockpit credentials.
      if (response.ok || [401, 403, 404].includes(response.status)) return {
        reachable: true, state: "reachable", status: response.status,
        message: "HTTPS answered. Browser authentication and the VNC handshake still require client verification.",
      };
      return { reachable: false, state: "http", status: response.status, message: "The viewer proxy returned an unexpected HTTP response. Check the exact hostname route before reconnecting." };
    } finally { if (timer) clearTimeout(timer); }
  } catch (error) { return failure(error); }
}

let cached: { origin: string | null; expires: number; result: Promise<ViewerTransport> } | undefined;
export function probeViewerTransport(): Promise<ViewerTransport> {
  const origin = camoufoxViewerOrigin();
  if (cached?.origin === origin && cached.expires > Date.now()) return cached.result;
  const result = inspectViewerTransport(origin);
  cached = { origin, result, expires: Date.now() + 10_000 };
  return result;
}
