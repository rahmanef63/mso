// noVNC is third-party code with keyboard/mouse access to a logged-in browser. It
// must never share the cockpit origin: on its own host, window.top and every MSO API
// are cross-origin, while middleware maps every path only to loopback noVNC.
import { configuredSessionCookieScope } from "@/lib/auth/session-cookie";
import { appNamespaceHost, cockpitOrigin } from "@/lib/managed-apps/origin";

export const CAMOUFOX_VIEWER_LABEL = "camoufox";

const normalizeHost = (value: string) => value.replace(/\.$/, "").toLowerCase();
const domainMatches = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);

function currentCookieDomain(): string | null {
  const scope = configuredSessionCookieScope();
  return scope.startsWith("domain:") ? scope.slice("domain:".length) : null;
}

function cockpitHost(): string | null {
  const origin = cockpitOrigin();
  if (!origin) return null;
  try { return normalizeHost(new URL(origin).hostname); }
  catch { return null; }
}

function viewerHostIsIsolated(host: string): boolean {
  host = normalizeHost(host);
  const cockpit = cockpitHost();
  if (cockpit && host === cockpit) return false;
  const cookieDomain = currentCookieDomain();
  return !cookieDomain || !domainMatches(host, cookieDomain);
}

function configuredViewerOrigin(): URL | null {
  const raw = process.env.CAMOUFOX_VIEWER_ORIGIN?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !viewerHostIsIsolated(url.hostname)
    ) return null;
    return url;
  } catch {
    return null;
  }
}

function derivedSiblingHost(): string | null {
  // Managed-app deployments commonly widen the cockpit cookie only to a namespace
  // such as mso.example.com. Place Camoufox beside that namespace so the browser
  // cannot send the cockpit cookie to the viewer at all.
  const cookieDomain = currentCookieDomain();
  if (cookieDomain) {
    const labels = cookieDomain.split(".");
    if (labels.length < 3) return null;
    const candidate = `${CAMOUFOX_VIEWER_LABEL}.${labels.slice(1).join(".")}`;
    return viewerHostIsIsolated(candidate) ? candidate : null;
  }

  // Host-only cockpit cookies are already isolated by hostname. Prefer a sibling
  // of the cockpit host when one can be derived without guessing a public suffix.
  const cockpit = cockpitHost();
  if (cockpit) {
    const labels = cockpit.split(".");
    if (labels.length >= 3) {
      const candidate = `${CAMOUFOX_VIEWER_LABEL}.${labels.slice(1).join(".")}`;
      if (viewerHostIsIsolated(candidate)) return candidate;
    }
  }

  // Legacy host-template fallback remains safe only for host-only sessions.
  const namespaced = appNamespaceHost(CAMOUFOX_VIEWER_LABEL);
  return namespaced && viewerHostIsIsolated(namespaced) ? namespaced : null;
}

export function camoufoxViewerHost(): string | null {
  return configuredViewerOrigin()?.hostname.toLowerCase() ?? derivedSiblingHost();
}

export function camoufoxViewerOrigin(): string | null {
  const configured = configuredViewerOrigin();
  if (configured) return configured.origin;
  const host = derivedSiblingHost();
  return host ? `https://${host}` : null;
}

export function isCamoufoxViewerHost(host: string | null | undefined): boolean {
  const expected = camoufoxViewerHost();
  if (!host || !expected) return false;
  return normalizeHost(host.split(":")[0]) === expected;
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
