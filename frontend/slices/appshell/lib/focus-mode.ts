"use client";

import { useSyncExternalStore } from "react";
import { registerCommands } from "./commands";
import { setToastsQuiet, toast } from "./toast";

// Focus mode (Do Not Disturb) — toasts stop popping; everything still lands
// in the Notification Center log (and badges still update). Persisted.

const KEY = "sv:focus";

function load(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(KEY) === "1";
}

let on = load();
setToastsQuiet(on);
const subs = new Set<() => void>();

export function setFocusMode(v: boolean): void {
  if (on === v) return;
  on = v;
  setToastsQuiet(v);
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
  // feedback: when turning ON this lands log-only by design — the menu-bar
  // moon/CC toggle is the visible state; turning OFF pops normally.
  toast(v ? "Focus mode on: notifications go to the center silently" : "Focus mode off");
}

export function toggleFocusMode(): void {
  setFocusMode(!on);
}

export function useFocusMode(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => on,
    () => on,
  );
}

registerCommands("focus-mode", [
  {
    id: "focus:toggle",
    label: "Toggle Focus mode",
    hint: "Focus",
    keywords: "dnd do not disturb quiet notifications silence",
    run: toggleFocusMode,
  },
]);
