// MSO HTTP server bootstrap & error audit hook (replaces Next.js instrumentation.ts).

export async function registerServerBootstrap(): Promise<void> {
  const { cookies } = await import("next/headers");
  const { registerSessionCookieReader, SESSION_COOKIE } = await import("../auth/require-session");
  registerSessionCookieReader(async () => (await cookies()).getAll(SESSION_COOKIE));

  await Promise.all([
    import("../agent/session-files")
      .then(({ backfillConversationIndex }) => backfillConversationIndex())
      .catch(() => undefined),
    import("../agent/session-archive")
      .then(({ pruneAgentSessionArchives }) => pruneAgentSessionArchives())
      .catch(() => undefined),
    Promise.all([
      import("../workflow/graph-triggers"),
      import("../mcp/tools"),
      import("../mcp/capability-runtime"),
    ])
      .then(([{ startWorkflowScheduler }, { TOOLS_BY_NAME }, { msoCapabilityRuntime }]) =>
        startWorkflowScheduler((name) => TOOLS_BY_NAME.get(name), msoCapabilityRuntime),
      )
      .catch(() => undefined),
    import("../mcp/federation/batonly-worker")
      .then(({ startBatonlyFederationWorker }) => startBatonlyFederationWorker())
      .catch(() => undefined),
    import("../auth/nakama-password")
      .then(({ reconcileNakamaPassword }) => reconcileNakamaPassword())
      .catch(() => undefined),
  ]);

  if (!process.env.NOTIFY_SOCKET) return;
  const { execFile } = await import("node:child_process");
  const usec = parseInt(process.env.WATCHDOG_USEC ?? "0", 10);
  const intervalMs = usec > 0 ? Math.floor(usec / 2000) : 10_000;
  const ping = () => execFile("systemd-notify", ["WATCHDOG=1"], () => {});
  ping();
  setInterval(ping, intervalMs).unref();
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method?: string; headers?: Record<string, unknown> },
  context: { routerKind?: string; routeType?: string; routePath?: string } = {},
): Promise<void> {
  try {
    const { audit } = await import("../host/audit");
    const e = err instanceof Error ? err : new Error(String(err));
    await audit({
      action: "framework.error",
      ok: false,
      actor: null,
      target: request.path,
      detail: `${e.name}: ${e.message}`,
      meta: {
        routerKind: context.routerKind ?? "MSO HTTP Router",
        routeType: context.routeType ?? "route",
      },
    });
  } catch {
    // never crash here — best-effort logging only
  }
}
