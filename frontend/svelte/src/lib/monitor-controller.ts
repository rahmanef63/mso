import { ApiError, readSession, readStats, type Session, type SysStats } from "./host-api.ts";

export type MonitorState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "ready"; session: Session; stats: SysStats }
  | { kind: "error"; message: string };

// One owner per mounted monitor. Restart/dispose invalidates every older request,
// even when a mocked or interrupted transport ignores AbortSignal.
export function createMonitor(update: (state: MonitorState) => void, fetcher = fetch) {
  let generation = 0;
  let active: AbortController | undefined;
  let disposed = false;
  return {
    async refresh() {
      if (disposed) return;
      const run = ++generation;
      active?.abort();
      const controller = active = new AbortController();
      update({ kind: "loading" });
      try {
        const session = await readSession(controller.signal, fetcher);
        if (disposed || run !== generation) return;
        if (!session.authenticated) { update({ kind: "signed-out" }); return; }
        const stats = await readStats(controller.signal, fetcher);
        if (disposed || run !== generation) return;
        update({ kind: "ready", session, stats });
      } catch (error) {
        if (disposed || run !== generation || controller.signal.aborted) return;
        update({ kind: "error", message: error instanceof ApiError
          ? error.message : "Could not reach the MSO API. Check the backend and retry." });
      }
    },
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}
