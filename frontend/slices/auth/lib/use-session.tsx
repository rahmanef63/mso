"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AUTHED_EVENT } from "@/lib/prefs/use-prefs-sync";
import { IS_DEMO } from "@/lib/demo";
import type { DeviceRole } from "@/lib/auth/roles";

export type SessionStatus = "loading" | "out" | "in";

type SessionSnapshot = { status: SessionStatus; role: DeviceRole | null };
type SessionValue = SessionSnapshot & {
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue>({
  status: "out",
  role: null,
  refresh: async () => {},
  signOut: async () => {},
});

export function SessionProvider({
  initialStatus,
  initialRole,
  children,
}: {
  initialStatus?: SessionStatus;
  initialRole?: DeviceRole | null;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => ({
    status: IS_DEMO ? "out" : (initialStatus ?? "loading"),
    role: IS_DEMO || initialStatus !== "in" ? null : (initialRole ?? "viewer"),
  }));

  const probe = useCallback(async (): Promise<SessionSnapshot> => {
    if (IS_DEMO) return { status: "out", role: null };
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      const body = (await response.json()) as { authenticated?: boolean; role?: DeviceRole | null };
      return body.authenticated
        ? { status: "in", role: body.role ?? "viewer" }
        : { status: "out", role: null };
    } catch {
      return { status: "out", role: null };
    }
  }, []);

  const refresh = useCallback(async () => {
    const next = await probe();
    setSnapshot(next);
    if (next.status === "in") window.dispatchEvent(new Event(AUTHED_EVENT));
  }, [probe]);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* best-effort — clear locally regardless */
    }
    setSnapshot({ status: "out", role: null });
  }, []);

  useEffect(() => {
    if (IS_DEMO || initialStatus !== undefined) return;
    let alive = true;
    probe().then((next) => alive && setSnapshot(next));
    return () => { alive = false; };
  }, [probe, initialStatus]);

  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    const sync = () => {
      if (document.visibilityState !== "visible") return;
      probe().then((next) => { if (alive) setSnapshot(next); });
    };
    const timer = window.setInterval(sync, 60_000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [probe]);

  const value = useMemo(
    () => ({ ...snapshot, refresh, signOut }),
    [snapshot, refresh, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
