// noVNC is third-party code with keyboard/mouse access to a logged-in browser. It
// must never share the cockpit origin: on its own host, window.top and every MSO API
// are cross-origin, while middleware maps every path only to loopback noVNC.
import { appNamespaceHost, cockpitOrigin } from "@/lib/managed-apps/origin";

export const CAMOUFOX_VIEWER_LABEL = "camoufox";

function configuredViewerOrigin(): URL | null {
  const raw = process.env.CAMOUFOX_VIEWER_ORIGIN?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) return null;
    return url;
  } catch {
    return null;
  }
}

export function camoufoxViewerHost(): string | null {
  return configuredViewerOrigin()?.host.toLowerCase() ?? appNamespaceHost(CAMOUFOX_VIEWER_LABEL);
}

export function camoufoxViewerOrigin(): string | null {
  const configured = configuredViewerOrigin();
  if (configured) return configured.origin;
  const host = camoufoxViewerHost();
  return host ? "https://" + host : null;
}

export function isCamoufoxViewerHost(host: string | null | undefined): boolean {
  const expected = camoufoxViewerHost();
  if (!host || !expected) return false;
  return host.split(":")[0].replace(/\.$/, "").toLowerCase() === expected;
}

export function camoufoxViewerCsp(): string {
  const cockpit = cockpitOrigin();
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    `frame-ancestors ${cockpit ?? "'none'"}`,
  ].join("; ");
}
