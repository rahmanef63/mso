type PageRequest = Pick<Request, "method" | "headers">;
type HeaderResponse = { headers: Headers };

function isAuthSensitivePageRequest(request: PageRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const accept = (request.headers.get("accept") ?? "").toLowerCase();
  return (
    accept.includes("text/html") ||
    request.headers.get("rsc") === "1" ||
    request.headers.has("next-router-prefetch") ||
    request.headers.has("next-router-state-tree")
  );
}

function appendVary(headers: Headers, token: string): void {
  const current = (headers.get("vary") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!current.some((value) => value.toLowerCase() === token.toLowerCase())) current.push(token);
  headers.set("Vary", current.join(", "));
}

/** Browser documents/RSC contain cookie-derived auth state and must never be shared. */
export function applyPrivatePageCachePolicy(response: HeaderResponse, request: PageRequest): void {
  if (!isAuthSensitivePageRequest(request)) return;
  response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  appendVary(response.headers, "Cookie");
}
