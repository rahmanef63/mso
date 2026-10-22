// Permission policy for ACP `session/request_permission`, kept pure: no transport, no
// process, no clock. Everything here is a decision about the menu the agent offered.

export interface AcpPermissionOption { optionId: string; kind: string; name: string }
export interface AcpPermissionRequest { sessionId: string; toolCall: Record<string, unknown>; options: AcpPermissionOption[] }
/** Returns true only for a NARROW allow. An absent policy means DENY. */
export type AcpPermissionPolicy = (request: AcpPermissionRequest) => boolean | Promise<boolean>;

/**
 * The decision for one `session/request_permission`, or null when no offered option
 * can express it — the caller must treat null as a cancelled turn, never as consent.
 * `allow_always` is deliberately unselectable: t3code's lesson is that an "always"
 * grant is project-wide, so MSO answers `once` only and a prompt-injected agent cannot
 * widen a supervised session.
 */
export function permissionOutcome(options: readonly AcpPermissionOption[], allow: boolean) {
  const wanted = allow ? ["allow_once"] : ["reject_once", "reject_always"];
  const chosen = options.find(option => wanted.includes(option.kind))
    ?? (allow ? undefined : options.find(option => option.kind.startsWith("reject")));
  return chosen ? { outcome: "selected" as const, optionId: chosen.optionId } : null;
}

export function parsePermissionRequest(raw: unknown): AcpPermissionRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const params = raw as Record<string, unknown>;
  if (typeof params.sessionId !== "string" || !Array.isArray(params.options)) return null;
  const options: AcpPermissionOption[] = [];
  for (const row of params.options) {
    const option = row as Record<string, unknown> | undefined;
    if (!option || typeof option.optionId !== "string" || typeof option.kind !== "string") return null;
    options.push({ optionId: option.optionId, kind: option.kind, name: typeof option.name === "string" ? option.name : option.optionId });
  }
  return { sessionId: params.sessionId, toolCall: (params.toolCall as Record<string, unknown>) ?? {}, options };
}
