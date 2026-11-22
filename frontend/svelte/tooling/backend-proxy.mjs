// Development/preview only. No public server or production trust policy is changed.
export function localReadProxy(value) {
  if (!value) return undefined;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)
      || !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("MSO_SVELTE_API_ORIGIN must be a loopback HTTP(S) origin without credentials or a path");
  }
  return Object.fromEntries(["/api/auth/me", "/api/v1/sys/stats"].map((path) => [
    `^${path}(?:\\?|$)`,
    {
      target: url.origin,
      changeOrigin: false,
      bypass(request, response) {
        if (request.method === "GET") return;
        response.writeHead(405, { "Allow": "GET", "Cache-Control": "no-store" });
        response.end();
        return false;
      },
    },
  ]));
}
