import { getSessionContext, type SessionContext, type SessionCookieReader } from "@/lib/auth/require-session";
import { roleAtLeast, type DeviceRole } from "@/lib/auth/roles";
import { apiError } from "@/lib/host/api-error";
import { HostError } from "@/lib/host/host-error";

export type ApiContext = {
  request: Request;
  url: URL;
  params: Record<string, string>;
};

export type ApiResult =
  | Response
  | { json: unknown; status?: number; headers?: Record<string, string> };

export type AuthOptions = {
  headers?: Record<string, string> | HeadersInit;
  cookieReader?: SessionCookieReader;
  minimumRole?: DeviceRole;
};

// Web-standard Response with application/json content-type.
export function json(body: unknown, init?: number | ResponseInit): Response {
  if (typeof init === "number") {
    return new Response(JSON.stringify(body ?? null), {
      status: init,
      headers: { "content-type": "application/json" },
    });
  }
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Response(JSON.stringify(body ?? null), {
    ...init,
    headers,
  });
}

// Re-exported rather than reimplemented: lib/host/api-error.ts already owns this
// behaviour (never throws, null on malformed input) and 105 route handlers import it
// from there. Two copies of a body parser is two places for the "null vs throw"
// contract to drift.
export { readJson } from "@/lib/host/api-error";

export function toResponse(result: ApiResult): Response {
  if (result instanceof Response) return result;
  return json(result.json, {
    status: result.status ?? 200,
    headers: result.headers,
  });
}

// Catch-site wrapper mapping HostError, ENOENT, EACCES to appropriate HTTP responses.
export async function guarded(
  route: string,
  fn: () => Promise<Response | ApiResult> | Response | ApiResult,
  fallback?: { status?: number; error?: string },
): Promise<Response> {
  try {
    const res = await fn();
    return toResponse(res);
  } catch (e) {
    return apiError(route, e, fallback);
  }
}

// Session gate resolving SessionContext or returning 401/403 Response.
export async function requireSession(
  roleOrOptions?: DeviceRole | AuthOptions,
  options?: AuthOptions,
): Promise<SessionContext | Response> {
  let minimumRole: DeviceRole = "viewer";
  let opts: AuthOptions | undefined;

  if (typeof roleOrOptions === "string") {
    minimumRole = roleOrOptions;
    opts = options;
  } else if (typeof roleOrOptions === "object") {
    opts = roleOrOptions;
    minimumRole = opts?.minimumRole ?? "viewer";
  } else {
    opts = options;
  }

  const context = await getSessionContext(opts?.cookieReader);
  if (!context?.session?.device_id) {
    return json({ error: "unauthorized" }, { status: 401, headers: opts?.headers });
  }
  if (!roleAtLeast(context.role, minimumRole)) {
    return json(
      { error: minimumRole === "owner" ? "owner_required" : "forbidden" },
      { status: 403, headers: opts?.headers },
    );
  }
  return context;
}

// Owner gate shorthand. Unauthenticated yields 401; non-owner yields 403.
export async function requireOwner(
  routeOrOptions?: string | AuthOptions,
  options?: AuthOptions,
): Promise<SessionContext | Response> {
  const opts = typeof routeOrOptions === "object" ? routeOrOptions : options;
  return requireSession("owner", opts);
}

export async function getApiContext(
  req: Request,
  context?: { params?: Promise<Record<string, string>> | Record<string, string> },
): Promise<ApiContext> {
  const params = context?.params ? await context.params : {};
  return {
    request: req,
    url: new URL(req.url),
    params,
  };
}

export { apiError, HostError };
export type { SessionContext, DeviceRole };
