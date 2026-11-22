// Development/preview only. Mirrors Rust Stage R3F 52-route allowlist + CSRF depth-2.
// No public server or production trust policy is changed.

const ROUTES = {
  "/api/auth/me": ["GET"],
  "/api/auth/login": ["POST"],
  "/api/auth/logout": ["POST"],
  "/api/auth/devices": ["GET", "POST"],
  "/api/assistant": ["POST"],
  "/api/changelog": ["GET"],
  "/api/memory": ["GET", "POST"],
  "/api/models": ["GET"],
  "/api/prefs": ["GET", "POST"],
  "/api/skills": ["GET"],
  "/api/threads": ["GET", "POST", "PATCH", "DELETE"],
  "/api/v1/agent-groups": ["GET", "POST"],
  "/api/v1/agent-profiles": ["GET", "POST"],
  "/api/v1/agent-sessions": ["GET", "POST"],
  "/api/v1/agent-vault": ["GET", "POST"],
  "/api/v1/app-catalog": ["GET"],
  "/api/v1/camoufox/service": ["GET", "POST"],
  "/api/v1/camoufox/session": ["GET", "POST", "DELETE"],
  "/api/v1/channels": ["GET", "POST"],
  "/api/v1/desktop/containers": ["GET", "POST"],
  "/api/v1/desktop/lifecycle": ["POST"],
  "/api/v1/desktop/screenshot": ["GET"],
  "/api/v1/features": ["GET"],
  "/api/v1/infra/providers": ["GET", "POST", "DELETE"],
  "/api/v1/integrations": ["GET", "POST"],
  "/api/v1/managed-apps": ["GET"],
  "/api/v1/memory-graph": ["GET"],
  "/api/v1/organization": ["GET", "POST"],
  "/api/v1/shell-apps": ["GET", "POST"],
  "/api/v1/stock/search": ["GET"],
  "/api/v1/workflows": ["GET", "POST"],
  "/api/v1/sys/audit": ["GET"],
  "/api/v1/sys/stats": ["GET"],
  "/api/v1/sys/processes": ["GET"],
  "/api/v1/sys/services": ["GET", "POST"],
  "/api/v1/sys/packages": ["GET"],
  "/api/v1/sys/update": ["GET"],
  "/api/v1/fs/copy": ["POST"],
  "/api/v1/fs/list": ["GET"],
  "/api/v1/fs/move": ["POST"],
  "/api/v1/fs/raw": ["GET"],
  "/api/v1/fs/read": ["GET"],
  "/api/v1/fs/search": ["GET"],
  "/api/v1/fs/usage": ["GET"],
  "/api/v1/fs/write": ["POST"],
  "/api/v1/fs/mkdir": ["POST"],
  "/api/v1/fs/delete": ["DELETE"],
  "/api/v1/term/open": ["POST"],
  "/api/v1/term/stream": ["GET"],
  "/api/v1/term/input": ["POST"],
  "/api/v1/term/resize": ["POST"],
  "/api/v1/term/close": ["POST"],
};

function isCrossOriginMutation(request) {
  const method = request.method ?? "GET";
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false;
  const site = request.headers["sec-fetch-site"];
  if (typeof site === "string" && site.trim()) {
    const normalized = site.trim().toLowerCase();
    return normalized !== "same-origin" && normalized !== "none";
  }
  const origin = request.headers.origin;
  if (typeof origin === "string" && origin.trim()) {
    const expected = request.headers["x-forwarded-host"] || request.headers.host;
    try {
      return !expected || new URL(origin).host.toLowerCase() !== String(expected).toLowerCase();
    } catch {
      return true;
    }
  }
  const cookie = String(request.headers.cookie ?? "");
  return !/(?:^|;\s*)session=[^;]+/.test(cookie);
}

export function localReadProxy(value) {
  if (!value) return undefined;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)
      || !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("MSO_SVELTE_API_ORIGIN must be a loopback HTTP(S) origin without credentials or a path");
  }
  return Object.fromEntries(Object.entries(ROUTES).map(([path, methods]) => [
    `^${path}(?:\\?|$)`,
    {
      target: url.origin,
      changeOrigin: false,
      bypass(request, response) {
        if (!methods.includes(request.method)) {
          response.writeHead(405, { Allow: methods.join(", "), "Cache-Control": "no-store" });
          response.end();
          return false;
        }
        if (isCrossOriginMutation(request)) {
          response.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          response.end(JSON.stringify({ error: "cross_origin_blocked" }));
          return false;
        }
      },
    },
  ]));
}
