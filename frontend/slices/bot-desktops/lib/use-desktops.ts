"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  desktopAction,
  isRunning,
  listDesktops,
  type BotDesktop,
  type LifecycleAction,
} from "./api";

/**
 * Bot desktop inventory + the four lifecycle verbs, as one hook.
 *
 * Polling is visibility-gated: each tick shells out to `docker ps`, so a
 * backgrounded tab must not keep paying for it. Ten seconds is the same cadence the
 * managed-apps slice uses, for the same reason.
 */
export function useDesktops() {
  const [desktops, setDesktops] = useState<BotDesktop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ container: string; lines: string[] } | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      setDesktops(await listDesktops(signal));
      setError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : "Could not read bot desktops");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initial = window.setTimeout(() => void refresh(controller.signal), 0);
    const tick = () => {
      if (!document.hidden) void refresh(controller.signal);
    };
    const timer = window.setInterval(tick, 10_000);
    const onVisibility = () => {
      if (!document.hidden) void refresh(controller.signal);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      controller.abort();
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const act = useCallback(
    async (container: string, action: LifecycleAction) => {
      setBusy(`${container}:${action}`);
      try {
        const result = await desktopAction(container, action);
        if (action === "logs") setLogs({ container: result.container, lines: result.logs ?? [] });
        // The verb already re-read the inventory; use it rather than waiting a tick.
        if (result.state) {
          setDesktops((current) => current.map((row) => (row.name === result.state?.name ? result.state : row)));
        }
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : `${action} failed`);
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const running = useMemo(() => desktops.filter(isRunning).length, [desktops]);

  return { desktops, running, loading, error, busy, logs, refresh, act, clearLogs: () => setLogs(null) };
}
