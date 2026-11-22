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

// Registers the PWA service worker + a ChunkLoadError self-heal.
//
// There is deliberately no update prompting here: the new worker stays in
// waiting until the browser retires it (every tab closed), and the only in-app
// update cue is Settings. Nobody posts SKIP_WAITING, so no controllerchange
// reload guard is needed either: the page never swaps its controller under the
// user's feet.
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

    // Registration only: the worker owns the icon + manifest cache. No manual
    // `reg.update()` polling and no activation handshake, so a deploy takes
    // effect on the user's next reload instead of under a toast.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    return () => {
      clearTimeout(t);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
