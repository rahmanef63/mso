import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";

export async function a2aOwnerContext() {
  const context = await getSessionContext();
  return context?.role === "owner" ? context : null;
}

export function a2aRouteError(error: unknown): NextResponse {
  const message =
    error instanceof Error ? error.message : "A2A operation failed";
  const status = /not found/i.test(message)
    ? 404
    : /ambiguous/i.test(message)
      ? 409
      : 400;
  return NextResponse.json({ error: message.slice(0, 240) }, { status });
}

export function a2aHash(value?: string): string | undefined {
  return value
    ? createHash("sha256").update(value).digest("hex").slice(0, 24)
    : undefined;
}

export function a2aLimited(
  actor: string,
  action: string,
  max: number,
): boolean {
  return rateLimited(`a2a:${action}:${actor}`, max, 60_000);
}

export function auditA2AFailure(
  action: string,
  actor: string,
  target: string,
  body: Record<string, unknown> | null,
  error: unknown,
): void {
  const detail = String((error as Error).message).slice(0, 160);
  if (action === "register" || action === "remove") {
    void audit({
      action: "a2a.registry",
      actor,
      target: target || String(body?.url || ""),
      ok: false,
      detail,
    });
  } else if (
    action.startsWith("credential") ||
    action.startsWith("inbound-token")
  ) {
    void audit({ action: "a2a.credential", actor, target, ok: false, detail });
  } else if (action === "cancel") {
    void audit({ action: "a2a.cancel", actor, target, ok: false, detail });
  } else if (action === "send" || action === "stream" || action === "handoff") {
    void audit({ action: "a2a.send", actor, target, ok: false, detail });
  }
}
