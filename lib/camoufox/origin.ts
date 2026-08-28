// noVNC is third-party code with keyboard/mouse access to a logged-in browser. It
// must never share the cockpit origin: on its own host, window.top and every MSO API
// are cross-origin, while middleware maps every path only to loopback noVNC.
import { appNamespaceHost, cockpitOrigin } from "@/lib/managed-apps/origin";

export const CAMOUFOX_VIEWER_LABEL = "camoufox";

export function camoufoxViewerHost(): string | null {
  return appNamespaceHost(CAMOUFOX_VIEWER_LABEL);
}

export function camoufoxViewerOrigin(): string | null {
  const host = camoufoxViewerHost();
  return host ? `https://${host}` : null;
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
