import type { DeviceRole } from "@/lib/auth/roles";

export type SessionStatus = "loading" | "out" | "in";
export type SessionSnapshot = { status: SessionStatus; role: DeviceRole | null };

const DEVICE_ROLES = new Set<DeviceRole>(["viewer", "operator", "owner"]);

/**
 * Resolve only an authoritative successful auth response. `null` means the
 * probe was indeterminate (network/5xx/malformed) and callers must preserve
 * their last known session state instead of inventing a logout.
 */
export function resolveSessionProbe(status: number, body: unknown): SessionSnapshot | null {
  if (status < 200 || status >= 300 || typeof body !== "object" || body === null) return null;
  const candidate = body as { authenticated?: unknown; role?: unknown };
  if (typeof candidate.authenticated !== "boolean") return null;
  if (!candidate.authenticated) return { status: "out", role: null };
  const role = DEVICE_ROLES.has(candidate.role as DeviceRole)
    ? (candidate.role as DeviceRole)
    : "viewer";
  return { status: "in", role };
}

export async function probeSession(
  fetcher: typeof fetch = fetch,
): Promise<SessionSnapshot | null> {
  try {
    const response = await fetcher("/api/auth/me", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    return resolveSessionProbe(response.status, body);
  } catch {
    return null;
  }
}
