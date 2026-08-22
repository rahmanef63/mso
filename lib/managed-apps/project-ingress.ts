// Edge-safe, opt-in machine ingress for project integrations. Default = empty,
// so stock MSO exposes no public managed-app POST lane. A deployment may declare
// exact app/method/path -> LOOPBACK routes with OS_PROJECT_INGRESS_ROUTES.
//
// MSO only performs a cheap HMAC-V2-shaped prefilter. The loopback service remains
// the cryptographic authority because MSO intentionally does not receive its secret.
export type ProjectIngressRoute = {
  app: string;
  method: "POST";
  path: string;
  target: string;
  auth: "hmac-v2-json";
  maxBodyBytes: number;
};

const MAX_ROUTES = 8;
const DEFAULT_BODY_LIMIT = 256 * 1024;
const MAX_BODY_LIMIT = 1024 * 1024;
const APP_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const PATH_RE = /^\/[a-zA-Z0-9._~!$&'()+,;=:@\/-]{1,180}$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

function validTarget(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname) || !url.port || url.username || url.password || url.search || url.hash) return null;
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !PATH_RE.test(url.pathname) || url.pathname.includes("..")) return null;
    return url.toString();
  } catch { return null; }
}

export function projectIngressRoutes(raw = process.env.OS_PROJECT_INGRESS_ROUTES ?? ""): ProjectIngressRoute[] {
  if (!raw.trim()) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed) || parsed.length > MAX_ROUTES) return [];
  const out: ProjectIngressRoute[] = [];
  const keys = new Set<string>();
  for (const row of parsed) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const r = row as Record<string, unknown>;
    const app = typeof r.app === "string" ? r.app : "";
    const method = r.method === "POST" ? "POST" : null;
    const requestPath = typeof r.path === "string" ? r.path : "";
    const target = validTarget(r.target);
    const auth = r.auth === "hmac-v2-json" ? "hmac-v2-json" : null;
    const maxBodyBytes = r.maxBodyBytes === undefined ? DEFAULT_BODY_LIMIT : Number(r.maxBodyBytes);
    if (!APP_RE.test(app) || !method || !PATH_RE.test(requestPath) || requestPath.includes("..") || !target || !auth) return [];
    if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1024 || maxBodyBytes > MAX_BODY_LIMIT) return [];
    const key = `${app}:${method}:${requestPath}`;
    if (keys.has(key)) return [];
    keys.add(key);
    out.push({ app, method, path: requestPath, target, auth, maxBodyBytes });
  }
  return out;
}

function plausibleHmacV2Json(request: Request, route: ProjectIngressRoute): boolean {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) return false;
  const seconds = Number(request.headers.get("x-webhook-timestamp") ?? "");
  if (!Number.isInteger(seconds) || Math.abs(Math.floor(Date.now() / 1000) - seconds) > 300) return false;
  if (!/^[0-9a-f]{64}$/i.test(request.headers.get("x-webhook-signature-v2") ?? "")) return false;
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader) {
    const length = Number(lengthHeader);
    if (!Number.isFinite(length) || length < 0 || length > route.maxBodyBytes) return false;
  }
  return true;
}

export function projectIngressDecision(
  request: Request,
  managedApp: string | null,
  pathname: string,
  raw = process.env.OS_PROJECT_INGRESS_ROUTES ?? "",
): { matched: false } | { matched: true; target?: string } {
  if (!managedApp) return { matched: false };
  const route = projectIngressRoutes(raw).find((candidate) =>
    candidate.app === managedApp && candidate.method === request.method && candidate.path === pathname,
  );
  if (!route) return { matched: false };
  return plausibleHmacV2Json(request, route) ? { matched: true, target: route.target } : { matched: true };
}
