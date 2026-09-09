"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AUTHED_EVENT } from "@/lib/prefs/use-prefs-sync";
import { IS_DEMO } from "@/lib/demo";
import type { DeviceRole } from "@/lib/auth/roles";
import { probeSession, type SessionSnapshot, type SessionStatus } from "./session-probe";

export type { SessionStatus } from "./session-probe";

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

  const probe = useCallback(() => probeSession(), []);

  const refresh = useCallback(async () => {
    const next = await probe();
    // `null` is deliberately NOT signed-out. A deploy/restart can race this
    // request; preserving the last authoritative snapshot keeps a valid cookie
    // from being presented as a logout while the service recovers.
    if (!next) return;
    setSnapshot(next);
    if (next.status === "in") window.dispatchEvent(new Event(AUTHED_EVENT));
  }, [probe]);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch {
      /* best-effort — clear locally regardless */
    }
    setSnapshot({ status: "out", role: null });
  }, []);

  // SSR gives the fast first paint, then the browser immediately reconciles it.
  // This closes stale HTML/CDN/BFCache windows without reintroducing a loading wall.
  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    void probe().then((next) => {
      if (alive && next) setSnapshot(next);
    });
    return () => {
      alive = false;
    };
  }, [probe]);

  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    const sync = () => {
      if (document.visibilityState !== "visible") return;
      void probe().then((next) => {
        if (alive && next) setSnapshot(next);
      });
    };
    const timer = window.setInterval(sync, 60_000);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
      window.removeEventListener("online", sync);
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
