"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clearSensitiveFeatureState } from "@/features/appshell";
import { AUTHED_EVENT } from "@/lib/prefs/use-prefs-sync";
import { IS_DEMO } from "@/lib/demo";
import type { DeviceRole } from "@/lib/auth/roles";
import { probeSession, type SessionSnapshot, type SessionStatus } from "./session-probe";
import { createSessionTransition } from "./session-transition";

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

  const [transition] = useState(() => createSessionTransition(setSnapshot, clearSensitiveFeatureState));
  useEffect(() => {
    if (snapshot.status === "out" || (snapshot.status === "in" && snapshot.role !== "owner")) clearSensitiveFeatureState();
  }, [snapshot.status, snapshot.role]);

  const probe = useCallback(() => probeSession(), []);

  // One place that both records a probe result and announces a confirmed session.
  // AUTHED_EVENT is what lib/prefs gates its GET on, so it must fire for the mount
  // probe too, not only for an explicit refresh() — otherwise a signed-in reload
  // would leave appearance/quicklinks unsynced.
  const applyProbe = useCallback(
    (id: number, next: SessionSnapshot | null) => {
      if (transition.acceptProbe(id, next) && next?.status === "in")
        window.dispatchEvent(new Event(AUTHED_EVENT));
    },
    [transition],
  );

  const refresh = useCallback(async () => {
    const id = transition.beginProbe();
    const next = await probe();
    // `null` is deliberately NOT signed-out. A deploy/restart can race this
    // request; preserving the last authoritative snapshot keeps a valid cookie
    // from being presented as a logout while the service recovers.
    applyProbe(id, next);
  }, [applyProbe, probe, transition]);

  const signOut = useCallback(async () => {
    const id = transition.beginSignOut();
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch {
      /* best-effort — clear locally regardless */
    }
    transition.finishSignOut(id);
  }, [transition]);

  // SSR gives the fast first paint, then the browser immediately reconciles it.
  // This closes stale HTML/CDN/BFCache windows without reintroducing a loading wall.
  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    const id = transition.beginProbe();
    void probe().then((next) => {
      if (alive) applyProbe(id, next);
    });
    return () => {
      alive = false;
    };
  }, [applyProbe, probe, transition]);

  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    const sync = () => {
      if (document.visibilityState !== "visible") return;
      const id = transition.beginProbe();
      void probe().then((next) => {
        if (alive) applyProbe(id, next);
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
  }, [applyProbe, probe, transition]);

  const value = useMemo(
    () => ({ ...snapshot, refresh, signOut }),
    [snapshot, refresh, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
