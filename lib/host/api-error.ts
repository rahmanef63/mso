// Response + input helpers for /api/v1 route handlers. One catch-site
// one-liner: curated HostError messages pass through (400, they're UX);
// everything else is logged server-side with the route name and replaced by a
// generic message so raw Node errors (ENOENT/EACCES with absolute paths) and
// unexpected exceptions never leak to the client.
import { NextResponse } from "next/server";
import { HostError } from "./host-error";

export function apiError(
  route: string,
  e: unknown,
  fallback: { status?: number; error?: string } = {},
): NextResponse {
  if (e instanceof HostError)
    return NextResponse.json({ error: e.message }, { status: e.status });
  // A missing path or a permission denial is a fact about the REQUEST, not a
  // server fault. They used to fall through to 500, which sends a client (and a
  // reader of the logs) hunting a broken server when the file simply is not there
  // — a browser e2e caught it as `500 GET /api/v1/fs/read` for a path that had
  // been opened from mock data. The message stays generic: the raw Node error
  // carries an absolute path and must not reach the client.
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT" || code === "ENOTDIR")
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (code === "EACCES" || code === "EPERM")
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  console.error(`[api/v1/${route}]`, e);
  return NextResponse.json(
    { error: fallback.error ?? "Operation failed" },
    { status: fallback.status ?? 500 },
  );
}

// Body parse that never throws — malformed/absent JSON becomes null, which the
// field checks below turn into a 400 instead of an unhandled 500.
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// Minimal validation (no zod): the string field, or null when the body/field
// is missing or the wrong type. Empty/whitespace fails unless allowEmpty.
export function requireString(
  body: unknown,
  key: string,
  opts: { allowEmpty?: boolean } = {},
): string | null {
  if (typeof body !== "object" || body === null) return null;
  const v = (body as Record<string, unknown>)[key];
  if (typeof v !== "string") return null;
  if (!opts.allowEmpty && !v.trim()) return null;
  return v;
}

// Optional string field: undefined when absent, null when present but invalid.
export function optionalString(body: unknown, key: string): string | undefined | null {
  if (typeof body !== "object" || body === null) return undefined;
  const v = (body as Record<string, unknown>)[key];
  if (v === undefined || v === null) return undefined;
  return typeof v === "string" ? v : null;
}

// Required integer field within [min, max] (rounds floats); null when the
// body/field is missing, the wrong type, or out of range.
export function requireInt(
  body: unknown,
  key: string,
  min: number,
  max: number,
): number | null {
  if (typeof body !== "object" || body === null) return null;
  const v = (body as Record<string, unknown>)[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= min && n <= max ? n : null;
}

export function invalidRequest(field: string): NextResponse {
  return NextResponse.json({ error: `Invalid request: ${field}` }, { status: 400 });
}
