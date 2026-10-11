"use client";

import { useSyncExternalStore } from "react";

// Runtime app registry — apps created via Create App or installed from the App
// Store. Persisted to localStorage (per-browser) — no backend table needed. A tiny external store so app-store, create-app, and
// the shell's useRuntimeApps all read the same reactive list.

export type AppRow = {
  appId: string;
  title: string;
  glyph: string;
  gradient: string;
  runtime: string; // html | node | python | shell
  entry: string;
  source: "custom" | "store";
  installed: boolean;
};

const KEY = "mso:apps";
const EMPTY: AppRow[] = [];
let rows: AppRow[] | null = null;
const subs = new Set<() => void>();

function load(): AppRow[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(r) ? (r as AppRow[]) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function snap(): AppRow[] {
  if (rows === null) rows = load();
  return rows;
}

function commit(next: AppRow[]) {
  rows = next;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* quota / private mode */
    }
  }
  subs.forEach((f) => f());
}

function changed(event: StorageEvent) {
  if (event.key !== KEY && event.key !== null) return;
  rows = load();
  subs.forEach(f => f());
}

function subscribe(cb: () => void) {
  if (subs.size === 0) window.addEventListener("storage", changed);
  subs.add(cb);
  return () => {
    subs.delete(cb);
    if (subs.size === 0) window.removeEventListener("storage", changed);
  };
}

export function useApps(): AppRow[] {
  return useSyncExternalStore(subscribe, snap, () => EMPTY);
}

// App Store install/uninstall toggle — upsert the row's installed state.
export function setInstalled(p: {
  appId: string;
  installed: boolean;
  title: string;
  glyph: string;
  gradient: string;
  runtime: string;
  entry: string;
}) {
  const cur = snap();
  const i = cur.findIndex((a) => a.appId === p.appId);
  const next = cur.slice();
  if (i >= 0) next[i] = { ...next[i], ...p };
  else next.push({ source: "store", ...p });
  commit(next);
}

// Create App — author a new custom app (installed immediately).
export function createApp(p: {
  appId: string;
  title: string;
  glyph: string;
  gradient: string;
  runtime: string;
  entry: string;
}) {
  const cur = snap();
  if (cur.some((a) => a.appId === p.appId)) throw new Error("App slug sudah dipakai");
  commit([...cur, { ...p, source: "custom", installed: true }]);
}
