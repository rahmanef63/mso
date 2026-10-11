"use client";

import { useSyncExternalStore } from "react";

// One browser-wide installation record for every shell; legacy opt-outs survive.
const KEY = "mso:enabled:v1";
const LEGACY_KEY = "mso:disabled";
export const ESSENTIAL_APP_IDS = ["files-manager", "camoufox-browser", "os-terminal", "app-store", "assistant", "hermes", "os-settings"];
const ESSENTIAL = new Set(ESSENTIAL_APP_IDS);
export type EnabledOverrides = Record<string, boolean>;
const EMPTY: EnabledOverrides = {};
let state: EnabledOverrides | null = null;
const subs = new Set<() => void>();
const validId = (id: string) => /^[a-z0-9][a-z0-9-]{0,79}$/.test(id);

export function parseEnabled(value: unknown): EnabledOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY;
  return Object.fromEntries(Object.entries(value).filter(([id, on]) => validId(id) && typeof on === "boolean"));
}

export function isAppEnabled(id: string, overrides: EnabledOverrides): boolean {
  return id === "app-store" || (Object.hasOwn(overrides, id) ? overrides[id] : ESSENTIAL.has(id));
}

function load(): EnabledOverrides {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) return parseEnabled(JSON.parse(raw));
    const legacy: unknown = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
    return Array.isArray(legacy) ? Object.fromEntries(legacy.filter((id): id is string => typeof id === "string" && validId(id)).map(id => [id, false])) : EMPTY;
  } catch { return EMPTY; }
}

function snap(): EnabledOverrides {
  state ??= load();
  return state;
}

function changed(event: StorageEvent) {
  if (event.key !== KEY && event.key !== LEGACY_KEY && event.key !== null) return;
  state = load();
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

export function useEnabledOverrides(): EnabledOverrides {
  return useSyncExternalStore(subscribe, snap, () => EMPTY);
}

// Uninstall only changes menu availability; app files, services and layouts stay.
export function setEnabled(id: string, on: boolean) {
  if (!validId(id) || (id === "app-store" && !on)) return;
  state = { ...snap(), [id]: on };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: session-only */ }
  subs.forEach(f => f());
}
