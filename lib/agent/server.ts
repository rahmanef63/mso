// SERVER-ONLY. Session + live device-role gate for /api/v1 routes. Host fs/exec/sys
// are handled locally in @/lib/host (mso runs on the host).
import { requireSession } from "@/lib/auth/require-session";
import type { DeviceRole } from "@/lib/auth/roles";
import { IS_DEMO } from "@/lib/demo";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const VIEWER_READ_PATHS = new Set([
  "/api/v1/apps",
  "/api/v1/sys/stats",
  "/api/v1/sys/processes",
]);
const VIEWER_READ_PREFIXES = [
  "/api/v1/fs/",
  "/api/v1/stock/",
  "/api/v1/temp-share/",
];
const OWNER_PREFIXES = [
  "/api/v1/exec/",
  "/api/v1/editor/",
  "/api/v1/term/",
  "/api/v1/sys/audit",
  "/api/v1/sys/cleanup",
  "/api/v1/sys/update",
];

/**
 * Default-deny policy for the host API.
 *
 * - Viewer reads are explicit. A newly-added GET cannot silently expose host data.
 * - Every unclassified route requires owner. A new POST cannot become an operator
 *   action just because its author forgot to add a policy row.
 * - Operator exceptions are narrow product surfaces with their own allowlists or
 *   bounded lifecycle contracts.
 */
export function requiredRoleForRequest(req?: Request): DeviceRole {
  if (!req) return "viewer";
  let pathname = "";
  try { pathname = new URL(req.url).pathname; } catch { return "owner"; }
  const method = req.method.toUpperCase();

  if (pathname === "/api/v1/sys/services/logs") return "operator";
  if (pathname === "/api/v1/sys/services") return READ_METHODS.has(method) ? "viewer" : "operator";
  if (pathname === "/api/v1/sys/packages") return "viewer";

  if (pathname.startsWith("/api/v1/camoufox/")) return "operator";
  if (pathname.startsWith("/api/v1/managed-apps/")) {
    if (pathname.includes("/install") || pathname.includes("/update")) return "owner";
    // A job may be an install/update/rollback/uninstall started by Owner. Reading
    // its progress is operational; terminating it changes an Owner-authorized flow.
    if (method === "DELETE" && /\/jobs\/[a-f0-9]{24}$/.test(pathname)) return "owner";
    return "operator";
  }
  if (pathname === "/api/v1/managed-apps") return "operator";

  if (OWNER_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return "owner";
  if (READ_METHODS.has(method) && (
    VIEWER_READ_PATHS.has(pathname) || VIEWER_READ_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  )) return "viewer";
  return "owner";
}

// Cookie-only auth. An explicit role is allowed for unusual callers; ordinary
// /api/v1 routes rely on the policy above so new mutations fail closed.
export async function verifyAuth(req?: Request, minimumRole?: DeviceRole): Promise<boolean> {
  if (IS_DEMO) return false;
  return requireSession(minimumRole ?? requiredRoleForRequest(req));
}
