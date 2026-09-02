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

const DEFAULT_MCP_BROWSER_ORIGINS = new Set([
  "https://chatgpt.com",
  "https://chat.openai.com",
]);

function configuredBrowserOrigins(): Set<string> {
  const out = new Set(DEFAULT_MCP_BROWSER_ORIGINS);
  for (const raw of (process.env.OS_MCP_BROWSER_ORIGINS ?? "").split(",")) {
    const value = raw.trim();
    if (!value) continue;
    try { out.add(new URL(value).origin); } catch { /* ignore malformed operator entries */ }
  }
  return out;
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
  if (explicit && requestOrigin === explicit && configuredBrowserOrigins().has(supplied.origin)) {
    const target = new URL(explicit);
    if (!isLoopbackHostname(target.hostname)) return true;
  }
  if (requestOrigin) {
    const target = new URL(requestOrigin);
    if (isLoopbackHostname(target.hostname) && supplied.origin === requestOrigin) return true;
  }

  // Without an explicit public origin, never trust an arbitrary Host header merely
  // because a browser echoed it in Origin: that is the DNS-rebinding failure mode.
  return false;
}


export function mcpCorsHeaders(req: Request): Record<string, string> {
  const raw = req.headers.get("origin");
  if (!raw || !mcpRequestOriginAllowed(req)) return {};
  let origin: string;
  try { origin = new URL(raw).origin; } catch { return {}; }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
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

export { clientIp } from "@/lib/host/request-ip";
