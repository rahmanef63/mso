"use client";

import { useEffect, useRef } from "react";
import { shellStore, hydrateBoot, serialize, retileSnapped } from "../lib/store";
import { useAppCatalog } from "../lib/registry";
import { useShellConfig } from "../registry/shell-config";
import type { PersistedWindow } from "../lib/types";

// Window layout persists to localStorage (per-browser, debounced). No backend —
// the layout is inherently per-device, so the browser IS the right home for it.
// The key comes from the manifest (`persistKey`) so the generic shell never
// hardcodes a consumer's namespace.
//
// Restore uses hydrateBoot (merge), NOT hydrate (replace): UrlSync's URL→state
// effect runs before this hook's (UrlSync mounts earlier in <AppShell>), so a
// deep link may have opened its window already — replacing the store wiped it
// and the stale layout's focused app then rewrote the URL. The merge keeps the
// deep-link window open + focused on top of the restored layout.
export function usePersistLayout() {
  const { persistKey } = useShellConfig();
  const apps = useAppCatalog();
  const ready = useRef(false);
  // Multi-instance app ids let hydrateBoot dedupe single-instance apps only.
  // Frozen in a ref: useAppCatalog() returns a fresh array every render, and the app
  // list is static per manifest — the hydrate effect must not re-run on it.
  const multiApps = useRef(new Set(apps.filter((a) => a.multi).map((a) => a.id)));

  useEffect(() => {
    try {
      const raw = localStorage.getItem(persistKey);
      if (raw) hydrateBoot(JSON.parse(raw) as PersistedWindow[], multiApps.current);
    } catch {
      /* corrupt cache — start clean */
    }
    ready.current = true;
  }, [persistKey]);

  // Re-clamp/re-tile windows when the viewport shrinks or rotates, so a window
  // arranged on a wide screen never strands its title bar offscreen on resize.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (t) clearTimeout(t);
      t = setTimeout(retileSnapped, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (t) clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = shellStore.subscribe(() => {
      if (!ready.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(persistKey, JSON.stringify(serialize()));
        } catch {
          /* quota / private mode */
        }
      }, 600); // never persist per-frame
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [persistKey]);
}
