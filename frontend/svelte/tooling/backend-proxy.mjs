// Development/preview only. Mirrors Rust Stage R2A route allowlist + CSRF depth-2.
// No public server or production trust policy is changed.

const ROUTES = {
  "/api/auth/me": ["GET"],
  "/api/auth/login": ["POST"],
  "/api/auth/logout": ["POST"],
  "/api/auth/devices": ["GET", "POST"],
  "/api/v1/sys/stats": ["GET"],
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
