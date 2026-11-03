"use client";

import { useEffect, useRef } from "react";
import { shellStore, hydrateBoot, serialize, retileSnapped } from "../lib/store";
import { useApps } from "../lib/registry";
import { useShellConfig } from "../registry/shell-config";
import { parseLayout } from "../lib/parse-layout";

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
  const apps = useApps();
  const ready = useRef(false);
  // Multi-instance app ids let hydrateBoot dedupe single-instance apps only.
  // Frozen in a ref: useApps() returns a fresh array every render, and the app
  // list is static per manifest — the hydrate effect must not re-run on it.
  const multiApps = useRef(new Set(apps.filter((a) => a.multi).map((a) => a.id)));

  useEffect(() => {
    try {
      const raw = localStorage.getItem(persistKey);
      if (raw) hydrateBoot(parseLayout(raw), multiApps.current);
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
    let pending = false;
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!pending) return;
      try {
        localStorage.setItem(persistKey, JSON.stringify(serialize()));
        pending = false;
      } catch { /* quota / private mode */ }
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    const unsub = shellStore.subscribe(() => {
      if (!ready.current) return;
      pending = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 600);
    });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      flush();
      unsub();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [persistKey]);
}
