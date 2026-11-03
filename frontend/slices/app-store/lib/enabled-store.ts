"use client";

import { useSyncExternalStore } from "react";

// Which built-in apps / shell features the owner has turned OFF in the App Store.
// We persist the DISABLED set (not the enabled one) so anything new ships ENABLED
// by default — adding an app or feature later never needs a migration and never
// silently vanishes. Per-browser, like the runtime app registry (apps-store.ts).
// `app-store` itself can never be disabled: it is the surface that re-enables
// everything else, so disabling it would be a lock-out.

const KEY = "mso:disabled";
const MANDATORY = new Set<string>(["app-store"]);

let ids: string[] | null = null;
const subs = new Set<() => void>();
const EMPTY: string[] = [];

function load(): string[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(r) ? (r as string[]) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function snap(): string[] {
  if (ids === null) ids = load();
  return ids;
}

function commit(next: string[]) {
  if (typeof window !== "undefined") {
    try { localStorage.setItem(KEY, JSON.stringify(next)); }
    catch { throw new Error("Browser storage could not save this change. Free some space or allow site storage, then try again."); }
  }
  ids = next;
  subs.forEach((notify) => notify());
}

function subscribe(cb: () => void) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

// Reactive list of disabled ids (apps + features). os-root filters the manifest
// by it; the store reads it to drive the per-entry toggle state.
export function useDisabledIds(): string[] {
  return useSyncExternalStore(subscribe, snap, () => EMPTY);
}

// Enable (remove from the disabled set) or disable (add to it). Mandatory ids
// can never be disabled.
export function setEnabled(id: string, on: boolean) {
  if (!on && MANDATORY.has(id)) return;
  const cur = snap();
  const has = cur.includes(id);
  if (on && has) commit(cur.filter((x) => x !== id));
  else if (!on && !has) commit([...cur, id]);
}
