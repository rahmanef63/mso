// Next 16 framework error hook. Routes uncaught render/RSC/route errors into
// the audit module so they land in the same forensic trail as exec/fs/auth
// events — no extra log channel, no extra ops surface. Best-effort: this
// handler must NEVER throw (would mask the real error).
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Enforce private session-archive retention at boot even when no new session
  // reaches the compaction threshold for weeks. Best-effort: retention cleanup
  // must never make the application fail to start.
  void import("./lib/agent/session-archive")
    .then(({ pruneAgentSessionArchives }) => pruneAgentSessionArchives())
    .catch(() => undefined);
  // systemd liveness: when the unit sets WatchdogSec, systemd exposes
  // NOTIFY_SOCKET + WATCHDOG_USEC. Node has no native AF_UNIX SOCK_DGRAM
  // (dgram is UDP-only), so we ping via the `systemd-notify` binary — which
  // requires NotifyAccess=all in the unit, since the ping comes from a child
  // PID, not main. A missed ping past WatchdogSec → systemd restarts us; this
  // catches a wedged event loop that Restart=always (crash-only) can't.
  // No-op in dev / demo / CI where NOTIFY_SOCKET is unset.
  if (!process.env.NOTIFY_SOCKET) return;
  const { execFile } = await import("node:child_process");
  const usec = parseInt(process.env.WATCHDOG_USEC ?? "0", 10);
  const intervalMs = usec > 0 ? Math.floor(usec / 2000) : 10_000; // half the deadline, in ms
  const ping = () => execFile("systemd-notify", ["WATCHDOG=1"], () => {});
  ping();
  setInterval(ping, intervalMs).unref();
}

export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  try {
    const { audit } = await import("./lib/host/audit");
    const e = err instanceof Error ? err : new Error(String(err));
    // Route shape goes into structured `meta` (since the audit field exists)
    // instead of being packed into `target` — easier to filter with `jq`,
    // greppable as `routerKind`/`routeType` keys, and leaves `target` clean
    // for the actual path the request hit.
    await audit({
      action: "framework.error",
      ok: false,
      actor: null,
      target: request.path,
      detail: `${e.name}: ${e.message}`,
      meta: {
        routerKind: context.routerKind,
        routeType: context.routeType,
      },
    });
  } catch {
    // never crash here — best-effort logging only
  }
};
