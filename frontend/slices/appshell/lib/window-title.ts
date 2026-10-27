"use client";

import { shellStore } from "./store-state";

// document.title ⇄ focused window sync — "<Window title> — <brand>". Without
// this the tab title stays frozen on the SSR metadata no matter which app is
// focused. Started by <AppShell> (suffix = manifest.brand.name); opt out with
// manifest.titleSync: false. The pre-sync title is captured once and restored
// whenever nothing is focused.

let suffix = "";
let base: string | null = null;
let started = false;

function apply() {
  if (typeof document === "undefined") return;
  if (base === null) base = document.title;
  const id = shellStore.getFocused();
  const win = id ? shellStore.getWindow(id) : undefined;
  if (!win) {
    document.title = base;
    return;
  }
  document.title = suffix && win.title !== suffix ? `${win.title}: ${suffix}` : win.title;
}

export function configureWindowTitle(opts: { suffix?: string }) {
  if (opts.suffix !== undefined) suffix = opts.suffix;
  apply();
}

/** Idempotent — subscribes once for the page's lifetime. */
export function startWindowTitleSync() {
  if (started || typeof document === "undefined") return;
  started = true;
  shellStore.subscribe(apply);
  apply();
}
