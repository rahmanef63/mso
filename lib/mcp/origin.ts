// The origin an MCP client must be told to use. Discovery metadata is
// origin-scoped (RFC 8414 / 9728), so getting this wrong is the single most common
// way a connector fails with "MCP server does not implement OAuth".
//
// Precedence mirrors lib/managed-apps/proxy-headers: OS_PUBLIC_ORIGIN is
// deployment-owned and wins; the real Host header comes next; X-Forwarded-Host is
// client-settable and is consulted LAST.

function normalizedConfiguredOrigin(): string | null {
  const explicit = process.env.OS_PUBLIC_ORIGIN?.trim();
  if (!explicit) return null;
  try {
    return new URL(explicit).origin;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

function requestHeaderOrigin(req: Request): string | null {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  const host = req.headers.get("host")?.trim() || url.host;
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

/**
 * Streamable HTTP requires Origin validation to prevent a browser from using DNS
 * rebinding to reach a local MCP listener. Server-to-server MCP clients normally
 * omit Origin and remain unaffected. If OS_PUBLIC_ORIGIN is configured, browser
 * requests must match it; a browser opened directly on the loopback cockpit is
 * also allowed to probe the loopback route used by Settings → MCP.
 */
export function mcpRequestOriginAllowed(req: Request): boolean {
  const raw = req.headers.get("origin");
  if (!raw) return true;

  let supplied: URL;
  try {
    supplied = new URL(raw);
  } catch {
    return false;
  }

  const explicit = normalizedConfiguredOrigin();
  if (explicit && supplied.origin === explicit) return true;

  const requestOrigin = requestHeaderOrigin(req);
  if (requestOrigin) {
    const target = new URL(requestOrigin);
    if (isLoopbackHostname(target.hostname) && supplied.origin === requestOrigin) return true;
  }

  // Without an explicit public origin, never trust an arbitrary Host header merely
  // because a browser echoed it in Origin: that is the DNS-rebinding failure mode.
  return false;
}

export function publicOrigin(req: Request): string {
  const explicit = process.env.OS_PUBLIC_ORIGIN?.trim();
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      // Misconfigured value (a bare hostname, no scheme) — fall through to the
      // headers rather than emit a URL no client can resolve.
    }
  }
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  const host = req.headers.get("host") ?? req.headers.get("x-forwarded-host") ?? url.host;
  return `${proto}://${host}`;
}

/** Best-effort client IP for the pre-auth rate limiter. Spoofable behind a proxy
 *  that does not overwrite the header — which is why it only ever gates rate
 *  limits, never authorization. */
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}
