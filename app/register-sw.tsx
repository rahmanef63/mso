"use client";

import { useEffect } from "react";

// One-shot guard (per tab) so recovery never loops.
const GUARD = "mso_chunk_recover";

// A failed dynamic import (new deploy → old chunk ref a stale cache/SW still
// points at) throws ChunkLoadError. Detect it broadly.
function isChunkError(v: unknown): boolean {
  const s =
    typeof v === "string"
      ? v
      : v && typeof v === "object"
        ? `${(v as { name?: string }).name ?? ""} ${(v as { message?: string }).message ?? ""}`
        : "";
  return /ChunkLoadError|Loading chunk|Failed to (load|fetch)[^]*chunk|importing a module script failed|dynamically imported module/i.test(
    s,
  );
}

async function clearCaches() {
  if (!("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* best effort */
  }
}

// Wipe caches + service workers, then hard-reload once — recovers a device
// stuck on stale chunks without the user clearing site data by hand.
async function recover() {
  if (sessionStorage.getItem(GUARD)) return;
  sessionStorage.setItem(GUARD, "1");
  await clearCaches();
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* best effort */
  }
  location.reload();
}

// New SW is installed + waiting → offer a one-tap reload. The reload clears
// caches and activates the waiting SW (SKIP_WAITING → controllerchange).
//
// `toast` is imported HERE, not at module scope. RegisterSW sits in the ROOT
// layout, and `@/features/appshell` re-exports the whole appshell barrel — so a
// top-level import put the entire OS shell (window manager, 5 shells, 10 shell
// features) into the static graph of every route, including public pages that
// render nothing but text. Deferring it to the moment an update actually exists
// keeps the shell out of the initial load and changes no behaviour: by then the
// shell is either already loaded, or there is no toast surface to render into.
async function promptUpdate(reg: ServiceWorkerRegistration) {
  const waiting = reg.waiting;
  if (!waiting || !navigator.serviceWorker.controller) return;
  let reloading = false;
  const { toast } = await import("@/features/appshell");
  toast("Versi baru tersedia.", {
    action: {
      label: "Reload",
      onClick: () => {
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => {
            if (reloading) return;
            reloading = true;
            void clearCaches().then(() => location.reload());
          },
          { once: true },
        );
        waiting.postMessage({ type: "SKIP_WAITING" });
      },
    },
  });
}

// Registers the PWA service worker + update toast + a ChunkLoadError self-heal.
export function RegisterSW() {
  useEffect(() => {
    // Clear the guard after a healthy spell so a later genuine error can recover.
    const t = setTimeout(() => sessionStorage.removeItem(GUARD), 5000);

    const onError = (e: ErrorEvent) => {
      if (isChunkError(e.error) || isChunkError(e.message)) void recover();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkError(e.reason)) void recover();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // SW update plumbing torn down on unmount.
    let updateTimer: number | undefined;
    let onVisible: (() => void) | undefined;

    if ("serviceWorker" in navigator) {
      // The waiting SW activates only when the user taps the "new version" toast
      // (SKIP_WAITING). Control then passes to the new SW → controllerchange →
      // reload ONCE for fresh assets. Guarded to an UPDATE (a controller already
      // existed); the first-ever install must NOT reload. One-shot flag = no loop.
      if (navigator.serviceWorker.controller) {
        let refreshing = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (refreshing) return;
          refreshing = true;
          void clearCaches().then(() => location.reload());
        });
      }
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          // Already-queued update from a prior tab session.
          if (reg.waiting) void promptUpdate(reg);
          // A new SW starts installing → toast once it finishes.
          reg.addEventListener("updatefound", () => {
            const sw = reg.installing;
            if (!sw) return;
            sw.addEventListener("statechange", () => {
              if (sw.state === "installed") void promptUpdate(reg);
            });
          });
          // Mobile PWAs check for SW updates lazily — force it now, on focus, and
          // on a slow interval so a fresh deploy surfaces the toast promptly
          // instead of only on the next cold launch.
          void reg.update();
          updateTimer = window.setInterval(() => void reg.update(), 60_000);
          onVisible = () => {
            if (document.visibilityState === "visible") void reg.update();
          };
          document.addEventListener("visibilitychange", onVisible);
        })
        .catch(() => {});
    }

    return () => {
      clearTimeout(t);
      if (updateTimer) window.clearInterval(updateTimer);
      if (onVisible) document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
