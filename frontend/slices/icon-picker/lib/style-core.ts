const KEY = "icon-picker:style";
const LEGACY_KEYS = ["nosion:iconStyle"] as const;
export const DEFAULT_ICON_STYLE = "twemoji" as const;

export type Style = "twemoji" | "native";

let current: Style = DEFAULT_ICON_STYLE;
let hydrated = false;
let storageBound = false;
const listeners = new Set<() => void>();

function isStyle(value: unknown): value is Style {
  return value === "twemoji" || value === "native";
}

function readStorage(): Style {
  if (typeof window === "undefined") return DEFAULT_ICON_STYLE;
  const raw = window.localStorage.getItem(KEY);
  if (isStyle(raw)) return raw;
  for (const legacy of LEGACY_KEYS) {
    const value = window.localStorage.getItem(legacy);
    if (!isStyle(value)) continue;
    try {
      window.localStorage.setItem(KEY, value);
      window.localStorage.removeItem(legacy);
    } catch {
      // Preserve the migrated in-memory value even when storage is unavailable.
    }
    return value;
  }
  return DEFAULT_ICON_STYLE;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function ensureHydrated(): void {
  if (hydrated || typeof window === "undefined") return;
  current = readStorage();
  hydrated = true;
  if (storageBound) return;
  storageBound = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY) return;
    const next = readStorage();
    if (next === current) return;
    current = next;
    notify();
  });
}

export function subscribeIconStyle(listener: () => void): () => void {
  ensureHydrated();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getIconStyleSnapshot(): Style {
  ensureHydrated();
  return current;
}

export function getIconStyleServerSnapshot(): Style {
  return DEFAULT_ICON_STYLE;
}

export function setIconStyle(next: Style): void {
  ensureHydrated();
  if (next === current) return;
  current = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      console.warn("[iconStyle] localStorage write failed");
    }
  }
  notify();
}

export function readIconStyle(): Style {
  return getIconStyleSnapshot();
}
